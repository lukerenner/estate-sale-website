// One-time AM Northwest backlog sweep — NOT wired into the recurring
// blog-sync cron (see tools/lib/sync-amnw.mjs for that; this is its
// import-legacy-videos.mjs-style counterpart).
//
// katu.com/search only ever returns ~8 results per query regardless of the
// "N results" total it claims, and which 8 you get shifts with the query
// wording. There's no working pagination and no articles sitemap, so the
// only way to surface a fuller backlog is sweeping a spread of topic-word
// queries and taking the union of AM Northwest article URLs found — that's
// what SWEEP_TERMS is. This is inherently best-effort, not exhaustive: a
// segment whose title/body doesn't share any of these words could be missed.
// If you run this again later to catch anything this pass missed, feel free
// to extend SWEEP_TERMS with more topic words before rerunning.
//
// Usage: node tools/import-legacy-amnw.mjs

import { existsSync, mkdirSync } from "node:fs";
import { fetchKatuHtml, parseKatuMeta, writeAmnwPost, existingAmnwUrls } from "./lib/amnw-scrape.mjs";

const SWEEP_TERMS = [
  "gary+germer",
  "germer+antique", "germer+appraiser", "germer+vintage", "germer+collection",
  "germer+estate", "germer+garage", "germer+silver", "germer+gold", "germer+jewelry",
  "germer+worth", "germer+value", "germer+tips", "germer+box", "germer+furniture",
  "germer+art", "germer+china", "germer+glass", "germer+watch", "germer+clock",
  "germer+toy", "germer+doll", "germer+book", "germer+coin", "germer+stamp",
  "germer+military", "germer+diamond", "germer+painting", "germer+pottery",
  "germer+chinese", "germer+japanese", "germer+wood", "germer+sports",
  "germer+memorabilia", "germer+photo", "germer+record", "germer+music",
  "germer+holiday", "germer+downsizing", "germer+moving",
];

async function findCandidateUrls() {
  const found = new Set();
  for (const term of SWEEP_TERMS) {
    const html = await fetchKatuHtml(`https://katu.com/search?find=${term}`);
    const re = /href="(\/amnw\/am-northwest-lifestyle-health\/[a-z0-9-]+)"/g;
    let m;
    while ((m = re.exec(html))) found.add("https://katu.com" + m[1]);
  }
  return [...found];
}

async function run() {
  const postsDir = "blog/posts";
  const imagesRoot = "assets/images/blog";
  const videosRoot = "assets/videos/blog";
  const tmpDir = ".tmp-amnw-bootstrap";
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const candidates = await findCandidateUrls();
  const existing = existingAmnwUrls(postsDir);
  const report = { created: [], skippedExisting: [], skippedNotGermer: [], failed: [] };

  for (const url of candidates) {
    if (existing.has(url)) {
      report.skippedExisting.push(url);
      continue;
    }
    try {
      const html = await fetchKatuHtml(url);
      if (!/germer/i.test(html)) {
        report.skippedNotGermer.push(url);
        continue;
      }
      const meta = parseKatuMeta(html, url);
      if (!meta.title || !meta.mp4Url) throw new Error("missing title or mp4Url");
      const slug = await writeAmnwPost(meta, { postsDir, imagesRoot, videosRoot, tmpDir, existingSlugs: [] });
      report.created.push(slug);
      console.log(`created: ${slug}`);
    } catch (e) {
      report.failed.push({ url, error: e.message });
      console.error(`FAILED ${url}: ${e.message}`);
    }
  }

  console.log(`\nCandidates found: ${candidates.length}`);
  console.log(`Created: ${report.created.length}, already existed: ${report.skippedExisting.length}, not Gary: ${report.skippedNotGermer.length}, failed: ${report.failed.length}`);
  return report;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
