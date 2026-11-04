'use strict';

/**
 * Championship rounds computed from the group server's rows: the same code
 * runs in the launcher and on the showcase site (tools/build-site.js bundles
 * it), so both show the same results. No dependency on Node or Electron.
 */

const champ = require('./championship');
const judging = require('./judging');

/** One battle recorded by several PCs: keep the newest of each pair within 5 min. */
function dedupe(battles) {
  const out = [];
  for (const b of [...battles].sort((x, y) => Date.parse(y.date) - Date.parse(x.date))) {
    if (out.some((o) => o.pair === b.pair && o.track === b.track && (o.layout || '') === (b.layout || '') && Math.abs(Date.parse(o.date) - Date.parse(b.date)) < 5 * 60 * 1000)) continue;
    out.push(b);
  }
  return out;
}

/** Battles of a round (result per mode), deduplicated, with the judges' decisions applied. */
function ruledBattles(round, battles, decisions) {
  const withPairs = dedupe(battles.filter((b) => b && b.drivers && b.drivers.length === 2).map((b) => ({ ...b, pair: b.drivers.map((d) => String(d.name).toLowerCase()).sort().join('|'), track: round.track, layout: round.layout || '' })));
  return withPairs.map((b) => ({ ...b, ...judging.judged(b, judging.decisionFor(decisions || [], { ...b, result: b })) }));
}

/**
 * Rows of the server (lks_laps) for a round whose « rules » end with @<round id>:
 * when the course changed during the round, only its latest version counts.
 */
function latestVersion(rows) {
  const newest = {};
  for (const r of rows) {
    const t = Date.parse(r.created_at) || 0;
    if (!(r.rules in newest) || t > newest[r.rules]) newest[r.rules] = t;
  }
  const best = Object.keys(newest).sort((a, b) => newest[b] - newest[a])[0];
  return rows.filter((r) => r.rules === best);
}

/** Best line per driver name (rows sorted best first). */
function bestPerDriver(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = String(r.driver || '').trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Results of one round from the server's rows.
 * entryRows: lks_laps rows of the round (drift / tandem), battleRows: rows of kind « battle ».
 */
function roundFromRows(round, { entryRows = [], battleRows = [], decisions = [], points } = {}) {
  const entries = bestPerDriver(latestVersion(entryRows).sort((a, b) => Number(b.score) - Number(a.score))).map((r) => ({ name: r.driver, score: Number(r.score) }));
  const battles = latestVersion(battleRows)
    .filter((r) => r.meta && r.meta.battle && r.meta.battle.result)
    .map((r) => ({ ...r.meta.battle.result, date: r.meta.battle.date || r.created_at }));
  return { ...round, ...champ.roundResults(round, { entries, battles: round.kind === 'battle' ? ruledBattles(round, battles, decisions) : [], points }) };
}

module.exports = { dedupe, ruledBattles, latestVersion, bestPerDriver, roundFromRows };
