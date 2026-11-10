'use strict';

/**
 * Category of a driver from ALL their runs (the group's server decides, see
 * docs/leaderboard.sql, lks_category_push): the average of the last 20 runs in
 * the notation of their category, zeros included. This module only explains it
 * to the driver: where they stand and what it takes to move up (or not to drop).
 */

const CATEGORY_MODE = { debutant: 'debutant', amateur: 'normal', pro: 'pro' };
const NEXT = { debutant: 'amateur', amateur: 'pro', pro: null };
const PREV = { debutant: null, amateur: 'debutant', pro: 'amateur' };
// same values as the server (used when an older server does not send them)
const RULES = { up: { debutant: 70, amateur: 65, pro: null }, down: { debutant: null, amateur: 35, pro: 30 }, window: 20, minRuns: 10, grace: 10 };

const r1 = (v) => Math.round(v * 10) / 10;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/** Average of the window once `k` more runs at `v` are added. */
function windowAfter(scores, k, v, size) {
  const w = [...scores, ...Array(k).fill(v)].slice(-size);
  return { n: w.length, avg: mean(w) };
}

/**
 * Score needed on each of the next `k` runs for the window's average to reach
 * `target` (null when even 100 is not enough or when the window would still be
 * too short). Exact: the oldest runs leave the window as new ones come in.
 */
function needed(scores, k, target, size, minRuns) {
  const room = Math.max(0, size - k); // old runs still in the window after k new ones
  const kept = room ? scores.slice(-room) : [];
  const n = Math.min(size, kept.length + k);
  if (n < minRuns) return null;
  const v = (target * n - kept.reduce((s, x) => s + x, 0)) / k;
  if (v > 100) return null;
  return r1(Math.max(0, v));
}

/**
 * { category, mode, avg, runs, window, up, down, next, prev, scores, plan, keep, grace, danger }
 * row = the driver's line of lks_categories_list (scores of the window, oldest first).
 */
function categoryGoal(row, fallbackScores = []) {
  const category = row && CATEGORY_MODE[row.category] ? row.category : 'debutant';
  const size = (row && row.window) || RULES.window;
  const minRuns = (row && row.minRuns) || RULES.minRuns;
  const up = row && row.up !== null && row.up !== undefined ? row.up : RULES.up[category];
  const down = row && row.down !== null && row.down !== undefined ? row.down : RULES.down[category];
  const scores = (row && Array.isArray(row.scores) ? row.scores : fallbackScores).filter((v) => Number.isFinite(v)).slice(-size);
  const avg = scores.length ? r1(mean(scores)) : null;
  const next = NEXT[category];
  const prev = PREV[category];
  const since = row && Number.isFinite(row.since) ? row.since : null;
  const grace = since === null ? 0 : Math.max(0, RULES.grace - since);
  const zeros = scores.filter((v) => v === 0).length;

  let plan = null;
  if (next && up !== null && up !== undefined) {
    const missing = Math.max(0, minRuns - scores.length);
    const reached = scores.length >= minRuns && avg >= up;
    const steps = [1, 3, 5, 10].map((k) => ({ runs: k, score: needed(scores, k, up, size, minRuns) })).filter((s) => s.runs >= missing);
    plan = { gap: avg === null ? null : r1(Math.max(0, up - avg)), missing, reached, steps: steps.filter((s) => s.score !== null).slice(0, 3) };
  }
  // how low the next run can go without dropping under the floor (after the grace runs)
  let keep = null;
  if (prev && down !== null && down !== undefined && scores.length) {
    const after = (v) => windowAfter(scores, 1, v, size).avg;
    keep = after(0) >= down ? 0 : needed(scores, 1, down, size, 1);
  }
  const danger = Boolean(prev && avg !== null && down !== null && avg < down + 5);
  return { category, mode: CATEGORY_MODE[category], avg, runs: scores.length, window: size, minRuns, up, down, next, prev, scores, zeros, plan, keep, grace, danger };
}

module.exports = { categoryGoal, needed, windowAfter, CATEGORY_MODE, RULES };
