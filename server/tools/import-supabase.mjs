// Reprend les données utiles d'un projet Supabase vers le serveur du groupe :
// records et battles (lks_laps) et galerie (photos + fichiers).
// Les Steam ID ne sont pas repris : chaque pilote reçoit un identifiant au hasard.
// Les runs (30 jours), qui est en ligne et le direct ne sont pas repris (passagers).
// Usage (par ./lks.sh import-supabase) : node import-supabase.mjs <url> <clé anon>
// Écrit le SQL sur la sortie standard et les photos dans /data/lks-gallery.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripImage } = require('./imagemeta.cjs');

const [url, key] = process.argv.slice(2);
if ((!/^https:\/\/[\w.-]+\/?$/.test(url || '') && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url || '')) || !key) {
  console.error('usage : import-supabase.mjs https://xxxx.supabase.co <clé anon>');
  process.exit(1);
}
const base = url.replace(/\/$/, '');
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const COLS = 'id,driver,car,track,layout,kind,rules,lap_ms,score,samples,meta,created_at';

async function get(p) {
  const res = await fetch(`${base}${p}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function all(view, select, order) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await get(`/rest/v1/${view}?select=${select}&order=${order}&limit=500&offset=${offset}`);
    out.push(...rows);
    if (rows.length < 500) return out;
  }
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 'null' : String(Number(v)));
const lines = ['begin;'];

// records and battles: one random id per driver name (the old Steam IDs are dropped)
const laps = await all('lks_laps', COLS, 'id.asc');
const ids = new Map();
const playerOf = (r) => {
  if (r.kind === 'battle') {
    const b = r.meta && r.meta.battle && r.meta.battle.id ? String(r.meta.battle.id) : String(r.id);
    return `b-${b.replace(/[^\w-]/g, '')}`.slice(0, 32);
  }
  const k = String(r.driver || '').trim().toLowerCase();
  if (!ids.has(k)) ids.set(k, `p-${crypto.randomBytes(8).toString('hex')}`);
  return ids.get(k);
};
// best first, so a driver who had two old ids keeps his best line
laps.sort((a, b) => (a.kind === 'time' ? (a.lap_ms || 1e12) - (b.lap_ms || 1e12) : Number(b.score || 0) - Number(a.score || 0)));
for (const r of laps) {
  lines.push(
    `insert into public.lks_laps (player, driver, car, track, layout, kind, rules, lap_ms, score, samples, meta, created_at) values (${[
      q(playerOf(r)), q(r.driver), q(r.car), q(r.track), q(r.layout || ''), q(r.kind), q(r.rules || ''), num(r.lap_ms), num(r.score), q(r.samples || ''), `${q(JSON.stringify(r.meta || {}))}::jsonb`, q(r.created_at),
    ].join(', ')}) on conflict (player, car, track, layout, kind, rules) do nothing;`,
  );
}

// gallery: rows + files (without their hidden data)
let photos = [];
try {
  photos = await all('lks_photos_list', 'id,file,author,caption,car,track,created_at', 'created_at.asc');
} catch {
  photos = [];
}
let copied = 0;
for (const p of photos) {
  if (!/^v1\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(p.file || '')) continue;
  const res = await fetch(`${base}/storage/v1/object/public/lks-gallery/${p.file}`);
  if (!res.ok) continue;
  let image;
  try {
    image = stripImage(Buffer.from(await res.arrayBuffer()), p.file.split('.').pop());
  } catch {
    continue;
  }
  const file = path.join(process.env.DATA_DIR || '/data', 'lks-gallery', p.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, image);
  copied++;
  lines.push(`insert into public.lks_photos (id, file, author, caption, car, track, created_at) values (${[q(p.id), q(p.file), q(p.author), q(p.caption || ''), q(p.car || ''), q(p.track || ''), q(p.created_at)].join(', ')}) on conflict (id) do nothing;`);
}

lines.push('commit;');
process.stdout.write(`${lines.join('\n')}\n`);
console.error(`${laps.length} records/battles, ${ids.size} pilotes, ${copied} photos`);
