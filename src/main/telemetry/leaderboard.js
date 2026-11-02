'use strict';

/**
 * Shared leaderboard on a free Supabase project (Postgres + REST), set up once
 * by an admin with docs/leaderboard.sql. Each driver keeps one entry per
 * car / track / layout / kind (best time or best drift score); the database
 * function only replaces it with a better one.
 */

const zlib = require('zlib');

const MAX_SAMPLES = 1500;

function downsample(samples, max = MAX_SAMPLES) {
  if (samples.length <= max) return samples;
  const out = [];
  const step = (samples.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(samples[Math.round(i * step)]);
  return out;
}

const packSamples = (samples) => zlib.gzipSync(JSON.stringify(downsample(samples))).toString('base64');
const unpackSamples = (b64) => JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));

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

  /** Send a lap: kept only if it beats the driver's previous record. */
  submit(lap, kind) {
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
        p_score: kind === 'drift' ? lap.drift.score : null,
        p_samples: packSamples(lap.samples),
        p_meta: { lapMs: lap.lapMs, topSpeed: lap.topSpeed, drift: lap.drift, session: lap.session, date: lap.date },
      }),
    });
  }

  list({ track, layout = '', car, kind = 'time', limit = 50 }) {
    const q = new URLSearchParams({ select: 'id,steam_id,driver,car,track,layout,kind,lap_ms,score,meta,created_at', track: `eq.${track}`, layout: `eq.${layout}`, kind: `eq.${kind}`, order: kind === 'time' ? 'lap_ms.asc' : 'score.desc', limit: String(limit) });
    if (car) q.set('car', `eq.${car}`);
    return this.request(`/rest/v1/lks_laps?${q}`);
  }

  async lap(id) {
    const rows = await this.request(`/rest/v1/lks_laps?${new URLSearchParams({ select: '*', id: `eq.${Number(id)}` })}`);
    if (!rows || !rows[0]) throw new Error('Tour introuvable');
    const r = rows[0];
    const meta = r.meta || {};
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
      drift: meta.drift || { score: r.score || 0 },
      date: r.created_at,
      samples: unpackSamples(r.samples),
    };
  }
}

module.exports = { Leaderboard, packSamples, unpackSamples, downsample };
