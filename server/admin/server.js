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
 *
 * The GitHub token stays on the server (never sent to the browser). Admins:
 * file ADMINS_FILE, one « name:scrypt$salt$hash » per line (./lks.sh add-admin).
 * No log, no IP kept. No dependency: Node.js 18 or newer.
 */

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const champ = (() => {
  try {
    return require('./championship');
  } catch {
    return require('../../src/main/telemetry/championship');
  }
})();

const PORT = Number(process.env.PORT) || 8090;
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

async function openManifest() {
  const release = await gh('GET', `/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`);
  const assets = await gh('GET', `/repos/${REPO}/releases/${release.id}/assets?per_page=100`);
  const asset = assets.find((a) => a.name === MANIFEST);
  if (!asset) throw Object.assign(new Error('Manifeste introuvable : publie d’abord du contenu depuis le launcher'), { status: 502 });
  const manifest = JSON.parse((await gh('GET', `/repos/${REPO}/releases/assets/${asset.id}`, { raw: true })).toString('utf8'));
  return { release, assets, asset, manifest };
}

/** Upload under a temporary name, then swap: launchers never see a missing manifest for long. */
async function saveManifest(state, manifest, by, actions) {
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

// ------------------------------------------------------------------ public data (cached 60 s)
let cache = { at: 0, manifest: null };
async function current() {
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
  const url = m.discord && m.discord.webhook;
  if (!HOOK.test(url || '')) return;
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
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
  const isPublic = p === '/admin/api/public' || p === '/admin/api/health';
  cors(req, res, isPublic);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  try {
    if (p === '/admin/api/health') return json(res, 200, { ok: true, github: Boolean(TOKEN), admins: Object.keys(admins()).length });
    if (p === '/admin/api/public' && req.method === 'GET') return json(res, 200, publicView(await current()));
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
    server.listen(PORT, () => console.log(`admin LKS prêt (port ${PORT}${TOKEN ? '' : ', sans GITHUB_TOKEN : lecture seule'})`));
  }
}

module.exports = { server, hashPassword, checkPassword, publicView, cleanEvent };
