# Route map — future navigation, not built in this phase

This phase ships **only the homepage** (`index.html`), plus one reusable
interior template: the estate sale detail page. As of the Eleventy migration
(2026-08-06), estate sale pages are no longer hand-duplicated HTML — see
`estate-sales/birkendene.njk` for the first templated instance and
`_includes/layouts/estate-sale.njk` for the shared layout it renders through.
To add a new sale, add a new `estate-sales/<slug>.njk` front-matter file
(copy `birkendene.njk` as a starting point) instead of duplicating a folder.
The old hand-authored version of the birkendene page is kept for reference at
`_archive/birkendene-hand-authored/` (excluded from the Eleventy build via
`.eleventyignore`) — safe to delete once you're comfortable the templated
version fully replaces it. The header and footer nav otherwise reference the
eventual full site's structure without those pages existing. Two link styles
are used, deliberately:

## Address privacy in the sale data (read before bulk-importing old sales)

`estate-sale.js` only *displays* the street address while a sale is live
(`Open Today` / `Final Day`) — but a front-matter `address.line1`/`line2` or
`mapQuery` value is baked into the page's HTML source (inside
`window.SALE_DATA` and the "Get Directions" link) on every build, regardless
of status. Client-side hiding doesn't stop "View Source" or a scraper from
reading it. This was already true of the original hand-authored pages; the
Eleventy layout doesn't introduce it, but does make it easy to avoid going
forward:

- **Importing the ~200 historical sales**: since they're all already over,
  don't put a real street address in their data files at all — hardcode
  `status: "Sale Ended"` and leave `address.line1`/`line2`/`mapQuery` unset
  (the layout falls back to the `neighborhood` field for display, and drops
  `streetAddress`/`postalCode` from the JSON-LD block when absent). There's
  no leak if the secret was never in the file. `neighborhood` itself is NOT
  sensitive and should still be populated on every page — generate it from
  each sale's zip code (a zip→Portland-neighborhood lookup) at import time,
  since the old site's export likely only has street-level addresses. Zip
  codes don't map 1:1 to neighborhoods here, so flag ambiguous/boundary zips
  for manual review rather than guessing silently.
- **New/upcoming sales** (e.g. birkendene): still use `status: "auto"` with a
  real address and `address.released: "auto"`, same as today. The address
  genuinely does ship in every page load before/after the sale, though — the
  real fix is a scheduled Netlify rebuild (or similar) at each sale's
  start/end time so the real address is only ever baked into that page's HTML
  during the live window. Not built yet; flagged here as follow-up work,
  agreed on 2026-08-06.

## In-page anchors (content exists today, on the homepage)

These nav items point at a section that genuinely exists on this homepage
right now, so the link works today even though the *dedicated* page doesn't
exist yet:

| Nav label | Links to | Homepage section |
| --- | --- | --- |
| Appraisals | `#appraisals` | Appraisals split section |
| Estate Services | `#estate-services` | Estate Services split section |
| Consignment | `#consignment` | Consignment split section |
| About Gary | `#about-gary` | About Gary section |
| Upcoming Sales | `#upcoming-sales` | Discovery card |
| Online Shop | `#shop` | Discovery card (renamed from "Gary's Vault" — 2026-08-09, per direction from Luke: that branding isn't used much anymore, and every reference to the old "Online Store" wording was unified to "Online Shop") |
| Contact Us (footer) | `#consultation` | Final consultation form |
| Get Sale Alerts (footer) | `#estate-alerts` | Estate Sale Alerts signup |
| Request a Consultation (header CTA) | `#consultation` | Final consultation form |

**When the dedicated page for any of these ships**, swap that one `href` from
the `#anchor` to the real path (e.g. `#appraisals` → `/appraisals`) — the
homepage section can stay as a summary/teaser that links out to the fuller
page, same as the reference composition implies for a mature version of this
site.

## Future-route placeholders (no matching content on the homepage)

These have no equivalent content anywhere on the homepage, so they point at
the real intended future path instead of an anchor. They are not scaffolded —
visiting them today does nothing (no page exists) — but the path itself is
the real one the future page should use:

| Nav label | Path | Why no homepage anchor |
| --- | --- | --- |
| The Team (footer) | `/team` | Homepage only covers Gary himself, not the full team roster/bios |
| Meet Gary and the Team (About Gary CTA) | `/team` | Same |
| Watch the Videos (About Gary CTA) | Actual YouTube channel/video (external, already live) | Preserves the current live destination rather than inventing a future in-site video library page |
| View Current Sales (Discovery card) | `/upcoming-sales` | Dedicated sale-listing page not part of this phase |

## Second batch of standalone pages (2026-08-10)

Per direction from Luke: of the routes below "Future-route placeholders" and
the legal pages, these four now ship as real pages (same `sale-hero` /
`split` / `faq-section` template pieces as the existing service pages — no
new markup patterns introduced). Explicitly deferred for a later phase:
Press, Video, Online Stores, and Give Us a Review.

| Route | What it is | Notes |
| --- | --- | --- |
| `/start-a-consignment/` | Full consignment intake form | Modeled directly on `/start-an-appraisal/` — first/last name, email, phone, item description, optional photos. `/our-services/consignment/`'s own hero form is untouched (still a working direct-submit quick form); this is an additional, more thorough intake, same relationship appraisals has between its service page and its dedicated intake page. |
| `/join-our-mailing-list/` | Standalone signup page | Deliberately lean — a single hero with the two-field signup form (name + email) plus the two discovery cards, no second copy of the signup form further down the page. |
| `/contact/` | Merged contact + consultation page | 1.0 had `/contact` and `/consultation` as two separate pages; this build already treats them as one "It Starts with a Conversation" concept on the homepage, so they merge into one page here too. `/consultation` now 301s here instead of to the homepage anchor. |
| `/our-services/speaking-engagements-and-clinics/` | Speaking Engagements & Clinics service page | Real copy pulled from the 1.0 page (appraisal-clinic pricing, FAQ, workshop topics) — not rewritten. Resolves a pre-existing dangling in-text mention on `/our-services/appraisals/`'s FAQ ("please visit our Speaking Engagements page"), now a real link. |

Header nav gained "Speaking Engagements" and "Contact" entries for these.
The homepage's own CTA buttons/nav-cta still point at `/#consultation` (an
in-page anchor) rather than `/contact/` — changing that would break the
homepage's own smooth-scroll behavior for a link that already works there.

Also fixed in passing: the "Gary&rsquo;s Vault" shop-card label was renamed
to "Online Shop" everywhere on 2026-08-09 (see the in-page anchors table
above) but the rename had only been applied to some pages. `index.njk`,
`our-services/estate-sales.njk`, and the shared
`partials/discovery-band.njk` all still said "Gary's Vault" — now consistent
sitewide.

## Retired current-site routes

Everything the outgoing site (`1.0/sitemap.xml`) had indexed — blog, press,
individual estate-sale galleries, legal pages, old contact/consultation forms,
old service pages — is 301-redirected to the closest homepage anchor via
`_redirects`. See `CONTENT_REVIEW.md` item 8 for the GitHub Pages caveat, and
item 7 for a flag on the retired legal pages specifically.
