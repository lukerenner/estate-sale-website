# Content Review — open items before launch

Flagging these rather than guessing, per the build brief. Please confirm each
before this replaces the live site.

## 1. Business hours (conflicting across three sources)

- **Redesign PDF**: "Tuesday — Saturday, 9am–5pm"
- **Current live site** (`1.0/contact/index.html`): "open - 10:00 am - 5:00 pm,
  Tuesday through Saturday, or by appointment."
- **AI-generated reference mockup** footer: "Mon – Fri, 9am – 5pm" (this one is
  almost certainly just a placeholder invented by the mockup generator, not
  real data — included here only for completeness)

**Used on this build:** Tuesday–Saturday, 10:00am–5:00pm (per your direction,
matching the current live site) — in the footer and in the `ProfessionalService`
JSON-LD. **Please double-check this against current reality before launch** —
none of the three sources fully agree, and the current site itself also
mentions "or by appointment," which isn't reflected in the new footer's short
form.

## 2. "Watch Gary in his element" video

The current homepage embeds three YouTube videos with no titles captured
during review: `XUHD3VWjJno`, `cE2oRYpeb6U`, `WlyTxFFD7Ro`. Per your direction,
this build uses the first (`XUHD3VWjJno`) for both the video panel link and
the "Watch the Videos" CTA (which points at the same video on YouTube, since
there's no dedicated video-library page in this phase). **Please confirm this
is actually a good "Gary in his element" clip** — it was picked by order, not
by content, and it's easy to swap the ID in `index.html` (search for
`XUHD3VWjJno`, two occurrences) once confirmed.

## 3. Testimonial attribution

The redesign PDF's third testimonial ("We go to lots of estate sales and Gary
Germer's sales are always heads above the rest...") has no name anywhere in
the source document. Per your direction, it's attributed on this homepage to
**Brad Thomas, Estate Sale Client**. That name came from you directly in this
conversation, not from the PDF — noting it here so there's a record of where
it came from, in case it needs to be double-checked against however you
verified it.

## 4. Gary's portrait — low resolution

The only confirmed, genuinely client-owned photo of Gary Germer found on the
current site (`assets/images/gary-germer-portrait.webp`, sourced from the
current site's Team page, where it's captioned "Gary Germer, Founding Director
of Appraisals and Estate Sales") is only **283×283px**. It's usable at the
current About-Gary portrait size but won't hold up if that panel grows larger
in a future refinement. A higher-resolution portrait should be sourced or
reshot.

## 5. Stock/estate photography — placeholders for the eventual photoshoot

Per your direction, this build reuses real photography already present on the
current live site rather than generic placeholders — a mix of the current
site's editorial-style stock interiors and genuine estate-sale documentation
photos. All of it will eventually be replaced by dedicated photography shot to
match the reference composition. Current sources, for the record:

| Section | File | Source |
| --- | --- | --- |
| Hero | `hero-antique-parlor.webp` | Stock interior already used elsewhere on the current site (Unsplash photo ID `1507452786732-f2dc0a2e7b7f` embedded in the current site's asset pipeline) |
| Appraisals | `appraisals-silver-service.webp` | Real estate-sale photo (silver tea service on an antique sideboard), from the current site's Bridlemile Midcentury sale gallery |
| Estate Services | `estate-services-wingback-chairs.webp` | Real estate-sale photo (wingback chairs), from the current site's Wilcox Manor sale gallery |
| Consignment | `consignment-curated-bookshelf.webp` | Real estate-sale photo (curated bookshelf of antique books, nesting dolls, and small objects), from the current site's Bridlemile Midcentury sale gallery |
| Discovery — Upcoming Sales | `discovery-glass-cabinet.webp` | Real estate-sale photo (pine hutch with leaded-glass doors), from the current site's Bridlemile Midcentury sale gallery |
| Discovery — Gary's Vault | `discovery-floral-and-painting.webp` | Real estate-sale photo, current site |
| About Gary | `gary-germer-portrait.webp` | Genuine portrait of Gary Germer (see item 4 above) |

**Not found anywhere on the current site**: a genuine close-up of hands
actively examining an object with a loupe — the ideal Appraisals-section shot
per the design brief. The silver-service photo above is used as the closest
real substitute. Add "appraiser examining an object with a loupe, close-up of
hands" to the shot list for the upcoming photoshoot.

Also worth a shot-list note: none of the reused photos are truly full-bleed,
editorial-grade photography shot for this exact layout — they're either
generic stock or candid sale-documentation photos, cropped to fit. Expect to
swap every one of them once the dedicated shoot happens.

## 6. Estate Sale Alerts / newsletter signup — no confirmed backend

No mailing-list service (Mailchimp, etc.) was specified for the "Get Estate
Sale Alerts" signup, so it currently POSTs to the same FormSubmit address as
the other forms, with its own subject line. This works (an email lands in the
inbox for each signup) but doesn't add anyone to an actual mailing list. Swap
in a real ESP integration before relying on it to build a list.

## 7. Legal pages retired, not rebuilt

The current site's Privacy Policy, Terms & Conditions, and Cookie Policy pages
are redirected to the homepage (`_redirects`) rather than rebuilt, since legal
pages are out of scope for this phase per the brief. **These should not stay
retired for long** — a business collecting names/emails/phone numbers/photos
through web forms typically needs a live privacy policy. Flagging so it isn't
forgotten once this phase ships.

## 8. Redirects assume Netlify

The `_redirects` file only works on Netlify (or similarly capable hosts). If
this deploys to GitHub Pages instead, see the "Deployment" section of
`README.md` — true 301s for the ~40 old URLs aren't possible there without
stub pages, which the brief rules out.
