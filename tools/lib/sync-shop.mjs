// Shopify "newly-listed" -> blog-post sync. Files are the source of truth:
// dedupe is "does any blog/posts/*.md already have source.id === this
// product's id", scanned fresh every run, never a state file.
//
// New product (no matching post) -> download + optimize images, write a
// sourceType: shop post.
//
// Sold status is re-checked for EVERY existing shop post on every run, and
// flipped in place (the `sold:` line only; nothing else about the file
// changes). The newly-listed feed can't answer this on its own: Shopify drops
// a product from the collection the moment it sells, so a sold item simply
// stops appearing rather than showing up as unavailable. Posts whose product
// is missing from the feed are therefore looked up one by one on the
// storefront (/products/<handle>.js):
//   - 404 (sold and archived/deleted/unpublished)   -> sold: true
//   - 200 with available: false (sold out)           -> sold: true
//   - 200 with available: true (relisted, returned)  -> sold: false
//   - anything else (429, 5xx, network)              -> leave as-is, retry next run
// so a transient error can never mark something sold by mistake.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import matter from "gray-matter";
import { optimizeGallery } from "./optimize-images.mjs";
import { htmlToMarkdown } from "./html-to-markdown.mjs";
import { slugify } from "./suggest-slug.mjs";

const PRODUCTS_URL = "https://shop.garygermer.com/collections/newly-listed/products.json";

async function fetchAllProducts() {
  const all = [];
  for (let pageNum = 1; ; pageNum++) {
    const res = await fetch(`${PRODUCTS_URL}?limit=250&page=${pageNum}`);
    if (!res.ok) throw new Error(`Shopify products.json fetch failed: ${res.status}`);
    const data = await res.json();
    const products = data.products || [];
    if (!products.length) break;
    all.push(...products);
  }
  return all;
}

function yamlString(str) {
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// true = can be bought, false = sold/gone, null = couldn't tell this run.
// Paced and retried because the storefront rate-limits bursts with 429s.
async function productAvailable(handle) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(`https://shop.garygermer.com/products/${encodeURIComponent(handle)}.js`, {
        headers: { "User-Agent": "gg-blog-sync", Accept: "application/json" },
      });
    } catch {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return false;
    if (res.ok) {
      try {
        const product = await res.json();
        return Boolean(product.available);
      } catch {
        return null;
      }
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 * (attempt + 1);
      await sleep(retryAfter * 1000);
      continue;
    }
    return null;
  }
  return null;
}

// Rewrites only the front-matter `sold:` line (adding one after
// `sourceType: shop` for any post that predates the field).
function setSold(filePath, sold) {
  const text = readFileSync(filePath, "utf8");
  const updated = /^sold:\s*(true|false)\s*$/m.test(text)
    ? text.replace(/^sold:\s*(true|false)\s*$/m, `sold: ${sold}`)
    : text.replace(/^(sourceType: shop)$/m, `$1\nsold: ${sold}`);
  if (updated !== text) writeFileSync(filePath, updated);
}

// Brings every existing shop post's `sold:` flag in line with the store.
// `feedById` is the newly-listed feed keyed by product id; anything not in
// it is looked up individually. `dryRun` reports without writing.
export async function refreshSoldStatus(postsById, feedById, { postsDir = "blog/posts", dryRun = false, delayMs = 600 } = {}) {
  const result = { markedSold: [], markedAvailable: [], unknown: [] };
  for (const [id, post] of postsById) {
    let available;
    const inFeed = feedById.get(id);
    if (inFeed) {
      available = (inFeed.variants || []).some((v) => v.available);
    } else {
      available = await productAvailable(post.fm.source.handle);
      await sleep(delayMs);
    }
    if (available === null) {
      result.unknown.push(post.file);
      continue;
    }
    const isSold = Boolean(post.fm.sold);
    if (!available && !isSold) {
      if (!dryRun) setSold(path.join(postsDir, post.file), true);
      result.markedSold.push(post.file);
    } else if (available && isSold) {
      if (!dryRun) setSold(path.join(postsDir, post.file), false);
      result.markedAvailable.push(post.file);
    }
  }
  return result;
}

function downloadTmp(url, destPath) {
  execFileSync("curl", ["-sL", "-A", "Mozilla/5.0", url, "-o", destPath]);
}

