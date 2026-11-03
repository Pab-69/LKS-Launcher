'use strict';

/**
 * Host a private game with the dedicated server that ships with Assetto Corsa
 * (assettocorsa/server/acServer.exe): build server_cfg.ini / entry_list.ini,
 * pack the minimal content the server needs (checksums), run and stop it.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const ini = require('./ini');
const { contentDir } = require('./acContent');

const DEFAULT_PORTS = { tcp: 9600, udp: 9600, http: 8081 };

function serverDir(acRoot) {
  return path.join(acRoot, 'server');
}

function serverExe(acRoot) {
  const dir = serverDir(acRoot);
  const candidates = process.platform === 'win32' ? ['acServer.exe'] : ['acServer', 'acServer.exe'];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/** Sun angle used by the server: same convention as race.ini. */
function sunAngle(hours) {
  return Math.max(-80, Math.min(80, Math.round((hours - 13) * 16)));
}

/**
 * o = { name, track, layout, cars: [{ id, skins: [] }], slots, mode: 'free'|'race',
 *       practiceMinutes, qualifyMinutes, raceLaps, timeOfDay, weather, ambient, road,
 *       password, adminPassword, ports: {tcp, udp, http}, lobby, welcome }
 */
function buildServerConfig(o) {
  const ports = { ...DEFAULT_PORTS, ...(o.ports || {}) };
  const cars = (o.cars || []).filter((c) => c && c.id);
  if (!o.track) throw new Error('Choisis un circuit');
  if (!cars.length) throw new Error('Choisis au moins une voiture');
  const slots = clampInt(o.slots, 1, 64, 12);
  const free = o.mode !== 'race';
  const ambient = clampInt(o.ambient, 0, 40, 22);
  const road = clampInt(o.road, 0, 55, ambient + 6);

  const cfg = {
    SERVER: {
      NAME: String(o.name || 'Partie LKS').replace(/[\r\n;]/g, ' ').slice(0, 60),
      CARS: cars.map((c) => c.id).join(';'),
      CONFIG_TRACK: o.layout || '',
      TRACK: o.track,
      SUN_ANGLE: sunAngle(o.timeOfDay ?? 14),
      PASSWORD: o.password || '',
      ADMIN_PASSWORD: o.adminPassword || '',
      UDP_PORT: ports.udp,
      TCP_PORT: ports.tcp,
      HTTP_PORT: ports.http,
      MAX_BALLAST_KG: 150,
      QUALIFY_MAX_WAIT_PERC: 120,
      RACE_PIT_WINDOW_START: 0,
      RACE_PIT_WINDOW_END: 0,
      REVERSED_GRID_RACE_POSITIONS: 0,
      LOCKED_ENTRY_LIST: 0,
      PICKUP_MODE_ENABLED: 1,
      LOOP_MODE: 1,
      SLEEP_TIME: 1,
      CLIENT_SEND_INTERVAL_HZ: 18,
      SEND_BUFFER_SIZE: 0,
      RECV_BUFFER_SIZE: 0,
      RACE_OVER_TIME: 180,
      KICK_QUORUM: 85,
      VOTING_QUORUM: 80,
      VOTE_DURATION: 20,
      BLACKLIST_MODE: 1,
      FUEL_RATE: 100,
      DAMAGE_MULTIPLIER: clampInt(o.damage, 0, 100, 50),
      TYRE_WEAR_RATE: 100,
      ALLOWED_TYRES_OUT: free ? -1 : 2,
      ABS_ALLOWED: 1,
      TC_ALLOWED: 1,
      STABILITY_ALLOWED: 0,
      AUTOCLUTCH_ALLOWED: 1,
      TYRE_BLANKETS_ALLOWED: 1,
      FORCE_VIRTUAL_MIRROR: 0,
      REGISTER_TO_LOBBY: o.lobby ? 1 : 0,
      MAX_CLIENTS: slots,
      NUM_THREADS: 2,
      UDP_PLUGIN_LOCAL_PORT: 0,
      UDP_PLUGIN_ADDRESS: '',
      AUTH_PLUGIN_ADDRESS: '',
      LEGAL_TYRES: '',
      START_RULE: 1,
      RACE_GAS_PENALTY_DISABLED: 0,
      TIME_OF_DAY_MULT: 1,
      RESULT_SCREEN_TIME: 60,
      MAX_CONTACTS_PER_KM: -1,
      RACE_EXTRA_LAP: 0,
      WELCOME_MESSAGE: '',
    },
    FTP: { HOST: '', LOGIN: '', PASSWORD: '', FOLDER: '', LINUX: 0 },
    PRACTICE: { NAME: free ? 'Session libre' : 'Essais', TIME: free ? 720 : clampInt(o.practiceMinutes, 0, 240, 10), IS_OPEN: 1 },
  };
  if (!free) {
    if (clampInt(o.qualifyMinutes, 0, 120, 10) > 0) cfg.QUALIFY = { NAME: 'Qualifications', TIME: clampInt(o.qualifyMinutes, 0, 120, 10), IS_OPEN: 1 };
    cfg.RACE = { NAME: 'Course', LAPS: clampInt(o.raceLaps, 1, 200, 10), TIME: 0, WAIT_TIME: 60, IS_OPEN: 1 };
  }
  cfg.DYNAMIC_TRACK = { SESSION_START: 95, RANDOMNESS: 2, SESSION_TRANSFER: 90, LAP_GAIN: 10 };
  cfg.WEATHER_0 = {
    GRAPHICS: o.weather || '3_clear',
    BASE_TEMPERATURE_AMBIENT: ambient,
    BASE_TEMPERATURE_ROAD: Math.max(0, road - ambient), // relative to ambient
    VARIATION_AMBIENT: 1,
    VARIATION_ROAD: 1,
    WIND_BASE_SPEED_MIN: 0,
    WIND_BASE_SPEED_MAX: 0,
    WIND_BASE_DIRECTION: 0,
    WIND_VARIATION_DIRECTION: 0,
  };
  cfg.DATA = { DESCRIPTION: o.welcome || '', EXSERVEREXE: '', EXSERVERBAT: '', EXSERVERHIDEWIN: 0, WEBLINK: '', WELCOME_PATH: '' };

  // Entry list: spread the slots over the chosen cars, cycling through skins.
  const entries = {};
  for (let i = 0; i < slots; i++) {
    const car = cars[i % cars.length];
    const skins = car.skins && car.skins.length ? car.skins : [''];
    entries[`CAR_${i}`] = {
      MODEL: car.id,
      SKIN: skins[Math.floor(i / cars.length) % skins.length],
      SPECTATOR_MODE: 0,
      DRIVERNAME: '',
      TEAM: '',
      GUID: '',
      BALLAST: 0,
      RESTRICTOR: 0,
    };
  }
  return { serverCfg: ini.stringify(cfg), entryList: ini.stringify(entries), ports };
}

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return 0;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    let n = 0;
    for (const e of fs.readdirSync(src)) n += copyIfExists(path.join(src, e), path.join(dst, e));
    return n;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  // skip identical files (re-hosting the same content is instant)
  if (fs.existsSync(dst)) {
    const d = fs.statSync(dst);
    if (d.size === st.size && d.mtimeMs >= st.mtimeMs) return 0;
  }
  fs.copyFileSync(src, dst);
  return 1;
}

