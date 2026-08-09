// Thin orchestrator run on a schedule (see .github/workflows/blog-sync.yml):
// calls all three sync modules in sequence, then refreshes the checkpoint
// cache. blog-sync-checkpoint.json is a non-authoritative perf cache only —
// every module re-derives "does this already exist?" from blog/posts/*.md
// itself, so the checkpoint file is safe to delete and rebuild at any time.

import { writeFileSync } from "node:fs";
import { syncEstateSales } from "./lib/sync-estate-sales.mjs";
import { syncShop } from "./lib/sync-shop.mjs";
import { syncVideo } from "./lib/sync-video.mjs";
import { syncAmnw } from "./lib/sync-amnw.mjs";

async function run() {
  const estateSales = syncEstateSales();
  const shop = await syncShop();
  const video = await syncVideo();
  const amnw = await syncAmnw();

  const summary = { ranAt: new Date().toISOString(), estateSales, shop, video, amnw };
  writeFileSync("tools/blog-sync-checkpoint.json", JSON.stringify(summary, null, 2));

  console.log(`Estate sales: ${estateSales.created.length} created, ${estateSales.skippedExisting.length} already existed.`);
  console.log(`Shop: ${shop.created.length} created, ${shop.updatedSold.length} marked sold, ${shop.skippedExisting.length} unchanged.`);
  console.log(`Video: ${video.created.length} created.`);
  console.log(`AM Northwest: ${amnw.created.length} created (${amnw.checked} new listing-page segments checked).`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
