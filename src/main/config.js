'use strict';

const fs = require('fs');
const path = require('path');

let electron = null;
try {
  electron = require('electron');
} catch {
  electron = null;
}

const appConfig = require('../../lks.config.json');

const DEFAULTS = {
  acRoot: '',
  documentsDir: '', // "Documents/Assetto Corsa" override (empty = auto)
  driverName: '',
  nationality: 'FRA',
  team: 'Lowkey Syndicate',
  steamId: '',
  manifestUrl: appConfig.manifestUrl,
  autoSync: true,
  closeOnLaunch: false,
  customServers: [], // [{ name, ip, httpPort }]
  favoriteServers: [],
  graphics: { preset: '', appliedAt: null },
  lastRunVersion: '',
  discordPresence: true,
  eventNotifications: true,
  updateNotes: null,
  admin: {
    repo: appConfig.contentRepo,
    tag: appConfig.contentTag || 'content',
    tokenEnc: '', // encrypted with safeStorage when available
  },
  solo: {
    mode: 'practice',
    car: '',
    skin: '',
    track: '',
    layout: '',
    lksOnly: false,
    durationMinutes: 30,
    laps: 5,
    aiCount: 0,
    aiLevel: 90,
    aiAggression: 20,
    startPosition: 'last',
    timeOfDay: 14,
    timeMult: 1,
    weather: '3_clear',
    ambient: 22,
    road: 28,
    trackGrip: 'optimum',
    penalties: true,
    fixedSetup: false,
  },
  assists: {
    preset: 'custom',
    idealLine: false,
    autoBlip: true,
    stabilityControl: 0,
    autoBrake: false,
    autoShifter: false,
    abs: 1,
    tractionControl: 1,
    autoClutch: true,
    visualDamage: true,
    damage: 100,
    fuelRate: 1,
    tyreWear: 1,
    tyreBlankets: true,
    slipstream: 1,
  },
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.existed = fs.existsSync(this.file);
    this.data = deepMerge(structuredClone(DEFAULTS), this.read());
    this.migrate();
  }

  /** Older launchers saved a default URL that has since moved: follow it. */
  migrate() {
    const legacy = appConfig.legacy || {};
    if ((legacy.manifestUrl || []).includes(this.data.manifestUrl)) this.data.manifestUrl = appConfig.manifestUrl;
    if ((legacy.contentRepo || []).includes(this.data.admin.repo)) this.data.admin.repo = appConfig.contentRepo;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Public view sent to the renderer (no secrets). */
  public() {
    const { admin, ...rest } = this.data;
    return {
      ...rest,
      admin: { repo: admin.repo, tag: admin.tag, hasToken: Boolean(admin.tokenEnc) },
    };
  }

  update(patch) {
    const clean = { ...patch };
    delete clean.admin;
    this.data = deepMerge(this.data, clean);
    if (patch.admin) {
      if (typeof patch.admin.repo === 'string') this.data.admin.repo = patch.admin.repo.trim();
      if (typeof patch.admin.tag === 'string') this.data.admin.tag = patch.admin.tag.trim() || 'content';
      if (typeof patch.admin.token === 'string') this.setToken(patch.admin.token.trim());
    }
    this.save();
    return this.public();
  }

  setToken(token) {
    if (!token) {
      this.data.admin.tokenEnc = '';
      return;
    }
    const safe = electron && electron.safeStorage;
    if (safe && safe.isEncryptionAvailable()) {
      this.data.admin.tokenEnc = 'enc:' + safe.encryptString(token).toString('base64');
    } else {
      this.data.admin.tokenEnc = 'b64:' + Buffer.from(token).toString('base64');
    }
  }

  getToken() {
    const value = this.data.admin.tokenEnc || '';
    if (value.startsWith('enc:')) {
      return electron.safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
    }
    if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString();
    return '';
  }
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      target[key] = deepMerge(target[key], value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

module.exports = { Settings, DEFAULTS, appConfig, deepMerge };
