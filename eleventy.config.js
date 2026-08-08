var { execFileSync } = require("node:child_process");
var path = require("node:path");

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Category vs. sourceType are independent front-matter axes on a blog post
// (see PLAN); the filter bar's 5 chips are a computed view over both, in
// this fixed display order — sourceType wins when it implies its own chip
// (shop/youtube), otherwise fall back to the human label for category.
var BLOG_CATEGORY_LABELS = {
  "estate-sales": "Estate Sales",
  "appraisals": "Appraisals",
  "show-and-tell": "Show & Tell",
};
var BLOG_CHIP_ORDER = ["Estate Sales", "Appraisals", "Show & Tell", "Shop Finds", "Video"];

function blogFilterLabel(category, sourceType) {
  if (sourceType === "shop") return "Shop Finds";
  if (sourceType === "youtube") return "Video";
  return BLOG_CATEGORY_LABELS[category] || category;
}

// Reads a WebP's real pixel size (for width/height attrs on {% blogImage %}
// output) the same way tools/lib/optimize-images.mjs does for sale galleries.
function imageDims(absPath) {
  try {
    var out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", absPath], { encoding: "utf8" });
    var w = Number((/pixelWidth:\s*(\d+)/.exec(out) || [])[1]);
    var h = Number((/pixelHeight:\s*(\d+)/.exec(out) || [])[1]);
    return w && h ? { width: w, height: h } : null;
  } catch (e) {
    return null;
  }
}

// The 26 short neighborhood labels found in estate-sales/*.njk, consolidated
// into 7 broad-area groups for the previous-sales filter bar (set 2026-08-07,
// replacing an earlier 13-group pass) — cards still display their specific
// neighborhood, only the filter is grouped. Every label must map somewhere;
// there is no "falls back to itself" case left unhandled.
var NEIGHBORHOOD_GROUPS = {
  // Lake Oswego & Dunthorpe — south-metro river neighborhoods. Tualatin's
  // one sale (Stafford Trail) is actually West Linn per its own hero copy,
  // which sits with this south-metro cluster rather than Southwest Portland.
  "Lake Oswego": "Lake Oswego & Dunthorpe",
  "Dunthorpe": "Lake Oswego & Dunthorpe",
  "Tualatin": "Lake Oswego & Dunthorpe",

  // West Hills — the West Hills ridge neighborhoods, plus Kings Heights and
  // NW Skyline which sit in the same hills near Forest Heights.
  "West Hills": "West Hills",
  "Southwest Hills": "West Hills",
  "Forest Heights": "West Hills",
  "Vista": "West Hills",
  "Council Crest": "West Hills",
  "Willamette Heights": "West Hills",
  "Kings Heights": "West Hills",
  "NW Skyline": "West Hills",

  // Northwest Portland — the close-in NW grid neighborhoods.
  "Northwest Portland": "Northwest Portland",
  "NW 23rd": "Northwest Portland",
  "Nob Hill": "Northwest Portland",

  // Southwest Portland — inner-SW neighborhoods, plus Scholls as the
  // closest fit among these 7 groups for a rural far-SW/Washington-County sale.
  "Raleigh Hills": "Southwest Portland",
  "Bridlemile": "Southwest Portland",
  "Hillsdale": "Southwest Portland",
  "Scholls": "Southwest Portland",

  // Northeast Portland — including Eliot per request; "Portland" (the one
  // sale with no more specific neighborhood on file) defaults here too.
  "Northeast Portland": "Northeast Portland",
  "Eliot": "Northeast Portland",
  "Grant Park": "Northeast Portland",
  "Portland": "Northeast Portland",

  // Southeast Portland
  "Central Eastside": "Southeast Portland",
  "Westmoreland": "Southeast Portland",

  // Camas, WA
  "Camas": "Camas",
  "Lacamas Lake": "Camas",
};

