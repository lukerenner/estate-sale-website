(function () {
  "use strict";

  /* ------------------------------------------------------------ analytics
     GA4 events via the gtag() stub base.njk always defines. Off the
     production hostnames that stub only queues into window.dataLayer (no
     Google script loads), so staging clicks never reach real reports — but
     the queued events are still inspectable there for QA. Event names follow
     GA4's recommended set where one exists (generate_lead, sign_up); mark
     generate_lead as a key event in the GA4 admin to count it as a
     conversion. */
  //
  // `callback` (optional) runs once GA confirms the hit went out, or after a
  // short timeout if GA never loads (blocked, staging) — so a redirect right
  // after a conversion never swallows the event that preceded it.
  function track(name, params, callback) {
    var done = false;
    function go() { if (!done) { done = true; callback(); } }
    var clean = {};
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== "") clean[k] = params[k];
    });
    var live = window.ggAnalyticsLive && typeof window.gtag === "function";
    if (callback && live) {
      clean.event_callback = go;
      clean.event_timeout = 800;
    }
    if (typeof window.gtag === "function") window.gtag("event", name, clean);
    if (callback) window.setTimeout(go, live ? 1000 : 0);
  }

  // One delegated listener for every trackable click: phone, email, the
  // Vault/shop, other outbound links, and the site's CTA buttons.
  document.addEventListener("click", function (e) {
    var link = e.target.closest && e.target.closest("a[href]");
    if (!link) return;
    var href = link.getAttribute("href") || "";
    var label = (link.getAttribute("aria-label") || link.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
    var location = link.closest("header") ? "header" : link.closest("footer") ? "footer" : "body";

    if (href.indexOf("tel:") === 0) {
      track("phone_click", { link_text: label, link_location: location });
    } else if (href.indexOf("mailto:") === 0) {
      track("email_click", { link_text: label, link_location: location });
    } else if (link.hostname && link.hostname !== window.location.hostname && /^https?:$/.test(link.protocol)) {
      if (/(^|\.)shop\.garygermer\.com$/.test(link.hostname)) {
        track("vault_click", { link_url: link.href, link_text: label, link_location: location });
      } else {
        track("outbound_click", { link_url: link.href, link_domain: link.hostname, link_location: location });
      }
    }
    if (link.classList.contains("button")) {
      track("cta_click", { link_text: label, link_url: link.href, link_location: location });
    }
  });

  /* -------------------------------------------------------- hash realign ---
     The browser's native anchor-scroll (e.g. the header's "About Gary"
     link, id="about-gary") fires once, early — before the hero photo, the
     web font swap, or any hello-bar height adjustment above the target
     have finished settling. On a long page that shift is enough to land
     short of the section's top. Re-apply once things are ready, and again
     on same-page hash clicks (which re-fire the browser's native jump
     immediately, before script.js's own later layout changes settle). */
  function realignHash() {
    if (!location.hash) return;
    var target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
  }
  if (document.readyState === "complete") {
    realignHash();
  } else {
    window.addEventListener("load", realignHash);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(realignHash);
  }
  window.addEventListener("hashchange", realignHash);

  /* ----------------------------------------------------------- hello bar ---
     Shows/hides the site-wide sale announcement rendered by
     partials/hello-bar.njk (from collections.heroBarSale — the soonest
     not-yet-concluded sale). Eligible window: the Monday of the sale's
     first week through the sale's own last-day closing time, computed
     against the visitor's local clock so it can turn off intraday without
     a rebuild. `?showHelloBar=1` forces it visible for design QA. */
  (function () {
    var bar = document.getElementById("hello-bar");
    if (!bar) return;

    var firstDate = bar.getAttribute("data-first-date");
    var lastDate = bar.getAttribute("data-last-date");
    var lastClose24 = bar.getAttribute("data-last-close24");
    var textEl = bar.querySelector("[data-hello-bar-text]");

    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function todayKey() {
      var d = new Date();
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
    function dateKey(d) {
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
    function parseDateKey(dateStr) {
      var p = dateStr.split("-");
      return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    function mondayOnOrBefore(d) {
      var day = d.getDay(); // 0 Sun .. 6 Sat
      var diff = day === 0 ? -6 : 1 - day;
      var m = new Date(d);
      m.setDate(d.getDate() + diff);
      return m;
    }
    function saleIsOver() {
      var today = todayKey();
      if (today > lastDate) return true;
      if (today < lastDate || !lastClose24) return false;
      var closeParts = lastClose24.split(":");
      var closeTime = new Date();
      closeTime.setHours(+closeParts[0], +closeParts[1], 0, 0);
      return new Date() >= closeTime;
    }

    // Keeps --hello-bar-h glued to the bar's actual rendered box at all
    // times — not just a one-off measurement at load. A snapshot taken
    // before the web font swaps in (or before a viewport resize re-wraps
    // the text) bakes in a wrong height that never self-corrects, leaving
    // the header floating below an empty gap where the bar used to be.
    // ResizeObserver fires on every layout change (font swap, wrap, resize,
    // show/hide) so the header offset can never drift from reality.
    function syncHeight() {
      document.documentElement.style.setProperty(
        "--hello-bar-h",
        bar.classList.contains("is-visible") ? bar.offsetHeight + "px" : "0px"
      );
    }
    if ("ResizeObserver" in window) {
      new ResizeObserver(syncHeight).observe(bar);
    } else {
      window.addEventListener("resize", syncHeight);
    }

    function evaluate() {
      // `?showHelloBar=1` (or `=week`) previews the "This Week" copy,
      // `?showHelloBar=today` previews the "Today" copy — regardless of the
      // real date, for design QA.
      var forcedMatch = /(?:^|[?&])showHelloBar=([^&]*)/.exec(window.location.search);
      var forced = forcedMatch ? decodeURIComponent(forcedMatch[1]) : null;

      var today = todayKey();
      var isToday = today >= firstDate && today <= lastDate;
      var mondayKey = dateKey(mondayOnOrBefore(parseDateKey(firstDate)));
      var isThisWeek = !isToday && today >= mondayKey && today < firstDate;
      var over = saleIsOver();

      var visible = forced !== null || ((isToday || isThisWeek) && !over);
      bar.classList.toggle("is-visible", visible);

      if (visible && textEl) {
        var showToday = forced !== null ? forced === "today" : isToday;
        textEl.textContent = "Our next estate sale is " + (showToday ? "today" : "this week") + ".";
      }
      syncHeight();
    }

    evaluate();
    // Fonts finishing their swap after the initial layout is exactly the
    // case syncHeight()/ResizeObserver above exists to catch, but re-run
    // evaluate() too in case it changes whether the text wraps.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(evaluate);
    }
    // Recheck periodically so the bar disappears on its own once the sale's
    // closing time passes, even on a page left open across that moment.
    window.setInterval(evaluate, 60000);
  })();

  /* -------------------------------------------------------------- header */
  var header = document.getElementById("site-header");
  var body0 = document.body;
  var lastScrollY = window.scrollY;
  var onScroll = function () {
    var y = window.scrollY;
    header.classList.toggle("is-scrolled", y > 8);

    if (body0.classList.contains("nav-open")) {
      lastScrollY = y;
      return;
    }
    var delta = y - lastScrollY;
    if (y > 8 && delta > 0) {
      header.classList.add("is-hidden");
    } else if (delta < 0) {
      header.classList.remove("is-hidden");
    }
    lastScrollY = y;
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ------------------------------------------------------- mobile nav ---
     Focus trap + Escape + scroll lock, matching the accessibility bar the
     brief sets for the mobile menu. */
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("site-nav");
  var body = document.body;
  var lastFocused = null;

  function focusableEls() {
    return Array.prototype.slice.call(
      nav.querySelectorAll('a[href], button:not([disabled])')
    );
  }

  function openNav() {
    lastFocused = document.activeElement;
    body.classList.add("nav-open", "nav-lock");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
    var first = focusableEls()[0];
    if (first) first.focus();
    document.addEventListener("keydown", onNavKeydown);
  }

  function closeNav() {
    body.classList.remove("nav-open", "nav-lock");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    document.removeEventListener("keydown", onNavKeydown);
    if (lastFocused) lastFocused.focus();
  }

  function onNavKeydown(e) {
    if (e.key === "Escape") {
      closeNav();
      return;
    }
    if (e.key === "Tab") {
      var items = focusableEls();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  toggle.addEventListener("click", function () {
    if (body.classList.contains("nav-open")) {
      closeNav();
    } else {
      openNav();
    }
  });

  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      if (body.classList.contains("nav-open")) closeNav();
    });
  });

  /* Nav dropdowns ("Estate Sales", "More") — keep at most one open, and
     close whichever is open on an outside click since native <details>
     doesn't do either of those on its own. */
  var navDropdowns = Array.prototype.slice.call(nav.querySelectorAll(".nav-dropdown"));
  navDropdowns.forEach(function (dropdown) {
    dropdown.addEventListener("toggle", function () {
      if (!dropdown.open) return;
      navDropdowns.forEach(function (other) {
        if (other !== dropdown) other.open = false;
      });
    });
  });
  document.addEventListener("click", function (e) {
    navDropdowns.forEach(function (dropdown) {
      if (dropdown.open && !dropdown.contains(e.target)) dropdown.open = false;
    });
  });

  /* -------------------------------------------------------- form checks
     Delegated on document, not a querySelectorAll snapshot, so forms
     injected after this script runs (e.g. estate-sale.js's post-sale
     signup) still get the same shake + highlight treatment. */
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.matches || !form.matches("form")) return;
    var invalid = form.querySelectorAll(":invalid");
    if (!invalid.length) return;
    e.preventDefault();
    invalid.forEach(function (el) {
      var field = el.closest(".field");
      if (field) field.classList.add("has-error");
    });
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
    var first = invalid[0].closest(".field") || invalid[0];
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    invalid[0].focus();
  });

  document.addEventListener("animationend", function (e) {
    if (e.animationName === "form-shake") e.target.classList.remove("shake");
  });

  document.querySelectorAll("form").forEach(function (form) {
    form.querySelectorAll("input, select, textarea").forEach(function (el) {
      el.addEventListener("input", function () {
        var field = el.closest(".field");
        if (field && el.validity.valid) field.classList.remove("has-error");
      });
      el.addEventListener("blur", function () {
        var field = el.closest(".field");
        if (field && !el.validity.valid && el.value !== "") field.classList.add("has-error");
      });
    });
  });

  /* --------------------------------------------------------- footer year */
  var yearEl = document.getElementById("footer-year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* --------------------------------------------- start-an-appraisal tiers
     /start-an-appraisal/?tier=free-spot-check (or verbal-evaluation /
     written-appraisal) preselects the matching option in the tier dropdown
     and swaps the hero heading/lead/CTA text to match — the appraisal tier
     cards on /our-services/appraisals/ link here with that param. */
  (function () {
    var hero = document.getElementById("appraisal-hero");
    if (!hero) return;
    var params = new URLSearchParams(window.location.search);

    /* The appraisals-page hero form GETs straight into this page (see
       appraisals.njk) so its fields arrive as query params of the same
       name — carry them into the matching inputs here rather than making
       the visitor retype everything they already answered. Runs regardless
       of whether `tier` matches below, since a visitor could in theory land
       with name/email params but no recognized tier. */
    var prefillFields = {
      first_name: "appraisal-first-name",
      last_name: "appraisal-last-name",
      email: "appraisal-email",
      phone: "appraisal-phone",
      message: "appraisal-message"
    };
    Object.keys(prefillFields).forEach(function (param) {
      var value = params.get(param);
      var field = document.getElementById(prefillFields[param]);
      if (value && field) field.value = value;
    });

    var tiers = {
      "free-spot-check": {
        option: "Free Spot Check",
        eyebrow: "Free Spot Check",
        heading: "Let’s See if You Need an Appraisal",
        lead: "A quick expert opinion on whether your item is worth investigating further — free, and with no obligation. It doesn’t include a dollar valuation, but it comes from the same licensed, bonded, and insured appraisers whose written reports are prepared to USPAP standards, the benchmark relied on by the IRS and accepted in federal and state courts.",
        formHeading: "Start a Free Spot Check",
        button: "Start a Free Spot Check"
      },
      "verbal-evaluation": {
        option: "Verbal Evaluation",
        eyebrow: "Verbal Evaluation",
        heading: "Let’s See How Much Your Item is Worth",
        lead: "A deeper, research-backed examination to determine what your item could realistically be worth. Handled by licensed, bonded, and insured appraisers whose written reports are prepared to USPAP standards — the benchmark relied on by the IRS and accepted in federal and state courts.",
        formHeading: "Start a Verbal Evaluation",
        button: "Start a Verbal Evaluation"
      },
      "written-appraisal": {
        option: "Full Written Appraisal",
        eyebrow: "Full Written Appraisal",
        heading: "Let’s Build Your Legally Defensible Appraisal",
        lead: "A detailed written report built for estates, trusts, charitable contributions, and insurance claims. Prepared by licensed, bonded, and insured appraisers to USPAP standards — the benchmark relied on by the IRS and accepted in federal and state courts.",
        formHeading: "Start a Written Appraisal",
        button: "Start a Written Appraisal"
      }
    };
    var tier = tiers[params.get("tier")];
    if (!tier) return;
    var eyebrowEl = hero.querySelector("[data-tier-eyebrow]");
    var headingEl = hero.querySelector("[data-tier-heading]");
    var leadEl = hero.querySelector("[data-tier-lead]");
    var formHeadingEl = hero.querySelector("[data-tier-form-heading]");
    var buttonEl = hero.querySelector("[data-tier-button]");
    var select = document.getElementById("appraisal-tier");
    if (eyebrowEl) eyebrowEl.textContent = tier.eyebrow;
    if (headingEl) headingEl.textContent = tier.heading;
    if (leadEl) leadEl.textContent = tier.lead;
    if (formHeadingEl) formHeadingEl.textContent = tier.formHeading;
    if (buttonEl) buttonEl.textContent = tier.button;
    if (select) select.value = tier.option;
  })();

  /* --------------------------------------------- appraisal photo upload
     The real intake requires at least one photo and caps the upload at
     MAX_PHOTOS files — both problems surface inline via the shared
     field-error paragraph instead of a static caption, and only once they're
     true. There's deliberately no raw-size cap here: the submit handler below
     shrinks every photo to fit the 4MB request budget, so three 5MB iPhone
     photos are fine and shouldn't be rejected before they get the chance. */
  var MAX_PHOTOS = 10;
  document.querySelectorAll('input[type="file"][name="attachment"]').forEach(function (photosInput) {
    var field = photosInput.closest(".field");
    var errorEl = field ? field.querySelector(".field-error") : null;
    var DEFAULT_MESSAGE = errorEl ? errorEl.textContent : "";
    var TOO_MANY_MESSAGE = "Please attach no more than " + MAX_PHOTOS + " photos.";
    photosInput.addEventListener("change", function () {
      var tooMany = photosInput.files.length > MAX_PHOTOS;
      photosInput.setCustomValidity(tooMany ? TOO_MANY_MESSAGE : "");
      if (errorEl) errorEl.textContent = tooMany ? TOO_MANY_MESSAGE : DEFAULT_MESSAGE;
      if (field) field.classList.toggle("has-error", tooMany);
    });
  });

  /* --------------------------------------------------- CTA intent preset
     Buttons that link to #consultation can carry data-need="An estate" etc.
     to preselect the matching option in that form's service dropdown. */
  document.querySelectorAll("a[data-need]").forEach(function (link) {
    link.addEventListener("click", function () {
      var select = document.getElementById("consult-need");
      if (!select) return;
      select.value = link.dataset.need;
    });
  });

  /* ------------------------------------------ mobile hero form unfold ---
     Below the hero-shell breakpoint the hero form starts collapsed; tapping
     a hero CTA unfolds it in place instead of jumping to the page-bottom
     consultation section. */
  var heroForm = document.querySelector(".hero-form-card");
  var heroNeedSelect = document.getElementById("hero-need");
  var heroNameField = document.getElementById("hero-name");
  var mobileFormMq = window.matchMedia("(max-width: 980px)");
  document.querySelectorAll(".hero-ctas a[data-need]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      if (!mobileFormMq.matches || !heroForm) return;
      e.preventDefault();
      if (heroNeedSelect) heroNeedSelect.value = link.dataset.need;
      heroForm.classList.add("is-open");
      heroForm.scrollIntoView({ behavior: "smooth", block: "start" });
      if (heroNameField) window.setTimeout(function () { heroNameField.focus(); }, 350);
    });
  });

  /* --------------------------------------------------- inline video play
     About-section thumbnails link out to the specific YouTube video by
     default (works with no JS); with JS, a click swaps the thumbnail for a
     self-hosted, controllable <video> instead of leaving the page. */
  document.querySelectorAll(".video-thumb[data-video]").forEach(function (thumb) {
    thumb.addEventListener("click", function (e) {
      e.preventDefault();
      var video = document.createElement("video");
      video.src = thumb.dataset.video;
      video.className = "video-thumb-player";
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      if (thumb.dataset.captions) {
        var track = document.createElement("track");
        track.kind = "captions";
        track.src = thumb.dataset.captions;
        track.srclang = "en";
        track.label = "English";
        video.appendChild(track);
      }
      thumb.replaceWith(video);
    });
  });

  /* ------------------------------------------------- hero video play button
     No autoplay (see blog-post.njk) — the visitor presses play, and that
     click is a real gesture, so sound plays immediately with no browser
     restrictions to work around. */
  document.querySelectorAll(".video-play-fallback[data-video-play]").forEach(function (button) {
    var video = button.closest(".blog-video-embed").querySelector("video");
    if (!video) return;

    video.addEventListener("play", function () { button.hidden = true; });
    button.addEventListener("click", function () { video.play(); });
  });

  /* ------------------------------------------------ grid filter bars ---
     Generic chip-filter behavior shared by the previous-sales neighborhood
     filter (data-sale-filter/data-sale-grid, cards keyed on
     data-neighborhood) and the blog category filter (data-blog-filter/
     data-blog-grid, cards keyed on data-category) — same interaction, two
     independent attribute pairs so neither page's markup fakes the other's. */
  [
    { filterAttr: "data-sale-filter", gridAttr: "data-sale-grid", cardSelector: ".sale-card", cardKey: "neighborhood" },
    { filterAttr: "data-blog-filter", gridAttr: "data-blog-grid", cardSelector: ".blog-card", cardKey: "category", limit: 10, showMoreSelector: "[data-blog-show-more]", urlParam: "filter", soldOnlyUnder: "for-sale" },
  ].forEach(function (cfg) {
    var filterBar = document.querySelector("[" + cfg.filterAttr + "]");
    var grid = document.querySelector("[" + cfg.gridAttr + "]");
    if (!filterBar || !grid) return;
    var showMoreBtn = cfg.showMoreSelector ? document.querySelector(cfg.showMoreSelector) : null;
    var expanded = false;

    function applyFilter(filter) {
      var shown = 0;
      grid.querySelectorAll(cfg.cardSelector).forEach(function (card) {
        var cardValues = (card.dataset[cfg.cardKey] || "").split(/\s+/);
        var matches = filter === "all" || cardValues.indexOf(filter) !== -1;
        // Sold shop items (data-sold) only appear under the For Sale chip,
        // after the available ones (blog/index.njk renders them last).
        if (cfg.soldOnlyUnder && card.hasAttribute("data-sold") && filter !== cfg.soldOnlyUnder) matches = false;
        var overLimit = cfg.limit && filter === "all" && !expanded && matches && ++shown > cfg.limit;
        card.hidden = !matches || overLimit;
      });
      if (showMoreBtn) showMoreBtn.hidden = !(cfg.limit && filter === "all" && !expanded && shown > cfg.limit);
    }

    filterBar.addEventListener("click", function (e) {
      var chip = e.target.closest(".filter-chip");
      if (!chip) return;
      filterBar.querySelectorAll(".filter-chip").forEach(function (c) {
        c.classList.remove("is-active");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("is-active");
      chip.setAttribute("aria-pressed", "true");
      expanded = false;
      applyFilter(chip.dataset.filter);

      /* Keep the URL in sync so the active filter survives a reload/share
         (mirrors the ?filter= read on load below) — replaceState, not push,
         so clicking through chips doesn't spam browser history. */
      if (cfg.urlParam) {
        var url = new URL(window.location.href);
        if (chip.dataset.filter === "all") url.searchParams.delete(cfg.urlParam);
        else url.searchParams.set(cfg.urlParam, chip.dataset.filter);
        window.history.replaceState(null, "", url);
      }
    });

    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", function () {
        expanded = true;
        applyFilter("all");
      });
    }

    /* ?filter=<slug> (e.g. /blog/?filter=video, linked from the homepage
       "Watch More Videos" button) preselects the matching chip on load,
       falling back to "all" when the param is absent or matches no chip. */
    var initialFilter = "all";
    if (cfg.urlParam) {
      var requested = new URLSearchParams(window.location.search).get(cfg.urlParam);
      var matchingChip = requested && filterBar.querySelector('.filter-chip[data-filter="' + requested + '"]');
      if (matchingChip) {
        filterBar.querySelectorAll(".filter-chip").forEach(function (c) {
          c.classList.remove("is-active");
          c.setAttribute("aria-pressed", "false");
        });
        matchingChip.classList.add("is-active");
        matchingChip.setAttribute("aria-pressed", "true");
        initialFilter = requested;
      }
    }

    applyFilter(initialFilter);
  });

  /* ---------------------------------------------- shop item PDP gallery */
  document.querySelectorAll("[data-shop-gallery]").forEach(function (gallery) {
    var mainImg = gallery.querySelector("[data-shop-gallery-main]");
    var bgImgs = gallery.querySelectorAll("[data-shop-gallery-bg]");
    var thumbs = gallery.querySelectorAll("[data-shop-gallery-thumb]");
    var prevBtn = gallery.querySelector("[data-shop-gallery-prev]");
    var nextBtn = gallery.querySelector("[data-shop-gallery-next]");
    if (!mainImg || !thumbs.length) return;

    function selectThumb(thumb) {
      thumbs.forEach(function (t) { t.classList.toggle("is-active", t === thumb); });
      mainImg.classList.add("is-fading");
      window.setTimeout(function () {
        mainImg.src = thumb.dataset.fullSrc;
        mainImg.srcset = thumb.dataset.fullSrcset;
        mainImg.classList.remove("is-fading");
      }, 180);
      bgImgs.forEach(function (bg) { bg.src = thumb.dataset.fullSrc; });
      thumb.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function step(delta) {
      var thumbList = Array.prototype.slice.call(thumbs);
      var current = thumbList.findIndex(function (t) { return t.classList.contains("is-active"); });
      var next = (current + delta + thumbList.length) % thumbList.length;
      selectThumb(thumbList[next]);
    }

    gallery.addEventListener("click", function (e) {
      var thumb = e.target.closest("[data-shop-gallery-thumb]");
      if (!thumb) return;
      selectThumb(thumb);
    });

    if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });
  });

  /* ------------------------------------------------ footer review widget
     Hovering a star fills every star up to it; clicking 1-3 opens a private
     feedback form (same /api/submit-inquiry pattern as the other footer forms) so
     lukewarm feedback stays off Google, while 4-5 sends the visitor straight
     out to leave a public Google review. */
  (function () {
    var group = document.querySelector("[data-review-stars]");
    var modal = document.querySelector("[data-review-modal]");
    if (!group || !modal) return;

    var stars = Array.prototype.slice.call(group.querySelectorAll("[data-star]"));
    var ratingInput = modal.querySelector("[data-review-rating-input]");
    var closeBtn = modal.querySelector("[data-review-modal-close]");
    var googleReviewUrl = group.dataset.googleReviewUrl;
    var selected = 0;
    var lastFocused = null;

    function paint(count) {
      stars.forEach(function (star) {
        star.classList.toggle("is-filled", Number(star.dataset.star) <= count);
      });
    }

    function openModal(rating) {
      lastFocused = document.activeElement;
      if (ratingInput) ratingInput.value = rating;
      modal.hidden = false;
      body.classList.add("nav-lock");
      document.addEventListener("keydown", onModalKeydown);
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      if (modal.hidden) return;
      modal.hidden = true;
      body.classList.remove("nav-lock");
      document.removeEventListener("keydown", onModalKeydown);
      selected = 0;
      paint(0);
      if (ratingInput) ratingInput.value = "";
      if (lastFocused) lastFocused.focus();
    }

    function onModalKeydown(e) {
      if (e.key === "Escape") closeModal();
    }

    stars.forEach(function (star) {
      var rating = Number(star.dataset.star);
      star.addEventListener("mouseenter", function () { paint(rating); });
      star.addEventListener("focus", function () { paint(rating); });
      star.addEventListener("click", function () {
        selected = rating;
        paint(rating);
        track("review_click", { rating: rating });
        if (rating >= 4) {
          if (googleReviewUrl) window.open(googleReviewUrl, "_blank", "noopener");
          return;
        }
        openModal(rating);
      });
    });
    group.addEventListener("mouseleave", function () { paint(selected); });
    group.addEventListener("focusout", function (e) {
      if (!group.contains(e.relatedTarget)) paint(selected);
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  })();

  /* ------------------------------------------------------- scroll reveal */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ------------------------------------------------- airtable inquiry forms
     contact.njk, start-an-appraisal.njk, and start-a-consignment.njk all
     post to /api/submit-inquiry (a Netlify Function that writes to
     Airtable). Netlify rejects request bodies over ~4.5MB with a bare 413
     (measured on the deployed function), so every photo is shrunk
     client-side to a per-photo share of a 4MB budget before it's sent — the
     alternative is a confusing failure partway through submit. */
  (function () {
    var MAX_TOTAL_BYTES = 4 * 1024 * 1024;
    var MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
    var MAX_DIMENSION = 2000;

    function loadImage(file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(); };
        img.src = url;
      });
    }

    // Re-encodes as JPEG until it fits `budget`, first by lowering quality,
    // then by shrinking the dimensions. A file the browser can't decode is
    // passed through untouched — the total-size check catches it if it's big.
    function compressImage(file, budget) {
      if (!file.type || file.type.indexOf("image/") !== 0 || file.size <= budget) {
        return Promise.resolve(file);
      }
      return loadImage(file).then(function (img) {
        var maxDim = MAX_DIMENSION;
        return new Promise(function (resolve) {
          function attempt(quality) {
            var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            var canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function (blob) {
              if (!blob) { resolve(file); return; }
              if (blob.size <= budget || (quality <= 0.45 && maxDim <= 800)) {
                var name = file.name.replace(/\.\w+$/, "") + ".jpg";
                resolve(new File([blob], name, { type: "image/jpeg" }));
              } else if (quality > 0.45) {
                attempt(quality - 0.2);
              } else {
                maxDim = Math.round(maxDim * 0.75);
                attempt(0.8);
              }
            }, "image/jpeg", quality);
          }
          attempt(0.85);
        });
      }, function () { return file; });
    }

    // Delegated on document (not a querySelectorAll snapshot) because
    // estate-sale.js injects a matching form into the DOM after this script
    // has already run (its own DOMContentLoaded handler fires later) — a
    // snapshot taken here would miss it and let the browser fall back to a
    // native submit, navigating to the endpoint's raw JSON response.
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form.matches || !form.matches('form[action="/api/submit-inquiry"]')) return;
      if (!form.checkValidity()) return; // existing handler above shakes + highlights invalid fields
      e.preventDefault();
      // One submission per click: compression can take a few seconds on a
      // phone, and a second tap in that window used to create a duplicate
      // Airtable record.
      if (form.dataset.submitting === "1" || form.dataset.submitted === "1") return;
      form.dataset.submitting = "1";

      var fileInput = form.querySelector('input[type="file"]');
      var errorEl = form.querySelector(".form-submit-error");
      var submitBtn = form.querySelector('button[type="submit"]');
      var originalBtnText = submitBtn ? submitBtn.textContent : "";
      var formType = (form.querySelector('input[name="form"]') || {}).value || "unknown";

      function showError(message) {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.hidden = false;
      }
      function reset() {
        form.dataset.submitting = "";
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
      }
      if (errorEl) errorEl.hidden = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting…"; }

      var files = fileInput ? Array.prototype.slice.call(fileInput.files) : [];
      var budget = files.length ? Math.min(MAX_ATTACHMENT_BYTES, Math.floor((MAX_TOTAL_BYTES * 0.95) / files.length)) : 0;

      Promise.all(files.map(function (f) { return compressImage(f, budget); })).then(function (compressed) {
        var total = compressed.reduce(function (sum, f) { return sum + f.size; }, 0);
        if (total > MAX_TOTAL_BYTES) {
          showError("Those photos are too large altogether — please attach fewer, or smaller ones.");
          reset();
          return;
        }

        var fd = new FormData(form);
        if (fileInput) {
          fd.delete(fileInput.name);
          compressed.forEach(function (f) { fd.append(fileInput.name, f); });
        }

        return fetch(form.getAttribute("action"), { method: "POST", body: fd, headers: { Accept: "application/json" } })
          .then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
              if (!res.ok) {
                var err = new Error("submit failed");
                err.status = res.status;
                err.serverMessage = data && data.error;
                throw err;
              }
              return data;
            });
          })
          .then(function (data) {
            // The footer's private-feedback form isn't a lead; everything else
            // posting here is an inquiry.
            var conversion = formType === "newsletter" ? "sign_up" : formType === "review" ? "review_feedback" : "generate_lead";
            var conversionParams = {
              form_type: formType,
              method: formType === "newsletter" ? "newsletter" : undefined,
              photos: files.length || undefined
            };
            // The inquiry was saved but not every photo made it — say so
            // plainly and don't show the generic thank-you page, which would
            // imply everything arrived. The form stays locked: resubmitting
            // would create a duplicate inquiry.
            if (data && data.photosFailed > 0) {
              form.dataset.submitted = "1";
              form.dataset.submitting = "";
              if (submitBtn) submitBtn.textContent = "Message Sent";
              showError(
                "We received your message, but " + data.photosFailed + " of " + data.photosAttempted +
                " photos didn’t upload. Please email " + (data.photosFailed === 1 ? "it" : "them") +
                " to info@garygermer.com — there’s no need to send the form again."
              );
              track(conversion, conversionParams);
              track("photo_upload_failed", { form_type: formType, failed: data.photosFailed });
              return;
            }
            track(conversion, conversionParams, function () { window.location.href = "/thanks.html"; });
          })
          .catch(function (err) {
            track("form_submit_error", { form_type: formType, status: err && err.status });
            if (err && err.status === 413) {
              showError("Those photos are too large altogether — please attach fewer, or smaller ones.");
            } else if (err && err.status === 400 && err.serverMessage) {
              showError(err.serverMessage);
            } else {
              showError("Something went wrong submitting this — please try again, or email us at info@garygermer.com.");
            }
            reset();
          });
      }).catch(function () {
        showError("Something went wrong preparing your photos — please try again, or email them to info@garygermer.com.");
        reset();
      });
    });
  })();
})();
