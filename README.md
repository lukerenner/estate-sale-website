# Gary Germer & Associates — Homepage (2.0)

Phase one of the garygermer.com redesign: a single, production-ready homepage.
No other pages, templates, or CMS are part of this phase — see `ROUTE_MAP.md`
for what the header/footer nav point at and why those pages don't exist yet.

## Stack

Plain, dependency-free HTML/CSS/JS — no framework, no build tool, no database.
This matches the actual convention of the two sibling repos inspected before
building this (`ElevatorBeat`, `lukerenner.co 2.0`), both of which are plain
`index.html` / `styles.css` / `script.js` sites with no `package.json`. The
Eleventy/Nunjucks structure suggested as a fallback in the brief was not used,
since real sibling repos were available and don't use it.

- `index.html` — the homepage, semantic HTML, all copy in place (no CMS)
- `styles.css` — one file: design tokens (`:root`) → base/reset → layout
  primitives (split-section, full-bleed, card grid) → component styles
- `script.js` — mobile nav (focus trap, Escape, scroll lock), sticky header,
  inline form validation messaging, footer year
- `assets/images/` — real photography sourced from the current live site (see
  `CONTENT_REVIEW.md` for exactly which images and why), each with a WebP +
  JPEG fallback and, for the large section photos, a smaller 900px-wide variant
  for responsive `srcset`
- `thanks.html` — FormSubmit success page (`noindex`)
- `robots.txt`, `sitemap.xml` — this phase only lists the homepage
- `_redirects` — Netlify-syntax 301s from every URL the outgoing site has
  indexed (per its `sitemap.xml`) to the closest matching homepage anchor

## Run it locally

No build, no server. Double-click `index.html`, or open it directly in a
browser via `file://`. Everything (fonts aside, which load from Google Fonts)
works fully offline.

To preview closer to production (relative paths, etc.), you can also serve it:

```bash
python3 -m http.server 8000
```

## Contact forms

Every form posts to `/api/submit-inquiry`
(`netlify/functions/submit-inquiry.mjs`), which writes to the Airtable base
in `.env` (`AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME` — set
the same three in Netlify's environment variables). Inquiries create a
Website Inquiries row linked to a de-duplicated Contacts row; newsletter
signups only flag the Contact. Photos are compressed in the browser to fit
Netlify's ~4.5MB request limit and uploaded to the same record; if any photo
fails, the visitor is told and the record is flagged — never a silent
success. Spam protection is a honeypot plus server-side validation.

## Deployment

Netlify, building from `main` (`npm run build`, publish `_site`, functions in
`netlify/functions`, edge functions in `netlify/edge-functions`). `_redirects`
does the 1.0 → 2.0 301s. Non-production hostnames (staging, deploy previews)
are sent `X-Robots-Tag: noindex` at runtime by an edge function, so
production is indexable as soon as the domain points at Netlify. See
`LAUNCH.md` for the cutover runbook and the full legacy redirect map.

## SEO

- Every page sets its own `title`/`description`; canonicals and Open Graph
  URLs are always `https://www.garygermer.com` + the page's trailing-slash URL.
- LocalBusiness JSON-LD comes from `_data/business.json` via
  `partials/business-schema.njk` (homepage, /contact/); the four service pages
  add a `Service` block via `partials/service-schema.njk`.
- `sitemap.xml` is generated from every built page; set `noindex: true` in a
  page's front matter to leave it out.
