// Gates `git push` to `main` so Netlify's per-deploy credit budget (15
// credits/production deploy, 1,000/month on the Personal plan) never gets
// blown through by the content-sync automation. Netlify deploys on every
// push, so this script -- not the sync scripts, not the workflow's commit
// step -- is the one thing that decides whether a push actually happens on
// any given run. See PUSH_POLICY.md for the full human-readable spec; this
// file is the implementation of that policy.
//
// State lives in tools/push-log.json: a plain array of ISO timestamps, one
// per push this script has made. It's appended to and committed as part of
// the very commit it just decided to push (via `git commit --amend`), so
// tracking the log never costs a deploy of its own.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LOG_PATH = "tools/push-log.json";
const CHECKPOINT_PATH = "tools/blog-sync-checkpoint.json";
const TIMEZONE = "America/Los_Angeles";
const BATCH_HOUR = 9; // 9am Pacific -- rule 2
const MONTHLY_CAP = 65; // rule 5, hard ceiling
const THROTTLE_36H_AT = 55; // rule 5, first step-down
const THROTTLE_48H_AT = 60; // rule 5, second step-down

function pacificParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  // Intl reports hour 24 as "24" at the top of the day in some environments
  // instead of "00" -- normalize so downstream hour comparisons are sane.
  const hour = Number(parts.hour) % 24;
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, monthKey: `${parts.year}-${parts.month}`, hour };
}

function loadLog() {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(LOG_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function hasUnpushedCommits() {
  try {
    run("git", ["fetch", "origin", "main", "--quiet"]);
  } catch {
    // A network hiccup here shouldn't crash the whole run -- fall through
    // and compare against whatever origin/main ref is already known
    // locally (checkout@v4 always sets one up).
  }
  const count = run("git", ["rev-list", "--count", "origin/main..HEAD"]);
  return Number(count) > 0;
}

/**
 * Decide whether to push right now, and do it if so. Pure-ish: the only
 * side effects are reading/writing the push log, `git add`/`commit --amend`,
 * and `git push` -- all skipped when the decision is "hold".
 *
 * @param {object} opts
 * @param {boolean} [opts.newSaleThisRun] - did syncEstateSalesSource create
 *   a genuinely new sale on this run? (rule 1's trigger; read from
 *   tools/blog-sync-checkpoint.json by the CLI entrypoint below when not
 *   passed explicitly)
 * @param {Date} [opts.now]
 * @returns {{pushed: boolean, reason: string}}
 */
export function decideAndPush({ newSaleThisRun = false, now = new Date() } = {}) {
  if (!hasUnpushedCommits()) return { pushed: false, reason: "nothing to push" };

  const log = loadLog();
  const { dateKey: today, monthKey: thisMonth, hour } = pacificParts(now);

  const monthCount = log.filter((ts) => pacificParts(new Date(ts)).monthKey === thisMonth).length;
  if (monthCount >= MONTHLY_CAP) {
    return { pushed: false, reason: `monthly cap reached (${monthCount}/${MONTHLY_CAP} pushes this month) -- holding until next month regardless of trigger` };
  }

  const pushedToday = log.some((ts) => pacificParts(new Date(ts)).dateKey === today);
  const lastPush = log.length ? new Date(log[log.length - 1]) : null;
  const hoursSinceLastPush = lastPush ? (now - lastPush) / 3_600_000 : Infinity;

  // Baseline rule 2 is a pure calendar-day gate (pushedToday), NOT a
  // rolling 24h timer -- a push at 10am Monday must be followed by the next
  // one at 9am Tuesday (~23h later), same-day, not held over because less
  // than 24h elapsed. The rolling-hours check only enters the picture once
  // rule 5's throttle kicks in, where the owner explicitly asked for "once
  // per 36 hours" / "once per 48 hours" rather than "once per day" -- that
  // genuinely does need to skip some days' 9am slots.
  let requiredIntervalHours = null;
  if (monthCount >= THROTTLE_48H_AT) requiredIntervalHours = 48;
  else if (monthCount >= THROTTLE_36H_AT) requiredIntervalHours = 36;
  const intervalGateOk = requiredIntervalHours === null || hoursSinceLastPush >= requiredIntervalHours;

  let shouldPush = false;
  let reason = "";

  // Rule 1: a brand-new estate sale pushes immediately -- but rule 3 (never
  // more than one push per Pacific day) still wins if we already pushed
  // today for any reason, scheduled or another sale. Deliberately NOT
  // subject to the rule-5 interval throttle -- rule 5 says to throttle
  // "rule number 2" specifically, so a genuinely new sale still goes out
  // same-day even while the daily batch is stretched to 36h/48h; only the
  // hard monthly cap above can block it.
  if (newSaleThisRun && !pushedToday) {
    shouldPush = true;
    reason = "new estate sale detected -- immediate push (rule 1)";
  } else if (hour === BATCH_HOUR && !pushedToday && intervalGateOk) {
    // Rule 2 + rule 5's dynamic throttle. Firing only inside the 9am
    // Pacific hour (this workflow runs hourly) keeps this from ever
    // triggering at the wrong time of day even once the interval grows
    // past 24h.
    shouldPush = true;
    reason = requiredIntervalHours
      ? `scheduled batch push (throttled to ${requiredIntervalHours}h intervals, ${monthCount}/${MONTHLY_CAP} pushes this month)`
      : `scheduled batch push (${monthCount}/${MONTHLY_CAP} pushes this month)`;
  }

  if (!shouldPush) {
    return {
      pushed: false,
      reason: `holding -- pushedToday=${pushedToday} pacificHour=${hour} hoursSinceLastPush=${Number.isFinite(hoursSinceLastPush) ? hoursSinceLastPush.toFixed(1) : "n/a"} requiredIntervalHours=${requiredIntervalHours} monthCount=${monthCount}`,
    };
  }

  const trimmed = [...log, now.toISOString()].slice(-400); // ~years of headroom at this cap
  writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2) + "\n");
  run("git", ["add", LOG_PATH]);
  // Folds the log update into whatever commit is already sitting at HEAD
  // (this run's content-sync commit, or a leftover one from an earlier held
  // run / an interactive session) so logging the push never costs a deploy
  // of its own.
  run("git", ["commit", "--amend", "--no-edit"]);
  run("git", ["push"]);

  return { pushed: true, reason };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  let newSaleThisRun = false;
  if (existsSync(CHECKPOINT_PATH)) {
    try {
      const checkpoint = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8"));
      newSaleThisRun = Boolean(checkpoint.estateSales?.created?.length);
    } catch {
      // Missing/unparsable checkpoint just means "assume no new sale this
      // run" -- never block the gate over a logging artifact.
    }
  }
  const result = decideAndPush({ newSaleThisRun });
  console.log(`[push-gate] ${result.pushed ? "PUSHED" : "held"}: ${result.reason}`);
}
