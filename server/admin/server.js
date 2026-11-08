'use strict';

/**
 * Administration from the showcase site: soirées (events) and news, written in
 * the group's manifest on GitHub exactly like the launcher's Publication page
 * does (same championship « Soirées LKS », same Discord announcement).
 *
 *   GET    /admin/api/public            group data for the site (no secret)
 *   POST   /admin/api/login             { name, password } -> { token }
 *   POST   /admin/api/logout
 *   GET    /admin/api/me
 *   POST   /admin/api/news              { title, body }
 *   DELETE /admin/api/news?date=<iso>
 *   PUT    /admin/api/events/<id>       the event (created or replaced)
 *   DELETE /admin/api/events/<id>
 *   PUT    /admin/api/championships/<id> { name, season, points, rounds }
 *   DELETE /admin/api/championships/<id>
 *   POST   /admin/api/discord/<news|reports>   relay to the group's Discord webhooks (launchers never see them)
 *
 * The GitHub token stays on the server (never sent to the browser). Admins:
 * file ADMINS_FILE, one « name:scrypt$salt$hash » per line (./lks.sh add-admin).
 * No log, no IP kept. No dependency: Node.js 18 or newer.
 */

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
// Optional: with DATABASE_URL (and the « pg » package, installed in the Docker image) the group's data
// lives in the server's database and is pushed live. Without it, everything stays on GitHub as before.
const Pool = (() => {
  try {
    return require('pg').Pool;
  } catch {
    return null;
  }
})();
const Client = (() => {
  try {
    return require('pg').Client;
  } catch {
    return null;
  }
})();
const champ = (() => {
  try {
    return require('./championship');
  } catch {
    return require('../../src/main/telemetry/championship');
  }
})();

const PORT = Number(process.env.PORT) || 8090;
const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_ON = Boolean(DATABASE_URL || process.env.PGHOST); // or PGHOST/PGUSER/PGPASSWORD/PGDATABASE
const dbConfig = () => (DATABASE_URL ? { connectionString: DATABASE_URL } : {});
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.CONTENT_REPO || 'Pab-69/LKS-Launcher';
const TAG = process.env.CONTENT_TAG || 'content';
const ADMINS_FILE = process.env.ADMINS_FILE || '/app/admins';
const API = (process.env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const UPLOADS = (process.env.GITHUB_UPLOADS || 'https://uploads.github.com').replace(/\/$/, '');
const ORIGINS = String(process.env.SITE_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const SESSION_MS = 8 * 3600000;
const MANIFEST = 'manifest.json';

// ------------------------------------------------------------------ GitHub
async function gh(method, url, { body, type, raw } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: {
      'User-Agent': 'LKS-admin',
      Accept: raw ? 'application/octet-stream' : 'application/vnd.github+json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(type ? { 'Content-Type': type } : {}),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(res.status === 401 || res.status === 403 ? 'Jeton GitHub refusé (vérifie GITHUB_TOKEN dans .env)' : `GitHub ${res.status} : ${text.slice(0, 160)}`);
    err.status = 502;
    throw err;
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  return res.status === 204 ? null : res.json();
}

async function openGithub() {
  const release = await gh('GET', `/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`);
  const assets = await gh('GET', `/repos/${REPO}/releases/${release.id}/assets?per_page=100`);
  const asset = assets.find((a) => a.name === MANIFEST);
  if (!asset) throw Object.assign(new Error('Manifeste introuvable : publie d’abord du contenu depuis le launcher'), { status: 502 });
  const manifest = JSON.parse((await gh('GET', `/repos/${REPO}/releases/assets/${asset.id}`, { raw: true })).toString('utf8'));
  return { release, assets, asset, manifest };
}

/** Upload under a temporary name, then swap: launchers never see a missing manifest for long. */
async function saveGithub(state, manifest, by, actions) {
  const date = new Date().toISOString();
  manifest.updatedAt = date;
  manifest.history = [...actions.map((action) => ({ date, by, action })).reverse(), ...(Array.isArray(manifest.history) ? manifest.history : [])].slice(0, 100);
  const tmpName = `manifest-${Date.now().toString(36)}.json`;
  for (const old of state.assets.filter((a) => /^manifest-[a-z0-9]+\.json$/.test(a.name))) await gh('DELETE', `/repos/${REPO}/releases/assets/${old.id}`).catch(() => {});
  const uploaded = await gh('POST', `${UPLOADS}/repos/${REPO}/releases/${state.release.id}/assets?name=${tmpName}`, { body: Buffer.from(JSON.stringify(manifest, null, 2)), type: 'application/json' });
  await gh('DELETE', `/repos/${REPO}/releases/assets/${state.asset.id}`);
  await gh('PATCH', `/repos/${REPO}/releases/assets/${uploaded.id}`, { body: JSON.stringify({ name: MANIFEST }), type: 'application/json' });
  cache = { at: Date.now(), manifest };
}

// one write at a time
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};


// ------------------------------------------------------------------ live data (database)
// Everything in the manifest except what is published from the launcher (cars, tracks, branding, setups)
// lives in the table lks_manifest. Launchers and the site read it from here and are told of every change
// through the SSE stream; GitHub keeps a mirror (old launchers, the bot, a safety copy).
const OWNED = new Set(['cars', 'tracks', 'branding', 'setups']);
const PATCH_KEYS = new Set(['servers', 'news', 'name', 'motd', 'csp', 'showcase', 'donate', 'shop', 'events', 'soloPresets', 'discord', 'vpn', 'leaderboard', 'drift', 'championships', 'allowAllContent', 'proposals', 'judging', 'galleryHidden']);
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

function splitManifest(m) {
  const meta = {};
  const owned = {};
  for (const [k, v] of Object.entries(m || {})) (OWNED.has(k) ? owned : meta)[k] = v;
  return { meta, owned };
}
const mergeManifest = (meta, owned) => ({ ...meta, ...owned });

const pool = Pool && DB_ON ? new Pool({ ...dbConfig(), max: 3, idleTimeoutMillis: 30000 }) : null;
if (pool) pool.on('error', () => {});

async function githubManifest() {
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/download/${encodeURIComponent(TAG)}/${MANIFEST}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) return await res.json();
  } catch {
    /* fall through to the API (private repository) */
  }
  return (await openGithub()).manifest;
}

