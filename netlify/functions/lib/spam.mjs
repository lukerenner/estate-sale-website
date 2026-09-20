// Spam defenses for /api/submit-inquiry.
//
// The honeypot in submit-inquiry.mjs only catches bots that render the form
// and fill every field. The flood of foreign-language "General Inquiry" rows
// that prompted this module looks like the other kind: a script POSTing
// straight at the endpoint, which never sees the honeypot at all. So there
// are two independent gates here —
//
//   1. isOffSite()  — was this POST made by a browser sitting on our own
//                     site? Real submissions carry a same-host Origin or
//                     Referer; a curl-style bot usually carries neither.
//   2. looksLikeSpam() — content heuristics, for bots that do bother to
//                     forge headers or drive a real browser.
//
// Both are deliberately tuned to under-block: a dropped real inquiry is a
// lost customer, a spam row that slips through is an annoyance. Callers
// treat a hit the same way they treat the honeypot — report success, write
// nothing — so a bot can't probe for the thresholds.

// Scripts that essentially never appear in a Portland antiques inquiry as
// the *body* of a message. Individual characters are fine (see below): a
// genuine question about a Japanese print may well include kanji alongside
// the English, which is why this is a ratio test and not a presence test.
const NON_LATIN = /[Ͱ-ϿЀ-ԯ֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/g;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/g;
// Above this share of the message's letters, it isn't an English inquiry
// with a foreign name or title in it — it's a foreign-language message.
const NON_LATIN_SHARE_LIMIT = 0.3;

// The ratio test above only catches a different *alphabet*. Spanish, Turkish
// and Polish sales pitches are Latin script and sail straight through it, so
// messages long enough to judge also have to look like English: any real
// English sentence of this length contains several of these. Deliberately no
// single-letter words ("a" and "i" are articles in Romance languages too),
// and a handful of this business's own nouns, so a terse-but-genuine note
// about an appraisal still registers.
const ENGLISH_MARKERS = new Set([
  "the", "and", "is", "are", "was", "were", "be", "been", "am",
  "to", "of", "in", "on", "at", "for", "with", "from", "about", "into",
  "my", "our", "your", "we", "you", "he", "she", "they", "it", "its", "me", "us",
  "have", "has", "had", "do", "does", "did", "can", "could", "would", "should", "will",
  "this", "that", "these", "those", "there", "here", "what", "which", "how", "when",
  "an", "or", "but", "not", "no", "if", "as", "so", "any", "some", "all", "more",
  "like", "need", "want", "looking", "interested", "please", "thank", "thanks", "hello",
  "item", "items", "appraisal", "appraise", "estate", "sale", "sell", "selling",
  "worth", "value", "consign", "consignment", "photos", "pictures", "collection",
  "antique", "antiques", "jewelry", "furniture", "painting", "grandmother", "inherited",
]);
// Below this, a message is too terse to judge — "Antique Chinese vase, Qing
// dynasty, signed base" is perfectly good English with no marker in it.
const MIN_WORDS_TO_JUDGE_LANGUAGE = 12;

const LINK = /https?:\/\/|www\.[a-z0-9-]|\b[a-z0-9-]{2,}\.(?:com|net|org|ru|su|cn|xyz|top|club|online|site|info|biz|shop|link|live|icu)\b/gi;
// Markup in a plain-text field is a comment-spam signature, not a customer.
const MARKUP = /\[\s*url|\[\s*link|<\s*a\s+href|<\s*\/\s*a\s*>|\{\s*link/i;

// Scored, not fatal on their own — an appraisal message could conceivably
// mention "bitcoin" or a "loan". Two hits is the bar.
//
// Matched on word boundaries, never as substrings: this business really does
// get messages about Joseon dynasty ceramics, and a bare "seo" substring
// would drop every one of them.
const SPAM_TERMS = [
  "seo", "backlink", "backlinks", "link building", "guest post", "guest posting",
  "casino", "gambling", "betting", "forex", "crypto", "bitcoin", "binance",
  "viagra", "cialis", "pharmacy", "escort", "escorts", "porn", "webcam", "hookup",
  "payday", "quick loan", "credit repair", "debt relief",
  "rank your", "first page of google", "traffic to your", "increase sales",
  "marketing offer", "promo code", "click here", "unsubscribe here",
];
const SPAM_TERM_RE = new RegExp(
  `\\b(?:${SPAM_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

function ratioNonLatin(text) {
  const nonLatin = (text.match(NON_LATIN) || []).length;
  if (!nonLatin) return 0;
  const latin = (text.match(LATIN_LETTER) || []).length;
  return nonLatin / (nonLatin + latin);
}

function countLinks(text) {
  return (text.match(LINK) || []).length;
}

// True when a message is long enough to judge and contains no English
// function words at all. A long pitch in Spanish or Turkish trips this; a
// short English note can't, by design.
function isNotEnglish(text) {
  const words = text.toLowerCase().match(/[a-zÀ-ɏ']+/g) || [];
  if (words.length < MIN_WORDS_TO_JUDGE_LANGUAGE) return false;
  return !words.some((w) => ENGLISH_MARKERS.has(w));
}

// A browser posting our own form always sends Origin (and nearly always
// Referer). Neither header present is the signature of a direct scripted
// POST. Privacy tooling strips Referer, so either one matching is enough.
// If we can't work out our own host, fail open rather than block everyone.
export function isOffSite(req) {
  const hosts = new Set();
  try { hosts.add(new URL(req.url).host); } catch { /* fall through */ }
  const hostHeader = req.headers.get("host");
  if (hostHeader) hosts.add(hostHeader);
  if (!hosts.size) return false;

  for (const name of ["origin", "referer"]) {
    const raw = req.headers.get(name);
    if (!raw || raw === "null") continue;
    try {
      if (hosts.has(new URL(raw).host)) return false;
    } catch { /* unparseable header — treat as no match */ }
  }
  // Headers point somewhere else, or there are none at all.
  return true;
}

// Returns a short reason string when the submission looks automated, or null
// when it should be processed normally.
export function looksLikeSpam(fd) {
  const message = String(fd.get("message") || "");
  const name = [fd.get("first_name"), fd.get("last_name"), fd.get("name")]
    .filter(Boolean).map(String).join(" ");

  if (MARKUP.test(message) || MARKUP.test(name)) return "markup in text field";
  // Nobody types a URL into the name field except a bot.
  if (countLinks(name) > 0) return "link in name field";
  if (ratioNonLatin(message) > NON_LATIN_SHARE_LIMIT) return "message is not in Latin script";
  if (ratioNonLatin(name) > NON_LATIN_SHARE_LIMIT) return "name is not in Latin script";
  if (isNotEnglish(message)) return "message is not in English";

  const links = countLinks(message);
  // One link is plausible — people paste an auction listing for the item
  // they're asking about. A wall of them is not.
  if (links >= 3) return "too many links";

  // Distinct terms, so one word repeated five times isn't five hits.
  const hits = new Set((`${name} ${message}`.match(SPAM_TERM_RE) || []).map((t) => t.toLowerCase()));
  if (hits.size + (links >= 1 ? 1 : 0) >= 2) return "spam vocabulary";
  return null;
}

// Best-effort burst limiter. Netlify Functions are stateless across
// instances, so this only sees the traffic its own warm instance handled —
// which is exactly the case that matters here (a flood arrives fast enough
// to reuse one instance). It is a speed bump, not a guarantee; the content
// gates above are the real defense.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 6;
const seen = new Map();

export function isRateLimited(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  if (!ip) return false;
  const now = Date.now();
  for (const [key, stamps] of seen) {
    const fresh = stamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length) seen.set(key, fresh); else seen.delete(key);
  }
  const stamps = seen.get(ip) || [];
  stamps.push(now);
  seen.set(ip, stamps);
  return stamps.length > MAX_PER_WINDOW;
}
