// One-time bulk import: 1.0 legacy /media/blog/* posts -> 2.0 blog/posts/*.md
// Run from a LOCAL SCRATCH COPY of the repo, never against the Google Drive
// path directly (see the project's CLAUDE.md). Mirrors import-legacy-sales.mjs's
// shape: hardcoded per-item URL/category table, per-item loop (parse -> resolve
// slug -> download+optimize images -> assemble front matter -> write file),
// accumulate a JSON report at the end.
//
// Usage: node tools/import-legacy-blog.mjs <path-to-legacy-html-dir> <output-report.json>
//   <legacy-html-dir> holds one .html file per post, already fetched with curl
//   (not this script) so the exact source markup is preserved for parsing.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseLegacyBlogPage } from "./lib/parse-legacy-blog.mjs";
import { optimizeNamedImage, convertTiers } from "./lib/optimize-images.mjs";
import { suggestSlug, slugify } from "./lib/suggest-slug.mjs";

const [, , htmlDir, reportPath] = process.argv;
if (!htmlDir || !reportPath) {
  console.error("Usage: node import-legacy-blog.mjs <legacy-html-dir> <report.json>");
  process.exit(1);
}

const OUTPUT_POSTS_DIR = path.resolve("blog/posts");
const OUTPUT_IMAGES_ROOT = path.resolve("assets/images/blog");
const TMP_IMAGES_DIR = path.resolve(".tmp-blog-import-images");

// Per-post URL + category, from the confirmed 1.0 sitemap (see PLAN). Category
// comes from the URL segment; posts with no category segment are the Show &
// Tell catch-all (only a-love-for-loving-art, per the confirmed sitemap).
const POSTS = [
  { file: "estate-sales__earlier-works-are-better.html", urlPath: "/media/blog/estate-sales/earlier-works-are-better", category: "estate-sales" },
  { file: "a-love-for-loving-art.html", urlPath: "/media/blog/a-love-for-loving-art", category: "show-and-tell" },
  { file: "show-and-tell__time-in-space-the-stars-theyve-seen.html", urlPath: "/media/blog/show-and-tell/time-in-space-the-stars-theyve-seen", category: "show-and-tell" },
  { file: "show-and-tell__faces-of-folklore.html", urlPath: "/media/blog/show-and-tell/faces-of-folklore", category: "show-and-tell" },
  { file: "estate-sales__free-hornung-mller-piano.html", urlPath: "/media/blog/estate-sales/free-hornung-mller-piano", category: "estate-sales" },
  { file: "appraisals__painting-appraisal-apple-blossem.html", urlPath: "/media/blog/appraisals/painting-appraisal-apple-blossem", category: "appraisals" },
  { file: "appraisals__what-to-do-before-an-antique-furniture-appraisal-why-get-one.html", urlPath: "/media/blog/appraisals/what-to-do-before-an-antique-furniture-appraisal-why-get-one", category: "appraisals" },
  { file: "appraisals__how-to-tell-if-a-painting-is-valuable.html", urlPath: "/media/blog/appraisals/how-to-tell-if-a-painting-is-valuable", category: "appraisals" },
  { file: "appraisals__how-to-get-antiques-appraised-in-oregon.html", urlPath: "/media/blog/appraisals/how-to-get-antiques-appraised-in-oregon", category: "appraisals" },
  { file: "estate-sales__how-to-have-an-estate-sale-in-portland-oregon-6-tips-for-success.html", urlPath: "/media/blog/estate-sales/how-to-have-an-estate-sale-in-portland-oregon-6-tips-for-success", category: "estate-sales" },
  { file: "show-and-tell__we-found-a-pony-in-the-manure.html", urlPath: "/media/blog/show-and-tell/we-found-a-pony-in-the-manure", category: "show-and-tell" },
  { file: "estate-sales__ancient-aliens-at-our-next-estate-sale.html", urlPath: "/media/blog/estate-sales/ancient-aliens-at-our-next-estate-sale", category: "estate-sales" },
  { file: "show-and-tell__rare-and-stunning-tiffany-co-184-piece-sterling-silver-flatware.html", urlPath: "/media/blog/show-and-tell/rare-and-stunning-tiffany-co-184-piece-sterling-silver-flatware", category: "show-and-tell" },
  { file: "show-and-tell__makonde-tree-of-life-sculptures.html", urlPath: "/media/blog/show-and-tell/makonde-tree-of-life-sculptures", category: "show-and-tell" },
];

