# Push/deploy policy

Netlify (`netlify.toml`) auto-deploys on every push to `main`, and on the
Personal plan (effective 2026-09-15) each production deploy costs 15 credits
against a 1,000-credit monthly allowance -- roughly 66 deploys/month before
running into overage. `.github/workflows/blog-sync.yml` runs hourly and can
generate a commit worth pushing (new estate sale, new shop listing, a sold-
status flip, a new video, a new AM Northwest segment, ...) far more often
than that, so pushing is deliberately decoupled from committing.

`tools/push-gate.mjs` is what actually runs `git push`, on every hourly
workflow run, deciding per this policy (set 2026-09-15, at the owner's
request, after Netlify's per-deploy credit cost came up):

1. **A brand-new estate sale posts to estatesales.org -> push immediately.**
   This is the one thing worth spending a deploy on right away, since it's
   also what can trigger the site's hello-bar/upcoming-sale announcement.
2. **Everything else batches and pushes once a day, at 9am Pacific.**
3. **Never more than one push per Pacific calendar day.** If a new-sale push
   already went out earlier today, today's 9am batch (or a second same-day
   sale) waits for tomorrow -- it does not stack a second push.
4. **Manual edits made through Claude are just regular commits.** When asked
   to "push it live," the change gets committed, not force-pushed -- it
   rides the same gate as everything else and goes out at the next allowed
   slot (immediate, if a sale happens to trigger one first, or the next 9am
   batch otherwise). If the owner ever wants something out *right now*,
   that's a deliberate, explicit override of this file's default -- say so.
5. **Hard cap: never more than 65 pushes in a calendar month.** As the
   month's count climbs, rule 2's interval stretches automatically:
   - 55-59 pushes this month -> batch interval becomes 36h
   - 60-64 pushes this month -> batch interval becomes 48h
   - 65+ pushes this month -> hold everything, no exceptions, until the
     month rolls over

State lives in `tools/push-log.json` (an array of ISO push timestamps,
trimmed to the most recent 400). It's the only thing `push-gate.mjs` trusts
to know "did we already push today" / "how many pushes this month" -- it's
appended to and folded into the commit it's about to push via
`git commit --amend`, so recording a push never itself costs a deploy.

The monthly count uses the **calendar month** in Pacific time, not
Netlify's exact billing-cycle anchor (currently the 15th) -- simpler to
reason about, and still conservative relative to the real 1,000-credit
budget.

## Changing the policy

All five rules and their numbers (9am, 65/month, the 36h/48h throttle
thresholds) live as named constants at the top of `tools/push-gate.mjs` --
change them there. If the actual Netlify plan/credit cost per deploy
changes, update the math in this file's intro paragraph too.
