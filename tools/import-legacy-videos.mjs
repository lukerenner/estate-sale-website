// One-time YouTube history bootstrap. The RSS feed sync-video.mjs uses only
// exposes the ~15 most recent uploads and structurally cannot backfill full
// channel history, so this is a separate tool, run once by hand (see PLAN
// "Bootstrap runs") — never wired into the recurring blog-sync workflow.
//
// Lists every historical video via `yt-dlp --print` (full extraction, not
// --flat-playlist — flat-playlist's per-item metadata doesn't include
// upload_date, and backdating to each video's real upload date is a hard
// requirement here; see the run notes for this deliberate deviation from
// the flag named in the original plan). Skips any id that already has a
// matching post, same as sync-video.mjs's dedupe.
//
// Usage: node tools/import-legacy-videos.mjs <report.json>

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { CHANNEL_ID, writeVideoPost } from "./lib/sync-video.mjs";

const [, , reportPath] = process.argv;
if (!reportPath) {
  console.error("Usage: node import-legacy-videos.mjs <report.json>");
  process.exit(1);
}

const POSTS_DIR = "blog/posts";
const IMAGES_ROOT = "assets/images/blog";
const TMP_DIR = ".tmp-video-bootstrap-images";

function existingVideoIds() {
  const ids = new Set();
  if (!existsSync(POSTS_DIR)) return ids;
  for (const file of readdirSync(POSTS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const fm = matter(readFileSync(path.join(POSTS_DIR, file), "utf8")).data;
    if (fm.sourceType === "youtube" && fm.source && fm.source.id) ids.add(fm.source.id);
  }
  return ids;
}

function run() {
  const report = { created: [], skippedExisting: [], failed: null };
  let raw;
  try {
    raw = execFileSync(
      "yt-dlp",
      ["--print", "%(id)s|||%(title)s|||%(upload_date)s|||%(description)s", `https://www.youtube.com/channel/${CHANNEL_ID}/videos`],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }
    );
  } catch (e) {
    report.failed = `yt-dlp failed: ${e.message}`;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.error(report.failed);
    process.exit(1);
  }

  if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  const existingIds = existingVideoIds();
  const existingSlugs = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

  const lines = raw.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    const [id, title, uploadDate, description] = line.split("|||");
    if (!id || !title) continue;
    if (existingIds.has(id)) {
      report.skippedExisting.push(id);
      continue;
    }
    const published = uploadDate && /^\d{8}$/.test(uploadDate)
      ? `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`
      : null;
    if (!published) {
      report.skippedExisting.push({ id, reason: "no upload_date from yt-dlp — needs manual publishDate" });
      continue;
    }
    const slug = writeVideoPost(
      { id, title, description, published, thumb: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` },
      { postsDir: POSTS_DIR, imagesRoot: IMAGES_ROOT, tmpDir: TMP_DIR, existingSlugs }
    );
    report.created.push({ id, slug, publishDate: published });
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Created ${report.created.length} video posts, skipped ${report.skippedExisting.length} already-imported.`);
}

run();
