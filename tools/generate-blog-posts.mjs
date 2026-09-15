// Thin orchestrator run on a schedule (see .github/workflows/blog-sync.yml):
// calls all three sync modules in sequence, then refreshes the checkpoint
// cache. blog-sync-checkpoint.json is a non-authoritative perf cache only —
// every module re-derives "does this already exist?" from blog/posts/*.md
// itself, so the checkpoint file is safe to delete and rebuild at any time.

import { writeFileSync } from "node:fs";
import { syncShop } from "./lib/sync-shop.mjs";
import { syncVideo } from "./lib/sync-video.mjs";
import { syncAmnw } from "./lib/sync-amnw.mjs";
import { syncEstateSalesSource } from "./lib/sync-estate-sales-source.mjs";

// Estate sales themselves need no separate blog-post sync step: the
// blogPosts collection (eleventy.config.js) reads estate-sales/*.njk
// directly, so a sale gets a blog-index card the moment its page exists —
// no separate blog/posts/*.md stub to generate. syncEstateSalesSource below
// is what creates that page in the first place, from estatesales.org.
async function run() {
  const shop = await syncShop();
  const video = await syncVideo();
  const amnw = await syncAmnw();
  const estateSales = await syncEstateSalesSource();

  const summary = { ranAt: new Date().toISOString(), shop, video, amnw, estateSales };
  writeFileSync("tools/blog-sync-checkpoint.json", JSON.stringify(summary, null, 2));

  console.log(`Shop: ${shop.created.length} created, ${shop.updatedSold.length} marked sold, ${shop.updatedAvailable.length} back for sale, ${shop.soldUnknown.length} status unknown (retried next run), ${shop.skippedExisting.length} in feed.`);
  console.log(`Video: ${video.created.length} created.`);
  console.log(`AM Northwest: ${amnw.created.length} created (${amnw.checked} new listing-page segments checked).`);
  console.log(`Estate sales: ${estateSales.created.length} created, ${estateSales.skippedExisting.length} already on file, ${estateSales.skippedNameMatch.length} skipped as likely legacy duplicates, ${estateSales.failed.length} failed.`);
  if (estateSales.failed.length) console.log("  Failed:", JSON.stringify(estateSales.failed));
  if (estateSales.skippedNameMatch.length) console.log("  Name-match skips (review if unexpected):", JSON.stringify(estateSales.skippedNameMatch));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
