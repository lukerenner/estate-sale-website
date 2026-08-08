## Blog import (2026-08-08)

The 14 legacy `/media/blog/...` posts (confirmed via the 1.0 sitemap) were
migrated to `blog/posts/*.md`, rendered through the new shared
`layouts/blog-post.njk` — one layout/typography pass instead of each post's
own hand-styled Ucraft markup. Every legacy URL gets an explicit page-to-page
301 in `_redirects`, ordered above the `/media/blog/*` catch-all so it always
wins. `/blog` also now points at the real `/blog/` index instead of `/`, and
the `/media/blog/*` wildcard was narrowed from a redirect-to-home fallback to
a redirect-to-blog-index fallback.

| Old URL | New URL | Why |
| --- | --- | --- |
| `/media/blog/estate-sales/earlier-works-are-better` | `/blog/earlier-works-are-better/` | Slug unchanged, category-scoped path flattened under `/blog/`. |
| `/media/blog/a-love-for-loving-art` | `/blog/love-for-loving-art/` | `suggestSlug` drops a leading "a"/"the"/"an" article per its existing convention. |
| `/media/blog/show-and-tell/time-in-space-the-stars-theyve-seen` | `/blog/time-in-space-the-stars-they-ve-seen/` | Slugify inserts a hyphen for "they've" (apostrophe stripped to a word boundary). |
| `/media/blog/show-and-tell/faces-of-folklore` | `/blog/faces-of-folklore/` | Unchanged slug. |
| `/media/blog/estate-sales/free-hornung-mller-piano` | `/blog/free-hornung-and-m-ller-piano/` | Title-based slug from the real headline ("Free Hornung & Müller Piano"); old slug had dropped the umlaut entirely (`mller`). |
| `/media/blog/appraisals/painting-appraisal-apple-blossem` | `/blog/video-appraising-apple-blossem-by-louis-betts/` | Old slug didn't match the page's own title; new slug is title-based. |
| `/media/blog/appraisals/what-to-do-before-an-antique-furniture-appraisal-why-get-one` | `/blog/what-to-do-before-an-antique-furniture-appraisal-and-why-get-one/` | Title-based slug ("&" spelled out as "and" per `suggestSlug`'s `slugify`). |
| `/media/blog/appraisals/how-to-tell-if-a-painting-is-valuable` | `/blog/how-to-tell-if-a-painting-is-valuable/` | Unchanged slug. |
| `/media/blog/appraisals/how-to-get-antiques-appraised-in-oregon` | `/blog/how-to-get-antiques-appraised-in-oregon-by-gary-germer-and-associates/` | Title-based slug from the full headline. |
| `/media/blog/estate-sales/how-to-have-an-estate-sale-in-portland-oregon-6-tips-for-success` | `/blog/how-to-have-an-estate-sale-in-portland-oregon-6-tips-for-success/` | Unchanged slug. |
| `/media/blog/show-and-tell/we-found-a-pony-in-the-manure` | `/blog/we-found-a-pony-in-the-manure/` | Unchanged slug. |
| `/media/blog/estate-sales/ancient-aliens-at-our-next-estate-sale` | `/blog/ancient-aliens-at-our-next-estate-sale/` | Unchanged slug. |
| `/media/blog/show-and-tell/rare-and-stunning-tiffany-co-184-piece-sterling-silver-flatware` | `/blog/rare-and-stunning-tiffany-and-co-184-piece-sterling-silver-flatware/` | Title-based slug ("&" spelled out as "and"). |
| `/media/blog/show-and-tell/makonde-tree-of-life-sculptures` | `/blog/makonde-tree-of-life-sculptures/` | Unchanged slug. |

Two imported posts (`earlier-works-are-better`, `love-for-loving-art`) had no
body text in the source at all — just a single photo — so their JSON-LD
`description` was reused as the post's one body paragraph rather than
shipping a bare hero with no copy. Flagged here rather than silently treated
as equivalent to the other 12 fully-bodied imports; see
`tools/legacy-blog-import-report.json` for the full machine-readable report
(warnings + per-post image counts) from the run that produced these files.

All 14 `publishDate` values come from each post's own JSON-LD
`datePublished` (real historical dates recovered from the source, not
estimated placeholders) — see the same report for the exact source-to-file
mapping.

# Redirect map — legacy estate sale slug renames

Audit trail for every estate-sale URL that changed during the 1.0 → 2.0
archive import. Every row here has a matching 301 rule in `_redirects`
(checked as part of the import's verification pass). Check this file before
ever reusing or retiring a slug in `estate-sales/`.

## Slugs renamed for SEO (2026-08-07)

The 1.0 site named many sales after their listing date rather than their
contents (`march-18th-2019`) or left Ucraft-generated artifacts in the URL
(`copy-of-margie-boule-gwyneth-gamble-booth-sale`). Per direction from Luke:
rename these to describe what was actually in the sale — a page titled after
its standout contents ("Chinese Porcelain Estate Sale") is worth more in
search than one named after an admin's original filing date — and document
every rename here with a real 301, never a silent URL change.

Renamed only where the source page's own content gave a confident, specific
name. Where a bare-date slug (`july-11th-13th-2019`) had no title, no
description, and no address to draw from — just an unlabeled photo gallery —
the date slug was kept rather than invented from photos alone.

| Old slug | New slug | Why |
| --- | --- | --- |
| `august-1st-4th-2019` | `gwyneth-gamble-booth-downsizing-sale-2019` | The page's own title module reads "Downsizing Sale of Ms. Gwyneth Gamble Booth" — a real, specific name existed and wasn't used as the slug. Year suffix added because this estate had two other sales (`the-holiday-sale-of-ms-gwyneth-gamble-booth`, `margie-boule-gwyneth-gamble-booth-sale`) that would otherwise collide on name. |
| `copy-of-margie-boule-gwyneth-gamble-booth-sale` | `historic-military-weapons-estate-sale` | Slug is a Ucraft "duplicate page" artifact and describes a *different* sale entirely — actual content is a military memorabilia collection (edged weapons, firearms, field equipment, Civil War–WWII). Old slug was actively misleading. |
| `march-12th-15th-2020` | `pop-up-shop-estate-sale-2020` | Page's own title is "POP UP SHOP ESTATE SALE" — an off-site pop-up near the Broadway showroom, not tied to one estate/neighborhood, so the format name is the most honest, specific slug available. |
| `march-18th-2019` | `nw-skyline-antiques-estate-sale` | Description names a specific neighborhood (NW Skyline) and a specific standout category (Chinese antiques, snuff bottle collection) — real signal to build a slug from. |
| `may-2nd-4th-2019` | `bishopcroft-house-estate-sale` | Description names the property itself: "The Bishopcroft House," a named historic West Hills estate — more distinctive and memorable than a bare date. |
| `military-weapons-2` | `military-collectibles-showroom-sale` | The trailing `-2` was a Ucraft disambiguator against `copy-of-margie-boule-...` (also military-weapons content). With that page renamed above, this slug no longer needs the collision-avoidance suffix and gets a real descriptive name instead. |
| `october-18th-2019` | `parrot-collector-estate-sale` | Description is unusually specific about a single collector's theme (parrot figurines, parrot-themed decor, "she was obsessed with them") — a strong, differentiated slug candidate that a bare date can't compete with in search. |

## Non-sale slugs (redirected, no page built)

These existed as URLs on 1.0 but are not estate sale listings and don't get
a `estate-sales/*.njk` page. See the plan's Scope section for the full
reasoning.

| Old slug | Redirects to | Why |
| --- | --- | --- |
| `new-sale` | `/west-hills-estate-sales/birkendene/` | Abandoned Ucraft draft duplicating birkendene's content, zero real gallery images. Destination updated 2026-08-07 for the neighborhood URL restructure below. |
| `janet-edwards` | `/estatesales` | Real sale (Janet Edwards Designs) but the 1.0 gallery module has zero images — nothing to build a page around. |
| `july-11th-13th-2019` | `/estatesales` | Removed per direction from Luke (2026-08-07): every 2.0 estate-sale URL must be location-based, and this page had no title, description, or address to build a real location slug from — just an unlabeled 30-photo gallery. Rather than invent a location, the page was dropped entirely. |
| `event-room`, `event-room/william-reynolds-art` | (existing `/portland-estate-sales/*` wildcard → `/#upcoming-sales`) | Showroom gallery pages, not sales. |

## Slugs deliberately kept as-is

Flagged as rename candidates during planning but kept because the existing
slug was already descriptive enough that renaming would just cost an
established URL for no real gain — per the "don't rename what isn't broken"
rule:

- All neighborhood-named slugs (`grant-park`, `bertha-heights`,
  `bixwood-manor`, `corinne-gentner`, etc.) — already specific and accurate.

(`westmorland-manner-in-sellwood-portland-sale` was previously listed here
but got shortened in the neighborhood restructure below, since the
neighborhood name is now carried by the URL prefix instead.)

## Neighborhood URL restructure (2026-08-07)

Per direction from Luke: every estate-sale URL moved from the flat
`/portland-estate-sales/<slug>/` path to a neighborhood-scoped path,
`/<neighborhood-group>-estate-sales/<slug>/`, so the URL itself carries an
SEO-relevant location signal. The neighborhood group for each sale is the
same 7-group mapping (`NEIGHBORHOOD_GROUPS` in `eleventy.config.js`) already
used for the previous-sales filter bar — West Hills, Northwest Portland,
Southwest Portland, Northeast Portland, Southeast Portland, Lake Oswego &
Dunthorpe, Camas.

Only each page's `permalink:` changed. The `slug:` front-matter field (and
the on-disk `assets/images/estate-sales/<slug>/` directory it points to) was
left untouched on every page — renaming those would mean physically moving
image directories for zero SEO benefit, since Google indexes the permalink,
not the internal slug. Where the shortened URL segment differs from the old
slug, that's a `permalink:` value only; the file's own `slug:` field and its
image folder still use the original name.

Every one of the 36 pages under `estate-sales/*.njk` got a real page-to-page
301 in `_redirects` from its old `/portland-estate-sales/<old-slug>/` URL to
its new neighborhood URL — see the "Neighborhood URL restructure" block
there for the full list. The three `august-1st-4th-2019`-style 1.0 legacy
redirects (added during the original archive import, above) were also
repointed straight to the final neighborhood URL to avoid a two-hop redirect
chain.

New slugs were shortened where the neighborhood-group prefix already covers
that ground (e.g. `bishopcroft-house-estate-sale` → `bishopcroft-house` under
`/west-hills-estate-sales/`), and disambiguated where a neighborhood group
now holds multiple sales for the same estate — three separate Gwyneth Gamble
Booth sales all fall under `/west-hills-estate-sales/`, so they became
`gwyneth-gamble-booth-2019`, `gwyneth-gamble-booth-holiday`, and
`margie-boule-moving-sale` (the last one is named for the sale itself, not
the estate, since "Margie Boulé & Friends Moving Sale" is a distinct title
in its own right). `westmorland-manner-in-sellwood-portland-sale` was also
corrected to the properly spelled `westmoreland-manor` (the old slug had two
misspellings — "westmorland" and "manner" for "manor" — that its own
`saleName`/`neighborhood` fields never had).
