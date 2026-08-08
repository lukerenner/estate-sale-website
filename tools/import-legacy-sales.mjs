// One-time bulk import: 1.0 legacy estate sale pages -> 2.0 estate-sales/*.njk
// Run from a LOCAL SCRATCH COPY of the repo, never against the Google Drive
// path directly (npm/node tooling against Drive is unreliable — see the
// project's CLAUDE.md). See INGEST.md for the reusable half of this pipeline.
//
// Usage: node tools/import-legacy-sales.mjs <path-to-1.0-sales-dir> <path-to-1.0-images-dir> <output-report.json>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { parseLegacySalePage } from "./lib/parse-legacy-sale.mjs";
import { optimizeGallery, optimizeNamedImage } from "./lib/optimize-images.mjs";
import { parseDateRange, yearFromSlug } from "./lib/parse-dates.mjs";

const [, , salesDir, imagesDir, reportPath] = process.argv;
if (!salesDir || !imagesDir || !reportPath) {
  console.error("Usage: node import-legacy-sales.mjs <1.0-sales-dir> <1.0-images-dir> <report.json>");
  process.exit(1);
}

const OUTPUT_SALES_DIR = path.resolve("estate-sales");
const OUTPUT_IMAGES_ROOT = path.resolve("assets/images/estate-sales");
const GALLERY_CAP = 30;

