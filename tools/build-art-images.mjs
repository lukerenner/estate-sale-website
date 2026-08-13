// Art-direction image pipeline.
//
//   node tools/build-art-images.mjs [--force]
//
// Reads art-direction/manifest.json, pulls every selected photo through a
// deterministic tone-unification pass, writes responsive WebP tiers into
// assets/images/art/, and emits _data/art.json so templates get real
// width/height (no layout shift) without ever naming a source file.
//
// WHY A NORMALIZER AT ALL
// The photography comes from two decades of different cameras, phones and
// stock libraries. Left alone the site reads as a scrapbook: one room is
// tungsten-orange, the next is daylight-blue, exposures wander a stop either
// way, and a few of the estate photos are HDR-ish and oversaturated. The pass
// below pulls every frame toward one warm-neutral house look WITHOUT flattening
// them all into the same picture — every correction is proportional (strength
// < 1) and clamped, so a well-shot photo barely moves and only the outliers get
// pulled hard.
//
// The five steps, in order:
//   1. crop        optional pre-crop (watermarks, art-directed reframing)
//   2. white balance   partial grey-world, then a deliberate warm bias so the
//                      house look is warm-neutral rather than clinically grey
//   3. exposure    gamma (not multiply) toward a target mean luma, so blacks
//                  stay at black and highlights are never pushed to clipping
//   4. saturation  pulled DOWN toward a target only — never boosted
//   5. contrast    a very mild S-curve for natural blacks
//
// Everything is driven by measurements of the image itself, so re-running the
// script on the same input always produces the same output.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "art-direction/manifest.json");
const OUT_DIR = path.join(ROOT, "assets/images/art");
const DATA_OUT = path.join(ROOT, "_data/art.json");
const WORK = path.join(ROOT, ".tmp-art-images");

const LEGACY_ROOTS = [
  path.resolve(ROOT, "../1.0/assets/static.ucraft.net/fs/ucraft/userFiles/garygermer/images"),
  path.resolve(ROOT, "../1.0/assets/static.ucraft.net/fs/ucraft/userFiles/garygermer/uploaded-media"),
];
const SALES_ROOT = path.join(ROOT, "assets/images/estate-sales");
// The licensed stock pool. It lives under art-direction/ rather than assets/ on
// purpose: assets/ is passthrough-copied wholesale into _site (see
// eleventy.config.js), so a source pool kept there would deploy to production
// even though no page ever links to it. Nothing under art-direction/ ships.
const REFERENCE_ROOT = path.join(ROOT, "art-direction/sources");

const FORCE = process.argv.includes("--force");

