// Shared KATU/AM Northwest scrape + ingest helpers, used by both
// import-legacy-amnw.mjs (one-time backlog sweep) and sync-amnw.mjs (ongoing
// recurring check). A KATU article page embeds its own video source, hero
// image, and full body text as escaped JSON inside the page HTML — no public
// API, so this is a page-scrape, not a feed.
//
// NOTE: katu.com's robots.txt disallows AI crawlers (ClaudeBot, anthropic-ai,
// Claude-Web) site-wide. This pipeline was built and is run with that known
// and accepted — see PLAN/session notes. Anyone re-enabling or extending this
// should know that going in, not discover it by reading robots.txt later.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { slugify } from "./suggest-slug.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const HTML_ENTITIES = {
  "&rsquo;": "’", "&lsquo;": "‘", "&rdquo;": "”", "&ldquo;": "“",
  "&amp;": "&", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
  "&quot;": '"', "&#39;": "'", "&apos;": "'",
};
function decodeEntities(str) {
  if (!str) return str;
  return str.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m] || m);
}

function extract(html, re) {
  const m = re.exec(html);
  return m ? m[1] : null;
}

function unescapeJson(str) {
  if (!str) return str;
  try {
    return decodeEntities(JSON.parse('"' + str + '"'));
  } catch {
    return decodeEntities(str);
  }
}

export async function fetchKatuHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

// Parses the embedded JSON-LD-ish metadata out of a KATU article page.
// "description" is KATU's own meta-tag copy, which has parens/en-dashes
// stripped by their pipeline; "articleBody" is the real story text with
// correct punctuation intact, so prefer it when present.
export function parseKatuMeta(html, url) {
  const headline = extract(html, /"headline":"((?:[^"\\]|\\.)*)"/);
  const description = extract(html, /"articleBody":"((?:[^"\\]|\\.)*)"/) || extract(html, /"description":"((?:[^"\\]|\\.)*)"/);
  let mp4Url = extract(html, /mp4Url\\":\\"([^\\]+)\\"/);
  if (mp4Url && mp4Url.startsWith("/")) mp4Url = "https://katu.com" + mp4Url;
  const thumbnailUrl = extract(html, /"thumbnailUrl":"([^"]+)"/);
  const datePublished = extract(html, /"datePublished":"([^"]+)"/);
  return {
    url,
    title: unescapeJson(headline),
    description: unescapeJson(description),
    mp4Url,
    thumbnailUrl,
    datePublished,
  };
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}

function imageDims(absPath) {
  try {
    const out = execFileSync("identify", ["-format", "%w %h", absPath], { encoding: "utf8" });
    const [w, h] = out.trim().split(/\s+/).map(Number);
    return w && h ? { width: w, height: h } : null;
  } catch {
    return null;
  }
}

function yamlString(str) {
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// Downloads the source mp4, re-encodes it to a web-friendly 480p file (the
// broadcast originals run 50-125MB, well past GitHub's 100MB file limit; see
// PLAN for the size-vs-quality call), generates hero image tiers, and writes
// blog/posts/<slug>.md. Mirrors tools/lib/sync-video.mjs's writeVideoPost,
// but sourceType: amnw gets a native <video> hero instead of a YouTube embed
// (see _includes/layouts/blog-post.njk).
export async function writeAmnwPost(meta, { postsDir, imagesRoot, videosRoot, tmpDir, existingSlugs }) {
  let slug = slugify(meta.title);
  if (existingSlugs.includes(slug)) slug = slug + "-amnw";
  existingSlugs.push(slug);

  const srcMp4 = path.join(tmpDir, `${slug}-src.mp4`);
  const outMp4 = path.join(videosRoot, `${slug}.mp4`);
  const thumbJpg = path.join(tmpDir, `${slug}-thumb.jpg`);
  const imgOutDir = path.join(imagesRoot, slug);
  if (!existsSync(imgOutDir)) mkdirSync(imgOutDir, { recursive: true });
  if (!existsSync(videosRoot)) mkdirSync(videosRoot, { recursive: true });

  if (!existsSync(outMp4)) {
    run("curl", ["-sL", "-A", UA, meta.mp4Url, "-o", srcMp4]);
    run("ffmpeg", [
      "-y", "-i", srcMp4,
      "-vf", "scale=-2:'min(480,ih)'",
      "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      outMp4,
    ]);
  }

  if (meta.thumbnailUrl) {
    run("curl", ["-sL", "-A", UA, meta.thumbnailUrl, "-o", thumbJpg]);
  } else {
    run("ffmpeg", ["-y", "-ss", "5", "-i", outMp4, "-frames:v", "1", "-q:v", "3", thumbJpg]);
  }
  run("cwebp", ["-quiet", "-q", "72", "-resize", "900", "0", thumbJpg, "-o", path.join(imgOutDir, `${slug}-hero-900.webp`)]);
  run("cwebp", ["-quiet", "-q", "72", thumbJpg, "-o", path.join(imgOutDir, `${slug}-hero.webp`)]);
  run("magick", [thumbJpg, "-quality", "78", path.join(imgOutDir, `${slug}-hero.jpg`)]);

  const dims = imageDims(thumbJpg) || { width: 1280, height: 720 };

  const publishDate = (meta.datePublished || new Date().toISOString()).slice(0, 10);
  const fullDesc = (meta.description || meta.title).trim();
  const desc = fullDesc.length <= 300 ? fullDesc : fullDesc.slice(0, 300).replace(/\s+\S*$/, "") + "…";

  const lines = [
    "layout: layouts/blog-post.njk",
    `permalink: /blog/${slug}/`,
    `slug: ${slug}`,
    `title: ${yamlString(meta.title)}`,
    `description: ${yamlString(desc)}`,
    `ogTitle: ${yamlString(meta.title)}`,
    `ogDescription: ${yamlString(desc)}`,
    `ogImage: /assets/images/blog/${slug}/${slug}-hero.jpg`,
    "category: show-and-tell",
    "sourceType: amnw",
    "source:",
    `  url: ${yamlString(meta.url)}`,
    `  video: /assets/videos/blog/${slug}.mp4`,
    `publishDate: "${publishDate}"`,
    "heroImage:",
    `  src: /assets/images/blog/${slug}/${slug}-hero.jpg`,
    `  srcset900: /assets/images/blog/${slug}/${slug}-hero-900.webp`,
    `  srcsetFull: /assets/images/blog/${slug}/${slug}-hero.webp`,
    `  width: ${dims.width}`,
    `  height: ${dims.height}`,
    `  alt: ${yamlString(meta.title)}`,
  ];
  const body = fullDesc + "\n\nOriginally aired on [AM Northwest](" + meta.url + "), KATU.";
  const content = "---\n" + lines.join("\n") + "\n---\n\n" + body + "\n";
  writeFileSync(path.join(postsDir, `${slug}.md`), content);
  return slug;
}

// Existing KATU article URLs already ingested, read from blog/posts/*.md —
// files are the source of truth for dedupe (same convention as
// sync-video.mjs), keyed on the KATU URL rather than publish date, since a
// video's date can drift a few days between when it aired and when this
// pipeline actually picked it up.
export function existingAmnwUrls(postsDir) {
  const urls = new Set();
  if (!existsSync(postsDir)) return urls;
  for (const file of readdirSync(postsDir)) {
    if (!file.endsWith(".md")) continue;
    const fm = matter(readFileSync(path.join(postsDir, file), "utf8")).data;
    if (fm.sourceType === "amnw" && fm.source && fm.source.url) urls.add(fm.source.url);
  }
  return urls;
}
