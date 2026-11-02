'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');

/** Tiny GitHub REST client: releases + release assets only. */
class GitHub {
  constructor({ token, repo, apiBase = 'https://api.github.com' }) {
    if (!token) throw new Error('Token GitHub manquant (Paramètres > Admin)');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Dépôt de contenu invalide (format attendu : utilisateur/depot)');
    this.token = token;
    this.repo = repo;
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  headers(extra) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'LKS-Launcher',
      ...extra,
    };
  }

  async api(method, apiPath, body) {
    const res = await fetch(`${this.apiBase}${apiPath}`, {
      method,
      headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (res.status === 204) return {};
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).message || text;
      } catch {
        /* raw text */
      }
      if (res.status === 401) msg = 'Token GitHub invalide ou expiré';
      if (res.status === 422 && /empty|Repository is empty/i.test(text)) msg = 'Le dépôt de contenu est vide : créez-y au moins un fichier (ex: README) puis réessayez';
      throw new Error(`GitHub ${res.status} : ${msg}`);
    }
    return text ? JSON.parse(text) : {};
  }

  async checkAccess() {
    const repo = await this.api('GET', `/repos/${this.repo}`);
    if (!repo) throw new Error(`Dépôt ${this.repo} introuvable (ou token sans accès)`);
    if (repo.permissions && !repo.permissions.push) throw new Error(`Le token n'a pas le droit d'écrire sur ${this.repo}`);
    return { private: repo.private, name: repo.full_name, url: repo.html_url };
  }

  getReleaseByTag(tag) {
    return this.api('GET', `/repos/${this.repo}/releases/tags/${encodeURIComponent(tag)}`);
  }

  async ensureRelease(tag) {
    const existing = await this.getReleaseByTag(tag);
    if (existing) return existing;
    return this.api('POST', `/repos/${this.repo}/releases`, {
      tag_name: tag,
      name: 'LKS Content',
      body: 'Contenu (voitures / circuits) synchronisé par le LKS Launcher. Ne pas supprimer.',
      draft: false,
      prerelease: false,
      make_latest: 'false',
    });
  }

  async listAssets(releaseId) {
    const all = [];
    for (let page = 1; page < 50; page++) {
      const list = await this.api('GET', `/repos/${this.repo}/releases/${releaseId}/assets?per_page=100&page=${page}`);
      if (!list || !list.length) break;
      all.push(...list);
      if (list.length < 100) break;
    }
    return all;
  }

  deleteAsset(id) {
    return this.api('DELETE', `/repos/${this.repo}/releases/assets/${id}`);
  }

  async downloadAsset(asset) {
    const res = await fetch(asset.url, { headers: this.headers({ Accept: 'application/octet-stream' }) });
    if (!res.ok) throw new Error(`Téléchargement de ${asset.name} impossible (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Upload a file (path) or Buffer as a release asset. */
  uploadAsset(release, name, source, contentType, onProgress) {
    const base = release.upload_url.replace(/\{.*\}$/, '');
    const url = new URL(`${base}?name=${encodeURIComponent(name)}`);
    const size = Buffer.isBuffer(source) ? source.length : fs.statSync(source).size;
    const lib = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        { method: 'POST', headers: this.headers({ 'Content-Type': contentType, 'Content-Length': size }) },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode >= 300) return reject(new Error(`Upload de ${name} refusé (HTTP ${res.statusCode}) : ${text.slice(0, 300)}`));
            try {
              resolve(JSON.parse(text));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      if (Buffer.isBuffer(source)) {
        req.end(source);
        if (onProgress) onProgress(size, size);
        return;
      }
      let sent = 0;
      const stream = fs.createReadStream(source, { highWaterMark: 1 << 20 });
      stream.on('data', (chunk) => {
        sent += chunk.length;
        if (onProgress) onProgress(sent, size);
      });
      stream.on('error', (e) => req.destroy(e));
      stream.pipe(req);
    });
  }
}

module.exports = { GitHub };
