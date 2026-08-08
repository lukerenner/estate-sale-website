# Ingesting a new estate sale

How to turn a folder of sale info + photos into a live page on this site.
This process was built out during the 2026-08-07 bulk import of 36 legacy
sales from the 1.0 site, and is meant to be reused as-is for every future
sale — new or historical.

Every sale is one file, `estate-sales/<slug>.njk`, holding only YAML front
matter (no body). It renders through the shared layout,
`_includes/layouts/estate-sale.njk`. **Never hand-duplicate a sale's HTML** —
if you find yourself copy-pasting page markup instead of adding a front
matter field, the layout is missing something it should have; fix the layout
instead. That's the entire point of this being templated: change the layout
or `_includes/partials/sale-details.njk` once, and every sale (past and
future) picks it up on the next build.

## The pipeline, in reusable pieces

`tools/lib/suggest-slug.mjs` — **reusable, use this for every future sale.**
Turns a property name / neighborhood / standout category into an
SEO-friendly slug, with a documented priority order and automatic collision
handling. Auto-generating a good slug is part of ingest by default now, not
a manual afterthought — see step 1 below.

`tools/lib/optimize-images.mjs` — **reusable, use this for every future
sale.** Input: a directory of source photos, any size. Output: capped,
three-tier WebP images (480w / 900w / 1400w, q72, no upscaling past the
source's native size) plus a manifest with each photo's real pixel
width/height. No knowledge of where the photos came from — hand it a folder,
get back a gallery.

`tools/lib/parse-legacy-sale.mjs` and `tools/lib/parse-dates.mjs` —
**one-time-import specific, NOT reused for future sales.** These exist only
to scrape structure and dates out of the old Ucraft-exported HTML archive.
A future sale starts from a plain info file, not scraped HTML, so these
modules stay out of the reusable path on purpose — don't be tempted to
generalize them "just in case."

`tools/import-legacy-sales.mjs` is the one-time orchestrator that wired all
three together for the legacy batch import. For a new individual sale, don't
run that script — follow the manual steps below instead, which use
`optimize-images.mjs` directly.

## Adding one new sale

1. **Generate the slug first — this is a standing step, not an
   afterthought.** Everything else (image output paths, the permalink) is
   named from it, so decide it before touching images. Use
   `tools/lib/suggest-slug.mjs`:

   ```js
   import { suggestSlug } from "./tools/lib/suggest-slug.mjs";
   import { readdirSync } from "node:fs";

   const existingSlugs = readdirSync("estate-sales").map((f) => f.replace(/\.njk$/, ""));
   const { slug, basis } = suggestSlug({
     propertyName: "The Bishopcroft House",     // a named estate/property, if one exists
     neighborhood: "West Hills",                // just the neighborhood, e.g. "Raleigh Hills"
     standoutCategory: "midcentury",             // optional: what the sale is actually known for
     dateFallback: "2026-09-11",                // last resort — see below
     existingSlugs,
   });
   ```

   Priority order (highest-value SEO signal first — same logic used for the
   7 real slug renames during the 2026-08-07 legacy import): a named
   property beats neighborhood + standout category, which beats neighborhood
   alone, which beats a bare date. **Only fall through to the date** when
   there's genuinely no content to name the sale from — never invent a
   specific name from photos alone; a date slug is more honest than a guessed
   one. Collisions (a repeat sale at the same estate) get a year suffix
   automatically.

   Treat the result as a strong suggestion, not a mandate — skim it before
   committing. If it reads awkwardly, adjust it by hand; the point of the
   function is to make "name it after what's actually in the sale" the
   default path, not to remove judgment entirely.

2. **Get the photos into three WebP tiers.** From a scratch working copy
   (never run this against the Google Drive-hosted path directly — see the
   project's global CLAUDE.md on why), call:

   ```js
   import { optimizeGallery, optimizeNamedImage } from "./tools/lib/optimize-images.mjs";
   const { manifest } = optimizeGallery(sourcePhotoPaths, "assets/images/estate-sales/<slug>", "<slug>", 30);
   ```

   `sourcePhotoPaths` should already be in the order you want them displayed.
   The 30-photo cap is a page-weight decision, not a technical limit — see
   "Image budget" below before changing it.

3. **Pick a hero image** and run `optimizeNamedImage` on it with
   `{ withJpg: true }` — the JPEG copy is only for OG/social-preview
   scrapers and old-browser `<img src>` fallback, not for real page
   rendering, so keep it capped at 1600w / q78 rather than full resolution.
   Do the same (without `withJpg`) for a video poster if the sale has a
   video.

4. **Write `estate-sales/<slug>.njk`.** Copy `estate-sales/birkendene.njk`
   as a starting template — it has every field the layout reads, with
   comments showing the shape. The full front-matter schema:

   | Field | Notes |
   | --- | --- |
   | `permalink` | `/portland-estate-sales/<slug>/` — must match this exactly for URL consistency across the whole archive |
   | `slug` | Same value as the permalink segment |
   | `saleName`, `title`, `description`, `ogTitle`, `ogDescription`, `ogImage` | Standard SEO/social fields |
   | `eyebrow`, `heroHeadingHtml`, `heroLead` | Hero section copy |
   | `neighborhood` | **Always populate**, even when `address` is withheld — see privacy note below |
   | `status` | `"auto"` for essentially every sale — see "Status logic" below |
   | `address` | **Omit entirely for concluded/historical sales.** Only set for a genuinely upcoming sale — see privacy note |
   | `dates` | Array of `{date, label, opens, opens24, closes, closes24}` — one entry per open day |
   | `heroImage`, `videoPoster` (optional) | `{src, srcset900, srcsetFull, width, height, alt}` |
   | `video` (optional) | `{youtubeId}` — omit the whole key if there's no video, the layout adapts automatically |
   | `about.heading`, `about.paragraphs` | Body copy — `paragraphs` is a list even for a single paragraph |
   | `gallery` | List of `{base, alt, width, height}` — `base` is just the filename stem, the layout derives the rest |

5. **Build and check it in the browser** (`npm run serve`, or the
   `eleventy-dev` launch config) before considering it done — status card
   states, gallery "See More" past 15 photos, lightbox, mobile layout.

## Status logic — upcoming / live / concluded from one template

Set `status: "auto"` and give the sale real `dates[]`. `estate-sale.js`'s
`computeStatus()` derives Upcoming / Open Today / Final Day / Sale Ended from
today's date vs. the range — you should never need to hand-set a status
string. The only reason to override `status` with a literal value is a sale
you want to force into a particular display state regardless of the
calendar (rare; ask before doing this).

## Address privacy — read before entering a real street address

`estate-sale.js` only *displays* the street address while a sale is live —
but a front-matter `address.line1`/`line2`/`mapQuery` is baked into the
page's HTML source (`window.SALE_DATA` and the "Get Directions" link) on
**every** build, regardless of status. Client-side hiding doesn't stop
"View Source" or a scraper from reading it.

- **A new upcoming sale**: fine to set a real `address` with
  `address.released: "auto"`, same as `birkendene.njk` does today. The
  address does ship in the page source before/after the sale window, though
  — a scheduled rebuild at each sale's start/end time is the real fix and is
  flagged as unbuilt follow-up work in `ROUTE_MAP.md`.
- **Any concluded/historical sale**: omit `address.line1`/`line2`/`mapQuery`
  entirely. There's no leak if the address was never in the file. Populate
  `neighborhood` instead — it's not sensitive and the layout falls back to
  it for both display and JSON-LD when `address.line1` is absent.

## Image budget — why these numbers, not a bigger version

"Lightning fast" is a standing requirement, not a per-sale option. The
480w/900w/1400w WebP tiers, q72, and the 30-photo gallery cap are all
deliberate:

- The visible page load only ever fetches the hero + the first 15 gallery
  tiles at their 480w tier (`loading="lazy"` on the rest, `data-gallery-extra
  hidden` past index 15). The 900w/1400w tiers only load on hover-zoom /
  lightbox-open. **Total repo size is not a page-speed metric — initial-view
  weight per page is.** Budget target: hero + 15×480w tiles under ~2.5MB for
  a full 30-photo sale.
- No `.jpg` gallery tier — WebP-only. A `.jpg` full-size tier was the single
  biggest weight driver in the original layout (roughly 90% of a sale's
  image footprint) and is strictly worse than the 1400w WebP tier that
  replaced it: bigger file, same or lower effective resolution.
- Never upscale past a source photo's native pixel width — a tier request
  bigger than the source just returns the source's real size.
- If a sale genuinely needs more than 30 photos to represent it well, raise
  the cap for that one sale rather than globally — don't change the default
  without a reason tied to an actual page-weight budget check.

## Slugs and redirects

New sales get their slug from `tools/lib/suggest-slug.mjs` (step 1 above) —
SEO-friendly naming is a standing part of ingest, not a decision made later
or only during bulk imports. Once a sale is live, its slug is permanent:
never revisit an already-descriptive slug just because a newer or cleverer
name occurs to you later.

If you ever do need to rename an existing slug (the content turns out to be
mislabeled, a real collision appears, etc.), add a real 301 in `_redirects`
**and** a row in `REDIRECT_MAP.md` documenting the old slug, new slug, and
why — see that file for the format and seven real examples from the
2026-08-07 import. Never silently move a slug.

## The archive index and sitemap

`sitemap.xml` is generated at build time from the `estateSales` collection
(`sitemap.xml.njk`) — you don't need to hand-edit it when adding a sale, it
just appears on the next build. The `/estatesales` archive/index page is a
separate, not-yet-built piece of work (tracked outside this file) that will
need to pick up new sales the same way once it exists.
