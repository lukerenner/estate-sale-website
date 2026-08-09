// YouTube RSS -> blog-post sync (recent-uploads only; see
// import-legacy-videos.mjs for the one-time full-history bootstrap, which
// the RSS feed structurally can't provide). Files are the source of truth:
// dedupe is "does any blog/posts/*.md already have source.id === this video
// id", scanned fresh every run.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import matter from "gray-matter";
import { slugify } from "./suggest-slug.mjs";

// Resolved once from https://www.youtube.com/garygermer (grep for
// "externalId":"UC...") — see PLAN. Hardcoded rather than re-scraped every
// run: the channel ID is effectively permanent, and scraping YouTube's HTML
// on every sync run is a fragile, unnecessary dependency for a value that
// doesn't change.
export const CHANNEL_ID = "UCKzrAlgXeAFrjsrDZDVok0Q";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

function yamlString(str) {
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function downloadTmp(url, destPath) {
  execFileSync("curl", ["-sL", "-A", "Mozilla/5.0", url, "-o", destPath]);
}

function parseFeedEntries(xml) {
  const entries = [];
  const entryRe = /<entry>(.*?)<\/entry>/gs;
  let m;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const id = /<yt:videoId>(.*?)<\/yt:videoId>/.exec(block)?.[1];
    const title = /<media:title>(.*?)<\/media:title>/.exec(block)?.[1];
    const description = /<media:description>([\s\S]*?)<\/media:description>/.exec(block)?.[1] || "";
    const published = /<published>(.*?)<\/published>/.exec(block)?.[1];
    const thumb = /<media:thumbnail url="([^"]+)"/.exec(block)?.[1];
    if (id && title) entries.push({ id, title, description: description.trim(), published, thumb });
  }
  return entries;
}

function existingVideoIds(postsDir) {
  const ids = new Set();
  if (!existsSync(postsDir)) return ids;
  for (const file of readdirSync(postsDir)) {
    if (!file.endsWith(".md")) continue;
    const fm = matter(readFileSync(path.join(postsDir, file), "utf8")).data;
    if (fm.sourceType === "youtube" && fm.source && fm.source.id) ids.add(fm.source.id);
  }
  return ids;
}

export function writeVideoPost({ id, title, description, published, thumb }, { postsDir, imagesRoot, tmpDir, existingSlugs }) {
  let slug = slugify(title);
  if (existingSlugs.includes(slug)) slug = `${slug}-${id}`;
  existingSlugs.push(slug);

  const outDir = path.join(imagesRoot, slug);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${slug}.jpg`);
  let heroWidth = 1280, heroHeight = 720;
  try {
    downloadTmp(thumb || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, tmpPath);
    execFileSync("cwebp", ["-quiet", "-q", "72", "-resize", "900", "0", tmpPath, "-o", path.join(outDir, `${slug}-hero-900.webp`)]);
    execFileSync("cwebp", ["-quiet", "-q", "72", tmpPath, "-o", path.join(outDir, `${slug}-hero.webp`)]);
    execFileSync("magick", [tmpPath, "-quality", "78", path.join(outDir, `${slug}-hero.jpg`)]);
  } catch {
    // thumbnail fetch failing shouldn't block writing the post — the layout
    // still has the live embed as the primary media.
  }

  const fullDesc = (description || title).trim();
  // Front-matter description/ogDescription are meta-tag/excerpt length —
  // truncate those on a word boundary with an ellipsis rather than an
  // arbitrary mid-word character cut. The post body keeps the full text.
  const desc = fullDesc.length <= 300 ? fullDesc : fullDesc.slice(0, 300).replace(/\s+\S*$/, "") + "…";
  const lines = [
    "layout: layouts/blog-post.njk",
    `permalink: /blog/${slug}/`,
    `slug: ${slug}`,
    `title: ${yamlString(title)}`,
    `description: ${yamlString(desc)}`,
    `ogTitle: ${yamlString(title)}`,
    `ogDescription: ${yamlString(desc)}`,
    `ogImage: /assets/images/blog/${slug}/${slug}-hero.jpg`,
    "category: show-and-tell",
    "sourceType: youtube",
    "source:",
    `  id: ${id}`,
    `publishDate: "${(published || new Date().toISOString()).slice(0, 10)}"`,
    "heroImage:",
    `  src: /assets/images/blog/${slug}/${slug}-hero.jpg`,
    `  srcset900: /assets/images/blog/${slug}/${slug}-hero-900.webp`,
    `  srcsetFull: /assets/images/blog/${slug}/${slug}-hero.webp`,
    `  width: ${heroWidth}`,
    `  height: ${heroHeight}`,
    `  alt: ${yamlString(title)}`,
  ];
  const content = "---\n" + lines.join("\n") + "\n---\n\n" + fullDesc + "\n";
  writeFileSync(path.join(postsDir, `${slug}.md`), content);
  return slug;
}

export async function syncVideo({ postsDir = "blog/posts", imagesRoot = "assets/images/blog", tmpDir = ".tmp-video-sync-images" } = {}) {
  const report = { created: [] };
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`YouTube RSS fetch failed: ${res.status}`);
  const xml = await res.text();
  const entries = parseFeedEntries(xml);
  const existingIds = existingVideoIds(postsDir);
  const existingSlugs = readdirSync(postsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

  for (const entry of entries) {
    if (existingIds.has(entry.id)) continue;
    const slug = writeVideoPost(entry, { postsDir, imagesRoot, tmpDir, existingSlugs });
    report.created.push(slug);
  }
  return report;
}