/**
 * Copy into server/content only what the dedicated server reads: car data
 * (checksums) and the track layout's data, AI line and ui files.
 */
function packContent(acRoot, dir, { cars, track, layout }) {
  let copied = 0;
  for (const car of cars) {
    const src = path.join(contentDir(acRoot, 'car'), car);
    const dst = path.join(dir, 'content', 'cars', car);
    if (!fs.existsSync(src)) throw new Error(`Voiture ${car} non installée`);
    copied += copyIfExists(path.join(src, 'data.acd'), path.join(dst, 'data.acd'));
    copied += copyIfExists(path.join(src, 'data'), path.join(dst, 'data'));
    copied += copyIfExists(path.join(src, 'ui', 'ui_car.json'), path.join(dst, 'ui', 'ui_car.json'));
  }
  const tSrc = path.join(contentDir(acRoot, 'track'), track);
  const tDst = path.join(dir, 'content', 'tracks', track);
  if (!fs.existsSync(tSrc)) throw new Error(`Circuit ${track} non installé`);
  const base = layout ? path.join(tSrc, layout) : tSrc;
  const out = layout ? path.join(tDst, layout) : tDst;
  copied += copyIfExists(path.join(base, 'data'), path.join(out, 'data'));
  copied += copyIfExists(path.join(base, 'ai'), path.join(out, 'ai'));
  copied += copyIfExists(path.join(tSrc, 'ui', ...(layout ? [layout] : []), 'ui_track.json'), path.join(tDst, 'ui', ...(layout ? [layout] : []), 'ui_track.json'));
  for (const f of fs.readdirSync(tSrc)) {
    if (/^models.*\.ini$/i.test(f) || /^surfaces\.ini$/i.test(f)) copied += copyIfExists(path.join(tSrc, f), path.join(tDst, f));
  }
  return copied;
}

