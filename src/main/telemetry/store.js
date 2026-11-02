'use strict';

/**
 * Lap storage on this PC: userData/telemetry/laps/<id>.json.gz + an index of
 * summaries (without samples) for fast lists and leaderboards.
 * Laps can be exported to a .lkslap file and imported by another driver.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { driftOf, MODE_IDS } = require('./drift');

const MAX_PER_COMBO = 40; // keep the bests + the most recent laps

function summary(lap) {
  const { samples, columns, ...rest } = lap;
  if (rest.tandem) {
    const { leadSamples, ...tandem } = rest.tandem;
    rest.tandem = tandem;
  }
  return { ...rest, samples: samples ? samples.length : 0 };
}

function validLap(lap) {
  return (
    lap &&
    lap.version === 1 &&
    typeof lap.id === 'string' &&
    /^[\w-]{4,40}$/.test(lap.id) &&
    typeof lap.car === 'string' &&
    typeof lap.track === 'string' &&
    Number.isFinite(lap.lapMs) &&
    Array.isArray(lap.samples) &&
    lap.samples.length >= 20 &&
    lap.samples.length <= 20000 &&
    lap.samples.every((r) => Array.isArray(r) && r.length >= 9 && r.every((v) => typeof v === 'number' && Number.isFinite(v)))
  );
}

/**
 * Judged result of a lap for a leaderboard: kind 'drift' or 'tandem' in a mode,
 * only when judged with the same course and rules (version).
 */
function resultOf(l, kind, mode = 'normal', rules) {
  const res = driftOf(l, mode, kind);
  if (!res || !(res.score > 0)) return null;
  if (rules !== undefined && (res.rules || '') !== rules) return null;
  return res;
}

const comboKey = (l) => `${l.car}|${l.track}|${l.layout || ''}`;

class LapStore {
  constructor(dir) {
    this.dir = path.join(dir, 'telemetry', 'laps');
    this.indexFile = path.join(dir, 'telemetry', 'index.json');
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      this.index = [];
    }
  }

  saveIndex() {
    fs.writeFileSync(`${this.indexFile}.tmp`, JSON.stringify(this.index));
    fs.renameSync(`${this.indexFile}.tmp`, this.indexFile);
  }

  file(id) {
    if (!/^[\w-]{4,40}$/.test(id)) throw new Error('Identifiant de tour invalide');
    return path.join(this.dir, `${id}.json.gz`);
  }

  save(lap, { imported = false } = {}) {
    if (!validLap(lap)) throw new Error('Tour invalide');
    fs.writeFileSync(this.file(lap.id), zlib.gzipSync(JSON.stringify(lap)));
    this.index = this.index.filter((l) => l.id !== lap.id);
    this.index.push({ ...summary(lap), imported });
    this.prune(comboKey(lap));
    this.saveIndex();
    return summary(lap);
  }

  /** Keep each driver's best time and best drift lap + the latest laps per combo. */
  prune(key) {
    const laps = this.index.filter((l) => comboKey(l) === key);
    if (laps.length <= MAX_PER_COMBO) return;
    const keep = new Set();
    const byDriver = {};
    for (const l of laps) (byDriver[l.driver.steamId || l.driver.name] = byDriver[l.driver.steamId || l.driver.name] || []).push(l);
    for (const list of Object.values(byDriver)) {
      const bestTime = list.filter((l) => l.valid).sort((a, b) => a.lapMs - b.lapMs)[0];
      if (bestTime) keep.add(bestTime.id);
      for (const kind of ['drift', 'tandem']) {
        for (const mode of MODE_IDS) {
          const best = list.filter((l) => resultOf(l, kind, mode)).sort((a, b) => resultOf(b, kind, mode).score - resultOf(a, kind, mode).score)[0];
          if (best) keep.add(best.id);
        }
      }
    }
    laps.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, MAX_PER_COMBO).forEach((l) => keep.add(l.id));
    for (const l of laps) {
      if (keep.has(l.id)) continue;
      fs.rmSync(this.file(l.id), { force: true });
      this.index = this.index.filter((x) => x.id !== l.id);
    }
  }

  load(id) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(this.file(id))).toString('utf8'));
  }

  remove(id) {
    fs.rmSync(this.file(id), { force: true });
    this.index = this.index.filter((l) => l.id !== id);
    this.saveIndex();
  }

  list(filter = {}) {
    return this.index
      .filter((l) => (!filter.car || l.car === filter.car) && (!filter.track || l.track === filter.track) && (filter.layout === undefined || (l.layout || '') === filter.layout))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  /**
   * Best valid lap (time) or best judged run (drift / tandem, in a mode) for a
   * combo, optionally for one driver. Judged runs come with `result`.
   */
  best({ car, track, layout = '', kind = 'time', mode = 'normal', steamId, rules } = {}) {
    const laps = this.list({ car, track, layout }).filter((l) => !steamId || l.driver.steamId === steamId);
    if (kind === 'time') return laps.filter((l) => l.valid).sort((a, b) => a.lapMs - b.lapMs)[0] || null;
    const judged = laps.map((l) => ({ ...l, result: resultOf(l, kind, mode, rules) })).filter((l) => l.result);
    return judged.sort((a, b) => b.result.score - a.result.score)[0] || null;
  }

  /** Leaderboard from the laps on this PC (own + imported): best per driver. */
  leaderboard({ track, layout = '', car, kind = 'time', mode = 'normal', rules }) {
    const best = {};
    for (const l of this.list({ track, layout, car })) {
      if (kind === 'time' && !l.valid) continue;
      const result = kind === 'time' ? null : resultOf(l, kind, mode, rules);
      if (kind !== 'time' && !result) continue;
      const key = l.driver.steamId || l.driver.name;
      const better = !best[key] || (kind === 'time' ? l.lapMs < best[key].lapMs : result.score > best[key].result.score);
      if (better) best[key] = result ? { ...l, result } : l;
    }
    return Object.values(best).sort((a, b) => (kind === 'time' ? a.lapMs - b.lapMs : b.result.score - a.result.score));
  }

  export(id) {
    return zlib.gzipSync(JSON.stringify(this.load(id)));
  }

  import(buffer) {
    let lap;
    try {
      lap = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
    } catch {
      throw new Error("Ce fichier n'est pas un tour LKS");
    }
    if (!validLap(lap)) throw new Error("Ce fichier n'est pas un tour LKS valide");
    return this.save(lap, { imported: true });
  }
}

module.exports = { LapStore, validLap, comboKey, resultOf };
