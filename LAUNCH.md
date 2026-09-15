# Launch checklist — garygermer.com 2.0

Pre-launch audit, 2026-09-14. Staging: https://gary.lukerenner.co (Netlify
project `gary-germer-2-0`). Production today is still the Ucraft site.

## Cutover runbook

1. **Merge & deploy** these changes to `main`; confirm the staging deploy
   succeeds. On staging, `curl -sI https://gary.lukerenner.co/ | grep -i x-robots`
   should now print `x-robots-tag: noindex, nofollow` (edge function
   `netlify/edge-functions/noindex-non-production.js`). — **Done.**
2. **Netlify → Domain management** — **Done 2026-09-15.** `www.garygermer.com`
   is the site's primary custom domain, `garygermer.com` is an alias (so is
   `gary.lukerenner.co` — kept alive as the staging URL, don't remove it
   until production is verified). No TLS certificate yet: Netlify can't issue
   one until DNS actually resolves here (confirmed via
   `showSiteTLSCertificate`: `"renewal_error_message": "www.garygermer.com
   doesn't appear to be served by Netlify"`) — that should self-resolve
   automatically within a few minutes to hours of the DNS change below, no
   further action needed unless it's still unissued a day later.
3. **DNS, at the current registrar — do not move nameservers.** Only repoint
   the apex (Netlify load balancer A record) and `www` (CNAME to
   `gary-germer-2-0.netlify.app`). Leave every other record alone —
   especially **`shop.garygermer.com` (the Vault/Shopify)** and the **MX
   records for info@garygermer.com**. Moving nameservers to Netlify DNS would
   silently drop both unless recreated first.
4. **Verify production** (after DNS propagates):
   - `https://www.garygermer.com/` has **no** `x-robots-tag` header.
   - `http://garygermer.com/x`, `https://garygermer.com/x` → 301 to `https://www.garygermer.com/x`.
   - Run every legacy URL in the table below; each should 301 once to a 200.
   - Submit one real test inquiry with 2–3 photos from a phone; confirm the
     Airtable row and the photos.
5. **Search Console**: add/verify the `garygermer.com` Domain property, submit
   `https://www.garygermer.com/sitemap.xml`, and watch Pages → "Not found (404)"
   for two weeks for any legacy URL this map missed.
6. **GA4 (G-DSW0DFDTQN)**: Admin → Events → mark `generate_lead` (and
   optionally `sign_up`, `phone_click`) as **key events**. Confirm events in
   Realtime/DebugView after launch.
7. **Retire Ucraft** only after the above checks pass.

## Needs a decision / client confirmation

- **"4.7 Stars on Google Reviews"** (homepage + contact hero copy). Birdeye,
  which aggregates Google, shows 4.6 from 139 reviews. Confirm the current
  Google figure before launch. (The same unsourced 4.7/100 was also hard-coded
  in JSON-LD; that has been removed.)
- **Business hours** Tue–Sat 10–5 "or by appointment" (from the current
  contact page) are in structured data — confirm still true.
- **No team page.** `/team` and `/about` 301 to the homepage's About Gary
  section — the only people content on the new site. Rebuild a team page
  later if staff bios matter.
- **No press page.** `/media/press` and `/media` 301 to Speaking Engagements
  (same Roadshow/TV-appearance territory). Closest fit, not an equivalent.
- **Hotjar (1287910)** runs on the old site and was not carried over. Add it
  back only if it's still wanted — it would need a Cookie Policy mention.
- **GTM-T6KGFN5** (on the old site) has no published container — Google
  returns 404 for it — so it was dropped. Re-add only if a container is
  published.
- **Sold shop items.** The blog sync now checks every shop post against the
  store and flips `sold:` automatically (19 posts whose products are gone will
  flip on the first run after this is pushed — trigger *Actions → Blog sync →
  Run workflow* to do it immediately rather than waiting up to 6 hours). Sold
  items are hidden from the blog's default view and listed after the
  available ones under the For Sale filter.
