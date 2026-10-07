// estatesales.org "past sales" -> estate-sales/*.njk sync. Files are the
// source of truth: dedupe is "does any estate-sales/*.njk already have
// front-matter source.id === this sale's id", scanned fresh every run, never
// a state file. Modeled directly on sync-shop.mjs's shape (see that file for
// the broader rationale) but adapted for estatesales.org's HTML instead of a
// JSON product feed.
//
// New sale (no matching .njk) -> scrape detail + gallery, generate a slug,
// download + optimize photos, write a new estate-sales/<slug>.njk with a
// `source: {id, url}` block.
//
// A single sale's fetch/parse/image failure is logged and skipped — it never
// aborts the run for the rest of the batch (same spirit as sync-shop.mjs's
// per-product error tolerance). Requests are paced with a small delay so
// this never hammers estatesales.org, whether run as a one-time backfill or
// unattended from a future CI schedule.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import matter from "gray-matter";
import { optimizeGallery } from "./optimize-images.mjs";
import { suggestSlug } from "./suggest-slug.mjs";

const COMPANY_URL = "https://estatesales.org/estate-sale-companies/gary-germer-associates-5061";
const ESO_ORIGIN = "https://estatesales.org";
const UA = "Mozilla/5.0 (compatible; GaryGermerSiteSync/1.0; +https://www.garygermer.com)";

const MONTH_ABBR = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };
const DOW_FULL = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { retries = 3, delayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 * (attempt + 1);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr || new Error(`fetchText failed for ${url}`);
}

function decodeEntities(str) {
  return String(str)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    // Catch-all for any other numeric entity (decimal or hex) this feed
    // happens to use — sale names have shown up with &#039; etc.
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function plainText(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

// Parses the trailing -<digits> off an estatesales.org sale URL/slug — the
// stable numeric id used for dedupe.
export function idFromUrl(url) {
  const m = String(url).match(/-(\d+)(?:\/)?$/);
  return m ? m[1] : null;
}

// Finds every /estate-sales/... sale-detail link anywhere in the company
// page's initial HTML — verified by curl to ship server-rendered, no JS
// needed. The company page currently has three tabs: "Sales" (panel1,
// active/upcoming — empty for this company as of this writing), an
// items-for-sale panel (panel2, irrelevant), and "Past Sales" (panel3, ~139
// entries, only the most recent ~50 of which are present in this initial
// HTML — pagination/"load more" for the rest is JS-driven and NOT scraped
// here, which is fine: a new sale always appears at the top of the recent
// window well before it would need page 2). Deliberately NOT scoped to
// panel3 specifically — a future active/upcoming sale in panel1 matches the
// same href pattern and is picked up automatically, which is what lets the
// hello-bar/upcoming-teaser features fire as soon as a sale is listed rather
// than only once it lands in the past-sales tab. If estatesales.org ever
// moves active sales to a structurally different markup (no plain <a href>
// linking straight to the detail page), this will need a second pass — no
// evidence of that today, but flagging it since it can't be verified without
// a company that currently has an active sale to test against.
//
// Each sale link appears multiple times per sale (photo, title, button);
// returns one entry per unique id, in page order (newest first).
export function parseCompanySaleLinks(html) {
  const seen = new Set();
  const out = [];
  const re = /href="(\/estate-sales\/[a-z]{2}\/[^"?]+?-(\d+))"/g;
  let m;
  while ((m = re.exec(html))) {
    const [, relUrl, id] = m;
    if (relUrl.endsWith("/gallery") || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url: ESO_ORIGIN + relUrl });
  }
  return out;
}

