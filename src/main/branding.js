'use strict';

/**
 * Brand assets (logos, showcase photos) are NOT part of the launcher (GPL-3.0):
 * they belong to the association, are published by admins next to the content
 * and downloaded at runtime into the user's profile.
 *
 * manifest.branding = {
 *   version: "<sha256 of all files>",
 *   files: [{ name: "logo.png", url, sha256, size }],
 *   showcase: [{ image: "bmw-m2.jpg", title, subtitle, position }]
 * }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const NAME_RE = /^[A-Za-z0-9][\w.-]{0,80}\.(png|jpe?g|webp|ico)$/i;
const MAX_FILE = 25 * 1024 * 1024;

function defaultFetch() {
  try {
    const { net, app } = require('electron');
    if (net && net.fetch && app && app.isReady && app.isReady()) return net.fetch.bind(net);
  } catch {
    /* not in electron */
  }
  return fetch;
}

function validName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

class BrandingManager extends EventEmitter {
  constructor({ dataDir, fetchImpl }) {
    super();
    this.dir = path.join(dataDir, 'branding');
    this.stateFile = path.join(this.dir, 'branding.json');
    this.fetchImpl = fetchImpl || null;
    this.state = this.readState();
    this.running = null;
  }

  fetch(...args) {
    return (this.fetchImpl || defaultFetch())(...args);
  }

  readState() {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return { version: null, files: {}, showcase: [] };
    }
  }

  /** Local path of a brand file, or null. */
  file(name) {
    if (!validName(name) || !this.state.files[name]) return null;
    const p = path.join(this.dir, name);
    return fs.existsSync(p) ? p : null;
  }

  status() {
    return {
      version: this.state.version,
      files: Object.keys(this.state.files),
      showcase: (this.state.showcase || []).filter((s) => this.file(s.image)),
    };
  }

  /** Download what changed. Returns true when the local branding changed. */
  sync(branding) {
    if (!this.running) this.running = this.doSync(branding).finally(() => (this.running = null));
    return this.running;
  }

  async doSync(branding) {
    if (!branding || !Array.isArray(branding.files)) return false;
    if (branding.version && branding.version === this.state.version && branding.files.every((f) => this.file(f.name))) return false;
    fs.mkdirSync(this.dir, { recursive: true });
    const files = {};
    for (const f of branding.files) {
      if (!validName(f.name) || !/^https?:\/\//.test(f.url || '')) continue;
      const target = path.join(this.dir, f.name);
      const known = this.state.files[f.name];
      if (known && known.sha256 === f.sha256 && fs.existsSync(target)) {
        files[f.name] = known;
        continue;
      }
      try {
        const res = await this.fetch(f.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_FILE) throw new Error('fichier trop gros');
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        if (f.sha256 && sha256 !== f.sha256) throw new Error('empreinte incorrecte');
        fs.writeFileSync(`${target}.tmp`, buf);
        fs.renameSync(`${target}.tmp`, target);
        files[f.name] = { sha256, size: buf.length };
      } catch (err) {
        this.emit('failed', { name: f.name, error: err.message });
        if (known && fs.existsSync(target)) files[f.name] = known; // keep the previous copy
      }
    }
    // Remove files that are no longer part of the branding.
    for (const name of Object.keys(this.state.files)) {
      if (!files[name]) fs.rmSync(path.join(this.dir, name), { force: true });
    }
    const showcase = (Array.isArray(branding.showcase) ? branding.showcase : [])
      .filter((s) => s && validName(s.image) && files[s.image])
      .map((s) => ({ image: s.image, title: String(s.title || ''), subtitle: String(s.subtitle || ''), position: String(s.position || 'center') }));
    this.state = { version: branding.version || null, files, showcase };
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    return true;
  }
}

/** Read a branding folder prepared by an admin (see the LKS branding pack). */
function readBrandingFolder(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((n) => validName(n) && fs.statSync(path.join(dir, n)).isFile());
  let showcase = [];
  const showcaseFile = path.join(dir, 'showcase.json');
  if (fs.existsSync(showcaseFile)) {
    showcase = JSON.parse(fs.readFileSync(showcaseFile, 'utf8').replace(/^﻿/, ''));
    if (!Array.isArray(showcase)) throw new Error('showcase.json doit contenir une liste');
    for (const s of showcase) if (!files.includes(s.image)) throw new Error(`Image de vitrine introuvable : ${s.image}`);
  }
  if (!files.includes('logo.png')) throw new Error('Le dossier doit contenir au moins logo.png');
  for (const n of files) if (fs.statSync(path.join(dir, n)).size > MAX_FILE) throw new Error(`${n} dépasse 25 Mo`);
  return { files, showcase };
}

module.exports = { BrandingManager, readBrandingFolder, validName };
