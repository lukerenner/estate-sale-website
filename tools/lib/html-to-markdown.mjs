// Minimal, targeted HTML->Markdown stripper for Shopify product body_html —
// deliberately not a full HTML parser (the source is simple product-page
// markup: p/br/strong/em/ul/li/a, nothing nested or exotic). Deterministic,
// no external dependency.

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&#39;": "'", "&quot;": '"' };

export function htmlToMarkdown(html) {
  let out = String(html || "");
  out = out
    .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, (m, href, text) => {
      const clean = text.replace(/<[^>]+>/g, "").trim();
      return clean ? `[${clean}](${href})` : "";
    })
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (m, inner) => `- ${inner.replace(/<[^>]+>/g, "").trim()}\n`)
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<(ul|ol)[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gis, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gis, "_$1_")
    .replace(/<[^>]+>/g, "");
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v);
  return out
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}
