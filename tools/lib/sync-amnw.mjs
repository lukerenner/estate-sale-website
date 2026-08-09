// AM Northwest (KATU) -> blog-post sync, run on the recurring blog-sync
// cron. Discovery source is the "Lifestyle & Health" category listing page
// (https://katu.com/amnw/am-northwest-lifestyle-health), which lists every
// segment newest-first — not just Gary Germer's. That page only shows the
// most recent page's worth of segments (no older-content pagination), so
// this module is only for catching NEW appearances going forward; it
// structurally cannot backfill history (see import-legacy-amnw.mjs for the
// one-time sweep that did that). Running on a 6-hour cron against a
// once-a-month guest slot leaves a wide safety margin before a new segment
// could roll off the listing page before this catches it.
//
// Files are the source of truth for dedupe: does any blog/posts/*.md
// already have source.url === this KATU article URL. See
// tools/lib/amnw-scrape.mjs's header note on robots.txt before extending
// this further.

import { existsSync, mkdirSync } from "node:fs";
import { fetchKatuHtml, parseKatuMeta, writeAmnwPost, existingAmnwUrls } from "./amnw-scrape.mjs";

const CATEGORY_URL = "https://katu.com/amnw/am-northwest-lifestyle-health";

function extractCategoryHrefs(html) {
  const re = /href="(\/amnw\/am-northwest-lifestyle-health\/[a-z0-9-]+)"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) seen.add(m[1]);
  return [...seen];
}

export async function syncAmnw({ postsDir = "blog/posts", imagesRoot = "assets/images/blog", videosRoot = "assets/videos/blog", tmpDir = ".tmp-amnw-sync" } = {}) {
  const report = { created: [], checked: 0 };
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const html = await fetchKatuHtml(CATEGORY_URL);
  const hrefs = extractCategoryHrefs(html);
  const existing = existingAmnwUrls(postsDir);

  for (const href of hrefs) {
    const url = "https://katu.com" + href;
    if (existing.has(url)) continue;
    report.checked++;

    const articleHtml = await fetchKatuHtml(url);
    if (!/germer/i.test(articleHtml)) continue; // not a Gary Germer segment

    const meta = parseKatuMeta(articleHtml, url);
    if (!meta.title || !meta.mp4Url) continue; // malformed/non-video page, skip rather than fail the run

    const slug = await writeAmnwPost(meta, {
      postsDir,
      imagesRoot,
      videosRoot,
      tmpDir,
      existingSlugs: [], // collisions are rare enough here to accept the -amnw suffix fallback in writeAmnwPost
    });
    report.created.push(slug);
  }

  return report;
}
