// Minifies the passthrough-copied CSS/JS in _site after `eleventy` writes it.
// These files bypass Eleventy's template pipeline (addPassthroughCopy), so
// there's no build-time hook to minify them other than a postbuild pass.
import { transform, transformSync } from "esbuild";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SITE = join(process.cwd(), "_site");
const CSS_FILES = ["styles.css"];
const JS_FILES = ["script.js", "estate-sale.js"];

async function minifyCss(file) {
  const p = join(SITE, file);
  const src = readFileSync(p, "utf8");
  const before = statSync(p).size;
  const { code } = await transform(src, { loader: "css", minify: true });
  writeFileSync(p, code);
  console.log(`[minify] ${file}: ${before}b -> ${code.length}b`);
}

async function minifyJs(file) {
  const p = join(SITE, file);
  const src = readFileSync(p, "utf8");
  const before = statSync(p).size;
  const { code } = await transform(src, { loader: "js", minify: true, target: "es2019" });
  writeFileSync(p, code);
  console.log(`[minify] ${file}: ${before}b -> ${code.length}b`);
}

for (const f of CSS_FILES) await minifyCss(f);
for (const f of JS_FILES) await minifyJs(f);