let ownedCache = { at: 0, owned: {}, digest: '' };
async function ownedFromGithub(force) {
  if (!force && ownedCache.at && Date.now() - ownedCache.at < 60000) return ownedCache.owned;
  try {
    const { owned } = splitManifest(await githubManifest());
    const digest = sha(stable(owned));
    const changed = ownedCache.digest && ownedCache.digest !== digest;
    ownedCache = { at: Date.now(), owned, digest };
    if (changed) await pool.query("select pg_notify('lks', '{\"t\":\"manifest\"}')").catch(() => {});
  } catch (err) {
    if (!ownedCache.at) throw err;
    ownedCache.at = Date.now() - 30000; // GitHub unreachable: keep the last copy, try again in 30 s
  }
  return ownedCache.owned;
}

async function loadMeta() {
  const r = await pool.query('select data, rev from public.lks_manifest where id = 1');
  if (r.rows[0]) return r.rows[0];
  // first start: the group's current data is taken from the manifest on GitHub
  const { meta } = splitManifest(await githubManifest());
  await pool.query('insert into public.lks_manifest (id, data, rev) values (1, $1, 1) on conflict (id) do nothing', [meta]);
  return (await pool.query('select data, rev from public.lks_manifest where id = 1')).rows[0];
}

async function openManifest() {
  if (!pool) return openGithub();
  const [{ data, rev }, owned] = await Promise.all([loadMeta(), ownedFromGithub()]);
  return { manifest: mergeManifest(data, owned), rev };
}

async function saveManifest(state, manifest, by, actions) {
  if (!pool) return saveGithub(state, manifest, by, actions);
  const { meta } = splitManifest(manifest);
  const date = new Date().toISOString();
  meta.updatedAt = date;
  meta.history = [...actions.map((action) => ({ date, by, action })).reverse(), ...(Array.isArray(meta.history) ? meta.history : [])].slice(0, 100);
  await pool.query('update public.lks_manifest set data = $1, rev = rev + 1, updated_at = now() where id = 1', [meta]);
  scheduleMirror();
}

