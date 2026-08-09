(function () {
  "use strict";

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

  /* -------------------------------------------------------- form checks */
  document.querySelectorAll("form").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      var invalid = form.querySelectorAll(":invalid");
      if (!invalid.length) return;
      e.preventDefault();
      invalid.forEach(function (el) {
        var field = el.closest(".field");
        if (field) field.classList.add("has-error");
      });
      var first = invalid[0].closest(".field") || invalid[0];
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      invalid[0].focus();
    });

    form.querySelectorAll("input, select, textarea").forEach(function (el) {
      el.addEventListener("input", function () {
        var field = el.closest(".field");
        if (field && el.validity.valid) field.classList.remove("has-error");
      });
    });
  });

  /* --------------------------------------------------------- footer year */
  var yearEl = document.getElementById("footer-year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

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
      thumb.replaceWith(video);
    });
  });

  /* ------------------------------------------------- hero video autoplay
     The markup already asks for unmuted autoplay; this only handles the
     case where the browser refuses it (no media-engagement history for the
     domain — the common case for a first-time visitor). play() rejects, and
     we reveal a play button so the visitor is never left looking at a
     stalled poster wondering what to click. That click is a real gesture,
     so playback then starts with sound. */
  document.querySelectorAll("[data-video-autoplay]").forEach(function (wrap) {
    var video = wrap.querySelector("video");
    var button = wrap.querySelector("[data-video-play]");
    if (!video || !button) return;

    video.addEventListener("play", function () { button.hidden = true; });
    button.addEventListener("click", function () {
      video.muted = false;
      video.play();
    });

    var attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () { button.hidden = false; });
    }
  });

  /* ------------------------------------------------ grid filter bars ---
     Generic chip-filter behavior shared by the previous-sales neighborhood
     filter (data-sale-filter/data-sale-grid, cards keyed on
     data-neighborhood) and the blog category filter (data-blog-filter/
     data-blog-grid, cards keyed on data-category) — same interaction, two
     independent attribute pairs so neither page's markup fakes the other's. */
  [
    { filterAttr: "data-sale-filter", gridAttr: "data-sale-grid", cardSelector: ".sale-card", cardKey: "neighborhood" },
    { filterAttr: "data-blog-filter", gridAttr: "data-blog-grid", cardSelector: ".blog-card", cardKey: "category", limit: 10, showMoreSelector: "[data-blog-show-more]" },
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
    });

    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", function () {
        expanded = true;
        applyFilter("all");
      });
    }

    applyFilter("all");
  });

  /* ---------------------------------------------- shop item PDP gallery */
  document.querySelectorAll("[data-shop-gallery]").forEach(function (gallery) {
    var mainImg = gallery.querySelector("[data-shop-gallery-main]");
    var bgImgs = gallery.querySelectorAll("[data-shop-gallery-bg]");
    if (!mainImg) return;
    gallery.addEventListener("click", function (e) {
      var thumb = e.target.closest("[data-shop-gallery-thumb]");
      if (!thumb) return;
      gallery.querySelectorAll("[data-shop-gallery-thumb]").forEach(function (t) {
        t.classList.toggle("is-active", t === thumb);
      });
      mainImg.src = thumb.dataset.fullSrc;
      mainImg.srcset = thumb.dataset.fullSrcset;
      bgImgs.forEach(function (bg) { bg.src = thumb.dataset.fullSrc; });
    });
  });

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
})();