module.exports = function (eleventyConfig) {
  // Static assets — served/copied as-is, same paths as today.
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("styles.css");
  eleventyConfig.addPassthroughCopy("script.js");
  eleventyConfig.addPassthroughCopy("estate-sale.js");
  eleventyConfig.addPassthroughCopy("favicon.ico");
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("_redirects");
  eleventyConfig.addPassthroughCopy("thanks.html");

  eleventyConfig.addCollection("estateSales", (api) =>
    api.getFilteredByGlob("estate-sales/*.njk").sort((a, b) => {
      var aLast = a.data.dates[a.data.dates.length - 1].date;
      var bLast = b.data.dates[b.data.dates.length - 1].date;
      return bLast.localeCompare(aLast); // newest last-day first
    })
  );

  eleventyConfig.addCollection("blogPosts", (api) =>
    api.getFilteredByGlob("blog/posts/*.md").sort((a, b) => b.date - a.date)
  );

  // The 5 filter-bar chip values actually present in collections.blogPosts,
  // in the fixed display order — mirrors saleNeighborhoods' dedupe/slugify
  // pattern, but over the blogFilterLabel computed view instead of a raw
  // front-matter field.
  eleventyConfig.addCollection("blogCategories", (api) => {
    var posts = api.getFilteredByGlob("blog/posts/*.md");
    var present = {};
    posts.forEach(function (post) {
      present[blogFilterLabel(post.data.category, post.data.sourceType)] = true;
    });
    return BLOG_CHIP_ORDER.filter((label) => present[label]).map((label) => ({
      label: label,
      slug: slugify(label),
    }));
  });

  // Sales whose first day hasn't happened yet as of build time, soonest
  // first — powers the "next sale" teaser card on the /estate-sales/ hero.
  // We only ever promote the next one (see previous-estate-sales.njk); this
  // is deliberately date-only (it ignores a page's own `status` override,
  // which exists to control that page's live/ended state, not to hide a
  // sale from this teaser).
  eleventyConfig.addCollection("upcomingEstateSales", (api) => {
    var todayKey = new Date().toISOString().slice(0, 10);
    function firstDate(item) {
      return item.data.dates.map((d) => d.date).sort()[0];
    }
    return api
      .getFilteredByGlob("estate-sales/*.njk")
      .filter((item) => item.data.dates && item.data.dates.length && firstDate(item) > todayKey)
      .sort((a, b) => firstDate(a).localeCompare(firstDate(b)));
  });

  // Grouped neighborhood label ("Forest Heights, Portland, Oregon" -> "Forest
  // Heights & NW Hills" via NEIGHBORHOOD_GROUPS), deduped and alphabetized,
  // for the previous-sales filter bar.
  eleventyConfig.addCollection("saleNeighborhoods", (api) => {
    var sales = api.getFilteredByGlob("estate-sales/*.njk");
    var seen = {};
    var list = [];
    sales.forEach(function (sale) {
      var short = (sale.data.neighborhood || "").split(",")[0].trim();
      var label = NEIGHBORHOOD_GROUPS[short] || short;
      if (!label || seen[label]) return;
      seen[label] = true;
      list.push({ label: label, slug: slugify(label) });
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  });

  eleventyConfig.addFilter("dateDisplay", function (isoDate) {
    var d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  });

  eleventyConfig.addFilter("json", (obj) => JSON.stringify(obj));

  // Address/neighborhood strings are hand-written per sale; normalize the
  // state name to its postal abbreviation regardless of how the sale's
  // front matter spells it out.
  eleventyConfig.addFilter("abbreviateOregon", function (str) {
    return (str || "").replace(/\bOregon\b/g, "OR");
  });

  // "Forest Heights, Portland, Oregon" -> "Forest Heights" — the short label
  // used on previous-sales cards and the neighborhood filter chips.
  eleventyConfig.addFilter("neighborhoodLabel", function (str) {
    return (str || "").split(",")[0].trim();
  });

  // "Forest Heights, Portland, Oregon" -> "Portland" — the city, for cards
  // that show neighborhood and city as separate lines. When a sale has no
  // distinct neighborhood on file ("Northeast Portland, Oregon", "Lake
  // Oswego, Oregon"), the first segment doubles as the city; stripping a
  // leading compass direction recovers "Portland" from "Northeast Portland".
  eleventyConfig.addFilter("cityLabel", function (str) {
    var parts = (str || "").split(",").map(function (p) { return p.trim(); });
    if (parts.length >= 3) return parts[1];
    return parts[0].replace(/^(Northeast|Northwest|Southeast|Southwest)\s+/i, "");
  });

  // Same short label, mapped to its broader filter-bar group.
  eleventyConfig.addFilter("neighborhoodGroup", function (str) {
    var short = (str || "").split(",")[0].trim();
    return NEIGHBORHOOD_GROUPS[short] || short;
  });

  eleventyConfig.addFilter("slugify", slugify);

  eleventyConfig.addFilter("blogFilterLabel", blogFilterLabel);

  eleventyConfig.addFilter("year", function (isoDate) {
    return (isoDate || "").slice(0, 4);
  });

  eleventyConfig.addFilter("galleryFullUrls", function (gallery, slug) {
    return (gallery || []).map(function (item) {
      return {
        full: "/assets/images/estate-sales/" + slug + "/" + item.base + "-1400.webp",
        alt: item.alt,
      };
    });
  });

  eleventyConfig.addFilter("isoDateTime", function (date, time24) {
    return date + "T" + time24 + ":00-07:00";
  });

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // No-JS fallback text only — estate-sale.js overwrites this on load from SALE_DATA.
  eleventyConfig.addFilter("dateRangeShort", function (dates) {
    var first = new Date(dates[0].date + "T00:00:00");
    var last = new Date(dates[dates.length - 1].date + "T00:00:00");
    var firstStr = MONTHS[first.getMonth()] + " " + first.getDate();
    if (first.getMonth() === last.getMonth()) return firstStr + "–" + last.getDate();
    return firstStr + "–" + MONTHS[last.getMonth()] + " " + last.getDate();
  });

  eleventyConfig.addFilter("weekdayRangeShort", function (dates) {
    var first = new Date(dates[0].date + "T00:00:00");
    var last = new Date(dates[dates.length - 1].date + "T00:00:00");
    if (dates.length === 1) return WEEKDAYS[first.getDay()];
    return WEEKDAYS[first.getDay()] + "–" + WEEKDAYS[last.getDay()];
  });

  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Long-form twins of dateRangeShort/weekdayRangeShort, matching
  // estate-sale.js's formatDateRangeLong/formatWeekdayRangeLong exactly —
  // for the /estate-sales/ hero's next-sale card, which (unlike a sale's own
  // page) has no JS to upgrade the short no-JS fallback after load.
  eleventyConfig.addFilter("dateRangeLong", function (dates) {
    var first = new Date(dates[0].date + "T00:00:00");
    var last = new Date(dates[dates.length - 1].date + "T00:00:00");
    var firstMonth = MONTHS_LONG[first.getMonth()], lastMonth = MONTHS_LONG[last.getMonth()];
    if (dates.length === 1) return firstMonth + " " + first.getDate();
    if (firstMonth === lastMonth) return firstMonth + " " + first.getDate() + "–" + last.getDate();
    return firstMonth + " " + first.getDate() + " – " + lastMonth + " " + last.getDate();
  });

  eleventyConfig.addFilter("weekdayRangeLong", function (dates) {
    var first = new Date(dates[0].date + "T00:00:00");
    var last = new Date(dates[dates.length - 1].date + "T00:00:00");
    if (dates.length === 1) return WEEKDAYS_LONG[first.getDay()];
    return WEEKDAYS_LONG[first.getDay()] + "–" + WEEKDAYS_LONG[last.getDay()];
  });

  // "Our Next Sale is in N Days/Weeks." — same rounding as estate-sale.js's
  // client-side countdownHeadline, computed at build time for the
  // /estate-sales/ hero's next-sale teaser card (which has no SALE_DATA/JS
  // of its own to recompute this on the fly).
  eleventyConfig.addFilter("countdownHeadline", function (dates) {
    var today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
    var first = new Date(dates.map((d) => d.date).sort()[0] + "T00:00:00");
    var days = Math.round((first - today) / 86400000);
    if (days < 7) return "Our Next Sale is in " + days + (days === 1 ? " Day." : " Days.");
    var weeks = Math.max(1, Math.round(days / 7));
    return "Our Next Sale is in " + weeks + (weeks === 1 ? " Week." : " Weeks.");
  });

  // ---- Blog body shortcodes (see PLAN "Content model") --------------------
  // {% blogImage "base", "Alt text" %} — same responsive <picture> markup the
  // estate-sale gallery uses, from a filename stem under this post's own
  // /assets/images/blog/<slug>/ directory (slug = this post's fileSlug).
  eleventyConfig.addShortcode("blogImage", function (base, alt) {
    var slug = this.page.fileSlug;
    var dir = "/assets/images/blog/" + slug + "/";
    var dims = imageDims(path.join(process.cwd(), "assets/images/blog", slug, base + "-1400.webp"));
    var safeAlt = String(alt || "").replace(/"/g, "&quot;");
    return (
      '<img class="blog-body-image" src="' + dir + base + '-900.webp"' +
      ' srcset="' + dir + base + '-480.webp 480w, ' + dir + base + '-900.webp 900w, ' + dir + base + '-1400.webp 1400w"' +
      ' sizes="(max-width: 700px) 100vw, 700px"' +
      (dims ? ' width="' + dims.width + '" height="' + dims.height + '"' : "") +
      ' loading="lazy" alt="' + safeAlt + '">'
    );
  });

  // {% pullquote %}...{% endpullquote %} — styled quote block.
  eleventyConfig.addPairedShortcode("pullquote", function (content) {
    return '<blockquote class="pullquote">' + content + "</blockquote>";
  });

  // {% blogGallery "slug", count %} — numbered <slug>-01..NN images, for
  // shop-item posts with multiple product photos (see sync-shop.mjs).
  eleventyConfig.addShortcode("blogGallery", function (slug, count) {
    var dir = "/assets/images/blog/" + slug + "/";
    var n = Number(count) || 0;
    var tiles = "";
    for (var i = 1; i <= n; i++) {
      var base = slug + "-" + String(i).padStart(2, "0");
      tiles +=
        '<img src="' + dir + base + '-480.webp"' +
        ' srcset="' + dir + base + '-480.webp 480w, ' + dir + base + '-900.webp 900w"' +
        ' sizes="(max-width: 700px) 45vw, 220px" loading="lazy" alt="Product photo ' + i + '">';
    }
    return '<div class="blog-gallery">' + tiles + "</div>";
  });

  return {
    dir: {
      input: ".",
      includes: "_includes",
      output: "_site",
    },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
