'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashFolder, hashFile } = require('./hash');
const { zipFolder } = require('./zip');
const { readCar, readTrack, contentDir } = require('./acContent');
const { normalizeManifest } = require('./sync');
const { readBrandingFolder } = require('./branding');
const crypto = require('crypto');

const MANIFEST_NAME = 'manifest.json';
const META_KEYS = ['servers', 'news', 'name', 'motd', 'csp', 'showcase', 'donate', 'shop', 'events', 'soloPresets', 'discord', 'vpn', 'leaderboard', 'drift', 'championships'];
const META_LABELS = {
  servers: 'Serveurs mis à jour',
  news: 'Actus mises à jour',
  motd: 'Message du jour modifié',
  csp: 'Version du CSP du groupe modifiée',
  donate: 'Page de dons modifiée',
  shop: 'Boutique modifiée',
  events: 'Calendrier des events modifié',
  soloPresets: 'Sessions solo modifiées',
  discord: 'Réglages Discord modifiés',
  vpn: 'VPN modifié',
  leaderboard: 'Classement configuré', drift: 'Parcours de drift modifié', championships: 'Championnat modifié',
};
const SETUP_EXT = /\.(ini|sp)$/i;
const plural = (kind) => (kind === 'car' ? 'cars' : 'tracks');
const safeName = (id) => id.replace(/[^A-Za-z0-9._-]/g, '_');
// Official Kunos content (base game + DLC) is never redistributed.
const OFFICIAL_TRACKS = new Set(['magione', 'monza', 'mugello', 'imola', 'spa', 'silverstone', 'vallelunga', 'drift', 'trento-bondone', 'monza66', 'nurburgring', 'barcelona', 'ks_barcelona']);
const isOfficial = (id) => /^ks_/i.test(id) || OFFICIAL_TRACKS.has(id);

/**
 * Publishes cars/tracks from the admin's Assetto Corsa install to a GitHub
 * release ("content" tag), then rewrites manifest.json. Every launcher reads
 * that manifest and downloads what changed.
 */
class Publisher {
  constructor({ gh, tag, log, progress }) {
    this.gh = gh;
    this.tag = tag || 'content';
    this.log = log || (() => {});
    this.progress = progress || (() => {});
  }

  async open() {
    this.release = await this.gh.ensureRelease(this.tag);
    this.assets = await this.gh.listAssets(this.release.id);
    const asset = this.assets.find((a) => a.name === MANIFEST_NAME);
    this.manifest = normalizeManifest(asset ? JSON.parse((await this.gh.downloadAsset(asset)).toString('utf8')) : null);
    return this.manifest;
  }

  manifestUrl() {
    return `https://github.com/${this.gh.repo}/releases/download/${encodeURIComponent(this.tag)}/${MANIFEST_NAME}`;
  }

  async upload(name, source, type, label) {
    const old = this.assets.find((a) => a.name === name);
    if (old) {
      await this.gh.deleteAsset(old.id);
      this.assets = this.assets.filter((a) => a !== old);
    }
    const asset = await this.gh.uploadAsset(this.release, name, source, type, (done, total) => this.progress({ step: 'upload', label: label || name, done, total }));
    this.assets.push(asset);
    return asset;
  }

  /** Local publish state of every car/track: published / modified / new. */
  async localDiff(acRoot, kind, ids, hashes) {
    const list = this.manifest[plural(kind)];
    return ids.map((id) => {
      const entry = list.find((e) => e.id === id);
      const local = hashes && hashes[`${kind}/${id}`];
      let status = entry ? 'published' : 'new';
      if (entry && local && local !== entry.version) status = 'modified';
      return { kind, id, status, remoteVersion: entry ? entry.version : null };
    });
  }