let mirrorTimer = null;
function scheduleMirror() {
  if (!TOKEN) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => mirror().catch((err) => console.error(`miroir GitHub : ${err.message}`)), 3000);
}
async function mirror() {
  return serial(async () => {
    const { data } = await loadMeta();
    const st = await openGithub();
    if (stable(splitManifest(st.manifest).meta) === stable(publicManifest(data))) return;
    const next = {};
    for (const [k, v] of Object.entries(st.manifest)) if (OWNED.has(k)) next[k] = v;
    await saveGithub(st, { ...next, ...publicManifest(data) }, 'serveur', []);
  });
}

// GitHub admins (launcher): a personal token with write access to the content repository
const ghAdmins = new Map(); // sha(token) -> { login, exp }
async function githubAdmin(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Connexion requise'), { status: 401 });
  const key = sha(token);
  const known = ghAdmins.get(key);
  if (known && known.exp > Date.now()) return known;
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'LKS-admin', Accept: 'application/vnd.github+json' };
  const repo = await fetch(`${API}/repos/${REPO}`, { headers });
  if (!repo.ok) throw Object.assign(new Error('Jeton GitHub refusé'), { status: 401 });
  if (!((await repo.json()).permissions || {}).push) throw Object.assign(new Error('Il faut un accès en écriture au dépôt du groupe'), { status: 403 });
  const me = await fetch(`${API}/user`, { headers }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (ghAdmins.size > 200) ghAdmins.clear();
  const admin = { login: me.login || 'admin', exp: Date.now() + 5 * 60000 };
  ghAdmins.set(key, admin);
  return admin;
}

async function putMeta(by, body) {
  const patch = (body && body.patch) || {};
  if (typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('« patch » invalide'), { status: 400 });
  const keys = Object.keys(patch);
  const bad = keys.find((k) => !PATCH_KEYS.has(k));
  const actions = (Array.isArray(body && body.actions) ? body.actions : []).map((a) => clean(a, 120)).filter(Boolean).slice(0, 10);
  // no keys is fine when it only adds history notes (cars and tracks are published from the launcher)
  if ((!keys.length && !actions.length) || bad) throw Object.assign(new Error(bad ? `Clé non modifiable : ${bad}` : 'Rien à modifier'), { status: 400 });
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    for (const k of keys) m[k] = k === 'discord' && HIDE ? await takeWebhooks({ ...(m.discord || {}), ...patch.discord }) : patch[k];
    await saveManifest(state, m, by, actions.length ? actions : keys.map((k) => `${k} modifié`));
    return { ok: true };
  });
}


// ------------------------------------------------------------------ Discord relay
// The webhook addresses let anyone post in the channel, so they must not be public. With HIDE_WEBHOOKS=1 they
// are kept in the private table lks_private (set from the launcher's Publication page as before) and removed from
// the public manifest; launchers post through this relay, which checks the message and limits the rate.
const HIDE = process.env.HIDE_WEBHOOKS === '1';
const ANON_KEY = process.env.ANON_KEY || '';
const PRIVATE_KEY = { news: 'discord_webhook', reports: 'discord_report_webhook' };
const MANIFEST_FIELD = { news: 'webhook', reports: 'reportWebhook' };

async function privateGet(key) {
  if (!pool) return null;
  const r = await pool.query('select value from public.lks_private where key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}
async function privateSet(key, value) {
  await pool.query('insert into public.lks_private (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, value]);
}

async function webhookUrl(channel, manifest) {
  const stored = await privateGet(PRIVATE_KEY[channel]).catch(() => null);
  if (stored && HOOK.test(stored)) return stored;
  const u = manifest && manifest.discord && manifest.discord[MANIFEST_FIELD[channel]];
  return HOOK.test(u || '') ? u : null;
}

/** Public copy of the group data: no webhook address when they are kept private. */
function publicManifest(m) {
  if (!HIDE || !m.discord) return m;
  const { webhook, reportWebhook, ...discord } = m.discord; // eslint-disable-line no-unused-vars
  return { ...m, discord };
}

/** Moves webhook addresses from the data to the private table (setting HIDE_WEBHOOKS=1, or when an admin saves them). */
async function takeWebhooks(discord) {
  if (!pool || !discord || typeof discord !== 'object') return discord;
  const rest = { ...discord };
  for (const channel of ['news', 'reports']) {
    const field = MANIFEST_FIELD[channel];
    if (field in rest) {
      if (HOOK.test(rest[field] || '')) await privateSet(PRIVATE_KEY[channel], rest[field]);
      delete rest[field]; // a blank field (the Publication page shows none) never erases the stored address
    }
  }
  return rest;
}

async function scrubWebhooks() {
  if (!pool || !HIDE) return;
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    if (!m.discord || (!('webhook' in m.discord) && !('reportWebhook' in m.discord))) return;
    m.discord = await takeWebhooks(m.discord);
    await saveManifest(state, m, 'serveur', ['Adresses des webhooks Discord retirées du manifeste public']);
  });
}

const hits = new Map(); // memory only, never written anywhere
function limited(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  return ++h.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (h.reset < now) hits.delete(k);
}, 60000).unref();

