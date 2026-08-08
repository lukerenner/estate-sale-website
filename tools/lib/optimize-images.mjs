// Reusable image pipeline: source photos -> capped, three-tier WebP set.
// This is the half of the import that future single-sale ingestion reuses
// as-is — see INGEST.md. No legacy-HTML knowledge lives here.
//
// Convention (do not change without updating INGEST.md and every .njk):
//   <outDir>/<slug>-NN-480.webp   grid thumbnail tier
//   <outDir>/<slug>-NN-900.webp   larger grid / retina tier
//   <outDir>/<slug>-NN-1400.webp  lightbox tier (this replaces the old
//                                 full-size .jpg — WebP-only, see plan)
// Quality is fixed at 72 and tiers never upscale past the source's native
// pixel width, because "lightning fast" is the standing requirement, not a
// per-sale option.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const TIERS = [480, 900, 1400];
export const QUALITY = 72;

export function getImageDims(filePath) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], {
    encoding: "utf8",
  });
  const width = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  if (!width || !height) throw new Error(`Could not read dimensions for ${filePath}`);
  return { width, height };
}

// Perceptual-ish de-dupe cheap enough to run per sale: flags exact
// byte-identical source files (Ucraft re-used the same upload in a few
// sales) so the same photo doesn't eat two of the 30 gallery slots.
export function dedupeBySize(filePaths) {
  const seen = new Set();
  const kept = [];
  for (const p of filePaths) {
    const key = execFileSync("stat", ["-f", "%z", p], { encoding: "utf8" }).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(p);
  }
  return kept;
}

/**
 * Convert one source photo into the three WebP tiers.
 * @returns {{width:number, height:number}} the SOURCE's real pixel size
 *   (front matter needs this, not any one tier's resized size, so the
 *   layout's width/height attributes describe the image's true aspect ratio).
 */
export function convertTiers(srcPath, outDir, base) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const { width, height } = getImageDims(srcPath);
  for (const tier of TIERS) {
    const targetWidth = tier >= width ? width : tier;
    const outPath = path.join(outDir, `${base}-${tier}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", String(QUALITY), "-resize", String(targetWidth), "0", srcPath, "-o", outPath]);
  }
  return { width, height };
}

/**
 * Optimize a full gallery for one sale.
 * @param {string[]} sourcePaths - absolute paths, already in display order
 * @param {string} outDir - .../assets/images/estate-sales/<slug>/
 * @param {string} slug
 * @param {number} cap - max photos to keep (30 for the legacy archive import)
 * @returns {Array<{base:string, width:number, height:number}>} gallery manifest
 */
export function optimizeGallery(sourcePaths, outDir, slug, cap = 30) {
  const deduped = dedupeBySize(sourcePaths);
  const dropped = sourcePaths.length - deduped.length;
  const kept = deduped.slice(0, cap);
  const overflow = deduped.length - kept.length;

  const manifest = kept.map((srcPath, i) => {
    const base = `${slug}-${String(i + 1).padStart(2, "0")}`;
    const { width, height } = convertTiers(srcPath, outDir, base);
    return { base, width, height };
  });

  return { manifest, droppedDuplicates: dropped, droppedOverflow: overflow };
}

/**
 * Optimize a single named image (hero, video poster) into the 900w WebP +
 * full WebP tiers the layout expects, plus one .jpg alongside the hero for
 * ogImage — social scrapers are the one remaining consumer of jpg here.
 */
export function optimizeNamedImage(srcPath, outDir, base, { withJpg = false } = {}) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const { width, height } = getImageDims(srcPath);
  const full900 = Math.min(900, width);
  execFileSync("cwebp", ["-quiet", "-q", String(QUALITY), "-resize", String(full900), "0", srcPath, "-o", path.join(outDir, `${base}-900.webp`)]);
  execFileSync("cwebp", ["-quiet", "-q", String(QUALITY), srcPath, "-o", path.join(outDir, `${base}.webp`)]);
  if (withJpg) {
    // Capped at 1600w, q78: this file is only an OG/social-preview image and
    // an <img src> fallback for browsers without srcset support (effectively
    // none in practice) — it should never be the thing a real visitor's
    // browser actually downloads, so keep it light rather than full-res.
    const jpgWidth = Math.min(1600, width);
    execFileSync("magick", [srcPath, "-resize", `${jpgWidth}x`, "-quality", "78", path.join(outDir, `${base}.jpg`)]);
  }
  return { width, height };
}
