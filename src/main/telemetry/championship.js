'use strict';

/**
 * Championships, set by the admins in the manifest:
 *   { id, name, points: [25, 18, …], rounds: [{ id, name, track, layout,
 *     kind: 'drift' | 'tandem' | 'battle', mode, start, end, bracket: 4 | 8 | 16 }] }
 *
 * - drift / tandem round: best note of each driver during the round (sent to
 *   the shared board with the round's rules: version@round).
 * - battle round: qualifying = best solo note during the round, the top N go
 *   into a bracket (1 vs N, 2 vs N-1…), each match is won by the latest battle
 *   between the two drivers without « one more time ».
 * Points by final position; the overall standings add the rounds up.
 */

const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const norm = (n) => String(n || '').trim().toLowerCase();

function roundStatus(round, now = Date.now()) {
  if (now < Date.parse(round.start)) return 'upcoming';
  if (now > Date.parse(round.end)) return 'done';
  return 'live';
}

/** Rounds open now on a track/layout (for sending results with the round's rules). */
function openRounds(championships, { track, layout = '' }, now = Date.now()) {
  const out = [];
  for (const c of championships || []) {
    for (const r of c.rounds || []) {
      if (r.track === track && (r.layout || '') === layout && roundStatus(r, now) === 'live') out.push(r);
    }
  }
  return out;
}

const pointsFor = (position, table = DEFAULT_POINTS) => (position >= 1 && position <= table.length ? table[position - 1] : 0);

/** Seed order of a bracket: 8 → [1, 8, 4, 5, 2, 7, 3, 6] (1 and 2 can only meet in the final). */
function seedOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

/**
 * Bracket from the qualifying order (names) and the battles of the round.
 * Returns { size, rounds: [[{ a, b, winner, battle, omt }]], placing: [names] | null }.
 */
function bracket(qualified, battles, size = 8) {
  const n = [4, 8, 16, 32].includes(size) ? size : 8;
  const seeds = qualified.slice(0, n);
  const BYE = { bye: true }; // empty seat (not enough qualified drivers)
  const byPair = (a, b) => battles
    .filter((x) => x.drivers && x.drivers.some((d) => norm(d.name) === norm(a)) && x.drivers.some((d) => norm(d.name) === norm(b)))
    .sort((x, y) => Date.parse(y.date) - Date.parse(x.date));
  let current = seedOrder(n).map((s) => seeds[s - 1] || BYE);
  const rounds = [];
  const eliminated = []; // [{ name, round }]
  while (current.length > 1) {
    const matches = [];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      let winner = null; // null = still to be decided
      let battle = null;
      let omt = false;
      if (a === BYE && b === BYE) winner = BYE;
      else if (a === BYE) winner = b;
      else if (b === BYE) winner = a;
      else if (a && b) {
        const played = byPair(a, b);
        battle = played.find((x) => x.winner) || played[0] || null;
        if (battle && battle.winner) {
          winner = qualified.find((q) => norm(q) === norm(battle.winner)) || battle.winner;
          eliminated.push({ name: norm(winner) === norm(a) ? b : a, round: rounds.length });
        } else if (battle) omt = true;
      }
      const real = (x) => (x === BYE ? null : x);
      matches.push({ a: real(a), b: real(b), winner: real(winner), battle, omt, bye: a === BYE || b === BYE });
      next.push(winner);
    }
    rounds.push(matches);
    current = next;
  }
  const champion = current[0];
  if (!champion || champion === BYE) return { size: n, rounds, placing: null };
  // final placing: champion, finalist, then by round of elimination (best qualifying first)
  const seedOf = (name) => qualified.findIndex((q) => norm(q) === norm(name));
  const placing = [champion];
  for (let r = rounds.length - 1; r >= 0; r--) {
    eliminated.filter((e) => e.round === r).sort((x, y) => seedOf(x.name) - seedOf(y.name)).forEach((e) => placing.push(e.name));
  }
  return { size: n, rounds, placing };
}

/**
 * Results of a round. entries = best notes [{ name, steamId, score }] sorted
 * (solo/tandem, or qualifying for battles); battles = judged battles of the round.
 * Returns { status, results: [{ position, name, score, points }], qualifying, draw } (draw = battle table).
 */
function roundResults(round, { entries = [], battles = [], points = DEFAULT_POINTS, now = Date.now() } = {}) {
  const status = roundStatus(round, now);
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  if (round.kind !== 'battle') {
    return { status, results: sorted.map((e, i) => ({ position: i + 1, name: e.name, steamId: e.steamId, score: e.score, points: pointsFor(i + 1, points) })) };
  }
  const br = bracket(sorted.map((e) => e.name), battles, round.bracket || 8);
  const results = br.placing
    ? br.placing.map((name, i) => ({ position: i + 1, name, score: (sorted.find((e) => norm(e.name) === norm(name)) || {}).score, points: pointsFor(i + 1, points) }))
    : [];
  return { status, qualifying: sorted, results, draw: br };
}

/** Overall standings: points of every round added up (ties: wins, then podiums). */
function standings(championship, rounds) {
  const table = {};
  rounds.forEach((r, i) => {
    for (const res of r.results || []) {
      const key = norm(res.name);
      const row = (table[key] = table[key] || { name: res.name, points: 0, wins: 0, podiums: 0, rounds: [] });
      row.points += res.points;
      if (res.position === 1) row.wins++;
      if (res.position <= 3) row.podiums++;
      row.rounds[i] = res.points;
    }
  });
  return Object.values(table).sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.name.localeCompare(b.name));
}

/** Admin input → clean championship list. */
function cleanChampionships(list) {
  const id = (v) => String(v || '').replace(/[^\w-]/g, '').slice(0, 6);
  const date = (v) => (Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  return (Array.isArray(list) ? list : []).slice(0, 20).map((c) => ({
    id: id(c.id) || Math.random().toString(36).slice(2, 8),
    name: String(c.name || 'Championnat').slice(0, 60),
    points: (Array.isArray(c.points) && c.points.length ? c.points : DEFAULT_POINTS).slice(0, 32).map((p) => Math.max(0, Math.min(1000, Number(p) || 0))),
    rounds: (Array.isArray(c.rounds) ? c.rounds : []).slice(0, 40).map((r) => ({
      id: id(r.id) || Math.random().toString(36).slice(2, 8),
      name: String(r.name || 'Manche').slice(0, 60),
      track: String(r.track || '').replace(/[^\w.-]/g, ''),
      layout: String(r.layout || '').replace(/[^\w.-]/g, ''),
      kind: ['drift', 'tandem', 'battle'].includes(r.kind) ? r.kind : 'drift',
      mode: ['debutant', 'normal', 'pro'].includes(r.mode) ? r.mode : 'normal',
      start: date(r.start) || new Date().toISOString(),
      end: date(r.end) || new Date(Date.now() + 7 * 86400000).toISOString(),
      bracket: [4, 8, 16, 32].includes(Number(r.bracket)) ? Number(r.bracket) : 8,
    })).filter((r) => r.track && Date.parse(r.end) > Date.parse(r.start)),
  }));
}

module.exports = { roundStatus, openRounds, pointsFor, seedOrder, bracket, roundResults, standings, cleanChampionships, DEFAULT_POINTS };