// ---------------------------------------------------------------------------
// Per-sale curated metadata. Filled in by hand after reviewing the parsed
// output (parsed-sales.json) — see the plan/run notes for how each field was
// decided. Every field here is a deliberate editorial choice, not a fallback.
// ---------------------------------------------------------------------------
const SALE_META = {
  "arthur-hill": {
    title: "The Arthur Hill Estate Sale",
    neighborhood: "Southwest Hills, Portland, Oregon",
  },
  "asian-art": {
    title: "The Asian Arts & Antiques Estate Collection",
    neighborhood: "Eliot, Portland, Oregon",
  },
  "august-1st-4th-2019": {
    newSlug: "gwyneth-gamble-booth-downsizing-sale-2019",
    title: "The Downsizing Sale of Ms. Gwyneth Gamble Booth",
    neighborhood: "West Hills, Portland, Oregon",
    dateOverride: {
      dates: [
        { date: "2019-08-01", label: "Thursday, August 1", opens: "2:00 PM", opens24: "14:00", closes: "8:00 PM", closes24: "20:00" },
        { date: "2019-08-02", label: "Friday, August 2", opens: "10:00 AM", opens24: "10:00", closes: "4:00 PM", closes24: "16:00" },
        { date: "2019-08-03", label: "Saturday, August 3", opens: "10:00 AM", opens24: "10:00", closes: "4:00 PM", closes24: "16:00" },
        { date: "2019-08-04", label: "Sunday, August 4", opens: "10:00 AM", opens24: "10:00", closes: "4:00 PM", closes24: "16:00" },
      ],
      confidence: "explicit-slug-year",
    },
  },
  "bertha-heights": {
    title: "The Bertha Heights Estate Sale",
    neighborhood: "Council Crest, Portland, Oregon",
  },
  "bixwood-manor": {
    title: "Bixwood Manor Estate Sale",
    neighborhood: "NW 23rd, Portland, Oregon",
  },
  "bridlemile-midcentury": {
    title: "The Bridlemile Midcentury Estate Sale",
    neighborhood: "Bridlemile, Portland, Oregon",
  },
  "broadway-woods": {
    title: "The Broadway Woods Estate Sale",
    neighborhood: "Northeast Portland, Oregon",
  },
  "copy-of-margie-boule-gwyneth-gamble-booth-sale": {
    newSlug: "historic-military-weapons-estate-sale",
    title: "Historic Military Weapons Estate",
    neighborhood: "Eliot, Portland, Oregon",
  },
  "corinne-gentner": {
    title: "The Estate of Corinne Gentner",
    neighborhood: "Raleigh Hills, Portland, Oregon",
  },
  "council-crest-downsizing-sale": {
    title: "Downsizing Sale Near Council Crest",
    neighborhood: "Council Crest, Portland, Oregon",
  },
  "easter-weekend-pop-up": {
    title: "Easter Weekend Pop-Up Multi-Estate Sale",
    neighborhood: "Central Eastside, Portland, Oregon",
  },
  "grant-park": {
    title: "The Grant Park Château Estate Sale",
    neighborhood: "Grant Park, Portland, Oregon",
  },
  "kings-cumberland": {
    title: "The Kings Cumberland Estate Sale",
    neighborhood: "Kings Heights, Portland, Oregon",
  },
  "lacamas-lake": {
    title: "The Lacamas Lake Estate Sale",
    neighborhood: "Lacamas Lake, Camas, Washington",
  },
  "lake-oswego-estate-sale": {
    title: "Lake Oswego Estate Sale",
    neighborhood: "Lake Oswego, Oregon",
  },
  "langworthy-estate-sale": {
    title: "The Langworthy Estate Sale",
    neighborhood: "Northwest Portland, Oregon",
    descriptionOverride:
      "The Langworthy Estate Sale offered a rare shopping opportunity: an entire home furnished top to bottom in practically new Restoration Hardware and West Elm furniture and decor, from sofas and dining tables to lighting, rugs, and designer kitchen accessories — like walking into a Street of Dreams show home where everything was for sale.",
  },
  "march-12th-15th-2020": {
    newSlug: "pop-up-shop-estate-sale-2020",
    title: "Pop-Up Shop Estate Sale",
    neighborhood: "Eliot, Portland, Oregon",
  },
  "march-18th-2019": {
    newSlug: "nw-skyline-antiques-estate-sale",
    title: "NW Skyline Estate Sale",
    neighborhood: "NW Skyline, Portland, Oregon",
  },
  "margie-boule-gwyneth-gamble-booth-sale": {
    title: "Margie Boulé & Friends Moving Sale",
    neighborhood: "Vista, Portland, Oregon",
  },
  "mary-mize": {
    title: "The Mary Mize Estate Sale",
    neighborhood: "Hillsdale, Portland, Oregon",
  },
  "may-2nd-4th-2019": {
    newSlug: "bishopcroft-house-estate-sale",
    title: "The Bishopcroft House Estate Sale",
    neighborhood: "West Hills, Portland, Oregon",
  },
  "midmod-moapa": {
    title: "The MidMod Moapa Estate Sale",
    neighborhood: "Dunthorpe, Portland, Oregon",
  },
  "military-weapons-2": {
    newSlug: "military-collectibles-showroom-sale",
    title: "Military Weapons & Historic Armory Estate Collection",
    neighborhood: "Eliot, Portland, Oregon",
    descriptionOverride:
      "A private collection of historic military memorabilia — firearms, edged weapons, field equipment, and military fine art and decor spanning the American Civil War through WWII. Held at Gary Germer & Associates' Broadway showroom and vault, where shoppers could also browse the many other treasures in the store.",
  },
  "nancy-fisher": {
    title: "Nancy Fisher Estate Sale",
    neighborhood: "Willamette Heights, Portland, Oregon",
  },
  "oakwood-gardens": {
    title: "The Oakwood Gardens Estate Sale",
    neighborhood: "Scholls, Oregon",
  },
  "october-18th-2019": {
    newSlug: "parrot-collector-estate-sale",
    title: "The Parrot Collector's Estate Sale",
    neighborhood: "Portland, Oregon",
  },
  "peter-abrahams": {
    title: "The Peter Abrahams Science & Astronomy Estate",
    neighborhood: "Eliot, Portland, Oregon",
    descriptionOverride:
      "The private collection of Peter Abrahams — local meteorologist, avid astronomer, woodworker, and independent scholar of the history of telescopes and binoculars. The estate included telescopes, binoculars, historic medical and science books, and other scientific and navigational instruments. Abrahams served as a past president of both the Antique Telescope Society and the Rose City Astronomers.",
  },
  "portland-nob-hill-estate-sale": {
    title: "Nob Hill Estate Sale",
    neighborhood: "Nob Hill, Portland, Oregon",
  },
  "riverwood": {
    title: 'The "Happy Ours" Riverwood Manor Estate Sale',
    neighborhood: "Dunthorpe, Portland, Oregon",
  },
  "stafford-trail": {
    title: "The Stafford Trail Estate Sale",
    neighborhood: "Tualatin, Oregon",
  },
  "the-holiday-sale-of-ms-gwyneth-gamble-booth": {
    title: "The Holiday Sale of Ms. Gwyneth Gamble Booth",
    neighborhood: "West Hills, Portland, Oregon",
    dateOverride: {
      dates: [
        { date: "2021-11-19", label: "Friday, November 19", opens: "10:00 AM", opens24: "10:00", closes: "4:00 PM", closes24: "16:00" },
        { date: "2021-11-20", label: "Saturday, November 20", opens: "10:00 AM", opens24: "10:00", closes: "4:00 PM", closes24: "16:00" },
        { date: "2021-11-21", label: "Sunday, November 21", opens: "10:00 AM", opens24: "10:00", closes: "4:00 PM", closes24: "16:00" },
      ],
      confidence: "LOW — no year or reliable upload signal in source; estimated from sequence relative to the estate's other two sales (Aug 2019, Jan 2022). Flag for manual verification.",
    },
  },
  "west-hills-estate-sale-fall-of-2020": {
    title: "West Hills Estate Sale",
    neighborhood: "West Hills, Portland, Oregon",
  },
  "westmorland-manner-in-sellwood-portland-sale": {
    title: "Westmoreland Manor Sale",
    neighborhood: "Westmoreland, Portland, Oregon",
  },
  "westridge": {
    title: "The Westridge Estate Sale",
    neighborhood: "Camas, Washington",
  },
  "wilcox-manor": {
    title: "The Wilcox Manor Estate Sale",
    neighborhood: "Southwest Hills, Portland, Oregon",
  },
};

