// Consistency check for the art-direction manifest.
//
//   node tools/check-art-images.mjs
//
// Catches the three ways this system can silently rot:
//   1. a template asks for a slug the manifest doesn't declare  -> blank image
//   2. the manifest declares a slug nothing uses                -> dead weight
//   3. two entries point at the same source photo               -> repetition,
//      which the art direction explicitly rules out
// Exits non-zero on any of them so it can gate a build.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["_site", "node_modules", ".git", "_archive", ".tmp-art-images"]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(njk|md)$/.test(e)) out.push(p);
  }
  return out;
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, "art-direction/manifest.json"), "utf8"));
const declared = new Map(manifest.images.map((i) => [i.slug, i]));

const used = new Set();
for (const f of walk(ROOT)) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/\{%\s*art(?:Url)?\s+"([^"]+)"/g)) used.add(m[1]);
  for (const m of t.matchAll(/\/assets\/images\/art\/([a-z0-9-]+)\.jpg/g)) used.add(m[1]);
}

const problems = [];
for (const s of used) if (!declared.has(s)) problems.push(`used but not declared: ${s}`);
for (const s of declared.keys()) if (!used.has(s)) problems.push(`declared but unused: ${s}`);

const bySrc = new Map();
for (const i of manifest.images) {
  const key = `${i.root}/${i.src}`;
  bySrc.set(key, [...(bySrc.get(key) || []), i.slug]);
}
for (const [src, slugs] of bySrc) {
  if (slugs.length > 1) problems.push(`same photo used ${slugs.length}x (${slugs.join(", ")}): ${src}`);
}

if (problems.length) {
  console.error("art-direction manifest problems:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`art manifest OK — ${declared.size} images, all placed, no repeats.`);
