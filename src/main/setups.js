'use strict';

/**
 * Shared car setups published by the admins (manifest.setups).
 * Installed into Documents/Assetto Corsa/setups/<car>/<track>/ next to the
 * player's own setups, with an "LKS_" prefix so nothing personal is ever
 * overwritten. Files installed by an older version are removed on update.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { extractZip, safeJoin } = require('./zip');
const { listFiles } = require('./hash');

function defaultFetch() {
  try {
    const { net, app } = require('electron');
    if (net && net.fetch && app && app.isReady && app.isReady()) return net.fetch.bind(net);
  } catch {
    /* not in electron */
  }
  return fetch;
}

const PREFIX = 'LKS_';
const validCar = (id) => typeof id === 'string' && /^[\w.-]+$/.test(id);

function installedName(rel) {
  const parts = rel.split('/');
  const file = parts.pop();
  parts.push(file.toUpperCase().startsWith('LKS') ? file : `${PREFIX}${file}`);
  return parts.join('/');
}

class SetupSync {
  constructor({ dataDir, getDocsDir, fetchImpl }) {
    this.stateFile = path.join(dataDir, 'setups.json');
    this.getDocsDir = getDocsDir;
    this.fetchImpl = fetchImpl || null;
    this.state = this.read();
    this.running = null;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  status() {
    return Object.entries(this.state).map(([car, s]) => ({ car, version: s.version, files: s.files.length }));
  }

  sync(entries) {
    if (!this.running) this.running = this.doSync(entries || []).finally(() => (this.running = null));
    return this.running;
  }

  async doSync(entries) {
    const docs = this.getDocsDir();
    if (!docs) return { installed: 0, removed: 0, errors: [] };
    const base = path.join(docs, 'setups');
    const result = { installed: 0, removed: 0, errors: [] };
    const wanted = new Map(entries.filter((e) => validCar(e.car)).map((e) => [e.car, e]));

    // cars no longer shared: remove what we installed
    for (const car of Object.keys(this.state)) {
      if (!wanted.has(car)) {
        result.removed += this.removeFiles(base, car);
        delete this.state[car];
      }
    }
    for (const entry of wanted.values()) {
      const current = this.state[entry.car];
      if (current && current.version === entry.version) continue;
      try {
        const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lks-setup-'));
        try {
          const res = await (this.fetchImpl || defaultFetch())(entry.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          if (entry.sha256 && sha !== entry.sha256) throw new Error('archive corrompue');
          const zip = path.join(tmp, 'setups.zip');
          fs.writeFileSync(zip, buf);
          await extractZip(zip, path.join(tmp, 'x'));
          if (current) result.removed += this.removeFiles(base, entry.car);
          const files = [];
          for (const rel of await listFiles(path.join(tmp, 'x'))) {
            const target = safeJoin(path.join(base, entry.car), installedName(rel));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(tmp, 'x', ...rel.split('/')), target);
            files.push(installedName(rel));
          }
          this.state[entry.car] = { version: entry.version, files };
          result.installed += files.length;
        } finally {
          await fs.promises.rm(tmp, { recursive: true, force: true });
        }
      } catch (err) {
        result.errors.push(`${entry.car} : ${err.message}`);
      }
    }
    this.save();
    return result;
  }

  removeFiles(base, car) {
    let n = 0;
    for (const rel of (this.state[car] && this.state[car].files) || []) {
      try {
        fs.rmSync(safeJoin(path.join(base, car), rel), { force: true });
        n++;
      } catch {
        /* already gone */
      }
    }
    return n;
  }
}

/** Cars that have setups in the admin's Documents folder. */
function localSetupCars(docsDir) {
  const base = path.join(docsDir, 'setups');
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        let count = 0;
        (function walk(dir) {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) walk(path.join(dir, e.name));
            else if (/\.(ini|sp)$/i.test(e.name) && !e.name.toUpperCase().startsWith(PREFIX)) count++;
          }
        })(path.join(base, d.name));
        return { car: d.name, count };
      })
      .filter((c) => c.count > 0);
  } catch {
    return [];
  }
}

module.exports = { SetupSync, localSetupCars, installedName };