function titleCase(saleName) {
  // Fallback only — SALE_META.title above covers every sale in this batch.
  return saleName
    .split(" ")
    .map((w) => (w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function eyebrowFor(meta) {
  return "Concluded Estate Sale";
}

function heroHeadingHtml(title) {
  const words = title.split(" ");
  const mid = Math.ceil(words.length / 2);
  return words.slice(0, mid).join(" ") + "<br>" + words.slice(mid).join(" ");
}

function run() {
  const report = { imported: [], skipped: [], dateWarnings: [], redirects: [] };
  if (!existsSync(OUTPUT_SALES_DIR)) mkdirSync(OUTPUT_SALES_DIR, { recursive: true });

  for (const [origSlug, meta] of Object.entries(SALE_META)) {
    const htmlPath = path.join(salesDir, origSlug, "index.html");
    if (!existsSync(htmlPath)) {
      report.skipped.push({ slug: origSlug, reason: "source HTML not found at " + htmlPath });
      continue;
    }
    const html = readFileSync(htmlPath, "utf8");
    const parsed = parseLegacySalePage(html, origSlug);

    const finalSlug = meta.newSlug || origSlug;
    if (meta.newSlug) {
      report.redirects.push({
        from: `/portland-estate-sales/${origSlug}/`,
        to: `/portland-estate-sales/${finalSlug}/`,
        reason: "non-descriptive slug renamed for SEO during legacy import",
      });
    }

    // ---- dates ----------------------------------------------------------
    let dateResult = meta.dateOverride;
    if (!dateResult) {
      const slugYear = yearFromSlug(origSlug);
      const uploadYear = parsed.earliestUpload ? new Date(parsed.earliestUpload).getUTCFullYear() : null;
      const fallbackYear = slugYear || uploadYear || new Date().getUTCFullYear();
      const parsedRange = parseDateRange(parsed.datesText || parsed.description, fallbackYear);
      if (!parsedRange) {
        report.dateWarnings.push({ slug: finalSlug, issue: "NO DATE PARSED — needs manual dates[] entry", datesText: parsed.datesText });
        continue;
      }
      dateResult = { dates: parsedRange.dates, confidence: parsedRange.confidence };
    }
    if (typeof dateResult.confidence === "string" && dateResult.confidence.startsWith("LOW")) {
      report.dateWarnings.push({ slug: finalSlug, issue: dateResult.confidence });
    }

    // ---- description ------------------------------------------------------
    const description = meta.descriptionOverride || parsed.description;
    if (!description) {
      report.dateWarnings.push({ slug: finalSlug, issue: "NO DESCRIPTION available even after override — needs manual copy" });
    }

    // ---- images -----------------------------------------------------------
    const galleryOutDir = path.join(OUTPUT_IMAGES_ROOT, finalSlug);
    const sourcePaths = parsed.galleryFiles.map((f) => path.join(imagesDir, f)).filter((p) => existsSync(p));
    const missing = parsed.galleryFiles.length - sourcePaths.length;
    if (missing > 0) {
      report.dateWarnings.push({ slug: finalSlug, issue: `${missing} gallery source file(s) referenced in HTML but not found on disk` });
    }

    const { manifest, droppedDuplicates, droppedOverflow } = optimizeGallery(sourcePaths, galleryOutDir, finalSlug, GALLERY_CAP);
    if (!manifest.length) {
      report.skipped.push({ slug: finalSlug, reason: "zero gallery images after optimization — cannot build page" });
      continue;
    }

    // Hero = first optimized gallery photo, reused as both the page hero and
    // the ogImage. A deliberate simplification vs. hand-picking each index
    // card's curated thumbnail — noted in the run report, see INGEST.md for
    // why (no reliable card-to-page join; see parseIndexCards doc comment).
    const heroSourcePath = sourcePaths[0];
    const heroDims = optimizeNamedImage(heroSourcePath, galleryOutDir, `${finalSlug}-hero`, { withJpg: true });

    const galleryFrontMatter = manifest.map((item, i) => ({
      base: item.base,
      alt: `Photo from ${meta.title}`,
      width: item.width,
      height: item.height,
    }));

    const title = meta.title;
    const frontMatter = {
      layout: "layouts/estate-sale.njk",
      permalink: `/portland-estate-sales/${finalSlug}/`,
      slug: finalSlug,
      saleName: title,
      // meta.neighborhood already carries its own city/state (not every sale
      // is in Portland — 5 in this batch are in Camas WA, Lake Oswego,
      // Tualatin, or Scholls), so use it whole rather than assuming
      // ", Portland" as a suffix.
      title: `${title} — ${meta.neighborhood} | Gary Germer & Associates`,
      description: description.length > 300 ? description.slice(0, 297) + "..." : description,
      ogTitle: title,
      ogDescription: description.length > 200 ? description.slice(0, 197) + "..." : description,
      ogImage: `/assets/images/estate-sales/${finalSlug}/${finalSlug}-hero.jpg`,
      eyebrow: eyebrowFor(meta),
      heroHeadingHtml: heroHeadingHtml(title),
      heroLead: description.length > 220 ? description.slice(0, 217) + "..." : description,
      neighborhood: meta.neighborhood,
      status: "auto",
      dates: dateResult.dates,
      heroImage: {
        src: `/assets/images/estate-sales/${finalSlug}/${finalSlug}-hero.jpg`,
        srcset900: `/assets/images/estate-sales/${finalSlug}/${finalSlug}-hero-900.webp`,
        srcsetFull: `/assets/images/estate-sales/${finalSlug}/${finalSlug}-hero.webp`,
        width: heroDims.width,
        height: heroDims.height,
        alt: `Photo from ${title}`,
      },
      about: {
        heading: title,
        paragraphs: [description],
      },
      gallery: galleryFrontMatter,
    };

    writeSaleFile(finalSlug, frontMatter);
    report.imported.push({
      origSlug,
      finalSlug,
      galleryCount: manifest.length,
      droppedDuplicates,
      droppedOverflow,
      dateConfidence: dateResult.confidence,
      datesRange: `${dateResult.dates[0].date} to ${dateResult.dates[dateResult.dates.length - 1].date}`,
    });
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Imported ${report.imported.length} sales, skipped ${report.skipped.length}, ${report.dateWarnings.length} warnings.`);
  console.log(`Report written to ${reportPath}`);
}

function yamlString(str) {
  // Front matter is YAML; escape double quotes and wrap. Descriptions/titles
  // never contain literal newlines by this point.
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function writeSaleFile(slug, fm) {
  const lines = [];
  lines.push(`layout: ${fm.layout}`);
  lines.push(`permalink: ${fm.permalink}`);
  lines.push(`slug: ${fm.slug}`);
  lines.push(`saleName: ${fm.saleName}`);
  lines.push(`title: ${yamlString(fm.title)}`);
  lines.push(`description: ${yamlString(fm.description)}`);
  lines.push(`ogTitle: ${fm.ogTitle}`);
  lines.push(`ogDescription: ${yamlString(fm.ogDescription)}`);
  lines.push(`ogImage: ${fm.ogImage}`);
  lines.push(`eyebrow: ${fm.eyebrow}`);
  lines.push(`heroHeadingHtml: ${yamlString(fm.heroHeadingHtml)}`);
  lines.push(`heroLead: ${yamlString(fm.heroLead)}`);
  lines.push(`neighborhood: ${fm.neighborhood}`);
  lines.push(`status: ${fm.status}`);
  lines.push(`dates:`);
  for (const d of fm.dates) {
    lines.push(`  - date: "${d.date}"`);
    lines.push(`    label: ${d.label}`);
    lines.push(`    opens: "${d.opens}"`);
    lines.push(`    opens24: "${d.opens24}"`);
    lines.push(`    closes: "${d.closes}"`);
    lines.push(`    closes24: "${d.closes24}"`);
  }
  lines.push(`heroImage:`);
  lines.push(`  src: ${fm.heroImage.src}`);
  lines.push(`  srcset900: ${fm.heroImage.srcset900}`);
  lines.push(`  srcsetFull: ${fm.heroImage.srcsetFull}`);
  lines.push(`  width: ${fm.heroImage.width}`);
  lines.push(`  height: ${fm.heroImage.height}`);
  lines.push(`  alt: ${yamlString(fm.heroImage.alt)}`);
  lines.push(`about:`);
  lines.push(`  heading: ${yamlString(fm.about.heading)}`);
  lines.push(`  paragraphs:`);
  for (const p of fm.about.paragraphs) {
    lines.push(`    - ${yamlString(p)}`);
  }
  lines.push(`gallery:`);
  for (const g of fm.gallery) {
    lines.push(`  - base: ${g.base}`);
    lines.push(`    alt: ${yamlString(g.alt)}`);
    lines.push(`    width: ${g.width}`);
    lines.push(`    height: ${g.height}`);
  }
  const content = "---\n" + lines.join("\n") + "\n---\n";
  writeFileSync(path.join(OUTPUT_SALES_DIR, `${slug}.njk`), content);
}

run();