// Pulls the Event JSON-LD block, the full "Sale Description" ad copy (kept
// as raw-ish HTML paragraphs — the estate-sale layout renders about.paragraphs
// with `| safe`, so entities like &rsquo;/&nbsp; are meant to survive as-is),
// and the "Dates & Times" open days. Deliberately ignores JSON-LD
// startDate/endDate (the offset is stale/wrong in this feed — real open/close
// clock times come from the rendered "Dates & Times" section instead, parsed
// below). `streetAddress` IS captured here (unlike locality/region/postal,
// which are never sensitive) but the caller must only ever use it for a sale
// that is still upcoming/live at scrape time — see buildAddressBlock() and
// INGEST.md's address-privacy section for why a concluded sale must never
// get a real street address in its front matter.
export function parseSaleDetail(html) {
  const jsonldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!jsonldMatch) throw new Error("no JSON-LD Event block found on detail page");
  // The feed's JSON-LD has stray literal newlines/tabs inside string values
  // in some cases but is otherwise valid; parse leniently field-by-field
  // instead of a strict JSON.parse, since whitespace-in-strings breaks that.
  const raw = jsonldMatch[1];
  const rawName = (raw.match(/"name":\s*"([^"]+)"/) || [])[1];
  const name = rawName ? decodeEntities(rawName) : rawName;
  const image = (raw.match(/"image":\s*\[\s*"([^"]+)"/) || [])[1];
  const streetAddress = (raw.match(/"streetAddress":\s*"([^"]+)"/) || [])[1];
  const addressLocality = (raw.match(/"addressLocality":\s*"([^"]+)"/) || [])[1];
  const addressRegion = (raw.match(/"addressRegion":\s*"([^"]+)"/) || [])[1];
  const addressPostalCode = (raw.match(/"postalCode":\s*"([^"]+)"/) || [])[1];
  if (!name) throw new Error("could not parse sale name from JSON-LD");

  // Sale Description: full ad copy, one or more <p> paragraphs.
  const descIdx = html.indexOf('id="sale-descr"');
  let paragraphs = [];
  if (descIdx !== -1) {
    const descSection = html.slice(descIdx, descIdx + 8000);
    const pMatches = [...descSection.matchAll(/<p>([\s\S]*?)<\/p>/g)];
    paragraphs = pMatches
      .map((p) => p[1].replace(/\s+/g, " ").trim())
      .filter(Boolean)
      // Drop the standalone accessibility/hazard disclaimer paragraph — it's
      // boilerplate, not sale content, and reads oddly as page body copy.
      .filter((p) => !/^DISCLAIMER:/i.test(plainText(p)))
      // The page also injects a generic "this sale occurred in the past,
      // browse others near <city>" banner elsewhere in the DOM; our
      // sale-descr window is generous enough to sometimes catch it — it's
      // boilerplate, not ad copy, so drop it explicitly.
      .filter((p) => !/occurred in the past\. Try browsing other sales near/i.test(p));
  }
  if (!paragraphs.length) {
    const jsonldDesc = (raw.match(/"description":\s*"([^"]*)"/) || [])[1];
    if (jsonldDesc) paragraphs = [decodeEntities(jsonldDesc)];
  }
  if (!paragraphs.length) throw new Error("could not find sale description text");

  // Dates & Times (US/Pacific): one <li> per open day, e.g.
  //   <li class="text-sm"><span>Thu, Sep 26, 2024</span> 10:00AM -  4:00PM</li>
  const datesIdx = html.indexOf("Dates &amp; Times");
  const datesEndIdx = html.indexOf("Sale Description", datesIdx);
  const dates = [];
  if (datesIdx !== -1) {
    const datesSection = html.slice(datesIdx, datesEndIdx === -1 ? datesIdx + 6000 : datesEndIdx);
    const liRe = /<li class="text-sm">\s*<span>([^<]+)<\/span>\s*([\d: ]+[AP]M)\s*-\s*([\d: ]+[AP]M)\s*<\/li>/g;
    let lm;
    while ((lm = liRe.exec(datesSection))) {
      const [, dateStr, opensStr, closesStr] = lm;
      const parsed = parseSaleDateLine(dateStr, opensStr, closesStr);
      if (parsed) dates.push(parsed);
    }
  }
  if (!dates.length) throw new Error("could not parse any open dates from the Dates & Times section");
  const openDates = fillDateGaps(dates);

  // Before the seller releases the street address, the JSON-LD carries no
  // address at all -- but the canonical URL still names the city and zip
  // (/estate-sales/or/hillsboro/97124/...), which are already public there.
  // Fall back to those so an upcoming sale isn't mislabeled "Portland".
  const urlLoc = (html.match(/estatesales\.org\/estate-sales\/([a-z]{2})\/([a-z0-9-]+)\/(\d{5})\//i) || []).slice(1);
  const fromUrl = urlLoc.length
    ? {
        addressRegion: urlLoc[0].toUpperCase(),
        addressLocality: urlLoc[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        addressPostalCode: urlLoc[2],
      }
    : {};

  return {
    name,
    image,
    streetAddress,
    addressLocality: addressLocality || fromUrl.addressLocality,
    addressRegion: addressRegion || fromUrl.addressRegion,
    addressPostalCode: addressPostalCode || fromUrl.addressPostalCode,
    paragraphs,
    dates: openDates,
  };
}

// A sale always runs every day from its first date to its last -- it never
// closes in the middle. estatesales.org listings sometimes skip days anyway
// (owner's call, 2026-10-07: Gary's "Oct 15 - 18, 4 days!!" sale was
// entered as Thu + Sun only), so fill any missing day in the range, copying
// hours from the nearest listed day before it.
export function fillDateGaps(dates) {
  const byDate = new Map(dates.map((d) => [d.date, d]));
  const keys = [...byDate.keys()].sort();
  const out = [];
  const last = new Date(`${keys.at(-1)}T00:00:00Z`);
  let prev = null;
  for (let d = new Date(`${keys[0]}T00:00:00Z`); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (byDate.has(key)) {
      prev = byDate.get(key);
      out.push(prev);
      continue;
    }
    const dow = Object.values(DOW_FULL)[d.getUTCDay()];
    const month = Object.values(MONTH_ABBR)[d.getUTCMonth()];
    out.push({ ...prev, date: key, label: `${dow}, ${month} ${d.getUTCDate()}` });
  }
  return out;
}

// Same rule computeStatus()/the upcomingEstateSales collection use elsewhere
// on the site: a sale is still upcoming/live if its LAST open day hasn't
// passed yet. Anything else is concluded.
// Keyed on the Pacific calendar day, not UTC: UTC rolls over at 4-5pm
// Pacific, which would call a sale "concluded" (and strip its address)
// while its final day is still open.
export function pacificDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function isUpcomingOrLive(dates, today = new Date()) {
  if (!dates || !dates.length) return false;
  const todayKey = pacificDateKey(today);
  const lastDate = dates.map((d) => d.date).sort().at(-1);
  return lastDate >= todayKey;
}

// Branches the `address` field on whether the sale is still upcoming/live:
//   - upcoming/live: a real address, `released: "auto"` — same shape as
//     birkendene.njk, so the layout can show/reveal it during the live
//     window. (It still ships in page source on every build regardless of
//     status — a known, accepted limitation documented in INGEST.md, not
//     something this module tries to fix.)
//   - concluded: no `address` key at all. Never bake a real street address
//     into a page for a sale that's already over — there is no live-window
//     purpose left for it, only a privacy downside.
export function buildAddressBlock(detail) {
  if (!isUpcomingOrLive(detail.dates)) return null;
  if (!detail.streetAddress) return null;
  const cityStateZip = [detail.addressLocality, [detail.addressRegion, detail.addressPostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    line1: detail.streetAddress,
    line2: cityStateZip,
    mapQuery: [detail.streetAddress, detail.addressLocality, detail.addressRegion, detail.addressPostalCode].filter(Boolean).join(", "),
    released: "auto",
  };
}

function parseSaleDateLine(dateStr, opensStr, closesStr) {
  const dm = dateStr.trim().match(/([A-Za-z]{3}),\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!dm) return null;
  const [, dow, monAbbr, day, year] = dm;
  const monthFull = MONTH_ABBR[monAbbr];
  const monthIndex = Object.keys(MONTH_ABBR).indexOf(monAbbr);
  if (!monthFull || monthIndex === -1) return null;
  const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const label = `${DOW_FULL[dow] || dow}, ${monthFull} ${Number(day)}`;

  const opens = parseTimeStr(opensStr);
  const closes = parseTimeStr(closesStr);
  if (!opens || !closes) return null;

  return { date, label, opens: opens.display, opens24: opens.h24, closes: closes.display, closes24: closes.h24 };
}

function parseTimeStr(str) {
  const tm = String(str).trim().match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!tm) return null;
  const [, hourStr, minute, ampm] = tm;
  let hour = Number(hourStr);
  const isPM = ampm.toUpperCase() === "PM";
  let h24 = hour % 12;
  if (isPM) h24 += 12;
  const display = `${hour}:${minute} ${ampm.toUpperCase()}`;
  return { display, h24: `${String(h24).padStart(2, "0")}:${minute}` };
}

// Gallery pages are 100 photos each; stop at the first page returning fewer
// than 100 or that repeats the previous page's first image (belt-and-braces
// against an unexpected infinite-pagination edge case).
export async function fetchGalleryImageUrls(saleDetailUrl, { delayMs = 700, maxPages = 20 } = {}) {
  const urls = [];
  let prevFirst = null;
  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = page === 1 ? `${saleDetailUrl}/gallery` : `${saleDetailUrl}/gallery?page=${page}`;
    const html = await fetchText(pageUrl);
    // Extension varies by sale -- older sales serve .jpg thumbs, newer ones
    // .webp (observed directly: "Adventurer's Sellwood Sale" id 2434733
    // serves .webp and was silently getting zero gallery photos before this
    // fix, falling back to the single JSON-LD hero image only). Capture
    // whatever extension is actually there instead of assuming .jpg.
    const thumbs = [...html.matchAll(/<img[^>]+src="(https:\/\/eso-cdn\.tlcdn\.workers\.dev\/s-\d+-[a-z0-9]+)-t\.(jpg|jpeg|webp|png)"/gi)].map((m) => `${m[1]}.${m[2]}`);
    if (!thumbs.length) break;
    if (prevFirst && thumbs[0] === prevFirst) break;
    prevFirst = thumbs[0];
    urls.push(...thumbs);
    if (thumbs.length < 100) break;
    await sleep(delayMs);
  }
  return urls;
}

function downloadTmp(url, destPath) {
  execFileSync("curl", ["-sL", "-A", UA, url, "-o", destPath]);
}

function yamlString(str) {
  return '"' + String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// Builds a heroHeadingHtml like existing sales do — a <br> before a
// trailing "Estate Sale" (or similar) when the name ends that way, otherwise
// the bare name with no forced line break.
function buildHeroHeading(name) {
  const m = name.match(/^(.*)\s+((?:Estate Sale|Estate Collection|Estate Warehouse Popup|Estate Popup Warehouse|Sale|Collection))$/i);
  if (m) return `${m[1]}<br>${m[2]}`;
  return name;
}

// Showroom/warehouse sales (held at the company's own Broadway retail space
// rather than a private home) don't have a residential neighborhood to
// derive — this is the same heuristic a human would apply, matching the
// precedent set by military-collectibles-showroom-sale.njk (neighborhood:
// "Eliot, Portland, Oregon", permalink under northeast-portland-estate-sales).
function isShowroomSale(name, paragraphs) {
  const text = `${name} ${paragraphs.join(" ")}`.toLowerCase();
  return /showroom|broadway|our (own )?(retail )?space|gallery( |-)?space|warehouse|in-tents|intents pop-?up|pop-?up warehouse/.test(text);
}

// Maps a zip -> the neighborhood group string used elsewhere on the site,
// and the matching permalink prefix. Falls back to a generic Portland
// grouping (Northeast Portland, matching the site's existing fallback for
// "Portland, Oregon" with no more specific neighborhood) when the zip isn't
// one we have a specific mapping for.
const ZIP_NEIGHBORHOODS = {
  "97232": { neighborhood: "Eliot, Portland, Oregon", permalinkPrefix: "northeast-portland-estate-sales" },
  "97227": { neighborhood: "Eliot, Portland, Oregon", permalinkPrefix: "northeast-portland-estate-sales" },
  "97212": { neighborhood: "Grant Park, Portland, Oregon", permalinkPrefix: "northeast-portland-estate-sales" },
  "97213": { neighborhood: "Northeast Portland, Oregon", permalinkPrefix: "northeast-portland-estate-sales" },
  "97214": { neighborhood: "Central Eastside, Portland, Oregon", permalinkPrefix: "southeast-portland-estate-sales" },
  "97202": { neighborhood: "Westmoreland, Portland, Oregon", permalinkPrefix: "southeast-portland-estate-sales" },
  "97225": { neighborhood: "Raleigh Hills, Portland, Oregon", permalinkPrefix: "southwest-portland-estate-sales" },
  "97239": { neighborhood: "Southwest Hills, Portland, Oregon", permalinkPrefix: "west-hills-estate-sales" },
  "97229": { neighborhood: "NW Skyline, Portland, Oregon", permalinkPrefix: "west-hills-estate-sales" },
};

function deriveLocation({ name, paragraphs, addressLocality, addressPostalCode, addressRegion }) {
  if (isShowroomSale(name, paragraphs)) {
    return { neighborhood: "Eliot, Portland, Oregon", permalinkPrefix: "northeast-portland-estate-sales" };
  }
  const known = ZIP_NEIGHBORHOODS[addressPostalCode];
  if (known) return known;
  // No specific precedent for this zip — fall back to city-level, matching
  // the site's existing convention for sales with no distinct neighborhood
  // on file (e.g. lake-oswego-estate-sale.njk: "Lake Oswego, Oregon").
  const city = addressLocality || "Portland";
  // Existing WA sales (lacamas-lake.njk, westridge.njk) spell the state
  // abbreviated ("... Camas, WA"); existing OR sales spell it out ("...
  // Portland, Oregon") — match whichever convention is already in use
  // rather than picking one.
  const state = addressRegion === "WA" ? "WA" : "Oregon";
  const permalinkPrefix =
    city === "Ridgefield" ? "ridgefield-estate-sales" : city === "Portland" ? "northeast-portland-estate-sales" : `${city.toLowerCase().replace(/\s+/g, "-")}-estate-sales`;
  return { neighborhood: `${city}, ${state}`, permalinkPrefix };
}

function truncate(str, max) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + "...";
}

/**
 * Scans every estate-sales/*.njk file for a front-matter `source.id`, so
 * repeated runs never re-create a sale already on disk. Legacy sales with no
 * `source` field simply never match anything here, by design.
 */
function scanExistingSourceIds(salesDir) {
  const ids = new Set();
  if (!existsSync(salesDir)) return ids;
  for (const file of readdirSync(salesDir)) {
    if (!file.endsWith(".njk")) continue;
    try {
      const { data } = matter(readFileSync(path.join(salesDir, file), "utf8"));
      if (data.source && data.source.id != null) ids.add(String(data.source.id));
    } catch {
      // an unparseable front-matter file shouldn't block the whole scan
    }
  }
  return ids;
}

// Belt-and-braces dedupe for sales that predate the `source.id` field: this
// site's own "past sales" window on estatesales.org can legitimately include
// a sale that was already hand-imported under a different slug (this is a
// real, observed case — "The Birkendene Estate Sale" and "The Oakwood
// Gardens Estate Sale" are both already on the site as birkendene.njk /
// oakwood-gardens.njk with no source.id, and both are recent enough to still
// show up in the scraped list). id-based dedupe alone can't catch this since
// the legacy file has no id to match. A normalized saleName match is a cheap,
// reasonably safe second check — it can't tell two truly different sales
// with the same generic name apart, but a false skip (missing a genuinely
// new sale that happens to share a name) is a far smaller problem than a
// false create (a duplicate page for a sale already live on the site).
function normalizeSaleName(name) {
  return String(name)
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scanExistingSaleNames(salesDir) {
  const names = new Set();
  if (!existsSync(salesDir)) return names;
  for (const file of readdirSync(salesDir)) {
    if (!file.endsWith(".njk")) continue;
    try {
      const { data } = matter(readFileSync(path.join(salesDir, file), "utf8"));
      if (data.saleName) names.add(normalizeSaleName(data.saleName));
    } catch {
      // an unparseable front-matter file shouldn't block the whole scan
    }
  }
  return names;
}

// Fingerprints of what estatesales.org said last time this sale was synced,
// stored in the file's `source` block. A refresh only rewrites the file when
// one of these moves -- so a hand edit to an upcoming sale survives until
// the listing itself changes, instead of being reverted every hour.
// `live` is folded in so the end of a sale (address stripped, eyebrow flips
// to "Concluded") registers as a change even if the listing didn't.
function sha1(str) {
  return createHash("sha1").update(str).digest("hex").slice(0, 16);
}
function detailHash(detail) {
  const { name, paragraphs, dates, streetAddress, addressLocality, addressRegion, addressPostalCode } = detail;
  return sha1(JSON.stringify({ name, paragraphs, dates, streetAddress, addressLocality, addressRegion, addressPostalCode, live: isUpcomingOrLive(dates) }));
}
function galleryHash(imageUrls) {
  return sha1(imageUrls.join("\n"));
}

// Downloads a sale's source photos and writes the three WebP tiers. Clears
// the sale's image folder first, so a refresh that drops or reorders photos
// never leaves stale -NN- files behind.
function downloadAndOptimize({ imageUrls, slug, imagesRoot, tmpDir, imageCap }) {
  const outDir = path.join(imagesRoot, slug);
  rmSync(outDir, { recursive: true, force: true });
  const tmpPaths = [];
  for (const [i, imgUrl] of imageUrls.entries()) {
    // Match the tmp file's extension to the real source extension
    // (.jpg or .webp) rather than assuming .jpg -- identify/cwebp
    // happen to sniff real content regardless of extension, so this
    // wasn't silently corrupting anything, but a .jpg-named webp file
    // is misleading to debug and worth getting right.
    const srcExt = path.extname(new URL(imgUrl).pathname) || ".jpg";
    const tmpPath = path.join(tmpDir, `${slug}-${i}${srcExt}`);
    try {
      downloadTmp(imgUrl, tmpPath);
      tmpPaths.push(tmpPath);
    } catch {
      // one bad photo shouldn't sink the whole sale
    }
  }
  if (!tmpPaths.length) throw new Error("all gallery photo downloads failed");

  const { manifest } = optimizeGallery(tmpPaths, outDir, slug, imageCap);
  if (!manifest.length) throw new Error("image optimization produced no gallery photos");
  return manifest;
}

// Builds a sale's full .njk front matter. Shared by create and refresh so
// the two can never drift apart. `extra` carries any keys a human added to
// an existing file (e.g. `video`) that this generator doesn't produce.
function renderSaleFile({ id, url, slug, permalink, detail, location, manifest, hashes, extra = {} }) {
  const hero = manifest[0];
  const description = truncate(plainText(detail.paragraphs[0]), 300);
  const ogDescription = truncate(plainText(detail.paragraphs[0]), 200);
  // A short teaser for the compact hero paragraph -- NOT the full ad
  // copy. The full text still lives, verbatim and unabridged, in
  // about.paragraphs below; the layout's "About the Sale" section
  // renders it whenever about.paragraphs exists (see
  // estate-sale.njk), matching the birkendene.njk pattern of a brief
  // hero blurb + full description further down the page.
  const heroLead = truncate(plainText(detail.paragraphs[0]), 240);

  const cityForTitle =
    location.neighborhood
      .split(",")
      .map((s) => s.trim())
      .slice(0, -1)
      .join(", ") || location.neighborhood;
  const upcomingOrLive = isUpcomingOrLive(detail.dates);
  const addressBlock = buildAddressBlock(detail);

  const lines = [
    "layout: layouts/estate-sale.njk",
    `permalink: ${permalink}`,
    `slug: ${slug}`,
    `saleName: ${yamlString(detail.name)}`,
    `title: ${yamlString(`${detail.name} — ${cityForTitle} | Gary Germer & Associates`)}`,
    `description: ${yamlString(description)}`,
    `ogTitle: ${yamlString(`${detail.name} — ${cityForTitle}`)}`,
    `ogDescription: ${yamlString(ogDescription)}`,
    `ogImage: /assets/images/estate-sales/${slug}/${hero.base}-900.webp`,
    // "Estate Liquidation Sale" for a still-upcoming/live sale (matches
    // birkendene.njk, the one precedent for that state); every concluded
    // sale on the site uses "Concluded Estate Sale".
    `eyebrow: ${upcomingOrLive ? "Estate Liquidation Sale" : "Concluded Estate Sale"}`,
    `heroHeadingHtml: ${yamlString(buildHeroHeading(detail.name))}`,
    `heroLead: ${yamlString(heroLead)}`,
    `neighborhood: ${location.neighborhood}`,
    "status: auto",
  ];
  if (detail.addressPostalCode) lines.push(`addressPostalCode: ${yamlString(detail.addressPostalCode)}`);
  if (addressBlock) {
    // Only ever reached for a sale that is still upcoming/live at scrape
    // time — see buildAddressBlock(). Every sale in a one-time backfill
    // of already-concluded sales takes the other branch and gets no
    // address key at all.
    lines.push("address:");
    lines.push(`  line1: ${yamlString(addressBlock.line1)}`);
    lines.push(`  line2: ${yamlString(addressBlock.line2)}`);
    lines.push(`  mapQuery: ${yamlString(addressBlock.mapQuery)}`);
    lines.push(`  released: ${addressBlock.released}`);
  }
  lines.push("dates:");
  for (const d of detail.dates) {
    lines.push(`  - date: ${yamlString(d.date)}`);
    lines.push(`    label: ${d.label}`);
    lines.push(`    opens: ${yamlString(d.opens)}`);
    lines.push(`    opens24: ${yamlString(d.opens24)}`);
    lines.push(`    closes: ${yamlString(d.closes)}`);
    lines.push(`    closes24: ${yamlString(d.closes24)}`);
  }
  lines.push("source:");
  lines.push(`  id: ${id}`);
  lines.push(`  url: ${url}`);
  lines.push(`  detailHash: ${hashes.detail}`);
  lines.push(`  galleryHash: ${hashes.gallery}`);
  lines.push("heroImage:");
  lines.push(`  src: /assets/images/estate-sales/${slug}/${hero.base}-900.webp`);
  lines.push(`  srcset900: /assets/images/estate-sales/${slug}/${hero.base}-900.webp`);
  lines.push(`  srcsetFull: /assets/images/estate-sales/${slug}/${hero.base}-1400.webp`);
  lines.push(`  width: ${hero.width}`);
  lines.push(`  height: ${hero.height}`);
  lines.push(`  alt: ${yamlString(`Photo from ${detail.name}`)}`);
  lines.push("about:");
  // Opts into the layout's full "About the Sale" section (estate-sale.njk)
  // -- see that file's comment. Required because heroLead here is only a
  // short teaser (truncate(paragraphs[0])), not the full copy like
  // legacy hand-authored sales' heroLead is.
  lines.push("  showFull: true");
  lines.push(`  heading: ${yamlString(detail.name)}`);
  lines.push("  paragraphs:");
  for (const p of detail.paragraphs) lines.push(`    - ${yamlString(p)}`);
  lines.push("gallery:");
  for (const g of manifest) {
    lines.push(`  - base: ${g.base}`);
    lines.push(`    alt: ${yamlString(`Photo from ${detail.name}`)}`);
    lines.push(`    width: ${g.width}`);
    lines.push(`    height: ${g.height}`);
  }

  if (Object.keys(extra).length) {
    lines.push(matter.stringify("", extra).replace(/^---\n/, "").replace(/---\n[\s\S]*$/, "").trimEnd());
  }
  return "---\n" + lines.join("\n") + "\n---\n";
}

/**
 * @param {object} opts
 * @param {string} [opts.salesDir] - estate-sales/ directory
 * @param {string} [opts.imagesRoot] - assets/images/estate-sales/ directory
 * @param {string} [opts.tmpDir] - scratch dir for downloaded source photos
 * @param {number} [opts.imageCap] - per-sale gallery photo cap (INGEST.md default: 30)
 * @param {number} [opts.delayMs] - pacing delay between sales/pages
 * @param {string} [opts.companyUrl] - override for testing
 * @param {string[]} [opts.onlyIds] - restrict processing to these sale ids
 *   (still subject to every dedupe check below). Not needed for normal
 *   scheduled runs — every id in the scraped window is fair game there by
 *   design. Meant for a scoped one-time backfill against a specific,
 *   pre-vetted list of ids, or for re-running a single failed id.
 * @returns {Promise<{created:string[], skippedExisting:string[], skippedNameMatch:string[], failed:Array<{id:string,url:string,error:string}>}>}
 */
export async function syncEstateSalesSource({
  salesDir = "estate-sales",
  imagesRoot = "assets/images/estate-sales",
  tmpDir = ".tmp-estate-sales-sync",
  imageCap = 30,
  delayMs = 1000,
  companyUrl = COMPANY_URL,
  onlyIds = null,
} = {}) {
  const report = { created: [], skippedExisting: [], skippedNameMatch: [], failed: [] };
  if (!existsSync(salesDir)) mkdirSync(salesDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const existingIds = scanExistingSourceIds(salesDir);
  const existingNames = scanExistingSaleNames(salesDir);
  const companyHtml = await fetchText(companyUrl);
  let saleLinks = parseCompanySaleLinks(companyHtml);
  if (onlyIds) {
    const allow = new Set(onlyIds.map(String));
    saleLinks = saleLinks.filter((l) => allow.has(l.id));
  }

  const existingSlugs = readdirSync(salesDir)
    .filter((f) => f.endsWith(".njk"))
    .map((f) => f.replace(/\.njk$/, ""));

  for (const { id, url } of saleLinks) {
    if (existingIds.has(id)) {
      report.skippedExisting.push(id);
      continue;
    }

    try {
      await sleep(delayMs);
      const detailHtml = await fetchText(url);
      const detail = parseSaleDetail(detailHtml);

      if (existingNames.has(normalizeSaleName(detail.name))) {
        // Already on the site under a legacy filename with no source.id —
        // see scanExistingSaleNames() above. Record it as its own report
        // bucket (not skippedExisting, which means "matched by id") so this
        // is visible and reviewable rather than silently identical-looking.
        report.skippedNameMatch.push({ id, url, name: detail.name });
        continue;
      }

      await sleep(delayMs);
      const imageUrls = await fetchGalleryImageUrls(url, { delayMs });
      if (!imageUrls.length && detail.image) imageUrls.push(detail.image);
      if (!imageUrls.length) throw new Error("no gallery photos found");

      const location = deriveLocation({ name: detail.name, paragraphs: detail.paragraphs, ...detail });

      const neighborhoodShort = location.neighborhood.split(",")[0].trim();
      // suggestSlug's "property name" candidate always appends " estate
      // sale" itself (see suggest-slug.mjs) — pass it the bare distinctive
      // name (leading article and any trailing "Estate Sale"/"Collection"-
      // type suffix already stripped) so it doesn't double up, e.g. "The
      // TillaThom Estate Sale" -> propertyName "TillaThom" -> slug
      // "tillathom-estate-sale", not "tillathom-estate-sale-estate-sale".
      const strippedName = detail.name
        .replace(/^(the|a|an)\s+/i, "")
        // Allow trailing punctuation ("New Year Blow Out Sale!") between the
        // suffix word and the end of the string.
        .replace(/\s+(estate sale|estate collection|estate warehouse popup|estate popup warehouse|estate liquidation sale|estate|sale|collection)[!.\s]*$/i, "")
        .trim();
      const { slug } = suggestSlug({
        propertyName: strippedName || undefined,
        neighborhood: neighborhoodShort,
        dateFallback: detail.dates[0].date,
        existingSlugs,
      });
      existingSlugs.push(slug);

      const manifest = downloadAndOptimize({ imageUrls, slug, imagesRoot, tmpDir, imageCap });
      const content = renderSaleFile({
        id,
        url,
        slug,
        permalink: `/${location.permalinkPrefix}/${slug}/`,
        detail,
        location,
        manifest,
        hashes: { detail: detailHash(detail), gallery: galleryHash(imageUrls) },
      });
      writeFileSync(path.join(salesDir, `${slug}.njk`), content);
      report.created.push(slug);
      existingIds.add(id);
      existingNames.add(normalizeSaleName(detail.name));
    } catch (err) {
      report.failed.push({ id, url, error: err && err.message ? err.message : String(err) });
    }
  }

  await refreshExistingSales({ salesDir, imagesRoot, tmpDir, imageCap, delayMs, report });
  return report;
}

// How long after a sale's last day it keeps being re-checked. The first
// check after it ends strips the street address from the file (see
// buildAddressBlock) -- client-side hiding alone still leaves it in the
// page source -- and catches any last edits to the listing.
const REFRESH_GRACE_DAYS = 3;

// The create pass above skips any sale already on disk, so without this a
// sale's page froze at whatever the listing said the first hour it was
// seen. For every sourced sale that is upcoming, live, or just ended,
// re-scrape the listing and rewrite the file when it changed: the street
// address once the seller releases it, new/removed photos, edited copy,
// changed dates. slug + permalink never change -- the URL is already live.
//
// report.updated lists every rewritten sale; report.urgent lists the ones
// whose street address was released (or corrected) while the sale is
// still upcoming/live --
// push-gate.mjs ships those immediately, past every throttle.
async function refreshExistingSales({ salesDir, imagesRoot, tmpDir, imageCap, delayMs, report, now = new Date() }) {
  report.updated = [];
  report.urgent = [];
  const cutoff = pacificDateKey(new Date(now.getTime() - REFRESH_GRACE_DAYS * 86_400_000));
  const justCreated = new Set(report.created);

  for (const file of readdirSync(salesDir)) {
    if (!file.endsWith(".njk")) continue;
    const filePath = path.join(salesDir, file);
    const raw = readFileSync(filePath, "utf8");
    let data;
    try {
      ({ data } = matter(raw));
    } catch {
      continue;
    }
    if (!data.source?.url || justCreated.has(data.slug)) continue;
    const lastDate = (data.dates || []).map((d) => d.date).sort().at(-1);
    if (!lastDate || lastDate < cutoff) continue;

    const { id, url } = data.source;
    try {
      await sleep(delayMs);
      const detail = parseSaleDetail(await fetchText(url));
      await sleep(delayMs);
      const imageUrls = await fetchGalleryImageUrls(url, { delayMs });

      const newDetailHash = detailHash(detail);
      // An empty gallery scrape is far more likely a markup change or a
      // hiccup than the seller deleting every photo -- keep what's on disk.
      const newGalleryHash = imageUrls.length ? galleryHash(imageUrls) : data.source.galleryHash;
      const galleryChanged = Boolean(imageUrls.length) && newGalleryHash !== data.source.galleryHash;
      if (newDetailHash === data.source.detailHash && !galleryChanged) continue;

      const manifest = galleryChanged
        ? downloadAndOptimize({ imageUrls, slug: data.slug, imagesRoot, tmpDir, imageCap })
        : data.gallery.map(({ base, width, height }) => ({ base, width, height }));

      const GENERATED_KEYS = new Set(["layout", "permalink", "slug", "saleName", "title", "description", "ogTitle", "ogDescription", "ogImage", "eyebrow", "heroHeadingHtml", "heroLead", "neighborhood", "status", "addressPostalCode", "address", "dates", "source", "heroImage", "about", "gallery"]);
      const extra = Object.fromEntries(Object.entries(data).filter(([k]) => !GENERATED_KEYS.has(k)));

      const content = renderSaleFile({
        id,
        url,
        slug: data.slug,
        permalink: data.permalink,
        detail,
        location: deriveLocation({ name: detail.name, paragraphs: detail.paragraphs, ...detail }),
        manifest,
        hashes: { detail: newDetailHash, gallery: newGalleryHash },
        extra,
      });
      if (content === raw) continue;
      writeFileSync(filePath, content);

      const { data: next } = matter(content);
      const changes = [];
      if (next.address?.line1 !== data.address?.line1) changes.push(next.address?.line1 ? "address released" : "address removed");
      if (JSON.stringify(next.dates) !== JSON.stringify(data.dates)) changes.push("dates");
      if (galleryChanged) changes.push("photos");
      if (JSON.stringify(next.about) !== JSON.stringify(data.about) || next.saleName !== data.saleName) changes.push("copy");
      if (next.neighborhood !== data.neighborhood) changes.push("location");
      report.updated.push({ slug: data.slug, changes });
      const urgent = isUpcomingOrLive(next.dates, now) && changes.includes("address released");
      if (urgent) report.urgent.push({ slug: data.slug, changes });
    } catch (err) {
      report.failed.push({ id: String(id), url, error: `refresh: ${err && err.message ? err.message : String(err)}` });
    }
  }
}
