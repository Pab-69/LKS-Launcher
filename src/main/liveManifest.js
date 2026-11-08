'use strict';

/**
 * The group's server keeps everything of the manifest except what is published from the launcher
 * (cars, tracks, branding, setups, which stay on GitHub). These helpers read that live manifest,
 * write changes to it, and listen to its change stream. Every function fails soft: without a
 * server (or when it is down) the launcher keeps working from the GitHub manifest as before.
 */

const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const OWNED = ['cars', 'tracks', 'branding', 'setups'];
const TIMEOUT_MS = 8000;

/** Base address of the group's server (no trailing slash), from a manifest. */
function serverBase(manifest) {
  const url = manifest && manifest.leaderboard && manifest.leaderboard.url;
  return /^https:\/\/[^/\s]+$/.test(String(url || '').replace(/\/+$/, '')) ? String(url).replace(/\/+$/, '') : null;
}

async function timedFetch(fetchImpl, url, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The live manifest, or null when the server has none (old server, down, no database). */
async function fetchLive(base, fetchImpl = fetch) {
  if (!base) return null;
  try {
    const res = await timedFetch(fetchImpl, `${base}/admin/api/manifest`, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    if (!res.ok) return null;
    const live = await res.json();
    return live && typeof live === 'object' && !Array.isArray(live) ? live : null;
  } catch {
    return null;
  }
}

/** GitHub manifest + live one: published content from GitHub, everything else from the server. */
function overlay(github, live) {
  if (!live) return github;
  const out = {};
  for (const k of OWNED) if (github && github[k] !== undefined) out[k] = github[k];
  for (const k of OWNED) if (out[k] === undefined && live[k] !== undefined) out[k] = live[k];
  for (const [k, v] of Object.entries(live)) if (!OWNED.includes(k)) out[k] = v;
  return out;
}

/** Writes group data (patch = { key: value }) and/or history notes. Throws a readable message. */
async function putLive(base, token, patch, actions, fetchImpl = fetch) {
  const res = await timedFetch(fetchImpl, `${base}/admin/api/meta`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch: patch || {}, actions: actions || [] }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).message || msg;
    } catch {
      /* keep the status */
    }
    throw new Error(`Serveur du groupe : ${msg}`);
  }
}

/**
 * Change stream of the server (Server-Sent Events). Emits 'event' (topic) for every message, and
 * 'open' after each (re)connection. Reconnects by itself, slower and slower while the server is down.
 */
class LiveStream extends EventEmitter {
  constructor({ getBase }) {
    super();
    this.getBase = getBase;
    this.req = null;
    this.timer = null;
    this.delay = 5000;
    this.stopped = true;
    this.base = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.req) this.req.destroy();
    this.req = null;
  }

  /** Call when the server address may have changed (new manifest). */
  check() {
    if (this.stopped) return;
    const base = this.getBase();
    if (base !== this.base && this.req) this.req.destroy(); // reconnects to the new address
    else if (base && !this.req && !this.timer) this.connect();
  }

  retry() {
    this.req = null;
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 60000);
  }

  connect() {
    const base = this.getBase();
    this.base = base;
    if (!base) return this.retry();
    let url;
    try {
      url = new URL(`${base}/admin/api/stream`);
    } catch {
      return this.retry();
    }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.get(url, { headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      this.delay = 5000;
      res.setEncoding('utf8');
      let buf = '';
      let idle = setTimeout(() => req.destroy(), 70000); // the server pings every 25 s
      this.emit('open');
      res.on('data', (chunk) => {
        clearTimeout(idle);
        idle = setTimeout(() => req.destroy(), 70000);
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = block.match(/^event: ([a-z]{2,20})$/m);
          if (m) this.emit('event', m[1]);
        }
      });
      res.on('end', () => clearTimeout(idle));
    });
    req.on('error', () => {});
    req.on('close', () => this.retry());
    this.req = req;
  }
}

module.exports = { OWNED, serverBase, fetchLive, overlay, putLive, LiveStream };
