'use strict';

/**
 * Judges' decisions on battles (manifest.judging, set by the admins): the
 * launcher's judging gives the result, a judge can overrule it (winner or
 * one more time). The same battle is recorded by several PCs: a decision is
 * matched by the two drivers, the track and the time (within 5 minutes).
 */

const norm = (n) => String(n || '').trim().toLowerCase();
const pairOf = (names) => names.map(norm).sort().join('|');
const WINDOW_MS = 5 * 60 * 1000;

function decisionFor(judging, battle) {
  const pair = battle.pair || pairOf(((battle.result || {}).drivers || []).map((d) => d.name));
  const t = Date.parse(battle.date);
  return (Array.isArray(judging) ? judging : []).find((d) => d.pair === pair && d.track === battle.track && (d.layout || '') === (battle.layout || '') && Math.abs(Date.parse(d.date) - t) <= WINDOW_MS) || null;
}

/** Result of a battle with the judge's decision applied (the launcher's own result is kept in `auto`). */
function judged(result, decision) {
  if (!result || !decision) return result;
  const names = (result.drivers || []).map((d) => d.name);
  const winner = decision.omt ? null : names.find((n) => norm(n) === norm(decision.winner)) || null;
  if (!decision.omt && !winner) return result;
  return { ...result, omt: Boolean(decision.omt), winner, judge: { by: decision.by || '', note: decision.note || '', at: decision.at }, auto: { omt: result.omt, winner: result.winner } };
}

/** Admin input → clean decision list (at most 300, newest kept). */
function cleanJudging(list) {
  return (Array.isArray(list) ? list : [])
    .filter((d) => d && typeof d.pair === 'string' && d.pair.includes('|') && Number.isFinite(Date.parse(d.date)) && (d.omt || d.winner))
    .map((d) => ({ pair: d.pair.slice(0, 90), track: String(d.track || '').replace(/[^\w.-]/g, ''), layout: String(d.layout || '').replace(/[^\w.-]/g, ''), date: new Date(d.date).toISOString(), omt: Boolean(d.omt), winner: d.omt ? null : String(d.winner).slice(0, 40), note: String(d.note || '').slice(0, 200), by: String(d.by || '').slice(0, 40), at: d.at || new Date().toISOString() }))
    .slice(-300);
}

module.exports = { decisionFor, judged, cleanJudging, pairOf };
