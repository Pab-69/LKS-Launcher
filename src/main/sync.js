'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { hashFolder } = require('./hash');
const { extractZip } = require('./zip');
const { contentDir } = require('./acContent');

const KINDS = ['car', 'track'];
const plural = (kind) => (kind === 'car' ? 'cars' : 'tracks');

function defaultFetch() {
  try {
    const { net, app } = require('electron');
    if (net && net.fetch && app && app.isReady && app.isReady()) return net.fetch.bind(net);
  } catch {
    /* not in electron */
  }
  return fetch;
}

function emptyManifest() {
  return { schema: 1, name: 'Lowkey Syndicate', updatedAt: null, news: [], servers: [], cars: [], tracks: [] };
}

function normalizeManifest(m) {
  const base = emptyManifest();
  const out = { ...base, ...(m || {}) };
  for (const key of ['news', 'servers', 'cars', 'tracks']) if (!Array.isArray(out[key])) out[key] = [];
  return out;
}

/**
 * Keeps the local Assetto Corsa content folder in sync with the LKS manifest.
 * Every car/track in the manifest has a "version" (deterministic folder hash);
 * anything whose installed version differs is (re)downloaded.
 */
class ContentSync extends EventEmitter {
  constructor({ dataDir, getAcRoot, getManifestUrl, fetchImpl }) {
    super();
    this.dataDir = dataDir;
    this.getAcRoot = getAcRoot;
    this.getManifestUrl = getManifestUrl;
    this.fetchImpl = fetchImpl || null;
    this.stateFile = path.join(dataDir, 'installed.json');
    this.cacheFile = path.join(dataDir, 'manifest-cache.json');
    this.downloadDir = path.join(dataDir, 'downloads');
    this.state = this.readJson(this.stateFile) || { car: {}, track: {} };
    for (const k of KINDS) this.state[k] = this.state[k] || {};
    this.manifest = normalizeManifest(this.readJson(this.cacheFile));
    this.manifestError = null;
    this.manifestFetchedAt = null;
    this.queue = [];
    this.current = null;
    this.running = false;
    this.abort = null;
    this.results = [];
    this.verifying = false;
  }

  fetch(...args) {
    return (this.fetchImpl || defaultFetch())(...args);
  }

  readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }

  saveState() {
    this.writeJson(this.stateFile, this.state);
  }

  async loadManifest() {
    const url = this.getManifestUrl();
    if (!url) {
      this.manifestError = 'Aucune URL de manifeste configurée';
      return this.manifest;
    }
    try {
      const res = await this.fetch(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = normalizeManifest(await res.json());
      this.manifest = manifest;
      this.manifestError = null;
      this.manifestFetchedAt = new Date().toISOString();
      this.writeJson(this.cacheFile, manifest);
    } catch (err) {
      this.manifestError = `Manifeste injoignable (${err.message}) — utilisation du cache`;
    }
    return this.manifest;
  }

  items() {
    const list = [];
    for (const kind of KINDS) for (const item of this.manifest[plural(kind)]) list.push({ ...item, kind });
    return list;
  }

  findItem(kind, id) {
    return this.manifest[plural(kind)].find((i) => i.id === id) || null;
  }

  folderOf(kind, id) {
    return path.join(contentDir(this.getAcRoot(), kind), id);
  }

  localStatus(kind, item) {
    const acRoot = this.getAcRoot();
    const entry = this.state[kind][item.id];
    const queued = this.queue.some((q) => q.kind === kind && q.id === item.id) || (this.current && this.current.kind === kind && this.current.id === item.id);
    if (!acRoot) return { status: 'noac', localVersion: null, queued };
    const exists = fs.existsSync(this.folderOf(kind, item.id));
    if (!exists) return { status: 'missing', localVersion: null, queued };
    if (!entry || !entry.version) return { status: 'unknown', localVersion: null, queued };
    return { status: entry.version === item.version ? 'ok' : 'update', localVersion: entry.version, queued };
  }

  statusList() {
    return this.items().map((item) => ({ ...item, ...this.localStatus(item.kind, item) }));
  }

  summary() {
    const list = this.statusList();
    const count = (s) => list.filter((i) => i.status === s).length;
    return {
      total: list.length,
      ok: count('ok'),
      update: count('update'),
      missing: count('missing'),
      unknown: count('unknown'),
      pending: list.filter((i) => i.status !== 'ok').length,
      downloadSize: list.filter((i) => i.status !== 'ok').reduce((s, i) => s + (i.size || 0), 0),
      manifestError: this.manifestError,
      manifestFetchedAt: this.manifestFetchedAt,
      manifestUpdatedAt: this.manifest.updatedAt,
      running: this.running,
      verifying: this.verifying,
    };
  }

  /**
   * Hash local folders to find out their real version (first launch, or
   * "verify integrity"). `all=false` only checks folders with unknown version.
   */
  async verify(all = false) {
    if (this.verifying) return;
    this.verifying = true;
    this.emit('changed');
    try {
      const targets = this.statusList().filter((i) => i.status !== 'missing' && i.status !== 'noac' && (all || i.status === 'unknown'));
      for (let n = 0; n < targets.length; n++) {
        const item = targets[n];
        this.emit('verify', { kind: item.kind, id: item.id, name: item.name, index: n + 1, count: targets.length });
        try {
          const { hash } = await hashFolder(this.folderOf(item.kind, item.id));
          this.state[item.kind][item.id] = { version: hash, verifiedAt: new Date().toISOString() };
        } catch {
          delete this.state[item.kind][item.id];
        }
      }
      this.saveState();
    } finally {
      this.verifying = false;
      this.emit('verify', null);
      this.emit('changed');
    }
  }

  /** Queue everything that is not up to date (or a given list of {kind,id}). */
  enqueue(targets) {
    const list = targets
      ? targets.map((t) => ({ ...this.findItem(t.kind, t.id), kind: t.kind })).filter((i) => i.id)
      : this.statusList().filter((i) => i.status !== 'ok' && i.status !== 'noac');
    let added = 0;
    for (const item of list) {
      const already = this.queue.some((q) => q.kind === item.kind && q.id === item.id) || (this.current && this.current.kind === item.kind && this.current.id === item.id);
      if (!already) {
        this.queue.push(item);
        added++;
      }
    }
    this.emit('changed');
    if (!this.running) this.process();
    return added;
  }

  cancel() {
    this.queue = [];
    if (this.abort) this.abort.abort();
    this.emit('changed');
  }

  async process() {
    if (this.running) return;
    this.running = true;
    this.results = [];
    this.emit('changed');
    while (this.queue.length) {
      const item = this.queue.shift();
      this.current = item;
      this.abort = new AbortController();
      try {
        await this.install(item, this.abort.signal);
        this.results.push({ kind: item.kind, id: item.id, name: item.name, ok: true });
      } catch (err) {
        this.results.push({ kind: item.kind, id: item.id, name: item.name, ok: false, error: err.message });
        this.emit('failed', { kind: item.kind, id: item.id, name: item.name, error: err.message });
      }
      this.current = null;
      this.emit('changed');
    }
    this.running = false;
    this.abort = null;
    this.emit('progress', null);
    this.emit('done', this.results);
    this.emit('changed');
  }

  progress(item, phase, done, total, speed) {
    const now = Date.now();
    if (phase === this._lastPhase && now - (this._lastEmit || 0) < 120 && done !== total) return;
    this._lastEmit = now;
    this._lastPhase = phase;
    this.emit('progress', {
      kind: item.kind,
      id: item.id,
      name: item.name,
      phase,
      done,
      total,
      speed: speed || 0,
      remaining: this.queue.length,
    });
  }

  async install(item, signal) {
    const acRoot = this.getAcRoot();
    if (!acRoot) throw new Error("Dossier d'Assetto Corsa non configuré");
    if (!item.url) throw new Error('Pas de lien de téléchargement dans le manifeste');
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const safeId = item.id.replace(/[^\w.-]/g, '_');
    const zipFile = path.join(this.downloadDir, `${item.kind}-${safeId}-${String(item.version).slice(0, 12)}.zip`);

    await this.download(item, zipFile, signal);

    // Extract into a temp folder next to the destination, then swap atomically.
    const base = contentDir(acRoot, item.kind);
    fs.mkdirSync(base, { recursive: true });
    const tmp = path.join(base, `.lks_tmp_${item.id}`);
    const old = path.join(base, `.lks_old_${item.id}`);
    const dest = path.join(base, item.id);
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await fs.promises.rm(old, { recursive: true, force: true });
    const total = item.unpackedSize || item.size || 0;
    await extractZip(zipFile, tmp, (done) => this.progress(item, 'extract', done, Math.max(total, done)), signal);
    try {
      if (fs.existsSync(dest)) await fs.promises.rename(dest, old);
    } catch (err) {
      await fs.promises.rm(tmp, { recursive: true, force: true });
      if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
        throw new Error('Fichiers verrouillés : fermez Assetto Corsa / Content Manager puis réessayez');
      }
      throw err;
    }
    await fs.promises.rename(tmp, dest);
    await fs.promises.rm(old, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(zipFile, { force: true }).catch(() => {});
    this.state[item.kind][item.id] = { version: item.version, installedAt: new Date().toISOString() };
    this.saveState();
    this.progress(item, 'done', 1, 1);
  }

  /** Resumable download with sha256 verification. */
  async download(item, zipFile, signal) {
    const part = `${zipFile}.part`;
    const hash = crypto.createHash('sha256');
    let start = 0;
    if (fs.existsSync(part)) {
      start = fs.statSync(part).size;
      if (item.size && start >= item.size) {
        await fs.promises.rm(part, { force: true });
        start = 0;
      } else if (start > 0) {
        await pipeline(fs.createReadStream(part), new Transform({ transform(c, _e, cb) { hash.update(c); cb(); } }));
      }
    }
    const headers = start > 0 ? { Range: `bytes=${start}-` } : {};
    const res = await this.fetch(item.url, { headers, signal });
    if (!res.ok && res.status !== 206) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
    if (start > 0 && res.status !== 206) {
      // Server ignored the range: restart from scratch.
      start = 0;
      hash.destroy && hash.destroy();
      return this.restartDownload(item, zipFile, signal, res);
    }
    await this.writeBody(item, res, part, start, hash, signal);
    return this.finishDownload(item, part, zipFile, hash);
  }

  async restartDownload(item, zipFile, signal, res) {
    const part = `${zipFile}.part`;
    const hash = crypto.createHash('sha256');
    await this.writeBody(item, res, part, 0, hash, signal);
    return this.finishDownload(item, part, zipFile, hash);
  }

  async writeBody(item, res, part, start, hash, signal) {
    const total = item.size || start + Number(res.headers.get('content-length') || 0);
    let done = start;
    let windowStart = Date.now();
    let windowBytes = 0;
    let speed = 0;
    const self = this;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        done += chunk.length;
        windowBytes += chunk.length;
        const elapsed = Date.now() - windowStart;
        if (elapsed > 1000) {
          speed = (windowBytes * 1000) / elapsed;
          windowStart = Date.now();
          windowBytes = 0;
        }
        self.progress(item, 'download', done, total, speed);
        cb(null, chunk);
      },
    });
    const body = res.body && typeof res.body.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
    await pipeline(body, counter, fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' }), { signal });
  }

  async finishDownload(item, part, zipFile, hash) {
    const digest = hash.digest('hex');
    if (item.sha256 && digest !== item.sha256) {
      await fs.promises.rm(part, { force: true });
      throw new Error('Fichier corrompu (sha256 différent) — relancez la synchro');
    }
    await fs.promises.rename(part, zipFile);
  }

  /** Remove leftovers of interrupted installs. */
  cleanup() {
    const acRoot = this.getAcRoot();
    if (!acRoot) return;
    for (const kind of KINDS) {
      const base = contentDir(acRoot, kind);
      let names = [];
      try {
        names = fs.readdirSync(base);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.startsWith('.lks_tmp_')) fs.rmSync(path.join(base, name), { recursive: true, force: true });
        if (name.startsWith('.lks_old_')) {
          const id = name.slice('.lks_old_'.length);
          // Swap interrupted between the two renames: put the old version back.
          if (!fs.existsSync(path.join(base, id))) fs.renameSync(path.join(base, name), path.join(base, id));
          else fs.rmSync(path.join(base, name), { recursive: true, force: true });
        }
      }
    }
  }
}

module.exports = { ContentSync, normalizeManifest, emptyManifest };