- **Video captions (ADA) — done.** All 36 self-hosted AM Northwest segments
  plus the 3 homepage clips now have captions — see
  `assets/captions/README.md` for sourcing (21 from YouTube auto-captions
  time-aligned to our files; 15 with no YouTube match transcribed locally
  with Whisper, since no upload existed to caption from). Auto-generated in
  both cases, not hand-checked line by line; expect occasional mis-hearings.
- **Spam**: forms rely on a honeypot plus server-side validation. If spam
  gets through after launch, add Cloudflare Turnstile (free, needs an account
  — not created here).
- **Delete the audit test rows — Done 2026-09-15.** All 3 Website Inquiries
  test rows and all 4 Contacts rows matching `launch-audit-test@example.com`
  (accumulated across audit runs) have been deleted.
- **"4.7 Stars" review count — confirmed by Luke 2026-09-15.** Still 4.7 on
  the actual Google Business Profile — no change needed to the copy or the
  badge image. (The badge's review count, "123," wasn't separately
  re-confirmed and may have climbed since the badge was made — cosmetic only,
  refresh on request.)

## Legacy URL → new URL map

Inventory: the live sitemap (78 URLs) + `/blog` + a full link crawl (found
nothing further) + probes of likely paths (found the three blog category
archives and Ucraft's `/about`, `/shop`, `/media` aliases). All resolve in
one hop; query strings are carried through. Source of truth: `_redirects`.

| Old URL | New URL | How |
| --- | --- | --- |
| `/about` | `/#about-gary` | 301 |
| `/blog` | `/blog/` | kept — Netlify adds the trailing slash |
| `/consultation` | `/contact/` | 301 |
| `/contact` | `/contact/` | kept — Netlify adds the trailing slash |
| `/contact/mailing-list` | `/join-our-mailing-list/` | 301 |
| `/cookie-policy` | `/cookie-policy/` | kept — Netlify adds the trailing slash |
| `/estatesales` | `/estate-sales/` | 301 |
| `/give-us-a-review` | `https://search.google.com/local/writereview?placeid=ChIJVdCyyFOnlVQRjzPTKo2igI0` | 301 |
| `/give-us-a-review/feedback` | `/contact/` | 301 |
| `/join-our-mailing-list` | `/join-our-mailing-list/` | kept — Netlify adds the trailing slash |
| `/media` | `/our-services/speaking-engagements-and-clinics/` | 301 |
| `/media/blog` | `/blog/` | 301 |
| `/media/blog/a-love-for-loving-art` | `/blog/love-for-loving-art/` | 301 |
| `/media/blog/appraisals` | `/blog/?filter=appraisals` | 301 |
| `/media/blog/appraisals/how-to-get-antiques-appraised-in-oregon` | `/blog/how-to-get-antiques-appraised-in-oregon-by-gary-germer-and-associates/` | 301 |
| `/media/blog/appraisals/how-to-tell-if-a-painting-is-valuable` | `/blog/how-to-tell-if-a-painting-is-valuable/` | 301 |
| `/media/blog/appraisals/painting-appraisal-apple-blossem` | `/blog/video-appraising-apple-blossem-by-louis-betts/` | 301 |
| `/media/blog/appraisals/what-to-do-before-an-antique-furniture-appraisal-why-get-one` | `/blog/what-to-do-before-an-antique-furniture-appraisal-and-why-get-one/` | 301 |
| `/media/blog/estate-sales` | `/blog/?filter=estate-sales` | 301 |
| `/media/blog/estate-sales/ancient-aliens-at-our-next-estate-sale` | `/blog/ancient-aliens-at-our-next-estate-sale/` | 301 |
| `/media/blog/estate-sales/earlier-works-are-better` | `/blog/earlier-works-are-better/` | 301 |
| `/media/blog/estate-sales/free-hornung-mller-piano` | `/blog/free-hornung-and-m-ller-piano/` | 301 |
| `/media/blog/estate-sales/how-to-have-an-estate-sale-in-portland-oregon-6-tips-for-success` | `/blog/how-to-have-an-estate-sale-in-portland-oregon-6-tips-for-success/` | 301 |
| `/media/blog/show-and-tell` | `/blog/?filter=show-tell` | 301 |
| `/media/blog/show-and-tell/faces-of-folklore` | `/blog/faces-of-folklore/` | 301 |
| `/media/blog/show-and-tell/makonde-tree-of-life-sculptures` | `/blog/makonde-tree-of-life-sculptures/` | 301 |
| `/media/blog/show-and-tell/rare-and-stunning-tiffany-co-184-piece-sterling-silver-flatware` | `/blog/rare-and-stunning-tiffany-and-co-184-piece-sterling-silver-flatware/` | 301 |
| `/media/blog/show-and-tell/time-in-space-the-stars-theyve-seen` | `/blog/time-in-space-the-stars-they-ve-seen/` | 301 |
| `/media/blog/show-and-tell/we-found-a-pony-in-the-manure` | `/blog/we-found-a-pony-in-the-manure/` | 301 |
| `/media/press` | `/our-services/speaking-engagements-and-clinics/` | 301 |
| `/media/video` | `/blog/?filter=video` | 301 |
| `/media/video/amnw` | `/blog/?filter=am-northwest` | 301 |
| `/online-stores` | `https://shop.garygermer.com/` | 301 |
| `/our-services/appraisals` | `/our-services/appraisals/` | kept — Netlify adds the trailing slash |
| `/our-services/consignment` | `/our-services/consignment/` | kept — Netlify adds the trailing slash |
| `/our-services/estate-sales` | `/our-services/estate-sales/` | kept — Netlify adds the trailing slash |
| `/our-services/speaking-engagements-and-clinics` | `/our-services/speaking-engagements-and-clinics/` | kept — Netlify adds the trailing slash |
| `/portland-estate-sales/arthur-hill` | `/west-hills-estate-sales/arthur-hill/` | 301 |
| `/portland-estate-sales/asian-art` | `/northeast-portland-estate-sales/asian-art/` | 301 |
| `/portland-estate-sales/august-1st-4th-2019` | `/west-hills-estate-sales/gwyneth-gamble-booth-2019/` | 301 |
| `/portland-estate-sales/bertha-heights` | `/west-hills-estate-sales/bertha-heights/` | 301 |
| `/portland-estate-sales/birkendene` | `/west-hills-estate-sales/birkendene/` | 301 |
| `/portland-estate-sales/bixwood-manor` | `/northwest-portland-estate-sales/bixwood-manor/` | 301 |
| `/portland-estate-sales/bridlemile-midcentury` | `/southwest-portland-estate-sales/bridlemile-midcentury/` | 301 |
| `/portland-estate-sales/broadway-woods` | `/northeast-portland-estate-sales/broadway-woods/` | 301 |
| `/portland-estate-sales/copy-of-margie-boule-gwyneth-gamble-booth-sale` | `/northeast-portland-estate-sales/historic-military-weapons/` | 301 |
| `/portland-estate-sales/corinne-gentner` | `/southwest-portland-estate-sales/corinne-gentner/` | 301 |
| `/portland-estate-sales/council-crest-downsizing-sale` | `/west-hills-estate-sales/council-crest/` | 301 |
| `/portland-estate-sales/easter-weekend-pop-up` | `/southeast-portland-estate-sales/easter-weekend-pop-up/` | 301 |
| `/portland-estate-sales/event-room` | `/estate-sales/` | 301 |
| `/portland-estate-sales/event-room/william-reynolds-art` | `/estate-sales/` | 301 |
| `/portland-estate-sales/grant-park` | `/northeast-portland-estate-sales/grant-park/` | 301 |
| `/portland-estate-sales/janet-edwards` | `/estate-sales/` | 301 |
| `/portland-estate-sales/july-11th-13th-2019` | `/estate-sales/` | 301 |
| `/portland-estate-sales/kings-cumberland` | `/west-hills-estate-sales/kings-cumberland/` | 301 |
| `/portland-estate-sales/lacamas-lake` | `/camas-estate-sales/lacamas-lake/` | 301 |
| `/portland-estate-sales/lake-oswego-estate-sale` | `/lake-oswego-dunthorpe-estate-sales/lake-oswego/` | 301 |
| `/portland-estate-sales/langworthy-estate-sale` | `/northwest-portland-estate-sales/langworthy/` | 301 |
| `/portland-estate-sales/march-12th-15th-2020` | `/northeast-portland-estate-sales/pop-up-shop-2020/` | 301 |
| `/portland-estate-sales/march-18th-2019` | `/west-hills-estate-sales/nw-skyline-antiques/` | 301 |
| `/portland-estate-sales/margie-boule-gwyneth-gamble-booth-sale` | `/west-hills-estate-sales/margie-boule-moving-sale/` | 301 |
| `/portland-estate-sales/mary-mize` | `/southwest-portland-estate-sales/mary-mize/` | 301 |
| `/portland-estate-sales/may-2nd-4th-2019` | `/west-hills-estate-sales/bishopcroft-house/` | 301 |
| `/portland-estate-sales/midmod-moapa` | `/lake-oswego-dunthorpe-estate-sales/midmod-moapa/` | 301 |
| `/portland-estate-sales/military-weapons-2` | `/northeast-portland-estate-sales/military-collectibles-showroom/` | 301 |
| `/portland-estate-sales/nancy-fisher` | `/west-hills-estate-sales/nancy-fisher/` | 301 |
| `/portland-estate-sales/new-sale` | `/west-hills-estate-sales/birkendene/` | 301 |
| `/portland-estate-sales/oakwood-gardens` | `/southwest-portland-estate-sales/oakwood-gardens/` | 301 |
| `/portland-estate-sales/october-18th-2019` | `/northeast-portland-estate-sales/parrot-collector/` | 301 |
| `/portland-estate-sales/peter-abrahams` | `/northeast-portland-estate-sales/peter-abrahams/` | 301 |
| `/portland-estate-sales/portland-nob-hill-estate-sale` | `/northwest-portland-estate-sales/nob-hill/` | 301 |
| `/portland-estate-sales/riverwood` | `/lake-oswego-dunthorpe-estate-sales/riverwood/` | 301 |
| `/portland-estate-sales/stafford-trail` | `/lake-oswego-dunthorpe-estate-sales/stafford-trail/` | 301 |
| `/portland-estate-sales/the-holiday-sale-of-ms-gwyneth-gamble-booth` | `/west-hills-estate-sales/gwyneth-gamble-booth-holiday/` | 301 |
| `/portland-estate-sales/west-hills-estate-sale-fall-of-2020` | `/west-hills-estate-sales/west-hills-fall-2020/` | 301 |
| `/portland-estate-sales/westmorland-manner-in-sellwood-portland-sale` | `/southeast-portland-estate-sales/westmoreland-manor/` | 301 |
| `/portland-estate-sales/westridge` | `/camas-estate-sales/westridge/` | 301 |
| `/portland-estate-sales/wilcox-manor` | `/west-hills-estate-sales/wilcox-manor/` | 301 |
| `/privacy-policy` | `/privacy-policy/` | kept — Netlify adds the trailing slash |
| `/shop` | `https://shop.garygermer.com/` | 301 |
| `/start-a-consignment` | `/start-a-consignment/` | kept — Netlify adds the trailing slash |
| `/start-an-appraisal` | `/start-an-appraisal/` | kept — Netlify adds the trailing slash |
| `/team` | `/#about-gary` | 301 |
| `/terms-and-conditions` | `/terms-and-conditions/` | kept — Netlify adds the trailing slash |
