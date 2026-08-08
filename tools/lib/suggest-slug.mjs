// SEO-friendly slug generation — part of the standard ingest process, not a
// one-off decision. Every sale gets an auto-generated candidate slug from
// this module; a human reviews/accepts it (or overrides with a reason) as
// part of writing the sale's front matter. See INGEST.md "Slugs" section.
//
// Priority order (highest-value SEO signal first), matching the reasoning
// used for the 7 real renames during the 2026-08-07 legacy import — a slug
// built from what was actually IN the sale beats one built from when it was
// listed:
//   1. A named property/collection ("The Bishopcroft House", "Grant Park
//      Château") — the most distinctive, memorable option when one exists.
//   2. Neighborhood + a standout category ("Raleigh Hills Midcentury Estate
//      Sale") — the default for most sales.
//   3. Neighborhood alone ("Lake Oswego Estate Sale") — when there's no
//      single standout category worth naming.
//   4. Date-based fallback — ONLY when there is no real content signal to
//      name the sale from at all (e.g. a gallery-only page with no title,
//      description, or neighborhood). Never invent a content name from
//      photos alone; a date slug is more honest than a guessed one.

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {object} input
 * @param {string} [input.propertyName] - a named estate/property, if one exists
 * @param {string} [input.neighborhood] - just the neighborhood/city, not the full "X, Portland, Oregon" string
 * @param {string} [input.standoutCategory] - e.g. "midcentury", "chinese porcelain", "military collectibles"
 * @param {string} [input.dateFallback] - e.g. "2019-07-11" — used only if nothing else is available
 * @param {string[]} [input.existingSlugs] - slugs already in use; collisions get a year suffix
 * @param {string} [input.year] - appended on collision, e.g. repeat sales at the same estate
 * @returns {{slug: string, basis: string}} the suggested slug and which rule produced it
 */
export function suggestSlug({ propertyName, neighborhood, standoutCategory, dateFallback, existingSlugs = [], year }) {
  const candidates = [];
  if (propertyName) {
    // Drop a leading article — "The Bishopcroft House" -> "bishopcroft-house
    // -estate-sale", matching the convention used across the real renames.
    const bareName = propertyName.replace(/^(the|a|an)\s+/i, "");
    candidates.push({ slug: slugify(`${bareName} estate sale`), basis: "property name" });
  }
  if (neighborhood && standoutCategory) {
    candidates.push({ slug: slugify(`${neighborhood} ${standoutCategory} estate sale`), basis: "neighborhood + standout category" });
  }
  if (neighborhood) candidates.push({ slug: slugify(`${neighborhood} estate sale`), basis: "neighborhood only" });
  if (dateFallback) candidates.push({ slug: slugify(dateFallback), basis: "date fallback — no content signal available" });

  if (!candidates.length) {
    throw new Error("suggestSlug: need at least one of propertyName, neighborhood, or dateFallback");
  }

  for (const candidate of candidates) {
    if (!existingSlugs.includes(candidate.slug)) return candidate;
  }

  // Every candidate collides with an existing slug (e.g. a second sale at
  // the same estate) — disambiguate with a year rather than silently
  // picking a worse candidate.
  const best = candidates[0];
  const withYear = year ? `${best.slug}-${year}` : `${best.slug}-2`;
  return { slug: withYear, basis: best.basis + " (year-suffixed to avoid collision)" };
}