function magick(args) {
  return execFileSync("magick", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Ask ImageMagick for a set of fx expressions in one pass.
function measure(file, exprs) {
  const fmt = exprs.map((e) => `%[fx:${e}]`).join(" ");
  const out = magick([file, "-format", fmt, "info:"]).trim();
  return out.split(/\s+/).map(Number);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Read the image as a small pixel grid and compute every statistic we need in
 * one go. 96x96 is plenty to characterise global colour and tone, costs
 * nothing, and — unlike a pile of separate -format calls — lets us compute
 * percentiles and a white-patch reference, which is what the white balance
 * actually needs.
 */
function analyse(file) {
  const txt = magick([file, "-resize", "96x96!", "-depth", "8", "-colorspace", "sRGB", "txt:-"]);
  const px = [];
  for (const line of txt.split("\n")) {
    const m = line.match(/^\d+,\d+: \(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (m) px.push([+m[1] / 255, +m[2] / 255, +m[3] / 255]);
  }
  if (!px.length) throw new Error(`could not sample pixels from ${file}`);

  const n = px.length;
  const sum = [0, 0, 0];
  let satSum = 0;
  const lumas = [];
  for (const [r, g, b] of px) {
    sum[0] += r; sum[1] += g; sum[2] += b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    // HSL saturation
    satSum += mx === mn ? 0 : (mx - mn) / (l < 0.5 ? mx + mn : 2 - mx - mn);
    lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const mean = sum.map((s) => s / n);
  const meanSat = satSum / n;
  const meanLuma = lumas.reduce((a, b) => a + b, 0) / n;

  const sorted = [...lumas].sort((a, b) => a - b);
  const pct = (p) => sorted[clamp(Math.round(p * (n - 1)), 0, n - 1)];

  // WHITE PATCH: the average colour of the brightest ~8% of the frame,
  // ignoring pixels that are already clipped (they carry no colour
  // information). In a furnished room this lands on window light, a lampshade,
  // white trim or a ceiling — i.e. something that ought to be neutral. Judging
  // colour cast from this instead of the frame average is what lets a room full
  // of mahogany and gilt stay warm while a genuine tungsten cast still gets
  // corrected.
  const cutoff = pct(0.92);
  const wp = [0, 0, 0];
  let wpN = 0;
  for (let i = 0; i < n; i++) {
    if (lumas[i] < cutoff) continue;
    const [r, g, b] = px[i];
    if (Math.max(r, g, b) > 0.99) continue;
    wp[0] += r; wp[1] += g; wp[2] += b; wpN++;
  }
  const whitePatch = wpN >= 12 ? wp.map((s) => s / wpN) : null;

  return { mean, meanSat, meanLuma, whitePatch, p01: pct(0.01), p99: pct(0.99) };
}

function resolveSource(img) {
  if (img.root === "sales") {
    const p = path.join(SALES_ROOT, img.src);
    if (!existsSync(p)) throw new Error(`missing sales source: ${img.src}`);
    return p;
  }
  if (img.root === "reference") {
    const p = path.join(REFERENCE_ROOT, img.src);
    if (!existsSync(p)) throw new Error(`missing reference source: ${img.src}`);
    return p;
  }
  for (const r of LEGACY_ROOTS) {
    const p = path.join(r, img.src);
    if (existsSync(p)) return p;
  }
  throw new Error(`missing legacy source: ${img.src}`);
}

/**
 * Build the ImageMagick argument list that performs tone unification.
 * Returns { args, report } so the run log can show what actually moved.
 */
function toneArgs(file, targets, overrides = {}) {
  const t = { ...targets, ...overrides };
  const warm = { ...targets.warmBias, ...(overrides.warmBias || {}) };

  // Measure on the already-cropped working file.
  const stats = analyse(file);
  const lum = stats.meanLuma;
  const meanSat = stats.meanSat;

  const args = [];
  const report = {};

  // --- 2. WHITE BALANCE ------------------------------------------------
  // Neutralise the WHITE PATCH (the brightest ~8% of the frame), not the frame
  // average. Grey-world assumes the average of a scene is neutral, which is
  // simply false for the subject matter here — a room of mahogany, gilt and
  // Persian carpet averages strongly warm on purpose, and grey-world would
  // "correct" all the warmth out of it. The bright end of an interior, on the
  // other hand, is nearly always something that really is white (window light,
  // trim, a lampshade), so it is a far better cast reference.
  //
  // We still only travel `wbStrength` of the way and clamp per channel, so a
  // photo that is already clean barely moves.
  const ref = stats.whitePatch || stats.mean;
  const refGrey = (ref[0] + ref[1] + ref[2]) / 3;
  const gains = ref.map((m) => {
    if (m <= 0.001) return 1;
    const full = refGrey / m;
    const partial = Math.pow(full, t.wbStrength);
    return clamp(partial, t.channelGainClamp[0], t.channelGainClamp[1]);
  });
  // Then push deliberately warm — the brand look is warm-neutral, not neutral.
  gains[0] *= warm.r;
  gains[1] *= warm.g;
  gains[2] *= warm.b;

  const ch = ["R", "G", "B"];
  gains.forEach((g, i) => {
    if (Math.abs(g - 1) < 0.002) return;
    args.push("-channel", ch[i], "-evaluate", "multiply", g.toFixed(4), "+channel");
  });
  report.wb = gains.map((g) => g.toFixed(3)).join("/");

  // --- 3. EXPOSURE -----------------------------------------------------
  // Gamma rather than a multiply: gamma fixes 0 and 1, so we can lift a dark
  // frame without ever crushing black or blowing a highlight to pure white.
  //
  // MIND THE INVERSION. `wantExp` is the exponent that lands mean luma exactly
  // on target: lum ** wantExp === target. ImageMagick's -gamma does NOT take an
  // exponent, it takes its reciprocal — `-gamma g` computes out = in ** (1/g).
  // Passing wantExp straight through (as this did until 2026-08-12) therefore
  // applied in ** (1/wantExp), which moves every frame the WRONG WAY: a bright
  // room measured at 0.70 against a 0.40 target came out at 0.74, and a dark
  // still life at 0.13 against a 0.30 target came out at 0.09. The clamp hid
  // it — outliers pinned at the clamp bound looked like the limiter doing its
  // job rather than a sign error. Blend toward the target in exponent space,
  // then invert once, at the boundary.
  let gamma = 1;
  if (lum > 0.01 && lum < 0.99) {
    const wantExp = Math.log(t.meanLuma) / Math.log(lum);
    const exp = 1 + (wantExp - 1) * t.exposureStrength;
    gamma = clamp(1 / exp, t.gammaClamp[0], t.gammaClamp[1]);
  }
  if (Math.abs(gamma - 1) > 0.005) args.push("-gamma", gamma.toFixed(4));
  report.lum = lum.toFixed(3);
  report.gamma = gamma.toFixed(3);

  // --- 4. SATURATION ---------------------------------------------------
  // Restrained, never boosted. Oversaturated HDR-ish estate photos get pulled
  // toward the target; already-muted photography is left alone.
  let satPct = 100;
  if (meanSat > 0.001) {
    const full = t.targetSaturation / meanSat;
    const partial = Math.pow(full, t.satStrength);
    satPct = clamp(partial * 100, t.satFloor, 100);
  }
  if (satPct < 99.5) args.push("-modulate", `100,${satPct.toFixed(1)},100`);
  report.sat = `${meanSat.toFixed(3)}→${satPct.toFixed(0)}%`;

  // --- 5. CONTRAST -----------------------------------------------------
  // A whisper of S-curve. Enough for natural blacks, far short of "HDR".
  args.push("-sigmoidal-contrast", "1.4,50%");

  return { args, report };
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const targets = manifest.targets;

  if (FORCE && existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(path.dirname(DATA_OUT), { recursive: true });

  const data = {};
  const failures = [];

  for (const img of manifest.images) {
    let src;
    try {
      src = resolveSource(img);
    } catch (err) {
      failures.push(`${img.slug}: ${err.message}`);
      continue;
    }

    const workFile = path.join(WORK, `${img.slug}.png`);

    // --- 0. STRAIGHTEN -------------------------------------------------
    // `rotate` is degrees clockwise, for the hand-held estate-sale photography
    // that was shot a degree or two off level. It runs before everything else
    // and rewrites `src`, so the crop maths below measure the straightened
    // frame rather than the original — otherwise `rotate` and `ratio` would
    // silently disagree about where the subject is.
    //
    // Rotating leaves triangular blank wedges in the corners, so shave a 2%
    // inset afterwards; that comfortably clears the wedge for the small
    // angles this is meant for (a 1° turn on a 1400px frame is ~16px).
    if (img.rotate) {
      const rotFile = path.join(WORK, `${img.slug}-rot.png`);
      const [rw, rh] = measure(src, ["w", "h"]);
      magick([
        src,
        "-distort", "SRT", String(img.rotate),
        "+repage",
        "-shave", `${Math.round(rw * 0.02)}x${Math.round(rh * 0.02)}`,
        "+repage",
        rotFile,
      ]);
      src = rotFile;
    }

    // --- 1. CROP -------------------------------------------------------
    // Pre-crop first so every later measurement describes the pixels we are
    // actually going to ship (a watermark corner or a dead strip of ceiling
    // would otherwise skew the white balance and exposure maths).
    const pre = [src];
    if (img.crop) pre.push("-crop", img.crop, "+repage");
    if (img.ratio) {
      // Art-directed aspect: cover-crop around the focal point rather than
      // letting CSS decide, so the important subject survives at every size.
      //
      // Measure whatever the pre-crop actually produced, not the untouched
      // source — otherwise `crop` and `ratio` silently fail to compose. The
      // ratio maths would size its window against the full frame, ImageMagick
      // would clamp that window to the smaller cropped canvas, and the result
      // came out at neither the requested aspect nor a predictable one.
      const [w, h] = img.crop
        ? img.crop.split("+")[0].split("x").map(Number)
        : measure(src, ["w", "h"]);
      const cur = w / h;
      const [fx, fy] = (img.focal || "50% 50%").split(/\s+/).map((s) => parseFloat(s) / 100);
      let cw, chh;
      if (cur > img.ratio) {
        chh = h;
        cw = Math.round(h * img.ratio);
      } else {
        cw = w;
        chh = Math.round(w / img.ratio);
      }
      const ox = Math.round(clamp(fx * w - cw / 2, 0, w - cw));
      const oy = Math.round(clamp(fy * h - chh / 2, 0, h - chh));
      pre.push("-crop", `${cw}x${chh}+${ox}+${oy}`, "+repage");
    }
    pre.push(workFile);
    magick(pre);

    // --- 2-5. TONE -----------------------------------------------------
    const { args, report } = toneArgs(workFile, targets, img.tone || {});
    const gradedFile = path.join(WORK, `${img.slug}-graded.png`);
    magick([workFile, ...args, gradedFile]);

    const [gw, gh] = measure(gradedFile, ["w", "h"]);

    // --- TIERS ---------------------------------------------------------
    // `maxTier` is the widest this slug can ever be asked to paint, derived
    // from its `sizes` attribute at 3x DPR. A 512px card tops out around
    // 1600px on the widest phone; shipping it a 2000px tier only offers the
    // browser a candidate that costs more and shows nothing extra.
    const ceiling = Math.min(img.maxTier || targets.tiers[targets.tiers.length - 1], gw);
    const tiers = [];
    for (const tier of targets.tiers) {
      // Never upscale past the source, but always finish with a tier at the
      // ceiling so the largest srcset candidate is the sharpest thing that
      // slug can actually use.
      const width = Math.min(tier, ceiling);
      if (tiers.includes(width)) continue;
      const out = path.join(OUT_DIR, `${img.slug}-${width}.webp`);
      magick([
        gradedFile,
        "-resize", `${width}x`,
        "-strip",
        "-define", `webp:method=6`,
        "-quality", String(targets.quality),
        out,
      ]);
      tiers.push(width);
      if (width === ceiling) break;
    }
    // A JPEG for og:image and the <img src> fallback. Only two audiences ever
    // fetch it: social/link unfurlers, which cap around 1200px anyway, and
    // browsers without WebP, which have been a rounding error since 2020. It
    // used to be generated at the full 2000px tier, which put ~13MB of pixels
    // into the deploy that essentially nothing downloaded.
    const jpgWidth = Math.min(targets.fallbackWidth || 1200, gw);
    magick([
      gradedFile,
      "-resize", `${jpgWidth}x`,
      "-strip",
      "-interlace", "Plane",
      "-sampling-factor", "4:2:0",
      "-quality", "80",
      path.join(OUT_DIR, `${img.slug}.jpg`),
    ]);

    data[img.slug] = {
      width: gw,
      height: gh,
      tiers,
      jpgWidth,
      focal: img.focal || "50% 50%",
      alt: img.alt,
      category: img.category,
      rank: img.rank,
    };

    console.log(
      `${img.slug.padEnd(34)} ${String(gw).padStart(4)}x${String(gh).padEnd(4)}  ` +
        `wb ${report.wb}  luma ${report.lum} γ${report.gamma}  sat ${report.sat}`
    );
  }

  writeFileSync(DATA_OUT, JSON.stringify(data, null, 2) + "\n");
  rmSync(WORK, { recursive: true, force: true });

  console.log(`\n${Object.keys(data).length} images → assets/images/art/`);
  if (failures.length) {
    console.error(`\n${failures.length} FAILED:`);
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
}

main();