const LIMITS = { news: { perIp: [12, 60000], all: [80, 60000] }, reports: { perIp: [3, 600000], all: [20, 3600000] } };

async function discordRelay(req, channel, body, ip, resolveUrl = async () => webhookUrl(channel, await current())) {
  if (ANON_KEY) {
    const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(key);
    const b = Buffer.from(ANON_KEY);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('Clé invalide'), { status: 401 });
  }
  const lim = LIMITS[channel];
  if (limited(`${channel}:all`, ...lim.all) || limited(`${channel}:${ip}`, ...lim.perIp)) throw Object.assign(new Error('Trop de messages, réessaie plus tard'), { status: 429 });
  const content = clean(body && body.content, 1900);
  if (!content) throw Object.assign(new Error('Message vide'), { status: 400 });
  const file = body && body.file;
  let bytes = null;
  if (file) {
    // only crash reports carry a file: a log (text) or a lap (base64, a few hundred kB at most)
    const bad = () => Object.assign(new Error('Fichier refusé'), { status: 400 });
    if (channel !== 'reports' || !/^[\w. -]{1,80}$/.test(String(file.name || ''))) throw bad();
    if (typeof file.b64 === 'string' && file.b64.length <= 820000) bytes = Buffer.from(file.b64, 'base64');
    else if (typeof file.content === 'string' && file.content.length <= 40000) bytes = Buffer.from(file.content, 'utf8');
    else throw bad();
  }
  const url = await resolveUrl();
  if (!url) throw Object.assign(new Error('Salon Discord non réglé'), { status: 503 });
  const payload = { username: 'LKS Launcher', content, allowed_mentions: { parse: [] } };
  let res;
  if (file) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', new Blob([bytes], { type: 'application/octet-stream' }), file.name);
    res = await fetch(`${url}?wait=true`, { method: 'POST', body: form });
  } else res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw Object.assign(new Error(`Discord a refusé le message (${res.status})`), { status: 502 });
  return { ok: true };
}

// ------------------------------------------------------------------ live stream (SSE)
const clients = new Set();
const queued = new Map();
function relay(topic) {
  if (queued.has(topic)) return; // several changes within 300 ms: one message
  queued.set(topic, setTimeout(() => {
    queued.delete(topic);
    const msg = `event: ${topic}\ndata: {"t":"${topic}"}\n\n`;
    for (const res of clients) res.write(msg);
  }, 300));
}
function listen() {
  if (!Client || !DB_ON) return;
  const c = new Client(dbConfig());
  let dead = false;
  const retry = () => {
    if (dead) return;
    dead = true;
    c.end().catch(() => {});
    setTimeout(listen, 5000).unref();
  };
  c.on('error', retry);
  c.on('end', retry);
  c.on('notification', (n) => {
    try {
      const t = JSON.parse(n.payload).t;
      if (/^[a-z]{2,20}$/.test(t)) relay(t);
    } catch {
      /* ignore */
    }
  });
  c.connect().then(() => c.query('LISTEN lks')).then(() => relay('manifest')).catch(retry);
}

