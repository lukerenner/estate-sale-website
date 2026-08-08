// Small field helpers shared by the sync-*.mjs scripts — standalone Node
// scripts (not the Eleventy build) can't reach eleventy.config.js's filters,
// so the one piece of logic they need (neighborhoodLabel) is duplicated here
// in sync with the "neighborhoodLabel" filter in eleventy.config.js.

export function neighborhoodLabel(str) {
  return (str || "").split(",")[0].trim();
}
