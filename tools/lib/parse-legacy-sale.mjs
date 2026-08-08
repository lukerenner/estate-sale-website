// One-time Ucraft-HTML parser for the 1.0 -> 2.0 legacy sale import.
// NOT part of the reusable pipeline — future single-sale intake starts from
// a plain info.md + photos folder instead of scraped HTML, so this module
// stays separate from lib/optimize-images.mjs on purpose. See INGEST.md.
//
// Ucraft pages are a flat, ordered sequence of "module" divs inside
// <main id="main-content">. This file classifies each module by its
// Module* class and by content heuristics (not by heading level — the same
// semantic role uses h2/h3/h5 across different sale pages) and extracts the
// handful of fields the 2.0 template's front matter needs.

// "align-center" is the common case, but some galleries (langworthy,
// peter-abrahams) export as "align-left" — match either.
const MODULE_RE = /<div\s+class="module-container\s+only-mobile\s+align-(?:center|left|right)\s+(Module\w+)/g;
const UC_CONTENT_RE = /<div class="uc-content">([\s\S]*?)<\/div>/;

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ucraft double-encoded some non-ASCII characters on export (mojibake) and
// separately lost whitespace between adjacent text runs when it flattened
// rich text to plain strings. Both are systematic enough to repair
// mechanically rather than per-page.
export function repairText(str) {
  if (!str) return str;
  let out = str
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€\x9d/g, "”")
    .replace(/â€"/g, "—")
    .replace(/â/g, "â") // CHâTEAU -> Château (â alone, mid-word, means literal â was lost a layer of decoding)
    .replace(/&amp;#039;/g, "’")
    .replace(/&#039;/g, "’")
    .replace(/&amp;/g, "&");
  // Insert a space where a lowercase/digit run butts against an uppercase
  // run or a digit run without punctuation between them, e.g.
  // "March 24-2610am-4pm" -> "March 24-26 10am-4pm" is NOT safely automatable
  // (ambiguous digit boundary) — flagged for manual review instead, see
  // NEEDS_DATE_REVIEW in import-legacy-sales.mjs.
  return out.trim();
}

export function sliceMain(html) {
  const start = html.indexOf('<main id="main-content"');
  const end = html.indexOf("</main>", start);
  if (start === -1 || end === -1) return "";
  return html.slice(start, end);
}

function extractModules(mainHtml) {
  const modules = [];
  let m;
  MODULE_RE.lastIndex = 0;
  while ((m = MODULE_RE.exec(mainHtml))) {
    modules.push({ type: m[1], index: m.index });
  }
  return modules.map((mod, i) => {
    const next = modules[i + 1] ? modules[i + 1].index : mainHtml.length;
    const chunk = mainHtml.slice(mod.index, next);
    const contentMatch = UC_CONTENT_RE.exec(chunk);
    return {
      type: mod.type,
      raw: chunk,
      text: contentMatch ? repairText(stripTags(contentMatch[1])) : "",
    };
  });
}

const ZIP_RE = /\b\d{5}\b/;
// Requires a day number right after the month name/abbreviation (e.g.
// "March 17", "Feb. 15th") so "decades", "August" used as a surname, etc.
// don't false-positive. A bare "\b(Jan|...)[a-z]*\b" match on "decades"
// (Dec + "ades") was the actual bug caught while testing this against
// westmorland-manner-in-sellwood-portland-sale.
const DATE_WORD_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s*\d{1,2}(st|nd|rd|th)?\b/i;

export function parseLegacySalePage(html, slug) {
  const mainHtml = sliceMain(html);
  const modules = extractModules(mainHtml);

  const galleryIdx = modules.findIndex((m) => m.type === "ModuleGallery");
  const beforeGallery = galleryIdx === -1 ? modules : modules.slice(0, galleryIdx);

  const titles = beforeGallery.filter((m) => m.type === "ModuleTitle" && m.text);
  const paragraphs = beforeGallery.filter((m) => m.type === "ModuleParagraph" && m.text);

  const saleNameTitle = titles[0]?.text || "";
  const addressTitle = titles.find((t, i) => i > 0 && ZIP_RE.test(t.text));

  const datesParagraph = paragraphs.find((p) => /dates?:/i.test(p.text) || DATE_WORD_RE.test(p.text));
  const descriptionParagraph = paragraphs.find((p) => p !== datesParagraph && p.text.length > 60);

  // Gallery: local <img class="image single-item ..." src="...">, DOM order.
  const galleryHtml = galleryIdx === -1 ? "" : modules[galleryIdx].raw;
  const imgRe = /<img\s+class="image\s+single-item[^"]*"[\s\S]*?src="([^"]+)"/g;
  const galleryFiles = [];
  let gm;
  while ((gm = imgRe.exec(galleryHtml))) {
    galleryFiles.push(gm[1].split("/").pop());
  }

  // Earliest upload timestamp from the gallery's OWN ?v= query params —
  // proxy for "when this sale's photos were uploaded," a few days before the
  // sale date and the only reliable year signal on pages whose visible date
  // heading omits the year. Scoped strictly to the gallery-images-data JSON
  // blob, NOT the whole page: a page-wide regex also catches a shared
  // static-asset cache-buster (?v=1739989674, 2025-02-19) that a site-wide
  // redeploy stamped onto unrelated pages, which silently produced the wrong
  // year for oakwood-gardens and 4 other sales during testing.
  const galleryDataMatch = /class="gallery-images-data"\s+value="([^"]*)"/.exec(html);
  const vParams = galleryDataMatch
    ? [...galleryDataMatch[1].matchAll(/\?v=(1[0-9]{9})/g)].map((m) => Number(m[1]))
    : [];
  const earliestUpload = vParams.length ? new Date(Math.min(...vParams) * 1000) : null;

  // <title>/<meta og:title> — the machine-readable title, used as a
  // fallback and a cross-check against the display title.
  const headTitleMatch = /<title>([^<]*)<\/title>/.exec(html);
  const headTitle = headTitleMatch ? repairText(headTitleMatch[1]).replace(/\s*\|\s*Gary Germer.*$/i, "").trim() : "";

  return {
    slug,
    saleNameTitle,
    headTitle,
    addressLines: addressTitle ? addressTitle.text : "",
    datesText: datesParagraph ? datesParagraph.text : "",
    description: descriptionParagraph ? descriptionParagraph.text : "",
    galleryFiles,
    earliestUpload: earliestUpload ? earliestUpload.toISOString() : null,
    moduleTypes: modules.map((m) => m.type), // debug aid
  };
}

// Parses 1.0/estatesales/index.html into ordered cards for manual
// title/thumbnail cross-reference. Do NOT join to sale pages by href — 6 of
// 43 cards on the live index point at the wrong slug (verified during
// research: e.g. "Corinne Gentner" and "Military Weapons" cards both link to
// other sales' pages). Join by title text instead.
export function parseIndexCards(html) {
  const cards = [];
  const cardRe = /<h[3-5][^>]*>\s*(?:<strong>)?([^<]+)/g;
  // Fallback: crude but sufficient for a one-time manual cross-reference —
  // real joining happens by a human reading this alongside the site tree,
  // not by trusting this regex as ground truth.
  let m;
  while ((m = cardRe.exec(html))) {
    const title = repairText(m[1]).trim();
    if (title) cards.push(title);
  }
  return cards;
}