// ------------------------------------------------------------------ public data (cached 60 s)
let cache = { at: 0, manifest: null };
async function current() {
  if (pool) return (await openManifest()).manifest;
  if (cache.manifest && Date.now() - cache.at < 60000) return cache.manifest;
  try {
    cache = { at: Date.now(), manifest: (await openManifest()).manifest };
  } catch (err) {
    if (!cache.manifest) throw err;
  }
  return cache.manifest;
}

function publicView(m) {
  const since = Date.now() - 30 * 86400000;
  return {
    name: m.name || 'Lowkey Syndicate',
    motd: m.motd || '',
    updatedAt: m.updatedAt || null,
    news: (m.news || []).slice(0, 30),
    events: (m.events || []).filter((e) => Date.parse(e.date) + (Number(e.durationMinutes) || 120) * 60000 > since).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    cars: (m.cars || []).map((c) => ({ id: c.id, name: c.name, brand: c.brand || '', skins: c.skins || [] })),
    tracks: (m.tracks || []).map((t) => ({ id: t.id, name: t.name, layouts: (t.layouts || []).map((l) => ({ id: l.id, name: l.name })) })),
    servers: (m.servers || []).filter((s) => s.ip).map((s) => ({ name: s.name || s.ip, value: `${s.ip}:${s.httpPort || 8081}` })),
    championships: m.championships || [],
    judging: m.judging || [],
    leaderboard: m.leaderboard && m.leaderboard.url ? { url: m.leaderboard.url, anonKey: m.leaderboard.anonKey } : null,
    discord: m.discord && m.discord.inviteUrl ? { inviteUrl: m.discord.inviteUrl } : null,
  };
}

// ------------------------------------------------------------------ admins
const sessions = new Map(); // token -> { name, exp }
const failures = new Map(); // name -> { n, until }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

function admins() {
  try {
    return Object.fromEntries(fs.readFileSync(ADMINS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[^:#\s][^:]*:scrypt\$[0-9a-f]+\$[0-9a-f]+$/.test(l)).map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), { name: l.slice(0, l.indexOf(':')), hash: l.slice(l.indexOf(':') + 1) }]));
  } catch {
    return {};
  }
}

function checkPassword(hash, password) {
  const [, salt, hex] = hash.split('$');
  const want = Buffer.from(hex, 'hex');
  const got = crypto.scryptSync(String(password), salt, want.length);
  return crypto.timingSafeEqual(want, got);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function login({ name, password }) {
  const key = String(name || '').trim().toLowerCase().slice(0, 40);
  const f = failures.get(key);
  if (f && f.until > Date.now()) throw Object.assign(new Error('Trop d’essais : réessaie dans 15 minutes'), { status: 429 });
  const admin = admins()[key];
  const ok = admin ? checkPassword(admin.hash, password) : (checkPassword(hashPassword('x'), 'y'), false);
  if (!ok) {
    // 5 wrong passwords within 15 minutes: that name is locked for 15 minutes
    const recent = f && Date.now() - f.first < 15 * 60000;
    const n = (recent ? f.n : 0) + 1;
    failures.set(key, { n, first: recent ? f.first : Date.now(), until: n >= 5 ? Date.now() + 15 * 60000 : 0 });
    await wait(800);
    throw Object.assign(new Error('Nom ou mot de passe incorrect'), { status: 401 });
  }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { name: admin.name, exp: Date.now() + SESSION_MS });
  return { token, name: admin.name, expires: new Date(Date.now() + SESSION_MS).toISOString() };
}

function who(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) {
    sessions.delete(token);
    throw Object.assign(new Error('Connexion expirée : reconnecte-toi'), { status: 401 });
  }
  return { ...s, token };
}

// ------------------------------------------------------------------ Discord (the group's announcement channel)
const HOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/;
async function announce(m, content) {
  const url = await webhookUrl('news', m);
  if (!url) return;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }) }).catch(() => {});
}

function trackLabel(m, id, layout) {
  const t = (m.tracks || []).find((x) => x.id === id);
  if (!t) return id;
  const l = (t.layouts || []).find((x) => x.id === (layout || ''));
  if (!l || !l.name || (t.layouts || []).length < 2) return t.name;
  return l.name.toLowerCase().startsWith(String(t.name).toLowerCase()) ? l.name : `${t.name} — ${l.name}`;
}
const carLabel = (m, id) => ((m.cars || []).find((c) => c.id === id) || {}).name || id;

