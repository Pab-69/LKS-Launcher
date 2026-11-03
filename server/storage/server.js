'use strict';

/**
 * File storage of the LKS server (proposals and gallery), with the same
 * addresses as Supabase Storage so the launcher works with both:
 *   POST /storage/v1/object/<bucket>/v1/<uuid>.<ext>       upload (public key needed)
 *   GET  /storage/v1/object/public/<bucket>/v1/<uuid>.<ext> download
 * No log, no IP kept. Photos lose their hidden data (EXIF, GPS…) on arrival.
 * No dependency: Node.js 18 or newer.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
// same code as the launcher (mounted next to this file by docker-compose.yml)
const { stripImage } = (() => {
  try {
    return require('./imagemeta');
  } catch {
    return require('../../src/main/imagemeta');
  }
})();

const DATA = process.env.DATA_DIR || '/data';
const ANON_KEY = process.env.ANON_KEY || '';
const PORT = Number(process.env.PORT) || 8080;
const MAX_TOTAL = (Number(process.env.MAX_TOTAL_GB) || 20) * 1024 ** 3; // whole storage
const UPLOADS_PER_HOUR = Number(process.env.UPLOADS_PER_HOUR) || 120; // all members together
const PROPOSAL_DAYS = Number(process.env.PROPOSAL_DAYS) || 180;

const BUCKETS = {
  'lks-proposals': { name: /^v1\/[0-9a-f-]{36}\.zip$/, max: 50 * 1024 * 1024, types: { zip: 'application/zip' } },
  'lks-gallery': { name: /^v1\/[0-9a-f-]{36}\.(jpg|png|webp)$/, max: 10 * 1024 * 1024, types: { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } },
};

let hour = { at: Date.now(), n: 0 };

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function keyOk(req) {
  if (!ANON_KEY) return false;
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return req.headers.apikey === ANON_KEY || auth === ANON_KEY;
}

function usedBytes(dir = DATA) {
  let total = 0;
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? usedBytes(p) : fs.statSync(p).size;
  }
  return total;
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Fichier trop gros'), { status: 413 }));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function upload(req, res, bucket, name) {
  const b = BUCKETS[bucket];
  if (!b || !b.name.test(name)) return json(res, 400, { message: 'Nom de fichier refusé' });
  if (!keyOk(req)) return json(res, 401, { message: 'Clé invalide' });
  if (Date.now() - hour.at > 3600000) hour = { at: Date.now(), n: 0 };
  if (++hour.n > UPLOADS_PER_HOUR) return json(res, 429, { message: 'Trop d’envois pour le moment, réessaie plus tard' });
  if (usedBytes() > MAX_TOTAL) return json(res, 507, { message: 'Stockage du groupe plein : préviens les admins' });
  const file = path.join(DATA, bucket, name);
  if (fs.existsSync(file)) return json(res, 409, { message: 'The resource already exists' });
  let body = await readBody(req, b.max);
  const ext = name.split('.').pop();
  if (bucket === 'lks-gallery') body = stripImage(body, ext); // checks it is a real picture too
  else if (!(body.length > 4 && body[0] === 0x50 && body[1] === 0x4b)) return json(res, 400, { message: 'Fichier zip attendu' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, body, { flag: 'wx' });
  fs.renameSync(tmp, file);
  return json(res, 200, { Key: `${bucket}/${name}` });
}

function download(req, res, bucket, name) {
  const b = BUCKETS[bucket];
  if (!b || !b.name.test(name)) return json(res, 404, { message: 'Introuvable' });
  const file = path.join(DATA, bucket, name);
  if (!fs.existsSync(file)) return json(res, 404, { message: 'Introuvable' });
  const size = fs.statSync(file).size;
  res.writeHead(200, { 'Content-Type': b.types[name.split('.').pop()] || 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'public, max-age=31536000, immutable' });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

/** Proposals older than PROPOSAL_DAYS: the file goes (the database forgets them too). */
function cleanup() {
  const dir = path.join(DATA, 'lks-proposals', 'v1');
  if (!fs.existsSync(dir)) return;
  const limit = Date.now() - PROPOSAL_DAYS * 86400000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < limit || f.endsWith('.part')) fs.unlinkSync(p);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/storage\/v1\/object\/(public\/)?([\w-]+)\/(.+)$/);
    if (url.pathname === '/storage/v1/health') return json(res, 200, { ok: true });
    if (!m) return json(res, 404, { message: 'Introuvable' });
    const [, pub, bucket, name] = m;
    if (pub && (req.method === 'GET' || req.method === 'HEAD')) return download(req, res, bucket, decodeURIComponent(name));
    if (!pub && req.method === 'POST') return await upload(req, res, bucket, decodeURIComponent(name));
    return json(res, 405, { message: 'Méthode refusée' });
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 400, { message: String(err.message || 'Erreur').slice(0, 200) });
    return undefined;
  }
});

if (require.main === module) {
  if (!ANON_KEY) {
    console.error('ANON_KEY manquant');
    process.exit(1);
  }
  cleanup();
  setInterval(cleanup, 6 * 3600000).unref();
  server.listen(PORT, () => console.log(`stockage LKS prêt (port ${PORT})`));
}

module.exports = { server, BUCKETS };
