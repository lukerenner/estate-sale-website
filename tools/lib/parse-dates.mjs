// Legacy date-text -> structured dates[] resolver. One-time-import specific
// (not part of the reusable pipeline) because it exists to cope with ~10
// different hand-typed date phrasings across the 1.0 archive. Future single-
// sale intake should just ask for dates directly in info.md — see INGEST.md.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ALT = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const MONTH_INDEX = {};
MONTHS.forEach((m, i) => {
  MONTH_INDEX[m.toLowerCase()] = i;
  MONTH_INDEX[m.slice(0, 3).toLowerCase()] = i;
});
MONTH_INDEX["sept"] = 8;

// The optional weekday-and-comma clause between the separator and the
// second month handles phrasing like "Nov. 22nd to Sunday, Nov. 24th" —
// caught missing 2 of 3 days on the-holiday-sale-of-ms-gwyneth-gamble-booth
// during testing, where "Sunday, " sat between "to" and "Nov.".
const WEEKDAY_ALT = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const RANGE_RE = new RegExp(
  `(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:[-–—]|&|to)\\s*(?:(?:${WEEKDAY_ALT})[a-z]*\\.?,?\\s+)?(?:(${MONTH_ALT})\\.?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?`,
  "gi"
);
const SINGLE_DAY_RE = new RegExp(`(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?`, "i");
const HOURS_RE = /(\d{1,2})\s*(am|pm)\s*(?:[-–—]|to)\s*(\d{1,2})\s*(am|pm)/i;
const EXPLICIT_YEAR_RE = /\b(19|20)\d{2}\b/;

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function to24(hour, meridiem) {
  let h = hour % 12;
  if (meridiem.toLowerCase() === "pm") h += 12;
  return pad(h) + ":00";
}

function to12(hhmm) {
  const [h] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${period}`;
}

/**
 * @param {string} text - the sale's dates paragraph (or any text blob that
 *   contains a date range somewhere in it — the regexes are unanchored)
 * @param {number} fallbackYear - used when no 4-digit year appears in text
 * @param {{opens24:string, closes24:string}} [defaultHours]
 * @returns {{dates: Array, confidence: 'explicit-year'|'fallback-year', spansFound: number} | null}
 */
export function parseDateRange(text, fallbackYear, defaultHours = { opens24: "10:00", closes24: "16:00" }) {
  if (!text) return null;

  const yearMatch = EXPLICIT_YEAR_RE.exec(text);
  const year = yearMatch ? Number(yearMatch[0]) : fallbackYear;
  const confidence = yearMatch ? "explicit-year" : "fallback-year";

  const hoursMatch = HOURS_RE.exec(text);
  const opens24 = hoursMatch ? to24(Number(hoursMatch[1]), hoursMatch[2]) : defaultHours.opens24;
  const closes24 = hoursMatch ? to24(Number(hoursMatch[3]), hoursMatch[4]) : defaultHours.closes24;

  const spans = [];
  let m;
  RANGE_RE.lastIndex = 0;
  while ((m = RANGE_RE.exec(text))) {
    const month1 = MONTH_INDEX[m[1].toLowerCase()];
    const day1 = Number(m[2]);
    const month2 = m[3] ? MONTH_INDEX[m[3].toLowerCase()] : month1;
    const day2 = Number(m[4]);
    if (month1 === undefined || month2 === undefined) continue;
    spans.push({ month1, day1, month2, day2 });
  }

  if (!spans.length) {
    const single = SINGLE_DAY_RE.exec(text);
    if (!single) return null;
    const month = MONTH_INDEX[single[1].toLowerCase()];
    const day = Number(single[2]);
    spans.push({ month1: month, day1: day, month2: month, day2: day });
  }

  const allDates = [];
  for (const span of spans) {
    let cursor = new Date(Date.UTC(year, span.month1, span.day1));
    const end = new Date(Date.UTC(year, span.month2, span.day2));
    // Guard against a mis-parsed reversed range looping for a year.
    let guard = 0;
    while (cursor <= end && guard < 14) {
      allDates.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + 86400000);
      guard++;
    }
  }
  if (!allDates.length) return null;

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dates = allDates.map((d) => {
    const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const label = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    return {
      date: dateStr,
      label,
      opens: to12(opens24),
      opens24,
      closes: to12(closes24),
      closes24,
    };
  });

  return { dates, confidence, spansFound: spans.length };
}

/** Extract a 4-digit year from a slug like "march-18th-2019" or "august-1st-4th-2019". */
export function yearFromSlug(slug) {
  const m = /-(\d{4})(?:-|$)/.exec(slug) || /(\d{4})$/.exec(slug);
  return m ? Number(m[1]) : null;
}