export async function syncShop({ postsDir = "blog/posts", imagesRoot = "assets/images/blog", tmpDir = ".tmp-shop-sync-images" } = {}) {
  const report = { created: [], updatedSold: [], updatedAvailable: [], soldUnknown: [], skippedExisting: [] };
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const postFiles = readdirSync(postsDir).filter((f) => f.endsWith(".md"));
  const postsById = new Map();
  for (const file of postFiles) {
    const full = matter(readFileSync(path.join(postsDir, file), "utf8"));
    const fm = full.data;
    if (fm.sourceType === "shop" && fm.source && fm.source.id != null) {
      postsById.set(String(fm.source.id), { file, fm, raw: full });
    }
  }

  const products = await fetchAllProducts();
  const existingSlugs = postFiles.map((f) => f.replace(/\.md$/, ""));

  const feedById = new Map(products.map((p) => [String(p.id), p]));
  const sold = await refreshSoldStatus(postsById, feedById, { postsDir });
  report.updatedSold = sold.markedSold;
  report.updatedAvailable = sold.markedAvailable;
  report.soldUnknown = sold.unknown;

  for (const product of products) {
    if (postsById.has(String(product.id))) {
      report.skippedExisting.push(product.handle);
      continue;
    }

    const images = product.images || [];
    if (!images.length) continue;

    let slug = slugify(product.title);
    if (existingSlugs.includes(slug)) slug = `${slug}-${product.id}`;
    existingSlugs.push(slug);

    const outDir = path.join(imagesRoot, slug);
    const tmpPaths = [];
    for (const [i, img] of images.entries()) {
      const ext = path.extname(new URL(img.src).pathname) || ".jpg";
      const tmpPath = path.join(tmpDir, `${slug}-${i}${ext}`);
      try {
        downloadTmp(img.src, tmpPath);
        tmpPaths.push(tmpPath);
      } catch {
        // one bad image shouldn't block the whole product
      }
    }
    if (!tmpPaths.length) continue;

    const { manifest } = optimizeGallery(tmpPaths, outDir, slug, 12);
    if (!manifest.length) continue;

    const hero = manifest[0];
    const price = product.variants && product.variants[0] ? `$${product.variants[0].price}` : "";
    const bodyMarkdown = htmlToMarkdown(product.body_html);
    // Some listings open with a boilerplate condition-assessment disclaimer
    // rather than descriptive text — skip it and use the next paragraph so
    // the card excerpt and og:description say something about the item.
    const paragraphs = bodyMarkdown.split("\n\n").map((p) => p.trim()).filter(Boolean);
    const description = paragraphs.find((p) => !/^PLEASE VIEW ALL PHOTOS FOR PROPER CONDITION ASSESSMENT\.?$/i.test(p)) || product.title;
    const galleryTag = manifest.length > 1 ? `\n\n{% blogGallery "${slug}", ${manifest.length} %}\n` : "";

    const lines = [
      "layout: layouts/blog-post.njk",
      `permalink: /blog/${slug}/`,
      `slug: ${slug}`,
      `title: ${yamlString(product.title)}`,
      `description: ${yamlString(description.slice(0, 300))}`,
      `ogTitle: ${yamlString(product.title)}`,
      `ogDescription: ${yamlString(description.slice(0, 200))}`,
      `ogImage: /assets/images/blog/${slug}/${hero.base}-900.webp`,
      "category: show-and-tell",
      "sourceType: shop",
      `galleryCount: ${manifest.length}`,
      "source:",
      `  id: ${product.id}`,
      `  handle: ${product.handle}`,
      `publishDate: "${(product.published_at || new Date().toISOString()).slice(0, 10)}"`,
      `shopUrl: https://shop.garygermer.com/products/${product.handle}`,
      `price: ${yamlString(price)}`,
      "sold: false",
      "heroImage:",
      `  src: /assets/images/blog/${slug}/${hero.base}-900.webp`,
      `  srcset900: /assets/images/blog/${slug}/${hero.base}-900.webp`,
      `  srcsetFull: /assets/images/blog/${slug}/${hero.base}-1400.webp`,
      `  width: ${hero.width}`,
      `  height: ${hero.height}`,
      `  alt: ${yamlString(product.title)}`,
    ];
    const content = "---\n" + lines.join("\n") + "\n---\n\n" + bodyMarkdown + galleryTag + "\n";
    writeFileSync(path.join(postsDir, `${slug}.md`), content);
    report.created.push(slug);
  }

  return report;
}