  async publishItems(acRoot, items, { force = false, notes = '' } = {}) {
    if (!this.manifest) await this.open();
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lks-publish-'));
    const report = [];
    try {
      for (let n = 0; n < items.length; n++) {
        const { kind, id } = items[n];
        const label = `${kind === 'car' ? 'Voiture' : 'Circuit'} ${id} (${n + 1}/${items.length})`;
        try {
          const result = await this.publishOne(acRoot, kind, id, tmpDir, { force, notes, label });
          report.push({ kind, id, ...result });
        } catch (err) {
          this.log(`✖ ${label} : ${err.message}`);
          report.push({ kind, id, status: 'error', error: err.message });
        }
      }
      if (report.some((r) => r.status === 'published')) await this.saveManifest();
      await this.collectGarbage();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
    return report;
  }

  async publishOne(acRoot, kind, id, tmpDir, { force, notes, label }) {
    if (isOfficial(id)) throw new Error('contenu officiel Kunos (ks_…) : tout le monde l’a déjà, publication bloquée');
    const dir = path.join(contentDir(acRoot, kind), id);
    if (!fs.existsSync(dir)) throw new Error(`Dossier introuvable : ${dir}`);
    this.log(`• ${label} : calcul de la version…`);
    const { hash, files, size: unpackedSize } = await hashFolder(dir, (done, total) => this.progress({ step: 'hash', label, done, total }));
    const list = this.manifest[plural(kind)];
    const existing = list.find((e) => e.id === id);
    if (existing && existing.version === hash && !force) {
      this.log(`= ${label} : déjà à jour, rien à envoyer`);
      return { status: 'unchanged' };
    }

    this.log(`• ${label} : compression (${files} fichiers, ${(unpackedSize / 1048576).toFixed(0)} Mo)…`);
    const zipPath = path.join(tmpDir, `${kind}-${safeName(id)}.zip`);
    await zipFolder(dir, zipPath, (written) => this.progress({ step: 'zip', label, done: written, total: unpackedSize }));
    const { hash: sha256, size } = await hashFile(zipPath);

    const short = hash.slice(0, 10);
    const assetName = `${kind}-${safeName(id)}-${short}.zip`;
    this.log(`• ${label} : envoi (${(size / 1048576).toFixed(1)} Mo)…`);
    const asset = await this.upload(assetName, zipPath, 'application/zip', label);

    const meta = kind === 'car' ? readCar(acRoot, id) : readTrack(acRoot, id);
    let preview = '';
    const previewRel = kind === 'car' ? (meta.skins.find((s) => s.preview) || {}).preview : meta.preview;
    if (previewRel) {
      const previewFile = path.join(contentDir(acRoot, kind), ...previewRel.split('/').slice(1));
      const ext = path.extname(previewFile).toLowerCase();
      const pAsset = await this.upload(`${kind}-${safeName(id)}-${short}-preview${ext}`, previewFile, ext === '.png' ? 'image/png' : 'image/jpeg', label);
      preview = pAsset.browser_download_url;
    }

    const entry = {
      id,
      name: meta.name,
      version: hash,
      url: asset.browser_download_url,
      sha256,
      size,
      unpackedSize,
      files,
      preview,
      publishedAt: new Date().toISOString(),
      notes: notes || '',
    };
    if (kind === 'car') Object.assign(entry, { brand: meta.brand, carClass: meta.carClass, skins: meta.skins.map((s) => s.id), specs: meta.specs });
    else Object.assign(entry, { country: meta.country, layouts: meta.layouts.map((l) => ({ id: l.id, name: l.name, length: l.length, pitboxes: l.pitboxes })) });
    if (existing) Object.assign(existing, entry);
    else list.push(entry);
    list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    this.log(`✔ ${label} : publié (version ${short})`);
    this.note(`${kind === 'car' ? 'Voiture' : 'Circuit'} « ${meta.name} » publié${notes ? ` — ${notes}` : ''}`);
    return { status: 'published', version: hash };
  }

  async removeItems(items) {
    if (!this.manifest) await this.open();
    for (const { kind, id } of items) {
      this.manifest[plural(kind)] = this.manifest[plural(kind)].filter((e) => e.id !== id);
      this.log(`− ${kind === 'car' ? 'Voiture' : 'Circuit'} ${id} retiré du manifeste`);
      this.note(`${kind === 'car' ? 'Voiture' : 'Circuit'} ${id} retiré`);
    }
    await this.saveManifest();
    await this.collectGarbage();
  }

  /** Replace servers / news / group name. */
  async updateMeta(patch) {
    if (!this.manifest) await this.open();
    for (const key of META_KEYS) {
      if (patch[key] === undefined) continue;
      this.manifest[key] = patch[key];
      this.note(META_LABELS[key] || `${key} modifié`);
    }
    await this.saveManifest();
  }

  /** GitHub login of the token's owner, for the publication history. */
  async whoami() {
    if (this.login === undefined) {
      try {
        const me = await this.gh.api('GET', '/user');
        this.login = (me && me.login) || null;
      } catch {
        this.login = null;
      }
    }
    return this.login;
  }

  note(action) {
    (this.pending = this.pending || []).push(action);
  }

  async saveManifest() {
    this.manifest.updatedAt = new Date().toISOString();
    if (this.pending && this.pending.length) {
      const by = (await this.whoami()) || 'admin';
      const date = this.manifest.updatedAt;
      const entries = this.pending.map((action) => ({ date, by, action }));
      this.manifest.history = [...entries.reverse(), ...(Array.isArray(this.manifest.history) ? this.manifest.history : [])].slice(0, 100);
      this.pending = [];
    }
    const buf = Buffer.from(JSON.stringify(this.manifest, null, 2));
    await this.upload(MANIFEST_NAME, buf, 'application/json', 'manifest.json');
    this.log('✔ Manifeste mis à jour : tous les launchers vont se synchroniser');
  }

  /**
   * Publish the association's visual identity (logos, showcase photos) from a
   * folder. These files are kept out of the launcher itself (all rights reserved).
   */
  async publishBranding(dir) {
    if (!this.manifest) await this.open();
    const { files, showcase } = readBrandingFolder(dir);
    const entries = [];
    const total = crypto.createHash('sha256');
    for (const name of files.sort()) {
      const buf = fs.readFileSync(path.join(dir, name));
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      total.update(`${name}\0${sha256}\n`);
      entries.push({ name, buf, sha256 });
    }
    total.update(JSON.stringify(showcase));
    const version = total.digest('hex');
    const previous = (this.manifest.branding && this.manifest.branding.files) || [];
    const out = [];
    for (const e of entries) {
      const old = previous.find((p) => p.name === e.name && p.sha256 === e.sha256);
      if (old) {
        out.push(old);
        this.log(`= ${e.name} : inchangé`);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.ico' ? 'image/x-icon' : 'image/jpeg';
      const asset = await this.upload(`branding-${e.sha256.slice(0, 10)}-${safeName(e.name)}`, e.buf, type, e.name);
      out.push({ name: e.name, url: asset.browser_download_url, sha256: e.sha256, size: e.buf.length });
      this.log(`✔ ${e.name} envoyé`);
    }
    this.manifest.branding = { version, files: out, showcase };
    this.note('Identité visuelle publiée');
    await this.saveManifest();
    await this.collectGarbage();
    return { version, files: out.length, showcase: showcase.length };
  }

  /**
   * Share car setups: Documents/Assetto Corsa/setups/<car>/<track>/*.ini
   * One small archive per car; members get them next to their own setups.
   */
  async publishSetups(docsDir, cars, names = {}) {
    if (!this.manifest) await this.open();
    if (!Array.isArray(this.manifest.setups)) this.manifest.setups = [];
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lks-setups-'));
    const report = [];
    try {
      for (const car of cars) {
        const src = path.join(docsDir, 'setups', car);
        if (!fs.existsSync(src)) {
          report.push({ car, status: 'error', error: 'aucun setup trouvé' });
          continue;
        }
        const stage = path.join(tmpDir, safeName(car));
        const files = [];
        (function walk(dir, rel) {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), r);
            else if (SETUP_EXT.test(e.name) && !/^LKS_/i.test(e.name)) {
              fs.mkdirSync(path.join(stage, ...r.split('/').slice(0, -1)), { recursive: true });
              fs.copyFileSync(path.join(dir, e.name), path.join(stage, ...r.split('/')));
              files.push(r);
            }
          }
        })(src, '');
        if (!files.length) {
          report.push({ car, status: 'error', error: 'aucun fichier .ini' });
          continue;
        }
        const { hash } = await hashFolder(stage);
        const existing = this.manifest.setups.find((s) => s.car === car);
        if (existing && existing.version === hash) {
          this.log(`= Setups ${car} : inchangés`);
          report.push({ car, status: 'unchanged' });
          continue;
        }
        const zipPath = path.join(tmpDir, `${safeName(car)}.zip`);
        await zipFolder(stage, zipPath);
        const { hash: sha256, size } = await hashFile(zipPath);
        const asset = await this.upload(`setups-${safeName(car)}-${hash.slice(0, 10)}.zip`, zipPath, 'application/zip', `Setups ${car}`);
        const entry = { car, name: names[car] || car, version: hash, url: asset.browser_download_url, sha256, size, files, publishedAt: new Date().toISOString() };
        if (existing) Object.assign(existing, entry);
        else this.manifest.setups.push(entry);
        this.log(`✔ Setups ${entry.name} : ${files.length} fichier(s) publiés`);
        this.note(`Setups « ${entry.name} » publiés (${files.length})`);
        report.push({ car, status: 'published', files: files.length });
      }
      if (report.some((r) => r.status === 'published')) await this.saveManifest();
      await this.collectGarbage();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
    return report;
  }

