'use strict';

/**
 * Défi de la semaine : chaque lundi (00:00 UTC) un défi tiré au sort de façon
 * déterministe, le même pour tous les launchers (et le bot) sans rien publier :
 * un circuit du groupe qui a un parcours, une notation, une note à atteindre.
 */

const WEEK = 7 * 86400000;
const MODES = ['normal', 'pro', 'debutant'];
const TARGET = { debutant: 80, normal: 72, pro: 62 };

/** Monday 00:00 UTC of the week containing `t`. */
function weekStart(t = Date.now()) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/**
 * The challenge of a week. tracks = [{ track, layout }] with a drift course,
 * in any order (sorted here so every PC picks the same one).
 */
function challengeOf(tracks, t = Date.now()) {
  const list = [...new Map(tracks.map((x) => [`${x.track}|${x.layout || ''}`, { track: x.track, layout: x.layout || '' }])).values()].sort((a, b) => `${a.track}|${a.layout}`.localeCompare(`${b.track}|${b.layout}`));
  if (!list.length) return null;
  const start = weekStart(t);
  const n = Math.round(start / WEEK);
  const h = hash(n);
  const pick = list[h % list.length];
  const mode = MODES[n % MODES.length];
  const target = TARGET[mode] + ((h >>> 8) % 7) - 3; // a bit different each week
  return { id: `w${n}`, ...pick, kind: 'drift', mode, target, start: new Date(start).toISOString(), end: new Date(start + WEEK).toISOString() };
}

module.exports = { challengeOf, weekStart, WEEK, TARGET };