// ------------------------------------------------------------------ edits
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

function cleanEvent(id, e, m) {
  const date = Date.parse(e.date);
  if (!clean(e.title, 80)) throw Object.assign(new Error('Il faut un titre'), { status: 400 });
  if (!Number.isFinite(date)) throw Object.assign(new Error('Date invalide'), { status: 400 });
  const track = clean(e.track, 80);
  const layout = clean(e.layout, 80);
  if (track && !(m.tracks || []).some((t) => t.id === track)) throw Object.assign(new Error('Circuit inconnu du groupe'), { status: 400 });
  const cars = [...new Set((Array.isArray(e.cars) ? e.cars : []).map((c) => clean(c, 80)))].filter((c) => (m.cars || []).some((x) => x.id === c)).slice(0, 40);
  const size = Number(e.battle && e.battle.size);
  const server = clean(e.server, 80);
  return {
    id,
    title: clean(e.title, 80),
    date: new Date(date).toISOString(),
    durationMinutes: Math.max(15, Math.min(720, Number(e.durationMinutes) || 120)),
    description: clean(e.description, 600),
    ...(track ? { track, layout } : {}),
    ...(cars.length ? { cars } : {}),
    ...(server && (m.servers || []).some((s) => `${s.ip}:${s.httpPort || 8081}` === server) ? { server } : {}),
    battle: [4, 8, 16].includes(size) && track ? { size, mode: ['debutant', 'normal', 'pro'].includes(e.battle.mode) ? e.battle.mode : 'normal' } : null,
  };
}

async function putEvent(by, id, body) {
  if (!/^[\w-]{3,40}$/.test(id)) throw Object.assign(new Error('Identifiant invalide'), { status: 400 });
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    const ev = cleanEvent(id, body, m);
    const events = [...(m.events || [])];
    const i = events.findIndex((x) => x.id === id);
    const isNew = i < 0;
    if (isNew) events.push(ev);
    else events[i] = ev;
    m.events = events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const championships = champ.syncSoirees(m.championships || [], m.events);
    if (championships) m.championships = championships;
    await saveManifest(state, m, `${by} (site)`, [`${isNew ? 'Event ajouté' : 'Event modifié'} : ${ev.title}`]);
    if (isNew && Date.parse(ev.date) > Date.now()) {
      const when = new Date(ev.date).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Paris' });
      const what = [ev.track ? trackLabel(m, ev.track, ev.layout) : null, (ev.cars || []).length ? ev.cars.map((c) => carLabel(m, c)).join(', ') : null].filter(Boolean).join(' · ');
      await announce(m, `📅 **${ev.title}** — ${when}${what ? `\n${what}` : ''}${ev.description ? `\n${ev.description}` : ''}`);
    }
    return ev;
  });
}

async function deleteEvent(by, id) {
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    const ev = (m.events || []).find((x) => x.id === id);
    if (!ev) throw Object.assign(new Error('Event introuvable'), { status: 404 });
    m.events = m.events.filter((x) => x.id !== id);
    const championships = champ.syncSoirees(m.championships || [], m.events);
    if (championships) m.championships = championships;
    await saveManifest(state, m, `${by} (site)`, [`Event retiré : ${ev.title}`]);
    return true;
  });
}

async function addNews(by, body) {
  const title = clean(body.title, 120);
  const text = clean(body.body, 4000);
  if (!title) throw Object.assign(new Error('Il faut un titre'), { status: 400 });
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    const item = { title, body: text, date: new Date().toISOString() };
    m.news = [item, ...(m.news || [])].slice(0, 50);
    await saveManifest(state, m, `${by} (site)`, [`Actu publiée : ${title}`]);
    if (body.discord !== false) await announce(m, `📰 **${title}**${text ? `\n${text}` : ''}`);
    return item;
  });
}

async function deleteNews(by, date) {
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    const item = (m.news || []).find((n) => n.date === date);
    if (!item) throw Object.assign(new Error('Actu introuvable'), { status: 404 });
    m.news = m.news.filter((n) => n !== item);
    await saveManifest(state, m, `${by} (site)`, [`Actu retirée : ${item.title}`]);
    return true;
  });
}

