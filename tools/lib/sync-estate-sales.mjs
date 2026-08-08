// Deterministic estate-sale -> blog-post sync. No network call — reads front
// matter already on disk. For every estate-sales/*.njk with no existing
// blog/posts/*.md whose source.handle === slug and sourceType === "estate-
// sale", writes a templated teaser post. Files are the source of truth: this
// scans blog/posts/*.md itself for the dedupe check, never a state file.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { neighborhoodLabel } from "./blog-fields.mjs";

function yamlString(str) {
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function existingEstateSaleHandles(postsDir) {
  if (!existsSync(postsDir)) return new Set();
  const handles = new Set();
  for (const file of readdirSync(postsDir)) {
    if (!file.endsWith(".md")) continue;
    const fm = matter(readFileSync(path.join(postsDir, file), "utf8")).data;
    if (fm.sourceType === "estate-sale" && fm.source && fm.source.handle) handles.add(fm.source.handle);
  }
  return handles;
}

function teaserDescription(sale) {
  const d = sale.dates || [];
  const dateText = d.length ? `${d[0].label || d[0].date} through ${d[d.length - 1].label || d[d.length - 1].date}` : "";
  const neighborhood = neighborhoodLabel(sale.neighborhood);
  const about = (sale.about && sale.about.paragraphs && sale.about.paragraphs[0]) || sale.description || "";
  const trimmedAbout = about.length > 220 ? about.slice(0, 217) + "..." : about;
  return `${sale.saleName} ran ${dateText} in ${neighborhood}. ${trimmedAbout}`.trim();
}

export function syncEstateSales({ salesDir = "estate-sales", postsDir = "blog/posts" } = {}) {
  const report = { created: [], skippedExisting: [] };
  if (!existsSync(salesDir)) return report;
  const existingHandles = existingEstateSaleHandles(postsDir);
  const existingPostSlugs = new Set(
    existsSync(postsDir) ? readdirSync(postsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")) : []
  );

  for (const file of readdirSync(salesDir)) {
    if (!file.endsWith(".njk")) continue;
    const sale = matter(readFileSync(path.join(salesDir, file), "utf8")).data;
    if (!sale.slug) continue;
    if (existingHandles.has(sale.slug)) {
      report.skippedExisting.push(sale.slug);
      continue;
    }

    let postSlug = sale.slug;
    if (existingPostSlugs.has(postSlug)) postSlug = `${postSlug}-sale`;
    existingPostSlugs.add(postSlug);

    const lastDate = sale.dates && sale.dates.length ? sale.dates[sale.dates.length - 1].date : new Date().toISOString().slice(0, 10);
    const description = teaserDescription(sale);

    const lines = [
      "layout: layouts/blog-post.njk",
      `permalink: /blog/${postSlug}/`,
      `slug: ${postSlug}`,
      `title: ${yamlString(sale.saleName)}`,
      `description: ${yamlString(description)}`,
      `ogTitle: ${yamlString(sale.saleName)}`,
      `ogDescription: ${yamlString(description)}`,
      `ogImage: ${sale.ogImage || sale.heroImage.src}`,
      "category: estate-sales",
      "sourceType: estate-sale",
      "source:",
      `  handle: ${sale.slug}`,
      `publishDate: "${lastDate}"`,
      `saleUrl: ${sale.permalink}`,
      `saleName: ${yamlString(sale.saleName)}`,
      "heroImage:",
      `  src: ${sale.heroImage.src}`,
      `  srcset900: ${sale.heroImage.srcset900}`,
      `  srcsetFull: ${sale.heroImage.srcsetFull}`,
      `  width: ${sale.heroImage.width}`,
      `  height: ${sale.heroImage.height}`,
      `  alt: ${yamlString(sale.heroImage.alt)}`,
    ];
    const content = "---\n" + lines.join("\n") + "\n---\n\n" + description + "\n";
    writeFileSync(path.join(postsDir, `${postSlug}.md`), content);
    report.created.push(postSlug);
  }
  return report;
}
