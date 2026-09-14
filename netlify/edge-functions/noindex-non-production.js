// Keeps every non-production hostname out of search results.
//
// The same Netlify site serves staging (gary.lukerenner.co,
// gary-germer-2-0.netlify.app, deploy previews) today and www.garygermer.com
// after launch, so this can't be decided at build time without risking a
// production deploy that ships noindex. Deciding per request by Host means
// production is indexable the moment the domain points here — no rebuild,
// no env var to remember — and everything else stays noindex.
//
// robots.txt is deliberately left crawlable on staging: a Disallow would stop
// Google from ever seeing the noindex header on pages it already knows about.
const PRODUCTION_HOSTS = new Set(["www.garygermer.com", "garygermer.com"]);

export default async (request, context) => {
  if (PRODUCTION_HOSTS.has(new URL(request.url).hostname)) return;
  const response = await context.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
};

export const config = {
  path: "/*",
  excludedPath: ["/assets/*", "/api/*"],
};
