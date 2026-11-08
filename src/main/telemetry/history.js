'use strict';

/**
 * Progress history of this PC's driver: one small line per judged run (kept
 * when the passages are purged at the end of a session).
 * userData/telemetry/history.json = [{ d, t, l, c, k, s: { debutant, normal, pro }, miss: [clip names], n }]
 */

const fs = require('fs');
const path = require('path');
const { driftOf, MODE_IDS } = require('./drift');

const MAX = 20000;
const WEEK = 7 * 86400000;

class History {
  constructor(dir) {
    this.file = path.join(dir, 'telemetry', 'history.json');
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.items)) this.items = [];
    } catch {
      this.items = null; // never written: filled from the passages still on this PC
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.items));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  /** Summary line of a judged lap (null when it was not a drift run). */
  static entry(lap) {
    const kind = lap.tandem ? 'tandem' : 'drift';
    const s = {};
    for (const m of MODE_IDS) {
      const r = driftOf(lap, m, kind);
      if (r && Number.isFinite(r.score)) s[m] = r.score;
    }
    if (!Object.keys(s).length || !(Math.max(...Object.values(s)) > 0)) return null;
    const d = driftOf(lap, 'normal', 'drift') || {};
    const clips = Array.isArray(d.clips) ? d.clips : [];
    return {
      id: lap.id,
      d: lap.date,
      t: lap.track,
      l: lap.layout || '',
      c: lap.car,
      k: kind,
      s,
      n: clips.length,
      miss: clips.filter((c) => !c.hit).map((c) => c.name),
    };
  }

  add(lap) {
    const e = History.entry(lap);
    if (!e) return false;
    if (!this.items) this.items = [];
    if (this.items.some((x) => x.id === e.id)) this.items = this.items.filter((x) => x.id !== e.id);
    this.items.push(e);
    if (this.items.length > MAX) this.items = this.items.slice(-MAX);
    this.save();
    return true;
  }

  /** First use: the passages of this driver still on this PC. */
  seed(laps) {
    if (this.items) return;
    this.items = laps.map((l) => History.entry(l)).filter(Boolean).sort((a, b) => Date.parse(a.d) - Date.parse(b.d));
    this.save();
  }

  /**
   * Progress per track: weekly average and best (in the driver's notation),
   * last `weeks` weeks, and the clips missed most often.
   */
  progress({ mode = 'normal', weeks = 12, now = Date.now() } = {}) {
    const byTrack = new Map();
    for (const e of this.items || []) {
      if (e.k !== 'drift' || !Number.isFinite(e.s[mode])) continue;
      const key = `${e.t}|${e.l}`;
      const t = byTrack.get(key) || { track: e.t, layout: e.l, runs: 0, weeks: Array.from({ length: weeks }, (_, i) => ({ from: now - (weeks - i) * WEEK, n: 0, sum: 0, best: 0 })), clips: new Map(), last: null };
      t.runs++;
      t.last = !t.last || Date.parse(e.d) > Date.parse(t.last) ? e.d : t.last;
      const w = t.weeks.find((x) => Date.parse(e.d) >= x.from && Date.parse(e.d) < x.from + WEEK);
      if (w) {
        w.n++;
        w.sum += e.s[mode];
        w.best = Math.max(w.best, e.s[mode]);
      }
      if (e.n) {
        for (const name of e.miss || []) t.clips.set(name, (t.clips.get(name) || 0) + 1);
        t.clipRuns = (t.clipRuns || 0) + 1;
      }
      byTrack.set(key, t);
    }
    return [...byTrack.values()]
      .sort((a, b) => Date.parse(b.last) - Date.parse(a.last))
      .map((t) => ({
        track: t.track,
        layout: t.layout,
        runs: t.runs,
        last: t.last,
        weeks: t.weeks.map((w) => ({ from: new Date(w.from).toISOString(), runs: w.n, avg: w.n ? Math.round((w.sum / w.n) * 10) / 10 : null, best: w.n ? w.best : null })),
        missed: [...t.clips.entries()].map(([name, n]) => ({ name, missed: n, rate: Math.round((n / (t.clipRuns || 1)) * 100) })).sort((a, b) => b.missed - a.missed).slice(0, 6),
      }));
  }
}

module.exports = { History };
