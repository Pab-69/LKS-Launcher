'use strict';

/**
 * Custom Shaders Patch (CSP) by Ilja Jusupov — installation from the official
 * acstuff server (exactly like Content Manager does: we never re-host it).
 *
 * Install = extract the official zip (dwrite.dll + extension/) into the AC root.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const yauzl = require('yauzl');
const ini = require('./ini');
const { extractZip } = require('./zip');

const PATCH_PAGE = 'https://acstuff.club/patch/';
const DISABLED_DLL = 'dwrite.dll.lks-disabled';

function defaultFetch() {
  try {
    const { net, app } = require('electron');
    if (net && net.fetch && app && app.isReady && app.isReady()) return net.fetch.bind(net);
  } catch {
    /* not in electron */
  }
  return fetch;
}

/** Parse the official patch page: recommended + latest + every listed version. */
function parsePatchPage(html) {
  const text = String(html || '');
  const all = [];
  const re = /\?info=([\d.]+)">v[\d.]+<\/a>\s*\(([\d.]+)\s*MB,\s*<span class="tag tag-(\w+)">/g;
  let m;
  while ((m = re.exec(text))) all.push({ version: m[1], sizeMb: Number(m[2]), tag: m[3] });
  const rec = text.match(/href="\?get=([\d.]+)"[^>]*>v[\d.]+ \(recommended version\)/) || text.match(/download="v([\d.]+)\.zip"/);
  const latest = text.match(/href="\?get=([\d.]+)"[^>]*>v[\d.]+ \(latest version\)/);
  const recommended = rec ? rec[1] : (all.filter((v) => v.tag === 'recommended').pop() || {}).version || null;
  return { recommended, latest: latest ? latest[1] : (all[all.length - 1] || {}).version || recommended, all };
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** What is installed in this AC folder. */
function installedCsp(acRoot) {
  if (!acRoot) return { installed: false, enabled: false, version: null, build: null };
  const dll = fs.existsSync(path.join(acRoot, 'dwrite.dll'));
  const disabledDll = fs.existsSync(path.join(acRoot, DISABLED_DLL));
  let version = null;
  let build = null;
  try {
    const data = ini.parse(fs.readFileSync(path.join(acRoot, 'extension', 'config', 'data_manifest.ini'), 'utf8'));
    version = (data.VERSION && data.VERSION.SHADERS_PATCH) || null;
    build = (data.VERSION && data.VERSION.SHADERS_PATCH_BUILD) || null;
  } catch {
    /* not installed */
  }
  return { installed: Boolean(version && (dll || disabledDll)), enabled: Boolean(version && dll), version, build };
}

/** CSP needs the Visual C++ 2015+ x86 runtime. Returns null when unknown (not Windows). */
function checkVcRedist() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86', '/v', 'Installed'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/Installed\s+REG_DWORD\s+0x1/i.test(stdout));
    });
  });
}

function listZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const names = [];
      zip.on('entry', (e) => {
        names.push(e.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

class CspManager extends EventEmitter {
  constructor({ dataDir, getAcRoot, fetchImpl, pageUrl }) {
    super();
    this.dataDir = dataDir;
    this.getAcRoot = getAcRoot;
    this.fetchImpl = fetchImpl || null;
    this.pageUrl = pageUrl || PATCH_PAGE;
    this.busy = false;
    this.versions = null;
    this.abort = null;
  }

  fetch(...args) {
    return (this.fetchImpl || defaultFetch())(...args);
  }

  async available() {
    const res = await this.fetch(this.pageUrl, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`Site du CSP injoignable (HTTP ${res.status})`);
    this.versions = parsePatchPage(await res.text());
    if (!this.versions.recommended) throw new Error('Impossible de lire la version recommandée du CSP');
    return this.versions;
  }

  status() {
    return { ...installedCsp(this.getAcRoot()), busy: this.busy };
  }

  progress(phase, done, total) {
    const now = Date.now();
    if (now - (this._last || 0) < 120 && done !== total) return;
    this._last = now;
    this.emit('progress', { phase, done, total });
  }

  /** Download + install the given version (official build). */
  async install(version) {
    const acRoot = this.getAcRoot();
    if (!acRoot) throw new Error("Dossier d'Assetto Corsa non configuré");
    if (!/^[\d.]+$/.test(String(version))) throw new Error('Version de CSP invalide');
    if (this.busy) throw new Error('Installation du CSP déjà en cours');
    this.busy = true;
    this.abort = new AbortController();
    this.emit('changed');
    const dir = path.join(this.dataDir || os.tmpdir(), 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    const zipFile = path.join(dir, `csp-${version}-${crypto.randomBytes(3).toString('hex')}.zip`);
    try {
      const res = await this.fetch(`${this.pageUrl}?get=${version}`, { signal: this.abort.signal });
      if (!res.ok) throw new Error(`Téléchargement du CSP impossible (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length') || 0);
      let done = 0;
      const self = this;
      const counter = new Transform({
        transform(chunk, _e, cb) {
          done += chunk.length;
          self.progress('download', done, total || done);
          cb(null, chunk);
        },
      });
      const body = res.body && typeof res.body.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
      await pipeline(body, counter, fs.createWriteStream(zipFile), { signal: this.abort.signal });

      const names = await listZip(zipFile);
      if (!names.includes('dwrite.dll') || !names.some((n) => n.startsWith('extension/'))) {
        throw new Error("L'archive téléchargée ne ressemble pas au Custom Shaders Patch");
      }
      // Remove a previously disabled DLL so the fresh one is active.
      await fs.promises.rm(path.join(acRoot, DISABLED_DLL), { force: true });
      try {
        await extractZip(zipFile, acRoot, (d) => this.progress('extract', d, Math.max(d, total * 1.6)));
      } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM') throw new Error("Fichiers verrouillés : fermez Assetto Corsa avant d'installer le CSP");
        throw err;
      }
      this.progress('done', 1, 1);
      return installedCsp(acRoot);
    } finally {
      await fs.promises.rm(zipFile, { force: true }).catch(() => {});
      this.busy = false;
      this.abort = null;
      this.emit('progress', null);
      this.emit('changed');
    }
  }

  cancel() {
    if (this.abort) this.abort.abort();
  }

  /** Non-destructive on/off switch (renames dwrite.dll). */
  setEnabled(enabled) {
    const acRoot = this.getAcRoot();
    const on = path.join(acRoot, 'dwrite.dll');
    const off = path.join(acRoot, DISABLED_DLL);
    if (enabled && fs.existsSync(off)) fs.renameSync(off, on);
    if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
    this.emit('changed');
    return installedCsp(acRoot);
  }
}

module.exports = { CspManager, parsePatchPage, installedCsp, compareVersions, checkVcRedist, PATCH_PAGE };