/**
 * A championship from the site, checked like the launcher does (cleanChampionships)
 * but with clear messages. « Soirées LKS » (id soiree) follows the calendar: only its
 * name, season and points can change here.
 */
function cleanChampionship(id, c, m, existing) {
  const name = clean(c.name, 60);
  if (!name) throw Object.assign(new Error('Il faut un nom'), { status: 400 });
  const points = (Array.isArray(c.points) ? c.points : String(c.points || '').split(/[,; ]+/)).map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 32);
  if (!points.length) throw Object.assign(new Error('Indique les points par place (ex. 25, 18, 15…)'), { status: 400 });
  let rounds;
  if (id === 'soiree') rounds = (existing && existing.rounds) || [];
  else {
    const seen = new Set();
    rounds = (Array.isArray(c.rounds) ? c.rounds : []).slice(0, 40).map((r, i) => {
      const label = `Manche ${i + 1}`;
      let rid = String(r.id || '').replace(/[^\w-]/g, '').slice(0, 6);
      while (!rid || seen.has(rid)) rid = crypto.randomBytes(4).toString('hex').slice(0, 6);
      seen.add(rid);
      const track = clean(r.track, 80);
      if (!(m.tracks || []).some((t) => t.id === track)) throw Object.assign(new Error(`${label} : choisis un circuit du groupe`), { status: 400 });
      const start = Date.parse(r.start);
      const end = Date.parse(r.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw Object.assign(new Error(`${label} : dates invalides`), { status: 400 });
      if (end <= start) throw Object.assign(new Error(`${label} : la fin doit être après le début`), { status: 400 });
      return { id: rid, name: clean(r.name, 60) || label, track, layout: clean(r.layout, 80), kind: r.kind, category: r.category, mode: r.mode, start: new Date(start).toISOString(), end: new Date(end).toISOString(), bracket: Number(r.bracket) || 8 };
    });
  }
  return champ.cleanChampionships([{ id, name, season: clean(c.season, 40), points, rounds }])[0];
}

async function putChampionship(by, id, body) {
  if (!/^[\w-]{1,6}$/.test(id)) throw Object.assign(new Error('Identifiant invalide'), { status: 400 });
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    const list = [...(m.championships || [])];
    const i = list.findIndex((c) => c.id === id);
    if (i < 0 && list.length >= 20) throw Object.assign(new Error('20 championnats au plus : supprime les anciens'), { status: 400 });
    const c = cleanChampionship(id, body, m, i >= 0 ? list[i] : null);
    if (i >= 0) list[i] = c;
    else list.push(c);
    m.championships = list;
    await saveManifest(state, m, `${by} (site)`, [`${i >= 0 ? 'Championnat modifié' : 'Championnat créé'} : ${c.season ? `${c.season} — ` : ''}${c.name}`]);
    return c;
  });
}

async function deleteChampionship(by, id) {
  if (id === 'soiree') throw Object.assign(new Error('« Soirées LKS » suit le calendrier : retire les battles des soirées à la place'), { status: 400 });
  return serial(async () => {
    const state = await openManifest();
    const m = state.manifest;
    const c = (m.championships || []).find((x) => x.id === id);
    if (!c) throw Object.assign(new Error('Championnat introuvable'), { status: 404 });
    m.championships = m.championships.filter((x) => x.id !== id);
    await saveManifest(state, m, `${by} (site)`, [`Championnat supprimé : ${c.name}`]);
    return true;
  });
}

