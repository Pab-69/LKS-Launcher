'use strict';

/**
 * Shared leaderboard on a free Supabase project (Postgres + REST), set up once
 * by an admin with docs/leaderboard.sql. Each driver keeps one entry per
 * car / track / layout / kind (best time or best drift score); the database
 * function only replaces it with a better one.
 */

const zlib = require('zlib');
const { driftOf } = require('./drift');

const FOLLOWER_COLS = 14; // tandem rows = follower columns + lead columns

const MAX_SAMPLES = 1500;

function downsample(samples, max = MAX_SAMPLES) {
  if (samples.length <= max) return samples;
  const out = [];
  const step = (samples.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(samples[Math.round(i * step)]);
  return out;
}

const packSamples = (samples, ghost, green) => zlib.gzipSync(JSON.stringify(ghost ? { v: 2, s: downsample(samples), g: downsample(ghost, 3000), ...(Number.isFinite(green) ? { gr: green } : {}) } : downsample(samples))).toString('base64');
/** Samples of a shared lap (and its ghost rows, when there is one). */
function unpackLap(b64) {
  const data = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
  return Array.isArray(data) ? { samples: data, ghost: null } : { samples: data.s || [], ghost: data.g || null, green: Number.isFinite(data.gr) ? data.gr : null };
}
const unpackSamples = (b64) => unpackLap(b64).samples;

class Leaderboard {
  constructor({ url, anonKey, fetchImpl }) {
    if (!/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(url || '') && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url || '')) throw new Error('Adresse Supabase invalide');
    if (!anonKey) throw new Error('Clé Supabase manquante');
    this.url = url.replace(/\/$/, '');
    this.key = anonKey;
    this.fetch = fetchImpl || fetch;
  }

  headers(extra = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra };
  }

  async request(path, init = {}) {
    const res = await this.fetch(`${this.url}${path}`, { ...init, headers: this.headers(init.headers) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).message || text;
      } catch {
        /* raw */
      }
      throw new Error(`Classement indisponible (${res.status}) : ${String(msg).slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  /**
   * Send a lap: kept only if it beats the driver's previous record.
   * kind 'time' | 'drift' | 'tandem' ; mode for judged runs (debutant, normal, pro).
   */
  submit(lap, kind, mode = 'normal', rules) {
    const res = kind === 'time' ? null : driftOf(lap, mode, kind);
    if (kind !== 'time' && !res) throw new Error('Run non notée');
    let samples = lap.samples;
    if (kind === 'tandem') {
      const pad = (r) => [...r, ...new Array(Math.max(0, FOLLOWER_COLS - r.length)).fill(0)].slice(0, FOLLOWER_COLS);
      samples = lap.samples.map((r, i) => [...pad(r), ...lap.tandem.leadSamples[i]]);
    }
    const meta = { lapMs: lap.lapMs, topSpeed: lap.topSpeed, session: lap.session, date: lap.date, mode };
    const ghost = kind !== 'tandem' && lap.ghost && Array.isArray(lap.ghost.rows) ? lap.ghost.rows : null;
    if (ghost) meta.ghost = true;
    if (kind === 'drift') meta.drift = res;
    if (kind === 'tandem') Object.assign(meta, { tandem: res, lead: lap.tandem.lead });
    return this.request('/rest/v1/rpc/submit_lap', {
      method: 'POST',
      body: JSON.stringify({
        p_steam_id: String(lap.driver.steamId || lap.driver.name).slice(0, 32),
        p_driver: String(lap.driver.name).slice(0, 40),
        p_car: lap.car,
        p_track: lap.track,
        p_layout: lap.layout || '',
        p_kind: kind,
        p_lap_ms: kind === 'time' ? lap.lapMs : null,
        p_score: res ? res.score : null,
        p_rules: rules || (res ? res.rules || '' : ''),
        p_samples: packSamples(samples, ghost, ghost ? lap.ghost.green : undefined),
        p_meta: meta,
      }),
    });
  }

  /** A battle (one row per mode); rules can carry a championship round (version@round). */
  submitBattle(battle, mode = 'normal', rules) {
    const res = battle.modes[mode];
    const [a, b] = res.drivers;
    return this.request('/rest/v1/rpc/submit_lap', {
      method: 'POST',
      body: JSON.stringify({
        p_steam_id: `b-${battle.id}`.slice(0, 32),
        p_driver: `${a.name} vs ${b.name}`.slice(0, 40),
        p_car: battle.cars[a.name] || Object.values(battle.cars)[0] || '?',
        p_track: battle.track,
        p_layout: battle.layout || '',
        p_kind: 'battle',
        p_lap_ms: null,
        p_score: Math.max(0.1, Math.max(a.total, b.total)),
        p_rules: rules || res.rules,
        p_samples: '',
        p_meta: { mode, battle: { id: battle.id, date: battle.date, pair: battle.pair, cars: battle.cars, runs: battle.runs, result: res } },
      }),
    });
  }

  /** Shared battles of a track (in a mode / round). */
  async battles({ track, layout = '', rules, limit = 100 }) {
    const rows = await this.list({ track, layout, kind: 'battle', rules, limit });
    return (rows || []).filter((r) => r.meta && r.meta.battle).map((r) => {
      const b = r.meta.battle;
      return { id: b.id, remote: true, track: r.track, layout: r.layout, date: b.date || r.created_at, pair: b.pair, cars: b.cars || {}, runs: b.runs || [], modes: { [r.meta.mode || 'normal']: b.result } };
    });
  }

  list({ track, layout = '', car, kind = 'time', rules = '', limit = 50 }) {
    const q = new URLSearchParams({ select: 'id,steam_id,driver,car,track,layout,kind,rules,lap_ms,score,meta,created_at', track: `eq.${track}`, layout: `eq.${layout}`, kind: `eq.${kind}`, rules: `eq.${kind === 'time' ? '' : rules}`, order: kind === 'time' ? 'lap_ms.asc' : 'score.desc', limit: String(limit) });
    if (car) q.set('car', `eq.${car}`);
    return this.request(`/rest/v1/lks_laps?${q}`);
  }

  async lap(id) {
    const rows = await this.request(`/rest/v1/lks_laps?${new URLSearchParams({ select: '*', id: `eq.${Number(id)}` })}`);
    if (!rows || !rows[0]) throw new Error('Tour introuvable');
    const r = rows[0];
    const meta = r.meta || {};
    const mode = meta.mode || 'normal';
    const unpacked = unpackLap(r.samples);
    let samples = unpacked.samples;
    let tandem;
    if (r.kind === 'tandem') {
      tandem = { lead: meta.lead || { name: '?', car: '' }, leadSamples: samples.map((x) => x.slice(FOLLOWER_COLS)), ...(meta.tandem || {}), modes: { [mode]: meta.tandem || { score: Number(r.score) } } };
      samples = samples.map((x) => x.slice(0, FOLLOWER_COLS));
    }
    const drift = meta.drift ? { ...meta.drift, modes: { [mode]: meta.drift } } : { score: 0 };
    return {
      version: 1,
      id: `remote-${r.id}`,
      remote: true,
      driver: { name: r.driver, steamId: r.steam_id },
      car: r.car,
      track: r.track,
      layout: r.layout,
      session: meta.session || 'unknown',
      lapMs: r.lap_ms || meta.lapMs || 0,
      valid: true,
      topSpeed: meta.topSpeed || 0,
      drift,
      tandem,
      ghost: unpacked.ghost ? { rows: unpacked.ghost, ...(unpacked.green !== null && unpacked.green !== undefined ? { green: unpacked.green } : {}) } : undefined,
      mode,
      date: r.created_at,
      samples,
    };
  }
}

module.exports = { Leaderboard, packSamples, unpackSamples, unpackLap, downsample };
