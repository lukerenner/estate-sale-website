// Scrape-only parser for the 1.0 Ucraft blog post HTML -> plain fields +
// normalized Markdown body. One-time-import-specific (mirrors
// parse-legacy-sale.mjs's role) — no knowledge of this lives in the
// reusable pipeline. Deliberately normalizes away Ucraft's inline styling
// rather than preserving it, since inconsistent inline styles across years
// is exactly what the blog migration is fixing (see PLAN).

const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&mdash;": "—",
  "&ndash;": "–",
  "&#39;": "'",
  "&quot;": '"',
};

function decodeEntities(str) {
  let out = str;
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).replaceAll ? out.replaceAll(k, v) : out.split(k).join(v);
  return out;
}

/**
 * @param {string} html - raw HTML of a legacy /media/blog/... page
 * @param {string} urlPath - e.g. "/media/blog/appraisals/how-to-tell-if-a-painting-is-valuable"
 */
export function parseLegacyBlogPage(html, urlPath) {
  const jsonLdMatch = /<script type="application\/ld\+json">\s*(\{"@context":"https:\\\/\\\/schema\.org","@type":"Article".*?\})\s*<\/script>/s.exec(html);
  let headline = null, description = null, datePublished = null, ogImage = null, author = null;
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      headline = data.headline || null;
      description = data.description || null;
      datePublished = data.datePublished || null;
      ogImage = Array.isArray(data.image) ? data.image[0] : data.image || null;
      author = data.author && data.author.name || null;
    } catch {
      // fall through with nulls; caller flags in report
    }
  }

  const segments = urlPath.split("/").filter(Boolean);
  // /media/blog/<category>/<slug> or /media/blog/<slug> (no category segment)
  const category = segments.length >= 4 ? segments[2] : null;

  const startIdx = html.indexOf("article-item-fulltext");
  const endIdx = startIdx >= 0 ? html.indexOf("article-item-info", startIdx) : -1;
  let rawBody = startIdx >= 0 && endIdx > startIdx ? html.slice(html.indexOf(">", startIdx) + 1, endIdx) : "";
  // endIdx lands on the literal string "article-item-info", which is itself
  // the class-attribute value of the *next* div — the slice above always
  // ends mid-tag with a dangling `<div class="` fragment; drop it.
  rawBody = rawBody.replace(/<[^>]*$/, "");
  // One legacy post (a YouTube-embed video post) has its real body text
  // double-HTML-encoded and stuffed inside the <iframe> as literal text — a
  // source-CMS artifact, not real content. Un-escaping once here recovers
  // the real <p>/<br> markup so the normal tag-to-Markdown pass below
  // handles it the same as every other post; a no-op for posts that don't
  // have this artifact.
  rawBody = rawBody.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  const images = [];
  let bodyWithTokens = rawBody.replace(/<img\b[^>]*>/gi, (imgTag) => {
    const src = /src="([^"]+)"/.exec(imgTag)?.[1];
    const alt = /alt="([^"]*)"/.exec(imgTag)?.[1] || "";
    if (!src) return "";
    const index = images.length;
    images.push({ src, alt: decodeEntities(alt) });
    return `[[IMG:${index}]]`;
  });

  // An <a> that only wraps an image token (zoom-link pattern) collapses to
  // just the token; a real inline text link becomes a Markdown link.
  bodyWithTokens = bodyWithTokens.replace(/<a[^>]*href="([^"]+)"[^>]*>(\s*\[\[IMG:\d+\]\]\s*)<\/a>/gi, "$2");
  bodyWithTokens = bodyWithTokens.replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, (m, href, text) => {
    const clean = text.replace(/<[^>]+>/g, "").trim();
    return clean ? `[${clean}](${href})` : "";
  });

  bodyWithTokens = bodyWithTokens
    .replace(/<h[2-6][^>]*>(.*?)<\/h[2-6]>/gis, (m, inner) => `\n\n## ${inner.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<em[^>]*>(.*?)<\/em>/gis, "_$1_")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gis, "**$1**")
    .replace(/<[^>]+>/g, "");

  bodyWithTokens = decodeEntities(bodyWithTokens);

  const paragraphs = bodyWithTokens
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== " ");

  return {
    title: headline,
    description,
    datePublished,
    category,
    author,
    ogImageUrl: ogImage,
    images,
    bodyParagraphs: paragraphs,
  };
}

export function markdownBody(paragraphs) {
  return paragraphs.join("\n\n") + "\n";
}