// ------------------------------------------------------------------ HTTP
function cors(req, res, open) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  if (open) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Trop long'), { status: 413 }));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => {
      try {
        resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('JSON invalide'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '');
  const isPublic = ['/admin/api/public', '/admin/api/health', '/admin/api/manifest', '/admin/api/stream'].includes(p);
  cors(req, res, isPublic);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  try {
    if (p === '/admin/api/health') return json(res, 200, { ok: true, github: Boolean(TOKEN), live: Boolean(pool), admins: Object.keys(admins()).length });
    if (p === '/admin/api/public' && req.method === 'GET') return json(res, 200, publicView(await current()));
    if (p === '/admin/api/manifest' && req.method === 'GET') {
      const body = JSON.stringify(publicManifest((await openManifest()).manifest));
      const etag = `W/"${sha(body).slice(0, 20)}"`;
      if (req.headers['if-none-match'] === etag) return res.writeHead(304, { ETag: etag }).end();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ETag: etag });
      return res.end(body);
    }
    if (p === '/admin/api/stream' && req.method === 'GET') {
      if (!pool) throw Object.assign(new Error('Direct indisponible'), { status: 503 });
      if (clients.size >= 400) throw Object.assign(new Error('Trop de connexions'), { status: 503 });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\nevent: hello\ndata: {}\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/admin/api/meta' && req.method === 'PUT') {
      if (!pool) throw Object.assign(new Error('Serveur sans base : écris directement sur GitHub'), { status: 503 });
      const admin = await githubAdmin(req);
      return json(res, 200, await putMeta(admin.login, await readJson(req, 512 * 1024)));
    }
    const dc = p.match(/^\/admin\/api\/discord\/(news|reports)$/);
    if (dc && req.method === 'POST') {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
      return json(res, 200, await discordRelay(req, dc[1], await readJson(req, 1200 * 1024), ip));
    }
    if (p === '/admin/api/login' && req.method === 'POST') return json(res, 200, await login(await readJson(req)));
    const me = who(req);
    if (p === '/admin/api/me' && req.method === 'GET') return json(res, 200, { name: me.name, github: Boolean(TOKEN) });
    if (p === '/admin/api/logout' && req.method === 'POST') {
      sessions.delete(me.token);
      return json(res, 200, { ok: true });
    }
    if (!TOKEN) throw Object.assign(new Error('GITHUB_TOKEN manquant dans .env : impossible de publier'), { status: 503 });
    if (p === '/admin/api/news' && req.method === 'POST') return json(res, 200, await addNews(me.name, await readJson(req)));
    if (p === '/admin/api/news' && req.method === 'DELETE') return json(res, 200, await deleteNews(me.name, url.searchParams.get('date')));
    const ev = p.match(/^\/admin\/api\/events\/([\w-]{3,40})$/);
    if (ev && req.method === 'PUT') return json(res, 200, await putEvent(me.name, ev[1], await readJson(req)));
    if (ev && req.method === 'DELETE') return json(res, 200, await deleteEvent(me.name, ev[1]));
    const ch = p.match(/^\/admin\/api\/championships\/([\w-]{1,6})$/);
    if (ch && req.method === 'PUT') return json(res, 200, await putChampionship(me.name, ch[1], await readJson(req)));
    if (ch && req.method === 'DELETE') return json(res, 200, await deleteChampionship(me.name, ch[1]));
    return json(res, 404, { message: 'Introuvable' });
  } catch (err) {
    return json(res, err.status || 500, { message: String(err.message || 'Erreur').slice(0, 300) });
  }
});

if (require.main === module) {
  if (process.argv[2] === 'hash') {
    // ./lks.sh add-admin : the password comes on stdin, the line goes to stdout
    const name = String(process.argv[3] || '').trim();
    const password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
    if (!/^[\w.-]{2,40}$/.test(name) || password.length < 10) {
      console.error('Nom (lettres, chiffres, . _ -) et mot de passe d’au moins 10 caractères');
      process.exit(1);
    }
    process.stdout.write(`${name}:${hashPassword(password)}\n`);
  } else {
    setInterval(() => {
      for (const [t, s] of sessions) if (s.exp < Date.now()) sessions.delete(t);
    }, 600000).unref();
    if (pool) {
      listen();
      scrubWebhooks().catch((err) => console.error(`webhooks : ${err.message}`));
      setInterval(() => ownedFromGithub(true).catch(() => {}), 60000).unref();
      setInterval(() => {
        for (const res of clients) res.write(': ping\n\n');
      }, 25000).unref();
    }
    server.listen(PORT, () => console.log(`admin LKS prêt (port ${PORT}${TOKEN ? '' : ', sans GITHUB_TOKEN : lecture seule'})`));
  }
}

module.exports = { server, discordRelay, publicManifest, splitManifest, mergeManifest, putMeta, PATCH_KEYS, OWNED, hashPassword, checkPassword, publicView, cleanEvent, cleanChampionship };
