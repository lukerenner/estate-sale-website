/* Estate Sale Detail Page — shared behavior engine.
   Reads window.SALE_DATA (defined inline on each sale page) and powers the
   parts of the page that can't be correct as plain static HTML: the status
   badge / hero CTAs (both date-dependent), the calendar download, the photo
   lightbox, and the video modal. Everything else on the page is hand-authored
   HTML, same as the homepage — this script only adds behavior on top of it. */
(function () {
  "use strict";

  var SALE = window.SALE_DATA;
  if (!SALE) return;

  /* ----------------------------------------------------------- date/status */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function computeStatus() {
    if (SALE.status && SALE.status !== "auto") return SALE.status;
    if (!SALE.dates || !SALE.dates.length) return "Upcoming";
    var keys = SALE.dates.map(function (d) { return d.date; }).sort();
    var first = keys[0], last = keys[keys.length - 1], today = todayKey();
    if (today < first) return "Upcoming";
    if (today > last) return "Sale Ended";
    if (today === last) return "Final Day";
    return "Open Today";
  }
  var STATUS_CLASS = {
    "Upcoming": "is-upcoming",
    "Open Today": "is-open",
    "Final Day": "is-final",
    "Sale Ended": "is-ended"
  };

  /* The address is a privacy-sensitive detail: it should only be public
     while the sale is actually live (Open Today / Final Day), never before
     (nothing to see yet) or after (an empty house shouldn't stay pinpointed
     on the internet forever). `address.released` can force `true`/`false`
     to override this per sale; anything else (including "auto") computes it. */
  function addressReleased() {
    if (!SALE.address) return false;
    var r = SALE.address.released;
    if (r === true || r === false) return r;
    var status = computeStatus();
    return status === "Open Today" || status === "Final Day";
  }

  function htmlEscape(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------ long-form copy ---
     Authors keep typing addresses/dates the short, natural way ("Ave.",
     "2026-09-11"); these expand them to the fuller, more premium form the
     card displays, so nobody has to remember to spell "Avenue" out by hand. */
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var STREET_SUFFIX_EXPANSIONS = {
    ave: "Avenue", st: "Street", dr: "Drive", rd: "Road", blvd: "Boulevard",
    ln: "Lane", ct: "Court", pl: "Place", ter: "Terrace", pkwy: "Parkway",
    hwy: "Highway", cir: "Circle", sq: "Square", trl: "Trail", way: "Way"
  };
  /* Dates are plain "YYYY-MM-DD" strings — parsed as UTC so day-math (here
     and in daysUntilFirst) can't drift a day from a local-timezone DST edge. */
  function parseDateKey(dateStr) {
    var parts = dateStr.split("-");
    return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  }
  function expandStreetSuffix(line) {
    if (!line) return line;
    return line.replace(/\b([A-Za-z]+)\.?\s*$/, function (match, word) {
      var expansion = STREET_SUFFIX_EXPANSIONS[word.toLowerCase()];
      return expansion || match;
    });
  }
  function formatDateRangeLong() {
    var dates = sortedDates();
    var first = parseDateKey(dates[0].date);
    var last = parseDateKey(dates[dates.length - 1].date);
    var firstMonth = MONTHS_LONG[first.getUTCMonth()], lastMonth = MONTHS_LONG[last.getUTCMonth()];
    if (dates.length === 1) return firstMonth + " " + first.getUTCDate();
    if (firstMonth === lastMonth) return firstMonth + " " + first.getUTCDate() + "–" + last.getUTCDate();
    return firstMonth + " " + first.getUTCDate() + " – " + lastMonth + " " + last.getUTCDate();
  }
  function formatWeekdayRangeLong() {
    var dates = sortedDates();
    var firstWd = WEEKDAYS_LONG[parseDateKey(dates[0].date).getUTCDay()];
    if (dates.length === 1) return firstWd;
    var lastWd = WEEKDAYS_LONG[parseDateKey(dates[dates.length - 1].date).getUTCDay()];
    return firstWd + "–" + lastWd;
  }
  function daysUntilFirst() {
    var first = parseDateKey(sortedDates()[0].date);
    var today = parseDateKey(todayKey());
    return Math.round((first - today) / 86400000);
  }
  function countdownHeadline() {
    var days = daysUntilFirst();
    if (days < 7) return "This Sale is in " + days + (days === 1 ? " Day." : " Days.");
    var weeks = Math.max(1, Math.round(days / 7));
    return "This Sale is in " + weeks + (weeks === 1 ? " Week." : " Weeks.");
  }
  /* "The Birkendene Estate Sale" -> "Estate Sale: The Birkendene Estate" —
     leads with what the event IS so it's scannable in a packed calendar. */
  function calendarTitle() {
    return "Estate Sale: " + String(SALE.name || "").replace(/\s+Sale\s*$/i, "").trim();
  }

  function subscribeActionsMarkup() {
    var idBase = "sale-alerts-" + (SALE.slug || "sale");
    return (
      '<p class="sale-info-subscribe-lead">Get notified when we have another one.</p>' +
      '<form class="sale-info-subscribe-form" action="/api/submit-inquiry" method="POST">' +
        '<input type="hidden" name="form" value="newsletter">' +
        '<div class="form-honey" aria-hidden="true">' +
          '<label for="' + idBase + '-company">Leave this field empty</label>' +
          '<input type="text" id="' + idBase + '-company" name="_honey" tabindex="-1" autocomplete="off">' +
        '</div>' +
        '<div class="form-row sale-info-subscribe-fields">' +
          '<div class="field">' +
            '<label class="field-label" for="' + idBase + '-name">Name</label>' +
            '<input id="' + idBase + '-name" name="name" type="text" placeholder="Name" autocomplete="name" required>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field-label" for="' + idBase + '-email">Email</label>' +
            '<input id="' + idBase + '-email" name="email" type="email" placeholder="Email" autocomplete="email" required>' +
          '</div>' +
        '</div>' +
        '<p class="form-submit-error" role="alert" hidden></p>' +
        '<button class="button button-primary" type="submit">Subscribe</button>' +
      '</form>'
    );
  }

  /* Drives the three states the sale-info card can be in — Upcoming, Live
     (Open Today / Final Day), and Concluded (Sale Ended) — from `dates`
     alone. Upcoming and Concluded both keep the address private; Concluded
     additionally swaps the CTAs for a "get notified" signup and drops the
     Hours row, since the card persists indefinitely afterward. */
  function applyStatus() {
    var status = computeStatus();
    var ended = status === "Sale Ended";
    var upcoming = status === "Upcoming";
    var released = addressReleased();

    var badge = document.querySelector("[data-sale-status-badge]");
    if (badge) {
      badge.textContent = status;
      badge.className = "sale-status-badge " + (STATUS_CLASS[status] || "");
    }

    var infoBar = document.querySelector("[data-sale-info-bar]");
    if (infoBar) {
      infoBar.classList.remove("is-upcoming", "is-open", "is-final", "is-ended");
      infoBar.classList.add(STATUS_CLASS[status] || "");
    }

    /* The flag headline does triple duty: a countdown before the sale, a
       same-day nudge while it's live, a "this ended" notice after. */
    var flagHeadline = document.querySelector("[data-sale-flag-headline]");
    if (flagHeadline) {
      if (ended) {
        flagHeadline.textContent = "This Sale Has Already Ended";
      } else if (upcoming) {
        flagHeadline.textContent = countdownHeadline();
      } else if (status === "Final Day") {
        flagHeadline.textContent = "Today's the Last Day!";
      } else {
        flagHeadline.textContent = "Happening Now!";
      }
      flagHeadline.hidden = false;
    }

    var datesValue = document.querySelector("[data-sale-dates-value]");
    if (datesValue) datesValue.textContent = formatDateRangeLong();
    var datesSub = document.querySelector("[data-sale-dates-sub]");
    if (datesSub) datesSub.textContent = formatWeekdayRangeLong();

    if (ended) {
      var hoursItem = document.querySelector("[data-sale-hours-item]");
      if (hoursItem) hoursItem.remove();
    }

    var concludedNote = document.querySelector("[data-sale-concluded-note]");
    if (concludedNote) concludedNote.hidden = !ended;

    var addressValue = document.querySelector("[data-sale-address-value]");
    var addressNote = document.querySelector("[data-sale-address-note]");
    if (released) {
      if (addressValue && SALE.address) {
        addressValue.innerHTML = htmlEscape(expandStreetSuffix(SALE.address.line1)) + "<br>" + htmlEscape(SALE.address.line2 || "");
      }
      if (addressNote) addressNote.hidden = true;
    } else {
      var neighborhoodSub = document.querySelector("[data-sale-neighborhood-sub]");
      if (addressValue && neighborhoodSub) {
        addressValue.innerHTML = neighborhoodSub.innerHTML;
        neighborhoodSub.remove();
      }
      if (addressNote) addressNote.hidden = !upcoming;
    }

    var actions = document.querySelector("[data-sale-info-actions]");
    if (actions) {
      if (ended) {
        actions.innerHTML = subscribeActionsMarkup();
        actions.classList.add("sale-info-actions--subscribe");
      } else {
        var calendarMenu = actions.querySelector("[data-sale-calendar-menu]");
        if (calendarMenu) setupCalendarMenu(calendarMenu);

        var directionsBtn = actions.querySelector("[data-sale-directions]");
        if (directionsBtn) {
          if (released) {
            directionsBtn.href = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(addressQuery());
            directionsBtn.target = "_blank";
            directionsBtn.rel = "noopener";
          } else {
            directionsBtn.remove();
            actions.classList.add("sale-info-actions--single");
          }
        }
      }
    }
  }

  /* -------------------------------------------------------------- overlay ---
     Shared open/close engine for the three full-screen overlays below
     (calendar modal, video modal, lightbox): nav-lock, Escape-to-close,
     click-outside-to-close, a Tab focus trap, and last-focus restoration.
     `opts.onOpen`/`onClose` let a caller hook its own side effect (loading
     an iframe src, clearing an <img> src, toggling aria-expanded) into the
     same lifecycle; `opts.initialFocus` opts into focusing a specific
     element on open (omit it to leave focus untouched, as the lightbox
     does); `opts.onKeydown` lets a caller add its own key handling (e.g.
     the lightbox's arrow-key navigation) alongside Escape/Tab. */
  function createOverlay(rootEl, opts) {
    opts = opts || {};
    var lastFocused;

    function focusableEls() {
      return Array.prototype.slice.call(rootEl.querySelectorAll("a[href], button:not([disabled])"));
    }
    function isOpen() { return !rootEl.hidden; }

    function open() {
      if (isOpen()) return;
      lastFocused = document.activeElement;
      if (opts.onOpen) opts.onOpen();
      rootEl.hidden = false;
      document.body.classList.add("nav-lock");
      document.addEventListener("keydown", onKeydown);
      if (opts.initialFocus) {
        var focusTarget = opts.initialFocus();
        if (focusTarget) focusTarget.focus();
      }
    }
    function close() {
      if (!isOpen()) return;
      rootEl.hidden = true;
      document.body.classList.remove("nav-lock");
      document.removeEventListener("keydown", onKeydown);
      if (opts.onClose) opts.onClose();
      if (lastFocused) lastFocused.focus();
    }
    function toggle() { if (isOpen()) close(); else open(); }

    function onKeydown(e) {
      if (opts.onKeydown) opts.onKeydown(e);
      if (e.key === "Escape") { close(); return; }
      if (e.key === "Tab") {
        var items = focusableEls();
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    rootEl.addEventListener("click", function (e) { if (e.target === rootEl) close(); });

    return { open: open, close: close, toggle: toggle, isOpen: isOpen };
  }

  /* --------------------------------------------------------------- ics --- */
  function addressQuery() {
    var a = SALE.address || {};
    return [expandStreetSuffix(a.line1), a.line2].filter(Boolean).join(", ");
  }
  function icsDate(dateStr, time24) {
    return dateStr.replace(/-/g, "") + "T" + time24.replace(":", "") + "00";
  }
  function icsEscape(str) {
    return String(str || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  }
  function nowStampUTC() {
    var d = new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function buildICS() {
    var dates = SALE.dates.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var first = dates[0], last = dates[dates.length - 1];
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Gary Germer & Associates//Estate Sales//EN",
      "BEGIN:VEVENT",
      "UID:" + SALE.slug + "-" + first.date + "@garygermer.com",
      "DTSTAMP:" + nowStampUTC(),
      "DTSTART:" + icsDate(first.date, first.opens24),
      "DTEND:" + icsDate(last.date, last.closes24),
      "SUMMARY:" + icsEscape(calendarTitle()),
      "DESCRIPTION:" + icsEscape(eventDetails()),
      "LOCATION:" + icsEscape(addressReleased() ? addressQuery() : SALE.neighborhood),
      "URL:" + (SALE.canonicalUrl || ""),
      "END:VEVENT",
      "END:VCALENDAR"
    ];
    return lines.join("\r\n");
  }
  function downloadICS() {
    var blob = new Blob([buildICS()], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (SALE.slug || "estate-sale") + ".ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------------------------------ calendar menu links --- */
  function sortedDates() {
    return SALE.dates.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  /* Calendar apps can't show a live map, so when the address isn't public
     yet the description has to carry the redirect explicitly — otherwise
     someone who added the event a month out has no way back to find it. */
  function eventDetails() {
    var parts = [];
    if (SALE.intro) parts.push(SALE.intro);
    if (SALE.canonicalUrl) {
      parts.push(
        addressReleased()
          ? SALE.canonicalUrl
          : "IMPORTANT NOTE: THE ADDRESS OF THE SALE WILL BE PUBLISHED THE MORNING OF THE SALE AT " + SALE.canonicalUrl + "."
      );
    }
    return parts.join("\n\n");
  }
  function eventLocation() {
    return addressReleased() ? addressQuery() : (SALE.neighborhood || "");
  }
  function buildQuery(params) {
    return Object.keys(params).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    }).join("&");
  }
  /* Google reads local wall-clock time plus a named zone (`ctz`), so this
     stays correct across DST without us tracking UTC offsets by hand. */
  function buildGoogleCalendarUrl() {
    var dates = sortedDates();
    var first = dates[0], last = dates[dates.length - 1];
    var start = first.date.replace(/-/g, "") + "T" + first.opens24.replace(":", "") + "00";
    var end = last.date.replace(/-/g, "") + "T" + last.closes24.replace(":", "") + "00";
    return "https://calendar.google.com/calendar/render?" + buildQuery({
      action: "TEMPLATE",
      text: calendarTitle(),
      dates: start + "/" + end,
      details: eventDetails(),
      location: eventLocation(),
      ctz: "America/Los_Angeles"
    });
  }
  /* Outlook's deep link wants an explicit UTC offset rather than a zone
     name — `timezoneOffset` on SALE_DATA lets a winter sale (PST, -08:00)
     override this Pacific-Daylight default. */
  function buildOutlookCalendarUrl() {
    var dates = sortedDates();
    var first = dates[0], last = dates[dates.length - 1];
    var tz = SALE.timezoneOffset || "-07:00";
    return "https://outlook.live.com/calendar/0/deeplink/compose?" + buildQuery({
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: calendarTitle(),
      startdt: first.date + "T" + first.opens24 + ":00" + tz,
      enddt: last.date + "T" + last.closes24 + ":00" + tz,
      body: eventDetails(),
      location: eventLocation()
    });
  }
  /* Opens in a modal rather than a dropdown anchored under the trigger —
     the sale-hero section clips overflow for its full-bleed photo, so a
     dropdown positioned under a button near the bottom of that 100svh
     section would get silently cut off instead of appearing on top. */
  function setupCalendarMenu(menu) {
    var trigger = menu.querySelector("[data-sale-calendar-trigger]");
    if (!trigger) return;

    var modal, overlay;

    function build() {
      modal = document.createElement("div");
      modal.className = "sale-overlay sale-calendar-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Add to calendar");
      modal.hidden = true;
      modal.innerHTML =
        '<div class="sale-calendar-modal-inner">' +
          '<button type="button" class="sale-lightbox-btn sale-calendar-modal-close" aria-label="Close">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>' +
          '</button>' +
          '<h2 class="sale-calendar-modal-title">Add to Calendar</h2>' +
          '<div class="sale-calendar-modal-options">' +
            '<a href="' + htmlEscape(buildGoogleCalendarUrl()) + '" target="_blank" rel="noopener">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke-linecap="round"/></svg>' +
              'Google Calendar' +
            '</a>' +
            '<a href="' + htmlEscape(buildOutlookCalendarUrl()) + '" target="_blank" rel="noopener">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke-linecap="round"/></svg>' +
              'Outlook Calendar' +
            '</a>' +
            '<button type="button" data-modal-ics>' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke-linecap="round"/></svg>' +
              'Apple Calendar &amp; Others (.ics)' +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      overlay = createOverlay(modal, {
        onOpen: function () { trigger.setAttribute("aria-expanded", "true"); },
        onClose: function () { trigger.setAttribute("aria-expanded", "false"); },
        initialFocus: function () { return modal.querySelector(".sale-calendar-modal-close"); }
      });

      modal.querySelector(".sale-calendar-modal-close").addEventListener("click", overlay.close);
      modal.querySelector("[data-modal-ics]").addEventListener("click", function () {
        downloadICS();
        overlay.close();
      });
    }

    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      if (!modal) build();
      overlay.toggle();
    });
  }

  /* ---------------------------------------------------------- map/location */
  function setupLocationPanel() {
    var mapWrap = document.querySelector("[data-sale-map]");
    var viewLarger = document.querySelector("[data-sale-map-link]");
    if (!SALE.address || !addressReleased() || !SALE.mapQuery) {
      if (mapWrap) mapWrap.remove();
      if (viewLarger) viewLarger.remove();
      return;
    }
    if (mapWrap) {
      var iframe = document.createElement("iframe");
      iframe.loading = "lazy";
      iframe.title = SALE.name + " — map";
      iframe.src = "https://www.google.com/maps?q=" + encodeURIComponent(SALE.mapQuery) + "&output=embed";
      mapWrap.appendChild(iframe);
    }
    if (viewLarger) {
      viewLarger.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(SALE.mapQuery);
      viewLarger.target = "_blank";
      viewLarger.rel = "noopener";
    }
  }

  /* -------------------------------------------------------- video modal --- */
  function setupVideoModal() {
    var trigger = document.querySelector("[data-sale-video-trigger]");
    if (!trigger || !SALE.video) return;

    var modal, frame, overlay;

    function build() {
      modal = document.createElement("div");
      modal.className = "sale-overlay sale-video-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", SALE.name + " — video");
      modal.hidden = true;
      modal.innerHTML =
        '<div class="sale-video-modal-inner">' +
          '<button type="button" class="sale-lightbox-btn sale-video-modal-close" aria-label="Close video">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>' +
          '</button>' +
          '<iframe class="sale-video-modal-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>' +
        '</div>';
      document.body.appendChild(modal);
      frame = modal.querySelector("iframe");

      overlay = createOverlay(modal, {
        onOpen: function () { frame.src = "https://www.youtube-nocookie.com/embed/" + SALE.video.youtubeId + "?autoplay=1&rel=0"; },
        onClose: function () { frame.src = ""; },
        initialFocus: function () { return modal.querySelector(".sale-video-modal-close"); }
      });

      modal.querySelector(".sale-video-modal-close").addEventListener("click", overlay.close);
    }

    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      if (!modal) build();
      overlay.open();
    });
  }

  /* ------------------------------------------------------------ lightbox */
  function setupLightbox() {
    var photos = SALE.gallery || [];
    if (!photos.length) return;

    var openers = document.querySelectorAll("[data-gallery-index]");
    var viewAll = document.querySelector("[data-gallery-view-all]");
    if (!openers.length && !viewAll) return;

    var lightbox, stage, img, caption, counter, overlay, index = 0;

    function build() {
      lightbox = document.createElement("div");
      lightbox.className = "sale-overlay sale-lightbox";
      lightbox.setAttribute("role", "dialog");
      lightbox.setAttribute("aria-modal", "true");
      lightbox.setAttribute("aria-label", "Photo gallery");
      lightbox.hidden = true;
      lightbox.innerHTML =
        '<button type="button" class="sale-lightbox-btn sale-lightbox-close" aria-label="Close gallery">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<button type="button" class="sale-lightbox-btn sale-lightbox-prev" aria-label="Previous photo">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<button type="button" class="sale-lightbox-btn sale-lightbox-next" aria-label="Next photo">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<div class="sale-lightbox-stage"><img class="sale-lightbox-image" alt=""></div>' +
        '<div class="sale-lightbox-footer"><p class="sale-lightbox-caption"></p><p class="sale-lightbox-counter"></p></div>';
      document.body.appendChild(lightbox);
      stage = lightbox.querySelector(".sale-lightbox-stage");
      img = lightbox.querySelector(".sale-lightbox-image");
      caption = lightbox.querySelector(".sale-lightbox-caption");
      counter = lightbox.querySelector(".sale-lightbox-counter");

      overlay = createOverlay(lightbox, {
        onClose: function () { img.src = ""; },
        onKeydown: function (e) {
          if (e.key === "ArrowLeft") show(index - 1);
          else if (e.key === "ArrowRight") show(index + 1);
        }
      });

      lightbox.querySelector(".sale-lightbox-close").addEventListener("click", overlay.close);
      lightbox.querySelector(".sale-lightbox-prev").addEventListener("click", function () { show(index - 1); });
      lightbox.querySelector(".sale-lightbox-next").addEventListener("click", function () { show(index + 1); });

      var touchStartX = null;
      stage.addEventListener("touchstart", function (e) { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
      stage.addEventListener("touchend", function (e) {
        if (touchStartX === null) return;
        var dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
        touchStartX = null;
      }, { passive: true });
    }

    function show(i) {
      index = (i + photos.length) % photos.length;
      var photo = photos[index];
      img.src = photo.full;
      img.alt = photo.alt || "";
      caption.textContent = photo.caption || "";
      caption.hidden = !photo.caption;
      counter.textContent = (index + 1) + " / " + photos.length;
    }

    function open(i) {
      if (!lightbox) build();
      show(i);
      overlay.open();
    }

    openers.forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        open(parseInt(el.getAttribute("data-gallery-index"), 10) || 0);
      });
    });
    if (viewAll) {
      viewAll.addEventListener("click", function (e) {
        e.preventDefault();
        open(0);
      });
    }
  }

  /* ------------------------------------------------------- gallery: see more */
  function setupGallerySeeMore() {
    var seeMore = document.querySelector("[data-gallery-see-more]");
    if (!seeMore) return;
    seeMore.addEventListener("click", function () {
      var hiddenTiles = document.querySelectorAll("[data-gallery-extra]");
      hiddenTiles.forEach(function (tile) {
        tile.hidden = false;
        tile.removeAttribute("data-gallery-extra");
      });
      seeMore.remove();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyStatus();
    setupLocationPanel();
    setupVideoModal();
    setupLightbox();
    setupGallerySeeMore();
  });
})();
