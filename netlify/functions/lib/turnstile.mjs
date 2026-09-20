// Cloudflare Turnstile verification.
//
// Turnstile scores the browser silently — a real visitor never sees a puzzle
// or a checkbox (the widget is rendered `interaction-only`, so it only shows
// itself on the rare occasion it wants an interaction). What it buys us over
// the heuristics in spam.mjs is coverage of the *next* kind of bot: one
// driving a real headless browser, which sends a correct Origin header and
// can write plausible English.
//
// Three states, because the site has to keep working in all of them:
//
//   not configured — no TURNSTILE_SECRET_KEY in the environment. Verification
//                    is skipped entirely and spam.mjs's heuristics are the
//                    only gate, exactly as before Turnstile existed. This is
//                    what local dev and any pre-setup deploy get.
//   token present  — verified against Cloudflare. A pass clears the
//                    submission; a fail is treated as spam.
//   token absent   — the visitor has JavaScript off (the forms still submit
//                    natively without it), so there's no widget to produce a
//                    token. NOT an automatic rejection — that would silently
//                    lock out a real person. The caller falls back to the
//                    heuristics instead.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TOKEN_FIELD = "cf-turnstile-response";

export function isConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

// Returns "pass" | "fail" | "skipped". Never throws: if Cloudflare is
// unreachable we fail open to "skipped" and let the heuristics decide, rather
// than dropping real inquiries during someone else's outage.
export async function verify(token, ip) {
  if (!isConfigured() || !token) return "skipped";

  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data.success) return "pass";
    console.warn("Turnstile rejected a token:", (data["error-codes"] || []).join(", "));
    return "fail";
  } catch (err) {
    console.error("Turnstile verification unavailable:", err);
    return "skipped";
  }
}
