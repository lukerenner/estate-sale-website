// Shopify "newly-listed" -> blog-post sync. Files are the source of truth:
// dedupe is "does any blog/posts/*.md already have source.id === this
// product's id", scanned fresh every run, never a state file.
//
// New product (no matching post) -> download + optimize images, write a
// sourceType: shop post. Existing shop post whose product now shows
// variants[].available: false, and whose post isn't already sold: true ->
// flip sold: true in place only; nothing else about the file changes.

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

function downloadTmp(url, destPath) {
  execFileSync("curl", ["-sL", "-A", "Mozilla/5.0", url, "-o", destPath]);
}

export async function syncShop({ postsDir = "blog/posts", imagesRoot = "assets/images/blog", tmpDir = ".tmp-shop-sync-images" } = {}) {
  const report = { created: [], updatedSold: [], skippedExisting: [] };
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

  for (const product of products) {
    const existing = postsById.get(String(product.id));
    const anyAvailable = (product.variants || []).some((v) => v.available);

    if (existing) {
      if (!anyAvailable && !existing.fm.sold) {
        const filePath = path.join(postsDir, existing.file);
        const updated = readFileSync(filePath, "utf8").replace(/^sold:\s*false\s*$/m, "sold: true");
        const finalContent = /^sold:\s*true\s*$/m.test(updated) ? updated : updated.replace(/^(sourceType: shop)$/m, "$1\nsold: true");
        writeFileSync(filePath, finalContent);
        report.updatedSold.push(existing.file);
      } else {
        report.skippedExisting.push(product.handle);
      }
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