  async removeSetups(cars) {
    if (!this.manifest) await this.open();
    this.manifest.setups = (this.manifest.setups || []).filter((s) => !cars.includes(s.car));
    for (const c of cars) this.note(`Setups ${c} retirés`);
    await this.saveManifest();
    await this.collectGarbage();
  }

  /** Delete archives no longer referenced by the manifest. */
  async collectGarbage() {
    const used = new Set();
    for (const f of (this.manifest.branding && this.manifest.branding.files) || []) {
      if (f.url) used.add(decodeURIComponent(f.url.split('/').pop()));
    }
    for (const e of [...this.manifest.cars, ...this.manifest.tracks, ...(this.manifest.setups || [])]) {
      if (e.url) used.add(decodeURIComponent(e.url.split('/').pop()));
      if (e.preview) used.add(decodeURIComponent(e.preview.split('/').pop()));
    }
    for (const asset of [...this.assets]) {
      if (asset.name === MANIFEST_NAME || used.has(asset.name)) continue;
      if (!/^(car|track|branding|setups)-/.test(asset.name)) continue;
      await this.gh.deleteAsset(asset.id);
      this.assets = this.assets.filter((a) => a !== asset);
    }
  }
}

module.exports = { Publisher, MANIFEST_NAME, isOfficial };