function yamlString(str) {
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function downloadImage(url, destPath) {
  execFileSync("curl", ["-sL", "-A", "Mozilla/5.0", url, "-o", destPath]);
}

function run() {
  const report = { imported: [], skipped: [], warnings: [] };
  if (!existsSync(OUTPUT_POSTS_DIR)) mkdirSync(OUTPUT_POSTS_DIR, { recursive: true });
  if (!existsSync(TMP_IMAGES_DIR)) mkdirSync(TMP_IMAGES_DIR, { recursive: true });

  const existingSlugs = existsSync(OUTPUT_POSTS_DIR)
    ? readdirSync(OUTPUT_POSTS_DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
    : [];

  for (const item of POSTS) {
    const htmlPath = path.join(htmlDir, item.file);
    if (!existsSync(htmlPath)) {
      report.skipped.push({ file: item.file, reason: "source HTML not found at " + htmlPath });
      continue;
    }
    const html = readFileSync(htmlPath, "utf8");
    const parsed = parseLegacyBlogPage(html, item.urlPath);

    if (!parsed.title) {
      report.skipped.push({ file: item.file, reason: "no headline found in JSON-LD — needs manual review" });
      continue;
    }

    const slugResult = suggestSlug({ propertyName: parsed.title, existingSlugs });
    // "<title> estate sale" isn't right for a blog post — strip that suffix
    // suggestSlug's propertyName branch always appends for sale slugs.
    const slug = slugify(slugResult.slug.replace(/-estate-sale$/, ""));
    existingSlugs.push(slug);

    let publishDate = null, dateConfidence = "explicit-jsonld";
    if (parsed.datePublished) {
      publishDate = parsed.datePublished.slice(0, 10);
    } else {
      report.warnings.push({ slug, issue: "NO PUBLISH DATE in source JSON-LD — needs manual publishDate" });
      dateConfidence = "MISSING";
    }

    // ---- images: download every referenced image, first = hero -----------
    // A handful of legacy posts (video embeds, or plain-text posts with no
    // inline photo) have zero usable <img> in the body; the JSON-LD Article
    // "image" is always present on this site's template, so it's the hero
    // fallback rather than skipping the post entirely.
    const outDir = path.join(OUTPUT_IMAGES_ROOT, slug);
    const downloaded = [];
    let usedFallbackHero = false;
    const bodyImages = parsed.images.filter((img) => !/youtube\.com\/embed/.test(img.src));
    bodyImages.forEach((img, i) => {
      const ext = path.extname(new URL(img.src).pathname) || ".jpg";
      const tmpPath = path.join(TMP_IMAGES_DIR, `${slug}-${i}${ext}`);
      try {
        downloadImage(img.src, tmpPath);
        downloaded.push({ tmpPath, alt: img.alt || parsed.title });
      } catch (e) {
        report.warnings.push({ slug, issue: `failed to download image ${img.src}: ${e.message}` });
      }
    });

    if (!downloaded.length && parsed.ogImageUrl) {
      const ext = path.extname(new URL(parsed.ogImageUrl).pathname) || ".jpg";
      const tmpPath = path.join(TMP_IMAGES_DIR, `${slug}-fallback${ext}`);
      try {
        downloadImage(parsed.ogImageUrl, tmpPath);
        downloaded.push({ tmpPath, alt: parsed.title });
        usedFallbackHero = true;
      } catch (e) {
        report.warnings.push({ slug, issue: `failed to download fallback og:image ${parsed.ogImageUrl}: ${e.message}` });
      }
    }

    if (!downloaded.length) {
      report.skipped.push({ slug, reason: "zero images downloaded (body + og:image fallback both failed) — cannot build hero image" });
      continue;
    }

    const heroSource = downloaded[0];
    const heroDims = optimizeNamedImage(heroSource.tmpPath, outDir, `${slug}-hero`, { withJpg: true });

    // Remaining images (index 1+) become numbered body images, in the same
    // order they'll appear via {% blogImage %} in the Markdown body.
    const bodyImageBases = {};
    downloaded.slice(1).forEach((img, i) => {
      const base = `${slug}-${String(i + 1).padStart(2, "0")}`;
      convertTiers(img.tmpPath, outDir, base);
      bodyImageBases[i + 1] = { base, alt: img.alt };
    });

    // ---- body: replace [[IMG:n]] tokens with the shortcode call -----------
    const bodyParagraphs = parsed.bodyParagraphs.map((p) =>
      p.replace(/\[\[IMG:(\d+)\]\]/g, (m, nStr) => {
        const n = Number(nStr);
        if (n === 0) return ""; // hero image, already shown by the layout — drop from body
        const entry = bodyImageBases[n];
        if (!entry) return "";
        return `{% blogImage "${entry.base}", ${JSON.stringify(entry.alt)} %}`;
      })
      // Ucraft wraps some images in a zoom-link <a> whose only "text" after
      // tag-stripping was the now-removed image token — collapses to an
      // empty [](url); drop those rather than leave a dead link.
      .replace(/\[\]\([^)]*\)/g, "")
    ).filter((p) => p.trim().length > 0);

    const description = parsed.description || bodyParagraphs[0]?.replace(/[_*[\]()#]/g, "").slice(0, 200) || parsed.title;

    if (!bodyParagraphs.length) {
      // Image-only legacy post (no text ever existed in the source beyond
      // the JSON-LD description) — reuse that description as the body's
      // one paragraph rather than ship a bare hero with no copy at all.
      report.warnings.push({ slug, issue: "body had no text paragraphs after normalization — reused JSON-LD description as body copy" });
      bodyParagraphs.push(description);
    }

    const frontMatterLines = [
      "layout: layouts/blog-post.njk",
      `permalink: /blog/${slug}/`,
      `slug: ${slug}`,
      `title: ${yamlString(parsed.title)}`,
      `description: ${yamlString(description)}`,
      `ogTitle: ${yamlString(parsed.title)}`,
      `ogDescription: ${yamlString(description)}`,
      `ogImage: /assets/images/blog/${slug}/${slug}-hero.jpg`,
      `category: ${parsed.category || item.category}`,
      "sourceType: editorial",
      `publishDate: "${publishDate || "1970-01-01"}"`,
      "heroImage:",
      `  src: /assets/images/blog/${slug}/${slug}-hero.jpg`,
      `  srcset900: /assets/images/blog/${slug}/${slug}-hero-900.webp`,
      `  srcsetFull: /assets/images/blog/${slug}/${slug}-hero.webp`,
      `  width: ${heroDims.width}`,
      `  height: ${heroDims.height}`,
      `  alt: ${yamlString(heroSource.alt)}`,
    ];
    const content = "---\n" + frontMatterLines.join("\n") + "\n---\n\n" + bodyParagraphs.join("\n\n") + "\n";
    writeFileSync(path.join(OUTPUT_POSTS_DIR, `${slug}.md`), content);

    report.imported.push({
      slug,
      urlPath: item.urlPath,
      publishDate,
      dateConfidence,
      imageCount: downloaded.length,
      redirectFrom: item.urlPath,
      redirectTo: `/blog/${slug}/`,
    });
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Imported ${report.imported.length} posts, skipped ${report.skipped.length}, ${report.warnings.length} warnings.`);
  console.log(`Report written to ${reportPath}`);
}

run();
