'use strict';

/**
 * Group features stored on the leaderboard's Supabase project (docs/leaderboard.sql):
 *  - proposals: members propose a car, a livery or a setup (file in the
 *    « lks-proposals » storage, or a download link for big files); the admins
 *    accept or refuse them in Publication (decision in the manifest);
 *  - presence: who has the launcher open, who is driving, on which server.
 */

const crypto = require('crypto');

const BUCKET = 'lks-proposals';
const GALLERY = 'lks-gallery';
const MAX_PHOTO = 10 * 1024 * 1024;
const MAX_UPLOAD = 50 * 1024 * 1024; // Supabase free plan: 50 MB per file
const KINDS = ['car', 'skin', 'setup'];

class Community {
  constructor({ url, anonKey, fetchImpl }) {
    if (!/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(url || '') && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url || '')) throw new Error('Adresse du serveur invalide');
    if (!anonKey) throw new Error('Clé du serveur manquante');
    this.url = url.replace(/\/$/, '');
    this.key = anonKey;
    this.fetch = fetchImpl || fetch;
  }

  async request(path, init = {}) {
    const res = await this.fetch(`${this.url}${path}`, {
      ...init,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).message || text;
      } catch {
        /* raw */
      }
      if (res.status === 404) msg = 'pas encore installé (les admins doivent relancer le script SQL du serveur)';
      throw new Error(`${String(msg).slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  // ------------------------------------------------------------ proposals
  /** Upload a zip (Buffer) for a proposal. Returns its storage path. */
  async upload(id, zip) {
    if (zip.length > MAX_UPLOAD) throw new Error('Fichier trop gros pour l’envoi direct (50 Mo max) : donne un lien de téléchargement');
    const file = `v1/${id}.zip`;
    await this.request(`/storage/v1/object/${BUCKET}/${file}`, { method: 'POST', body: zip, headers: { 'Content-Type': 'application/zip', 'x-upsert': 'false' } });
    return file;
  }

  /** p = { kind, car, skin, track, title, author, message, link, zip? } (no Steam ID: only the name the member chose) */
  async propose(p) {
    if (!KINDS.includes(p.kind)) throw new Error('Type de proposition inconnu');
    const id = crypto.randomUUID();
    let file = '';
    if (p.zip) file = await this.upload(id, p.zip);
    if (!file && !/^https:\/\/\S{4,}$/.test(p.link || '')) throw new Error('Il faut un fichier ou un lien https://');
    await this.request('/rest/v1/rpc/submit_proposal', {
      method: 'POST',
      body: JSON.stringify({
        p_id: id,
        p_kind: p.kind,
        p_car: p.car,
        p_skin: p.skin || '',
        p_track: p.track || '',
        p_title: String(p.title || p.car).slice(0, 80),
        p_author: String(p.author || 'Pilote').slice(0, 40),
        p_message: String(p.message || '').slice(0, 600),
        p_link: file ? '' : p.link,
        p_file: file,
        p_size: p.zip ? p.zip.length : 0,
      }),
    });
    return id;
  }

  async proposals() {
    const rows = await this.request('/rest/v1/lks_proposals_list?select=*&order=created_at.desc&limit=200');
    return (rows || []).map((r) => ({
      id: r.id,
      kind: r.kind,
      car: r.car,
      skin: r.skin,
      track: r.track,
      title: r.title,
      author: r.author,
      message: r.message,
      link: r.link,
      size: Number(r.size) || 0,
      download: r.file ? `${this.url}/storage/v1/object/public/${BUCKET}/${r.file}` : r.link,
      direct: Boolean(r.file),
      date: r.created_at,
      up: Number(r.up) || 0,
      down: Number(r.down) || 0,
    }));
  }

  /** Vote on a proposal: 1, -1, or 0 to take the vote back (one per launcher). */
  vote(proposalId, voter, secret, value) {
    if (![-1, 0, 1].includes(value)) throw new Error('Vote invalide');
    return this.request('/rest/v1/rpc/vote_proposal', { method: 'POST', body: JSON.stringify({ p_proposal: proposalId, p_voter: voter, p_secret: secret, p_value: value }) });
  }

  // ------------------------------------------------------------ runs and live (judges)
  /** Note of a finished run: r = { id, driver, car, track, layout, kind, score, detail } */
  addRun(r) {
    return this.request('/rest/v1/rpc/add_run', {
      method: 'POST',
      body: JSON.stringify({ p_id: r.id, p_driver: String(r.driver || 'Pilote').slice(0, 40), p_car: r.car || '', p_track: r.track, p_layout: r.layout || '', p_kind: r.kind === 'tandem' ? 'tandem' : 'drift', p_score: Math.max(0, Math.min(100, Math.round((Number(r.score) || 0) * 10) / 10)), p_detail: r.detail || {} }),
    });
  }

  async runs({ track, layout, since, driver, kind, limit = 60 } = {}) {
    const q = new URLSearchParams({ select: '*', order: 'created_at.desc', limit: String(limit) });
    if (driver) q.set('driver', `ilike.${String(driver).replace(/[*%,()]/g, '').trim()}`);
    if (kind) q.set('kind', `eq.${kind}`);
    if (track) q.set('track', `eq.${track}`);
    if (track && layout !== undefined) q.set('layout', `eq.${layout}`);
    if (since) q.set('created_at', `gte.${since}`);
    const rows = await this.request(`/rest/v1/lks_runs_list?${q}`);
    return (rows || []).map((r) => ({ id: r.id, driver: r.driver, car: r.car, track: r.track, layout: r.layout, kind: r.kind, score: Number(r.score), detail: r.detail || {}, date: r.created_at }));
  }

  /** Live state of this driver during an evening (every 1-2 s). */
  setLive(p) {
    return this.request('/rest/v1/rpc/set_live', { method: 'POST', body: JSON.stringify({ p_id: p.id, p_secret: p.secret, p_name: String(p.name || 'Pilote').slice(0, 40), p_car: p.car || '', p_track: p.track || '', p_layout: p.layout || '', p_data: p.data || {} }) });
  }

  async live() {
    const rows = await this.request('/rest/v1/lks_live_now?select=*&order=name.asc&limit=40');
    return (rows || []).map((r) => ({ id: r.id, name: r.name, car: r.car, track: r.track, layout: r.layout, data: r.data || {}, updatedAt: r.updated_at }));
  }

  // ------------------------------------------------------------ driver categories
  /** Category of every driver (set by the server from the best notes): [{ name, category, avg, runs, updatedAt }] */
  async categories() {
    const rows = await this.request('/rest/v1/lks_categories_list?select=*&limit=1000');
    const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
    return (rows || []).map((r) => ({
      name: r.name,
      category: ['debutant', 'amateur', 'pro'].includes(r.category) ? r.category : 'debutant',
      avg: Number(r.avg) || 0,
      runs: Number(r.runs) || 0,
      updatedAt: r.updated_at,
      // since 1.29 (server): every run counts, rolling window of the last runs
      since: num(r.since),
      up: num(r.up),
      down: num(r.down),
      window: num(r.window_size),
      minRuns: num(r.min_runs),
      scores: Array.isArray(r.scores) ? r.scores.map(num) : null,
    }));
  }

  // ------------------------------------------------------------ battles launched in game
  /** This PC's driver notes for a battle: { tag, driver, opponent, parts: { mode: { lead, chase } } } */
  addBattlePart(p) {
    const parts = {};
    for (const [mode, v] of Object.entries(p.parts || {})) {
      if (!['debutant', 'normal', 'pro'].includes(mode)) continue;
      parts[mode] = { lead: Math.max(0, Math.min(100, Number(v.lead) || 0)), chase: Math.max(0, Math.min(100, Number(v.chase) || 0)) };
    }
    return this.request('/rest/v1/rpc/add_battle_part', {
      method: 'POST',
      body: JSON.stringify({ p_tag: String(p.tag).slice(0, 24), p_driver: String(p.driver || 'Pilote').slice(0, 40), p_opponent: String(p.opponent || '').slice(0, 40), p_parts: parts }),
    });
  }

  async battleParts(tag) {
    const q = new URLSearchParams({ select: 'tag,driver,opponent,parts,created_at', tag: `eq.${String(tag).slice(0, 24)}`, limit: '10' });
    const rows = await this.request(`/rest/v1/lks_battle_parts_list?${q}`);
    return (rows || []).map((r) => ({ tag: r.tag, driver: r.driver, opponent: r.opponent, parts: r.parts || {}, date: r.created_at }));
  }

  // ------------------------------------------------------------ gallery
  /** p = { image: Buffer, ext: jpg|png|webp, author, caption, car, track } */
  async addPhoto(p) {
    if (!['jpg', 'png', 'webp'].includes(p.ext)) throw new Error('Image JPEG, PNG ou WebP seulement');
    if (!p.image || p.image.length > MAX_PHOTO) throw new Error('Image trop grosse (10 Mo max)');
    const id = crypto.randomUUID();
    const file = `v1/${id}.${p.ext}`;
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[p.ext];
    await this.request(`/storage/v1/object/${GALLERY}/${file}`, { method: 'POST', body: p.image, headers: { 'Content-Type': type, 'x-upsert': 'false' } });
    await this.request('/rest/v1/rpc/add_photo', { method: 'POST', body: JSON.stringify({ p_id: id, p_file: file, p_author: String(p.author || 'Pilote').slice(0, 40), p_caption: String(p.caption || '').slice(0, 200), p_car: p.car || '', p_track: p.track || '' }) });
    return id;
  }

  async photos() {
    const rows = await this.request('/rest/v1/lks_photos_list?select=*&limit=120');
    return (rows || []).map((r) => ({ id: r.id, url: `${this.url}/storage/v1/object/public/${GALLERY}/${r.file}`, author: r.author, caption: r.caption, car: r.car, track: r.track, date: r.created_at }));
  }

  // ------------------------------------------------------------ presence
  /** p = { id, secret, name, state: launcher|solo|online|hosting, server: { name, ip, port, httpPort }, car, track, layout } */
  setPresence(p) {
    let server = {};
    if (p.server && p.server.ip) server = { name: String(p.server.name || '').slice(0, 60), ip: String(p.server.ip).slice(0, 64), port: Number(p.server.port) || 0, httpPort: Number(p.server.httpPort) || 0 };
    else if (p.server && p.server.hostId) server = { name: String(p.server.name || '').slice(0, 60), hostId: String(p.server.hostId).slice(0, 64) };
    return this.request('/rest/v1/rpc/set_presence', {
      method: 'POST',
      body: JSON.stringify({ p_id: p.id, p_secret: p.secret, p_name: String(p.name || 'Pilote').slice(0, 40), p_state: p.state, p_server: server, p_car: p.car || '', p_track: p.track || '', p_layout: p.layout || '' }),
    });
  }

  removePresence(id, secret) {
    return this.request('/rest/v1/rpc/remove_presence', { method: 'POST', body: JSON.stringify({ p_id: id, p_secret: secret }) });
  }

  async presence() {
    const rows = await this.request('/rest/v1/lks_presence_live?select=*&order=updated_at.desc&limit=100');
    return (rows || []).map((r) => ({ id: r.id, name: r.name, state: r.state, server: r.server && (r.server.ip || r.server.hostId) ? r.server : null, car: r.car, track: r.track, layout: r.layout, updatedAt: r.updated_at }));
  }
}

/** Status of a proposal from the admins' decisions (manifest.proposals). */
function decisionOf(manifest, id) {
  const d = manifest && manifest.proposals && manifest.proposals[id];
  return d && ['accepted', 'refused'].includes(d.status) ? d : { status: 'pending' };
}

module.exports = { Community, decisionOf, MAX_UPLOAD, MAX_PHOTO, KINDS };
