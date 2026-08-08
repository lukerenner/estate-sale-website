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

Both the hero form and the final "Begin with a conversation" form POST to
[FormSubmit](https://formsubmit.co/) at `info@garygermer.com` — same pattern
used by the `lukerenner.co` sibling repo (honeypot field, `_captcha` disabled,
redirect to `thanks.html`). The consultation form also accepts an optional
photo upload (`enctype="multipart/form-data"`), which FormSubmit supports
directly. The "Get Estate Sale Alerts" signup uses the same FormSubmit address
with its own `_subject`, since no separate mailing-list service was specified.

**One-time activation required:** the first submission after deployment
triggers a confirmation email from FormSubmit to `info@garygermer.com` —
someone at Gary Germer & Associates needs to click the confirmation link in
that email once. Every submission before that click is silently dropped, so
send a test submission and confirm the email arrives before pointing any real
traffic at this site.

## Deployment

This repo assumes **Netlify** as the host, specifically so the `_redirects`
file can do real host-level 301s without generating a stub HTML page per old
URL (the brief explicitly rules out stub pages). Point a new Netlify site at
this folder with no build command and a publish directory of `.`.

If this ever needs to move to **GitHub Pages** instead (matching how the
outgoing `1.0` site and `ElevatorBeat`/`lukerenner.co`'s public targets are
hosted): GitHub Pages has no server-side redirect mechanism, so the
`_redirects` file won't do anything there. The only GitHub-Pages-compatible
way to preserve the old URLs is a small stub HTML page per old path (canonical
tag + instant client-side redirect) — which the brief explicitly says not to
build. In that scenario, the honest fallback is a single catch-all `404.html`
that sends visitors to `/`, accepting that individual old URLs won't get a
true 301. That tradeoff should be a deliberate call by whoever deploys this,
not something decided silently in code — flagged here and in
`CONTENT_REVIEW.md`.

## SEO

- `<title>` and meta description carried over the intent of the current
  site's indexed homepage title/description, tightened to the new
  positioning.
- Open Graph + Twitter Card metadata point at the hero image.
- `ProfessionalService` JSON-LD includes name, phone, address, hours, and
  service area — hours are flagged as needing final confirmation, see
  `CONTENT_REVIEW.md`.
- `sitemap.xml` lists only this homepage; expand it as future routes ship.