const LOBBY_REFUSED = 'la liste publique du jeu (lobby) a refusé l’inscription du serveur';

/** Why acServer stopped, from the end of its log (Go panic, port taken, missing content, lobby…). */
function serverStopReason(log) {
  const text = (log || []).slice(-60).join('\n');
  if (/bind: (?:only one usage|address already in use)|address already in use|Only one usage of each socket/i.test(text)) return 'un port du serveur est déjà utilisé';
  // acServer quits when the AC lobby can't be reached ("RACHED" sic) or rate-limits it
  if (/LOBBY COULD NOT BE R[E]?ACHED|TOO MANY REGISTRATION ATTEMPTS/i.test(text)) return LOBBY_REFUSED;
  if (/panic:|goroutine \d+/i.test(text)) return 'le serveur a planté';
  if (/cannot find|not found|no such file/i.test(text)) return 'un fichier du circuit ou d’une voiture manque';
  return '';
}

/** Runs one dedicated server at a time and keeps its last log lines. */
class ServerHost extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.log = [];
    this.info = null;
  }

  get running() {
    return Boolean(this.proc);
  }

  push(line) {
    const text = String(line).trimEnd();
    if (!text) return;
    this.log.push(text);
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    this.emit('log', text);
  }

  /**
   * Start the server. `exe` can be overridden with { command, args } (tests).
   */
  start({ acRoot, config, pack, exe, label }) {
    if (this.proc) throw new Error('Un serveur tourne déjà : arrête-le avant d’en lancer un autre');
    const dir = serverDir(acRoot);
    const command = exe ? exe.command : serverExe(acRoot);
    if (!command) throw new Error("Serveur d'Assetto Corsa introuvable (dossier assettocorsa/server). Vérifie l'intégrité des fichiers du jeu dans Steam.");
    const presetDir = path.join(dir, 'presets', 'lks-launcher');
    fs.mkdirSync(presetDir, { recursive: true });
    const cfgFile = path.join(presetDir, 'server_cfg.ini');
    const entryFile = path.join(presetDir, 'entry_list.ini');
    fs.writeFileSync(cfgFile, config.serverCfg);
    fs.writeFileSync(entryFile, config.entryList);
    const copied = pack ? packContent(acRoot, dir, pack) : 0;
    this.log = [];
    this.push(`Contenu préparé (${copied} fichier(s) copié(s))`);
    const args = exe ? exe.args : ['-c', cfgFile, '-e', entryFile];
    this.proc = spawn(command, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.info = { startedAt: Date.now(), ports: config.ports, label: label || '' };
    const onData = (chunk) => String(chunk).split(/\r?\n/).forEach((l) => this.push(l));
    this.proc.stdout.on('data', onData);
    this.proc.stderr.on('data', onData);
    this.proc.on('error', (err) => {
      this.push(`Erreur : ${err.message}`);
      this.proc = null;
      this.emit('stopped', { error: err.message });
    });
    this.proc.on('exit', (code) => {
      this.push(`Serveur arrêté (code ${code})`);
      this.proc = null;
      this.emit('stopped', { code });
    });
    this.emit('started', this.info);
    return this.info;
  }

  stop() {
    if (!this.proc) return false;
    const p = this.proc;
    p.kill();
    setTimeout(() => {
      if (!p.killed && p.exitCode === null) p.kill('SIGKILL');
    }, 3000);
    return true;
  }
}

module.exports = { buildServerConfig, packContent, ServerHost, serverExe, serverDir, DEFAULT_PORTS, sunAngle, serverStopReason, LOBBY_REFUSED };
