'use strict';

/**
 * Minimal Discord Rich Presence client (local IPC, no dependency).
 * Shows "Playing Lowkey Syndicate — Drift on Haruna in a BMW M2" on the
 * member's Discord profile, with buttons to join the group.
 *
 * Protocol: frames of [int32 opcode][int32 length][JSON] over the local
 * discord-ipc-N pipe/socket. 0 = handshake, 1 = frame, 2 = close.
 */

const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

function ipcPath(id) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${id}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
  return path.join(base.replace(/\/$/, ''), `discord-ipc-${id}`);
}

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/** Keep the text Discord-compatible (2 to 128 chars). */
function clip(text) {
  const s = String(text || '').trim();
  if (!s) return undefined;
  return (s.length < 2 ? `${s} ` : s).slice(0, 128);
}

class DiscordPresence extends EventEmitter {
  constructor({ ipcPathFor = ipcPath } = {}) {
    super();
    this.ipcPathFor = ipcPathFor;
    this.clientId = null;
    this.enabled = true;
    this.socket = null;
    this.ready = false;
    this.activity = null;
    this.retryTimer = null;
    this.buffer = Buffer.alloc(0);
  }

  configure({ clientId, enabled }) {
    const changed = clientId !== this.clientId || enabled !== this.enabled;
    this.clientId = clientId || null;
    this.enabled = enabled !== false;
    if (!changed) return;
    this.disconnect();
    if (this.clientId && this.enabled) this.connect();
  }

  get connected() {
    return this.ready;
  }

  connect(index = 0) {
    clearTimeout(this.retryTimer);
    if (!this.clientId || !this.enabled) return;
    if (index > 9) {
      // Discord not running: try again later
      this.retryTimer = setTimeout(() => this.connect(0), 30000);
      return;
    }
    const socket = net.createConnection(this.ipcPathFor(index));
    let opened = false;
    socket.once('connect', () => {
      opened = true;
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      socket.write(encode(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => {
      if (!opened) this.connect(index + 1);
    });
    socket.on('close', () => {
      if (!opened) return;
      const wasReady = this.ready;
      this.ready = false;
      this.socket = null;
      if (wasReady) this.emit('disconnected');
      if (this.clientId && this.enabled) this.retryTimer = setTimeout(() => this.connect(0), 15000);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      let msg = null;
      try {
        msg = JSON.parse(this.buffer.subarray(8, 8 + len).toString('utf8'));
      } catch {
        msg = null;
      }
      this.buffer = this.buffer.subarray(8 + len);
      if (op === OP_CLOSE) {
        this.emit('warning', new Error((msg && msg.message) || 'Discord a fermé la connexion'));
        if (this.socket) this.socket.destroy();
        return;
      }
      if (msg && msg.evt === 'READY') {
        this.ready = true;
        this.emit('ready', msg.data && msg.data.user);
        this.flush();
      } else if (msg && msg.evt === 'ERROR') {
        this.emit('warning', new Error((msg.data && msg.data.message) || 'Erreur Discord'));
      }
    }
  }

  /**
   * activity = { details, state, startedAt, largeImage, largeText, smallImage, smallText, buttons: [{label, url}] }
   * or null to clear.
   */
  setActivity(activity) {
    this.activity = activity;
    this.flush();
  }

  flush() {
    if (!this.ready || !this.socket) return;
    const a = this.activity;
    const activity = a
      ? {
          details: clip(a.details),
          state: clip(a.state),
          timestamps: a.startedAt ? { start: Math.floor(a.startedAt / 1000) } : undefined,
          assets: a.largeImage || a.smallImage
            ? { large_image: a.largeImage, large_text: clip(a.largeText), small_image: a.smallImage, small_text: clip(a.smallText) }
            : undefined,
          buttons: (a.buttons || []).filter((b) => b && b.label && /^https:\/\//.test(b.url || '')).slice(0, 2).map((b) => ({ label: String(b.label).slice(0, 32), url: b.url })),
          instance: false,
        }
      : null;
    if (activity && activity.buttons && !activity.buttons.length) delete activity.buttons;
    this.socket.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: crypto.randomUUID() }));
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    this.ready = false;
    if (this.socket) {
      this.socket.removeAllListeners('close');
      this.socket.destroy();
      this.socket = null;
    }
  }
}

module.exports = { DiscordPresence, encode, ipcPath };
