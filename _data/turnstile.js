// Cloudflare Turnstile's site key. Public by nature — it ships in the HTML —
// but read from the environment rather than committed so staging and
// production can use different widgets, and so the site builds fine before
// anyone has set one up.
//
// When this is empty, base.njk emits no Turnstile markup at all and script.js
// stays inert, leaving the server-side heuristics as the only spam gate. Set
// TURNSTILE_SITE_KEY (here and in Netlify) together with TURNSTILE_SECRET_KEY
// on the function side — one without the other does nothing useful.
module.exports = {
  siteKey: process.env.TURNSTILE_SITE_KEY || "",
};
