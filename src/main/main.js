'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen, nativeImage, Notification, clipboard } = require('electron');

const { Settings } = require('./config');
const { detectAcRoot, detectSteamUser, isAcRoot, acDocumentsDir } = require('./paths');
const { scanCars, scanTracks, scanWeathers, resolveContentFile, readCar, readTrack } = require('./acContent');
const { ContentSync } = require('./sync');
const { buildSoloRaceIni, buildOnlineRaceIni, buildAssistsIni, GameLauncher } = require('./launch');
const { getServerInfo, getServerCars, resolveTrack } = require('./servers');
const { GitHub } = require('./github');
const { Publisher, isOfficial } = require('./publisher');
const { listFiles, hashFolder } = require('./hash');
const { contentDir } = require('./acContent');
const { CspManager, checkVcRedist, compareVersions } = require('./csp');
const graphics = require('./graphics');
const crashlog = require('./crashlog');
const { BrandingManager } = require('./branding');
const { SetupSync, localSetupCars } = require('./setups');
const { DiscordPresence } = require('./discord');
const { appConfig } = require('./config');
const { buildServerConfig, ServerHost, serverExe } = require('./hosting');
const { findGateway, isPrivateIp } = require('./upnp');
const { networkAddresses, LABELS: NET_LABELS } = require('./netinfo');
const { encodeInvite, decodeInvite } = require('../shared/invite');
const vpn = require('./vpn');
const { TelemetryManager } = require('./telemetry');
const { SharedMemorySource, SimulatedSource } = require('./telemetry/source');
const { Simulator } = require('./telemetry/simulator');
const telemetryTools = require('./telemetry/tools');
const ingame = require('./telemetry/ingame');
const { Leaderboard } = require('./telemetry/leaderboard');
const { courseVersion, referenceFrom, MODE_LABELS, MODE_IDS, MODES } = require('./telemetry/drift');
const { autoCourse } = require('./telemetry/ailine');
const { collectRuns } = require('./telemetry/tandem');
const ghosts = require('./telemetry/ghosts');
const champ = require('./telemetry/championship');
const { dedupe: dedupeBattles } = require('./telemetry/battles');

const MANIFEST_POLL_MS = 5 * 60 * 1000;

// Dev/test hook: isolated profile folder.
if (process.env.LKS_USER_DATA) app.setPath('userData', process.env.LKS_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: 'lks-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let settings = null;
let sync = null;
const game = new GameLauncher();
let contentCache = null;
let updater = null;
let csp = null;
let branding = null;
let setupsSync = null;
const presence = new DiscordPresence();
const startedAt = Date.now();
const notifiedEvents = new Set();
const host = new ServerHost();
let hostState = null; // { name, ports, password, track, layout, upnp: {state, error, externalIp}, invites: [] }
let gateway = null;
let telemetry = null;
let mappedPorts = [];

const acRoot = () => settings.data.acRoot;
const docsDir = () => acDocumentsDir(settings.data, app.getPath('documents'));
const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    backgroundColor: '#07070a',
    title: 'LKS Launcher',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

async function firstRunDetection() {
  let changed = false;
  if (!settings.data.acRoot || !isAcRoot(settings.data.acRoot)) {
    const found = await detectAcRoot();
    if (found) {
      settings.data.acRoot = found;
      changed = true;
    }
  }
  if (!settings.data.steamId || !settings.data.driverName) {
    const user = await detectSteamUser();
    if (!settings.data.steamId && user.steamId) {
      settings.data.steamId = user.steamId;
      changed = true;
    }
    if (!settings.data.driverName && user.personaName) {
      settings.data.driverName = user.personaName;
      changed = true;
    }
  }
  if (changed) settings.save();
}

function scanContent(force) {
  if (!acRoot()) return { cars: [], tracks: [], weathers: [] };
  if (!contentCache || force) {
    contentCache = { cars: scanCars(acRoot()), tracks: scanTracks(acRoot()), weathers: scanWeathers(acRoot()) };
  }
  return contentCache;
}

function lksIds() {
  return {
    car: new Set(sync.manifest.cars.map((c) => c.id)),
    track: new Set(sync.manifest.tracks.map((t) => t.id)),
  };
}

function applyBrandIcon() {
  const icon = branding.file('icon.png');
  if (icon && win && !win.isDestroyed()) win.setIcon(nativeImage.createFromPath(icon));
}

// ---------------------------------------------------------------- Discord Rich Presence
function brandLogoUrl() {
  const files = (sync.manifest.branding && sync.manifest.branding.files) || [];
  const logo = files.find((f) => f.name === 'logo.png');
  return logo ? logo.url : undefined;
}

function presenceButtons() {
  const d = sync.manifest.discord || {};
  const buttons = [];
  if (d.inviteUrl) buttons.push({ label: 'Rejoindre le Discord', url: d.inviteUrl });
  buttons.push({ label: 'Télécharger le launcher', url: `https://github.com/${appConfig.contentRepo}/releases/latest` });
  return buttons;
}

let presenceState = { details: 'Dans le launcher', state: 'Lowkey Syndicate', startedAt };

function setPresence(state) {
  presenceState = state || presenceState;
  presence.setActivity({ ...presenceState, largeImage: brandLogoUrl(), largeText: 'Lowkey Syndicate', buttons: presenceButtons() });
}

function configurePresence() {
  const clientId = (sync.manifest.discord && sync.manifest.discord.clientId) || appConfig.discordClientId || null;
  presence.configure({ clientId: clientId && /^\d{15,25}$/.test(String(clientId)) ? String(clientId) : null, enabled: settings.data.discordPresence !== false });
  setPresence();
}

// ---------------------------------------------------------------- events: reminders before a session
function checkEvents() {
  if (settings.data.eventNotifications === false || !Notification.isSupported()) return;
  const now = Date.now();
  for (const ev of sync.manifest.events || []) {
    const start = Date.parse(ev.date);
    if (!start || !ev.id) continue;
    const minutes = Math.round((start - now) / 60000);
    const key15 = `${ev.id}:15`;
    const key0 = `${ev.id}:0`;
    let body = null;
    if (minutes <= 15 && minutes > 1 && !notifiedEvents.has(key15)) {
      notifiedEvents.add(key15);
      body = `Ça commence dans ${minutes} min${ev.server ? ' — le serveur est prêt' : ''}.`;
    } else if (minutes <= 1 && minutes >= -10 && !notifiedEvents.has(key0)) {
      notifiedEvents.add(key0);
      notifiedEvents.add(key15);
      body = "C'est parti ! Clique pour rejoindre.";
    }
    if (!body) continue;
    const n = new Notification({ title: `${ev.title || 'Event LKS'}`, body, icon: branding.file('icon.png') || path.join(__dirname, '..', '..', 'assets', 'icon.png') });
    n.on('click', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      send('navigate', { route: ev.server ? 'servers' : 'home', params: ev.server ? { select: ev.server } : {} });
    });
    n.show();
  }
}

function syncSetups() {
  if (!acRoot() || !fs.existsSync(docsDir())) return;
  setupsSync
    .sync(sync.manifest.setups || [])
    .then((r) => {
      if (r.installed) send('toast', { kind: 'success', text: `Setups LKS mis à jour (${r.installed} fichier(s))` });
      for (const e of r.errors) send('toast', { kind: 'warn', text: `Setups : ${e}` });
    })
    .catch(() => {});
}

// ---------------------------------------------------------------- hosting a private game
function computeInvites() {
  if (!hostState) return [];
  const invites = [];
  const make = (kind, address) => ({
    kind,
    label: NET_LABELS[kind] || kind,
    address,
    code: encodeInvite({ name: hostState.name, address, tcpPort: hostState.ports.tcp, httpPort: hostState.ports.http, password: hostState.password, kind }),
  });
  const ext = hostState.upnp && hostState.upnp.externalIp;
  if (ext && hostState.upnp.state === 'open' && !isPrivateIp(ext)) invites.push(make('internet', ext));
  for (const n of networkAddresses()) invites.push(make(n.kind, n.address));
  return invites;
}

async function openPorts() {
  const ports = hostState.ports;
  hostState.upnp = { state: 'working' };
  send('host:changed');
  try {
    gateway = await findGateway();
    const wanted = [[ports.tcp, 'TCP'], [ports.udp, 'UDP'], [ports.http, 'TCP']];
    for (const [port, proto] of wanted) {
      if (mappedPorts.some((m) => m[0] === port && m[1] === proto)) continue;
      await gateway.map(port, proto, `LKS Launcher ${proto} ${port}`);
      mappedPorts.push([port, proto]);
    }
    const externalIp = await gateway.externalIp().catch(() => null);
    if (externalIp && isPrivateIp(externalIp)) {
      hostState.upnp = { state: 'cgnat', externalIp, error: "Ta box n'a pas d'adresse publique (IP partagée / 4G) : passe par Radmin VPN ou ZeroTier." };
    } else {
      hostState.upnp = { state: 'open', externalIp };
    }
  } catch (err) {
    hostState.upnp = { state: 'failed', error: err.message };
  }
  hostState.invites = computeInvites();
  send('host:changed');
}

function closePorts() {
  const g = gateway;
  const list = mappedPorts;
  mappedPorts = [];
  if (!g) return Promise.resolve();
  return Promise.all(list.map(([port, proto]) => g.unmap(port, proto).catch(() => {})));
}

async function hostStatus() {
  const s = { running: host.running, serverFound: Boolean(acRoot() && serverExe(acRoot())), log: host.log.slice(-120), networks: networkAddresses(), state: hostState };
  if (hostState) hostState.invites = computeInvites(); // VPN may have been joined meanwhile
  if (host.running && hostState) {
    const info = await getServerInfo({ ip: '127.0.0.1', httpPort: hostState.ports.http, name: hostState.name });
    s.info = info.online ? { clients: info.clients, maxClients: info.maxClients, track: info.track } : null;
    s.uptime = Date.now() - host.info.startedAt;
  }
  return s;
}

function syncBranding() {
  branding
    .sync(sync.manifest.branding)
    .then((changed) => {
      if (!changed) return;
      send('branding:changed', branding.status());
      applyBrandIcon();
    })
    .catch(() => {});
}

async function refreshManifest({ autoSync } = {}) {
  const before = sync.manifest.updatedAt;
  await sync.loadManifest();
  send('sync:changed', sync.summary());
  syncBranding();
  syncSetups();
  applyDriftCourses();
  configurePresence();
  checkEvents();
  const pending = sync.summary();
  if (pending.unknown > 0 && !sync.verifying) await sync.verify(false);
  if (autoSync && settings.data.autoSync && !game.running && acRoot()) {
    const s = sync.summary();
    if (s.pending > 0) {
      sync.enqueue();
      send('toast', { kind: 'info', text: `Synchronisation : ${s.pending} élément(s) à mettre à jour` });
    }
  }
  return sync.manifest.updatedAt !== before;
}

function setupSync() {
  sync = new ContentSync({
    dataDir: app.getPath('userData'),
    getAcRoot: acRoot,
    getManifestUrl: () => settings.data.manifestUrl,
  });
  try {
    sync.cleanup();
  } catch {
    /* ignore */
  }
  sync.on('changed', () => send('sync:changed', sync.summary()));
  sync.on('progress', (p) => send('sync:progress', p));
  sync.on('verify', (v) => send('sync:verify', v));
  sync.on('failed', (e) => send('toast', { kind: 'error', text: `${e.name || e.id} : ${e.error}` }));
  sync.on('done', (results) => {
    contentCache = null;
    const ok = results.filter((r) => r.ok).length;
    const ko = results.length - ok;
    if (results.length) send('toast', { kind: ko ? 'warn' : 'success', text: ko ? `${ok} installé(s), ${ko} en erreur` : `Contenu LKS à jour (${ok} installé(s))` });
    send('content:changed');
    autoCourses.clear(); // tracks may have changed
    driftSignature = null;
    applyDriftCourses();
  });
  setInterval(() => refreshManifest({ autoSync: true }).catch(() => {}), MANIFEST_POLL_MS);
}

// ---------------------------------------------------------------- telemetry
const fmtLap = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

function dashUrls(port) {
  return networkAddresses().filter((n) => n.kind === 'lan' || n.kind === 'other').map((n) => `http://${n.address}:${port}`);
}

async function applyDash() {
  const t = settings.data.telemetry;
  if (t.dashEnabled && !telemetry.dash.running) {
    try {
      await telemetry.dash.start(t.dashPort || 8095);
    } catch (err) {
      send('toast', { kind: 'error', text: `Tableau de bord téléphone : ${err.message}` });
    }
  } else if (!t.dashEnabled && telemetry.dash.running) telemetry.dash.stop();
}

/**
 * Drift course (clips, reference line, rules) for a track/layout: the one
 * published by the admins, otherwise the one generated from the installed
 * track's AI line.
 */
const autoCourses = new Map();
function autoDriftCourse(track, layout = '') {
  const key = `${track}|${layout}`;
  if (!autoCourses.has(key)) {
    let course = null;
    try {
      course = autoCourse(acRoot(), track, layout);
    } catch (err) {
      console.warn('[drift] ligne IA illisible', key, err.message);
    }
    autoCourses.set(key, course);
  }
  return autoCourses.get(key);
}
function driftCourseInfo(c) {
  const all = (sync && sync.manifest && sync.manifest.drift) || {};
  const published = all[`${c.track}|${c.layout || ''}`];
  if (published) return { course: published, source: 'published' };
  const auto = autoDriftCourse(c.track, c.layout || '');
  return { course: auto, source: auto ? 'auto' : null };
}
const driftCourse = (c) => driftCourseInfo(c).course;

/** Courses for the in-game app: published ones + automatic ones for the group's tracks. */
function allDriftCourses() {
  const out = {};
  for (const t of (sync.manifest && sync.manifest.tracks) || []) {
    for (const l of t.layouts && t.layouts.length ? t.layouts : [{ id: '' }]) {
      const c = driftCourse({ track: t.id, layout: l.id || '' });
      if (c) out[`${t.id}|${l.id || ''}`] = c;
    }
  }
  return { ...out, ...((sync.manifest && sync.manifest.drift) || {}) };
}

let driftSignature = null;
/** After a manifest change: re-judge local laps and update the in-game app's clips. */
function applyDriftCourses() {
  if (!telemetry || !sync) return;
  const sig = JSON.stringify((sync.manifest && sync.manifest.drift) || {});
  if (sig === driftSignature) return;
  driftSignature = sig;
  try {
    if (telemetry.rescoreAll()) send('telemetry:lap', null);
    if (acRoot()) ingame.writeCourses(acRoot(), allDriftCourses());
  } catch (err) {
    console.warn('[drift]', err.message);
  }
}

/** Keep only known rule fields with sane values (admins' custom rules). */
function cleanRules(rules) {
  const out = {};
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const rule = (r) => (r ? { action: ['none', 'points', 'zero'].includes(r.action) ? r.action : 'points', points: num(r.points, 0, 100) } : undefined);
  for (const m of MODE_IDS) {
    const r = rules[m];
    if (!r || typeof r !== 'object') continue;
    const o = {};
    if (r.angleTarget !== undefined) o.angleTarget = num(r.angleTarget, 10, 80);
    if (Array.isArray(r.lineTol)) o.lineTol = [num(r.lineTol[0], 0, 30), num(r.lineTol[1], 1, 60)];
    if (r.clipScale !== undefined) o.clipScale = num(r.clipScale, 0.3, 3);
    if (r.weights) o.weights = { angle: num(r.weights.angle, 0, 100), speed: num(r.weights.speed, 0, 100), line: num(r.weights.line, 0, 100) };
    for (const k of ['spin', 'reverse', 'missedClip']) if (r[k]) o[k] = rule(r[k]);
    if (r.off) o.off = { ...rule(r.off), wheels: num(r.off.wheels, 1, 4) };
    if (r.straighten) o.straighten = { ...rule(r.straighten), minMs: num(r.straighten.minMs, 100, 3000) };
    if (r.tandem) {
      const t = r.tandem;
      o.tandem = {};
      if (Array.isArray(t.gap)) o.tandem.gap = [num(t.gap[0], 0, 30), num(t.gap[1], 1, 60)];
      for (const k of ['contact', 'pass', 'lost']) if (t[k]) o.tandem[k] = rule(t[k]);
    }
    out[m] = o;
  }
  return out;
}

/** Tandem runs saved by the in-game app (it sees the car in front). */
async function importTandemRuns() {
  if (!telemetry || !acRoot() || settings.data.telemetry.enabled === false) return;
  const appDir = ingame.appDir(acRoot());
  try {
    if (telemetry.attachGhosts(path.join(appDir, 'ghosts'))) send('telemetry:lap', null);
  } catch (err) {
    console.warn('[ghost]', err.message);
  }
  const dir = path.join(appDir, 'runs');
  if (!fs.existsSync(dir)) return;
  for (const lap of collectRuns(dir, { name: settings.data.driverName || '', steamId: settings.data.steamId || '' })) {
    try {
      await telemetry.addTandemRun(lap);
    } catch (err) {
      console.warn('[tandem]', err.message);
    }
  }
}

function setupTelemetry() {
  const source = process.env.LKS_TELEMETRY_SIM ? new SimulatedSource(new Simulator({ lapMs: 30000 })) : new SharedMemorySource();
  telemetry = new TelemetryManager({
    dataDir: app.getPath('userData'),
    source,
    getDriver: () => ({ name: settings.data.driverName || 'Pilote', steamId: settings.data.steamId || '' }),
    getBoardConfig: () => sync.manifest.leaderboard || null,
    getSettings: () => settings.data.telemetry,
    getCourse: driftCourse,
    getRounds: (combo) => champ.openRounds((sync.manifest && sync.manifest.championships) || [], combo),
  });
  telemetry.on('battle', (b) => {
    const res = b.modes.normal;
    const me = (settings.data.driverName || '').trim().toLowerCase();
    const other = res.drivers.find((d) => d.name.trim().toLowerCase() !== me) || res.drivers[1];
    let text = `Battle ${res.drivers[0].name} – ${res.drivers[1].name} : ${res.omt ? 'one more time' : `${res.winner} gagne`}`;
    if (me && res.drivers.some((d) => d.name.trim().toLowerCase() === me)) text = `Battle contre ${other.name} : ${res.omt ? 'one more time !' : res.winner.trim().toLowerCase() === me ? 'gagnée' : 'perdue'} (${res.drivers.map((d) => d.total).join(' – ')})`;
    send('toast', { kind: res.omt ? 'info' : 'success', text });
    send('telemetry:lap', null);
  });
  applyDriftCourses();
  telemetry.on('lap', ({ lap, pbTime, pbDrift, pbTandem }) => {
    send('telemetry:lap', lap);
    const label = (modes) => (modes.includes('normal') ? '' : ` (${MODE_LABELS[modes[0]]})`);
    if (pbTandem && pbTandem.length) send('toast', { kind: 'success', text: `Record de tandem : ${(lap.tandem.modes[pbTandem.includes('normal') ? 'normal' : pbTandem[0]] || {}).score}/100${label(pbTandem)}` });
    else if (pbDrift && pbDrift.length) send('toast', { kind: 'success', text: `Record de drift : ${(lap.drift.modes[pbDrift.includes('normal') ? 'normal' : pbDrift[0]] || {}).score}/100${label(pbDrift)}` });
    else if (pbTime) send('toast', { kind: 'success', text: `Record perso : ${fmtLap(lap.lapMs)}` });
  });
  telemetry.on('submitted', () => send('toast', { kind: 'info', text: 'Envoyé au classement' }));
  telemetry.on('submitError', (err) => send('toast', { kind: 'warn', text: err.message }));
  telemetry.on('warning', (err) => console.warn('[telemetry]', err.message));
  telemetry.start();
  setInterval(importTandemRuns, 5000);
  setInterval(() => {
    const live = telemetry.live();
    if (live) send('telemetry:live', live);
  }, 100);
  applyDash();
}

function setupHosting() {
  host.on('stopped', () => {
    closePorts();
    hostState = null;
    if (!game.running) setPresence({ details: 'Dans le launcher', state: 'Lowkey Syndicate', startedAt: Date.now() });
    send('host:changed');
  });
  host.on('log', () => send('host:log'));
}

function setupSync_() {
  setupsSync = new SetupSync({ dataDir: app.getPath('userData'), getDocsDir: docsDir });
  setInterval(checkEvents, 30000);
}

function setupGame() {
  game.on('started', () => {
    for (const id of Object.keys(settings.data.tools || {})) {
      if (settings.data.tools[id] && telemetryTools.findTool(id)) {
        try {
          telemetryTools.launchTool(id);
        } catch {
          /* ignore */
        }
      }
    }
    send('game:state', { running: true });
    if (game.presence) setPresence({ ...game.presence, startedAt: Date.now() });
    if (settings.data.closeOnLaunch && win) win.minimize();
  });
  game.on('exited', (info) => {
    if (telemetry) telemetry.source.detach();
    send('game:state', { running: false, ...info });
    if (!info.error && crashlog.looksLikeCrash(info)) {
      try {
        lastCrash = { ...crashlog.diagnose({ ...info, launch: lastLaunch, version: app.getVersion(), docsDir: docsDir() }), launch: lastLaunch, at: new Date().toISOString(), canRestore: graphics.hasBackup(docsDir()) };
        send('game:crash', lastCrash);
      } catch (err) {
        console.warn('[crash]', err.message);
      }
    }
    setPresence({ details: 'Dans le launcher', state: 'Lowkey Syndicate', startedAt: Date.now() });
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    refreshManifest({ autoSync: true }).catch(() => {});
  });
}

let lastLaunch = null;
let lastCrash = null;

/** Launch acs.exe after fixing a screen mode that cannot exist (older versions could write one). */
function startGame(launch) {
  try {
    if (graphics.repairVideoIni(docsDir())) send('toast', { kind: 'info', text: 'Résolution d’écran corrigée avant le lancement' });
  } catch {
    /* unreadable video.ini: the game will say so */
  }
  lastLaunch = launch;
  game.launch(acRoot(), docsDir());
}

function ensureReady() {
  if (!acRoot() || !isAcRoot(acRoot())) throw new Error("Dossier d'Assetto Corsa introuvable : configurez-le dans les Paramètres");
  if (game.running) throw new Error('Assetto Corsa est déjà en cours');
  if (sync.running) throw new Error('Synchronisation en cours, patientez quelques instants');
}

let updaterState = { state: 'idle' };
let lastUpdateCheck = 0;
let whatsNew = null;

function setUpdater(patch) {
  updaterState = { ...updaterState, ...patch };
  send('updater:status', updaterState);
}

/** GitHub gives release notes as HTML (or a list of versions): make plain text. */
function notesToText(notes) {
  if (!notes) return '';
  const html = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes);
  return html
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/h\d|\/ul|\/li)[^>]*>/gi, '\n')
    .replace(/<h\d[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function checkForUpdates() {
  if (!updater) return Promise.resolve(null);
  lastUpdateCheck = Date.now();
  return updater.checkForUpdates().catch((e) => setUpdater({ state: 'error', error: e.message }));
}

/** First start after an update: remember which "what's new" to show. */
function computeWhatsNew() {
  const current = app.getVersion();
  const previous = settings.data.lastRunVersion;
  // v1.0.0 did not record its version: an existing profile without it means an update.
  const updated = previous ? previous !== current : settings.existed;
  if (updated) {
    let notes = '';
    try {
      const { changelogSection, markdownToText } = require('../shared/changelog');
      notes = markdownToText(changelogSection(fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8'), current));
    } catch {
      /* no changelog */
    }
    const pending = settings.data.updateNotes || {};
    if (!notes && pending.version === current) notes = pending.notes;
    whatsNew = { version: current, previous: previous || null, notes };
  }
  if (previous !== current) settings.update({ lastRunVersion: current });
}

function setupUpdater() {
  if (!app.isPackaged) {
    updaterState = { state: 'dev' };
    return;
  }
  // Unpacked/portable builds have no update configuration: nothing to update.
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    updaterState = { state: 'unavailable' };
    return;
  }
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  updater.autoDownload = true; // only the changed blocks are downloaded (blockmap)
  updater.autoInstallOnAppQuit = true; // installed silently when the launcher is closed
  updater.on('checking-for-update', () => updaterState.state !== 'ready' && setUpdater({ state: 'checking' }));
  updater.on('update-available', (i) => setUpdater({ state: 'downloading', version: i.version, percent: 0, notes: notesToText(i.releaseNotes) }));
  updater.on('update-not-available', () => setUpdater({ state: 'latest', checkedAt: new Date().toISOString() }));
  updater.on('download-progress', (p) => setUpdater({ state: 'downloading', percent: p.percent, speed: p.bytesPerSecond, transferred: p.transferred, total: p.total }));
  updater.on('update-downloaded', (i) => {
    const notes = notesToText(i.releaseNotes) || updaterState.notes || '';
    settings.update({ updateNotes: { version: i.version, notes } });
    setUpdater({ state: 'ready', version: i.version, notes, percent: 100 });
  });
  updater.on('error', (e) => setUpdater({ state: 'error', error: e.message }));
  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, 30 * 60 * 1000);
  // Coming back to the launcher after a while: check again.
  app.on('browser-window-focus', () => {
    if (Date.now() - lastUpdateCheck > 15 * 60 * 1000 && updaterState.state !== 'downloading' && updaterState.state !== 'ready') checkForUpdates();
  });
}

// ---------------------------------------------------------------- graphics / CSP
async function gpuName() {
  try {
    const info = await app.getGPUInfo('complete');
    const aux = info.auxAttributes || {};
    const devices = (info.gpuDevice || []).filter((d) => d.active !== false);
    const parts = [aux.glRenderer, ...devices.map((d) => d.deviceString), aux.glVendor].filter(Boolean);
    return parts.join(' | ').replace(/ANGLE \(|Direct3D.*$/g, '').trim();
  } catch {
    return '';
  }
}

function displayInfo() {
  const d = screen.getPrimaryDisplay();
  return {
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    refresh: Math.round(d.displayFrequency || 60),
  };
}

function cspTarget() {
  const pinned = sync.manifest.csp && sync.manifest.csp.version;
  if (pinned) return { version: String(pinned), source: 'lks' };
  if (csp.versions && csp.versions.recommended) return { version: csp.versions.recommended, source: 'recommended' };
  return { version: null, source: null };
}

async function graphicsStatus() {
  if (!csp.versions) await csp.available().catch(() => null);
  const name = await gpuName();
  const target = cspTarget();
  const status = csp.status();
  return {
    csp: status,
    target,
    versions: csp.versions,
    needsUpdate: Boolean(target.version && (!status.installed || compareVersions(status.version, target.version) < 0)),
    vcRedist: await checkVcRedist(),
    gpu: { name, recommended: graphics.recommendPreset(name) },
    display: displayInfo(),
    presets: graphics.presetList(),
    preset: settings.data.graphics.preset || '',
    hasBackup: graphics.hasBackup(docsDir()),
    gameRunning: game.running,
  };
}

function ensureGameClosed() {
  if (!acRoot() || !isAcRoot(acRoot())) throw new Error("Dossier d'Assetto Corsa introuvable : configurez-le dans les Paramètres");
  if (game.running) throw new Error("Fermez Assetto Corsa d'abord");
}

function setupCsp() {
  csp = new CspManager({ dataDir: app.getPath('userData'), getAcRoot: acRoot, pageUrl: process.env.LKS_CSP_PAGE || undefined });
  csp.on('progress', (p) => send('csp:progress', p));
  csp.on('changed', () => send('csp:changed'));
}

// ---------------------------------------------------------------- admin
let publisher = null;
let adminBusy = false;
const hashCache = new Map();

function newGitHub() {
  return new GitHub({ token: settings.getToken(), repo: settings.data.admin.repo, apiBase: process.env.LKS_GITHUB_API || undefined });
}

function getPublisher() {
  const gh = newGitHub();
  publisher = new Publisher({
    gh,
    tag: settings.data.admin.tag,
    log: (line) => send('admin:log', line),
    progress: (p) => send('admin:progress', p),
  });
  return publisher;
}

/** Cheap signature of a folder (count + size + newest mtime) to reuse hashes. */
async function folderSignature(dir) {
  const files = await listFiles(dir);
  let size = 0;
  let mtime = 0;
  for (const rel of files) {
    const st = await fs.promises.stat(path.join(dir, ...rel.split('/')));
    size += st.size;
    mtime = Math.max(mtime, st.mtimeMs);
  }
  return `${files.length}:${size}:${Math.round(mtime)}`;
}

async function cachedHash(kind, id) {
  const dir = path.join(contentDir(acRoot(), kind), id);
  const sig = await folderSignature(dir);
  const key = `${kind}/${id}`;
  const hit = hashCache.get(key);
  if (hit && hit.sig === sig) return hit.hash;
  const { hash } = await hashFolder(dir);
  hashCache.set(key, { sig, hash });
  return hash;
}

async function withAdmin(fn) {
  if (adminBusy) throw new Error('Une publication est déjà en cours');
  adminBusy = true;
  send('admin:busy', true);
  try {
    return await fn();
  } finally {
    adminBusy = false;
    send('admin:busy', false);
    send('admin:progress', null);
  }
}

// ---------------------------------------------------------------- IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function setupIpc() {
  handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, docsDir: docsDir() }));
  handle('window:action', (action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    if (action === 'close') win.close();
  });

  handle('settings:get', () => settings.public());
  handle('settings:update', (patch) => {
    const before = settings.data.acRoot;
    const beforeUrl = settings.data.manifestUrl;
    const out = settings.update(patch || {});
    if (before !== settings.data.acRoot) {
      contentCache = null;
      sync.cleanup();
      send('content:changed');
    }
    if (beforeUrl !== settings.data.manifestUrl || before !== settings.data.acRoot) refreshManifest({ autoSync: true }).catch(() => {});
    else send('sync:changed', sync.summary());
    configurePresence();
    return out;
  });
  handle('settings:detect', async () => {
    const [root, user] = await Promise.all([detectAcRoot(), detectSteamUser()]);
    return { acRoot: root, steamId: user.steamId, personaName: user.personaName };
  });
  handle('settings:validateAcRoot', (dir) => isAcRoot(dir));
  handle('dialog:pickFolder', async (title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choisir un dossier', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('shell:open', (target) => {
    if (/^https?:\/\//.test(target)) return shell.openExternal(target);
    const map = { ac: acRoot(), docs: docsDir(), logs: path.join(docsDir(), 'logs'), cars: path.join(acRoot(), 'content', 'cars'), tracks: path.join(acRoot(), 'content', 'tracks') };
    if (map[target]) return shell.openPath(map[target]);
    return null;
  });

  // Local content
  handle('content:scan', (force) => {
    const c = scanContent(force);
    const ids = lksIds();
    return {
      cars: c.cars.map((x) => ({ ...x, lks: ids.car.has(x.id) })),
      tracks: c.tracks.map((x) => ({ ...x, lks: ids.track.has(x.id) })),
      weathers: c.weathers,
    };
  });
  handle('content:car', (id) => readCar(acRoot(), id));
  handle('content:track', (id) => readTrack(acRoot(), id));

  // Sync
  handle('sync:summary', () => sync.summary());
  handle('sync:list', () => sync.statusList());
  handle('sync:manifest', () => sync.manifest);
  handle('sync:refresh', () => refreshManifest({ autoSync: false }).then(() => sync.summary()));
  handle('sync:start', (targets) => {
    if (!acRoot()) throw new Error("Configurez d'abord le dossier d'Assetto Corsa");
    if (game.running) throw new Error('Fermez Assetto Corsa avant de synchroniser');
    return sync.enqueue(targets || null);
  });
  handle('sync:cancel', () => sync.cancel());
  handle('sync:verify', (all) => {
    sync.verify(Boolean(all)).catch(() => {});
    return true;
  });

  // Game
  handle('game:status', () => ({ running: game.running }));
  handle('game:lastCrash', () => lastCrash);
  handle('game:launchSolo', (opts) => {
    ensureReady();
    const s = settings.data;
    const content = scanContent(false);
    const car = content.cars.find((c) => c.id === opts.car);
    const track = content.tracks.find((t) => t.id === opts.track);
    if (!car) throw new Error('Voiture introuvable : choisissez une voiture installée');
    if (!track) throw new Error('Circuit introuvable : choisissez un circuit installé');
    const layout = track.layouts.find((l) => l.id === (opts.layout || '')) || track.layouts[0];
    const maxCars = layout.pitboxes || 24;
    const raceIni = buildSoloRaceIni({
      ...opts,
      layout: layout.id,
      maxCars,
      skin: opts.skin || (car.skins[0] && car.skins[0].id) || '',
      aiSkins: car.skins.map((k) => k.id),
      driverName: s.driverName,
      nationality: s.nationality,
    });
    game.writeConfig(docsDir(), raceIni, buildAssistsIni(opts.assists || s.assists));
    settings.update({ solo: { ...opts, assists: undefined }, assists: opts.assists || s.assists });
    const modeLabel = { practice: 'Entraînement', race: 'Course', hotlap: 'Hotlap' }[opts.mode] || 'Solo';
    game.presence = { details: `Solo — ${modeLabel}`, state: `${car.name} @ ${layout.name || track.name}` };
    startGame({ kind: 'solo', mode: opts.mode || 'practice', car: car.id, track: track.id, layout: layout.id });
    return true;
  });
  handle('game:joinServer', async (opts) => {
    ensureReady();
    const s = settings.data;
    if (!opts.car) throw new Error('Choisissez une voiture');
    const content = scanContent(true);
    if (!content.cars.some((c) => c.id === opts.car)) throw new Error(`Voiture ${opts.car} non installée`);
    const { track, layout } = resolveTrack(opts.track, content.tracks);
    if (!content.tracks.some((t) => t.id === track)) throw new Error(`Circuit ${track} non installé`);
    const raceIni = buildOnlineRaceIni({
      ...opts,
      track,
      layout,
      driverName: s.driverName,
      team: s.team,
      nationality: s.nationality,
      steamId: s.steamId,
    });
    game.writeConfig(docsDir(), raceIni, null);
    const carInfo = content.cars.find((c) => c.id === opts.car);
    const trackInfo = content.tracks.find((t) => t.id === track);
    game.presence = { details: `En ligne — ${opts.serverName || 'serveur LKS'}`, state: `${carInfo ? carInfo.name : opts.car} @ ${trackInfo ? trackInfo.name : track}` };
    startGame({ kind: 'online', mode: opts.serverName || '', car: opts.car, track, layout });
    return true;
  });

  // Servers
  handle('servers:list', () => {
    const fromManifest = (sync.manifest.servers || []).map((x) => ({ ...x, source: 'lks' }));
    const custom = (settings.data.customServers || []).map((x) => ({ ...x, source: 'custom' }));
    return [...fromManifest, ...custom].map((x) => ({ ...x, httpPort: Number(x.httpPort) || 8081, key: `${x.ip}:${x.httpPort || 8081}` }));
  });
  handle('servers:info', (server) => getServerInfo(server));
  handle('servers:cars', (server) => getServerCars(server, settings.data.steamId));
  handle('servers:checkContent', (info) => {
    const content = scanContent(true);
    const { track } = resolveTrack(info.track, content.tracks);
    const lks = lksIds();
    const missingCars = (info.cars || []).filter((c) => !content.cars.some((x) => x.id === c));
    const trackMissing = !content.tracks.some((t) => t.id === track);
    const statuses = sync.statusList();
    const outdated = statuses.filter((i) => i.status !== 'ok' && ((i.kind === 'car' && (info.cars || []).includes(i.id)) || (i.kind === 'track' && i.id === track)));
    return {
      track,
      trackMissing,
      missingCars,
      outdated: outdated.map((i) => ({ kind: i.kind, id: i.id, name: i.name })),
      installable: [
        ...missingCars.filter((c) => lks.car.has(c)).map((id) => ({ kind: 'car', id })),
        ...(trackMissing && lks.track.has(track) ? [{ kind: 'track', id: track }] : []),
      ],
      notAvailable: [...missingCars.filter((c) => !lks.car.has(c)), ...(trackMissing && !lks.track.has(track) ? [track] : [])],
    };
  });

  // Graphics / CSP
  handle('graphics:status', () => graphicsStatus());
  handle('csp:status', () => ({ ...csp.status(), preset: settings.data.graphics.preset || '' }));
  handle('csp:install', async (version) => {
    ensureGameClosed();
    const v = version || cspTarget().version || (await csp.available()).recommended;
    const result = await csp.install(v);
    send('toast', { kind: 'success', text: `Custom Shaders Patch v${result.version} installé` });
    return result;
  });
  handle('csp:cancel', () => csp.cancel());
  handle('csp:setEnabled', (enabled) => {
    ensureGameClosed();
    return csp.setEnabled(Boolean(enabled));
  });
  handle('graphics:apply', (presetId) => {
    ensureGameClosed();
    const written = graphics.applyPreset(docsDir(), presetId, { display: displayInfo() });
    settings.update({ graphics: { preset: presetId, appliedAt: new Date().toISOString() } });
    return written;
  });
  handle('graphics:restore', () => {
    ensureGameClosed();
    const n = graphics.restoreBackup(docsDir());
    settings.update({ graphics: { preset: '' } });
    return n;
  });
  // Beginner path: install / update CSP, then apply the preset matching the GPU.
  handle('graphics:oneClick', async (presetId) => {
    ensureGameClosed();
    const st = await graphicsStatus();
    if (st.needsUpdate || !st.csp.installed) await csp.install(st.target.version || st.versions.recommended);
    if (!csp.status().enabled) csp.setEnabled(true);
    const preset = presetId || st.gpu.recommended;
    graphics.applyPreset(docsDir(), preset, { display: displayInfo() });
    settings.update({ graphics: { preset, appliedAt: new Date().toISOString() } });
    send('toast', { kind: 'success', text: `Jeu configuré : CSP + préréglage ${graphics.PRESETS[preset].label}` });
    return preset;
  });

  // Updater
  handle('updater:check', async () => {
    if (!updater) return { state: updaterState.state };
    await checkForUpdates();
    return updaterState;
  });
  handle('updater:state', () => updaterState);
  handle('app:whatsNew', () => {
    const w = whatsNew;
    whatsNew = null; // shown once
    return w;
  });
  handle('updater:install', () => {
    if (!updater || updaterState.state !== 'ready') throw new Error('Aucune mise à jour prête');
    if (game.running) throw new Error("Ferme Assetto Corsa avant de mettre à jour le launcher");
    if (sync.running) throw new Error('Attends la fin de la synchronisation du contenu');
    // silent install, then the launcher restarts by itself
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  });

  // Admin / publishing
  handle('admin:test', async () => {
    const gh = newGitHub();
    const info = await gh.checkAccess();
    const pub = getPublisher();
    await pub.open();
    return { ...info, manifestUrl: pub.manifestUrl(), cars: pub.manifest.cars.length, tracks: pub.manifest.tracks.length };
  });
  handle('admin:overview', async () => {
    if (!acRoot()) throw new Error("Dossier d'Assetto Corsa non configuré");
    const pub = getPublisher();
    await pub.open();
    const content = scanContent(true);
    const map = (kind, list) =>
      list.map((x) => {
        const entry = pub.manifest[kind === 'car' ? 'cars' : 'tracks'].find((e) => e.id === x.id);
        return { kind, id: x.id, name: x.name, brand: x.brand || x.country || '', official: isOfficial(x.id), published: Boolean(entry), remoteVersion: entry ? entry.version : null, publishedAt: entry ? entry.publishedAt : null, size: entry ? entry.size : null };
      });
    const remoteOnly = (kind) =>
      pub.manifest[kind === 'car' ? 'cars' : 'tracks']
        .filter((e) => !(kind === 'car' ? content.cars : content.tracks).some((x) => x.id === e.id))
        .map((e) => ({ kind, id: e.id, name: e.name, published: true, remoteOnly: true, remoteVersion: e.version, publishedAt: e.publishedAt, size: e.size }));
    return {
      manifestUrl: pub.manifestUrl(),
      manifest: { drift: pub.manifest.drift || {}, leaderboard: pub.manifest.leaderboard || null, vpn: pub.manifest.vpn || null, history: (pub.manifest.history || []).slice(0, 30), events: pub.manifest.events || [], soloPresets: pub.manifest.soloPresets || [], discord: pub.manifest.discord || null, setups: (pub.manifest.setups || []).map((s) => ({ car: s.car, name: s.name, files: s.files.length, publishedAt: s.publishedAt })), branding: pub.manifest.branding ? { version: pub.manifest.branding.version, files: pub.manifest.branding.files.map((f) => f.name), showcase: (pub.manifest.branding.showcase || []).length } : null, name: pub.manifest.name, motd: pub.manifest.motd || '', csp: pub.manifest.csp || null, donate: pub.manifest.donate || null, shop: pub.manifest.shop || null, servers: pub.manifest.servers, news: pub.manifest.news, updatedAt: pub.manifest.updatedAt },
      cars: [...map('car', content.cars), ...remoteOnly('car')],
      tracks: [...map('track', content.tracks), ...remoteOnly('track')],
    };
  });
  handle('admin:localVersions', async (items) => {
    const out = {};
    for (const { kind, id } of items) {
      try {
        out[`${kind}/${id}`] = await cachedHash(kind, id);
      } catch {
        out[`${kind}/${id}`] = null;
      }
      send('admin:hashed', { key: `${kind}/${id}`, hash: out[`${kind}/${id}`] });
    }
    return out;
  });
  handle('admin:publish', (items, opts) =>
    withAdmin(async () => {
      const pub = getPublisher();
      await pub.open();
      const report = await pub.publishItems(acRoot(), items, opts || {});
      await refreshManifest({ autoSync: false });
      // The admin already has the exact files: mark them as installed.
      for (const r of report) if (r.status === 'published' || r.status === 'unchanged') {
        const entry = sync.findItem(r.kind, r.id);
        if (entry) sync.state[r.kind][r.id] = { version: entry.version, installedAt: new Date().toISOString() };
      }
      sync.saveState();
      send('sync:changed', sync.summary());
      return report;
    }),
  );
  handle('admin:remove', (items) =>
    withAdmin(async () => {
      const pub = getPublisher();
      await pub.removeItems(items);
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
  handle('branding:get', () => branding.status());
  handle('clipboard:write', (text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  handle('host:status', () => hostStatus());
  handle('host:start', async (opts) => {
    if (!acRoot() || !isAcRoot(acRoot())) throw new Error("Dossier d'Assetto Corsa introuvable : configure-le dans les Paramètres");
    const content = scanContent(true);
    const track = content.tracks.find((t) => t.id === opts.track);
    if (!track) throw new Error('Circuit non installé');
    const layout = track.layouts.find((l) => l.id === (opts.layout || '')) || track.layouts[0];
    const cars = (opts.cars || []).map((id) => content.cars.find((c) => c.id === id)).filter(Boolean);
    if (!cars.length) throw new Error('Choisis au moins une voiture installée');
    const maxSlots = Math.max(2, layout.pitboxes || 24);
    const slots = Math.min(Number(opts.slots) || 12, maxSlots);
    const config = buildServerConfig({
      ...opts,
      layout: layout.id,
      slots,
      cars: cars.map((c) => ({ id: c.id, skins: c.skins.map((k) => k.id) })),
      ports: opts.ports,
    });
    host.start({ acRoot: acRoot(), config, pack: { cars: cars.map((c) => c.id), track: track.id, layout: layout.id }, label: `${track.name}` });
    hostState = { name: opts.name || 'Partie LKS', ports: config.ports, password: opts.password || '', track: track.name, layout: layout.name, slots, cars: cars.map((c) => c.id), upnp: { state: opts.upnp === false ? 'off' : 'working' }, invites: [] };
    hostState.invites = computeInvites();
    settings.update({ host: { ...opts } });
    if (!game.running) setPresence({ details: 'Héberge une partie', state: `${track.name} — ${slots} places`, startedAt: Date.now() });
    if (opts.upnp !== false) openPorts();
    send('host:changed');
    return hostStatus();
  });
  handle('host:stop', async () => {
    host.stop();
    await closePorts();
    return true;
  });
  handle('host:decodeInvite', (code) => decodeInvite(code));
  handle('vpn:status', () => ({ ...vpn.vpnStatus(sync.manifest.vpn), platform: process.platform }));
  handle('vpn:installZerotier', async () => {
    await vpn.installZerotier({ fetchImpl: net.fetch.bind(net) });
    send('toast', { kind: 'success', text: 'ZeroTier installé' });
    return vpn.vpnStatus(sync.manifest.vpn);
  });
  handle('vpn:join', async () => {
    const cfg = sync.manifest.vpn || {};
    if (cfg.provider !== 'zerotier') throw new Error("Le VPN configuré n'est pas ZeroTier");
    await vpn.zerotierCommand('join', cfg.networkId);
    // the virtual network card takes a few seconds to get its address
    for (let i = 0; i < 15 && !vpn.vpnStatus(cfg).connected; i++) await new Promise((r) => setTimeout(r, 1000));
    send('host:changed');
    return vpn.vpnStatus(cfg);
  });
  handle('vpn:leave', async () => {
    const cfg = sync.manifest.vpn || {};
    await vpn.zerotierCommand('leave', cfg.networkId);
    send('host:changed');
    return vpn.vpnStatus(cfg);
  });
  handle('vpn:rules', (ports) => vpn.zerotierRules(ports || undefined));

  // Telemetry
  handle('telemetry:status', () => {
    const t = settings.data.telemetry;
    return { ...t, board: Boolean(telemetry.board()), dash: { running: telemetry.dash.running, urls: telemetry.dash.running ? dashUrls(t.dashPort || 8095) : [] }, live: telemetry.live(), error: telemetry.source.error || telemetry.tickError ? 'Impossible de lire les données du jeu sur ce PC.' : null };
  });
  handle('telemetry:settings', async (patch) => {
    settings.update({ telemetry: patch || {} });
    await applyDash();
    return settings.data.telemetry;
  });
  handle('telemetry:laps', (filter) => telemetry.store.list(filter || {}));
  handle('telemetry:lap', async (id) => {
    if (String(id).startsWith('remote-')) {
      const board = telemetry.board();
      if (!board) throw new Error('Classement partagé non configuré');
      return board.lap(String(id).slice(7));
    }
    return telemetry.store.load(id);
  });
  handle('drift:course', ({ track, layout }) => {
    const { course, source } = driftCourseInfo({ track, layout });
    return { course, source, version: courseVersion(course) };
  });
  handle('drift:autoCourse', ({ track, layout }) => {
    autoCourses.delete(`${track}|${layout || ''}`);
    const course = autoDriftCourse(track, layout || '');
    if (!course) throw new Error('Pas de ligne IA (ai/fast_lane.ai) pour ce circuit : place les clips à la main.');
    return course;
  });
  handle('drift:modes', () => ({ ids: MODE_IDS, labels: MODE_LABELS, presets: MODES }));
  handle('ghost:status', () => (acRoot() ? ghosts.currentGhost(ingame.appDir(acRoot())) : null));
  handle('ghost:clear', () => {
    if (acRoot()) ghosts.clearGhost(ingame.appDir(acRoot()));
    return true;
  });
  handle('ghost:set', async (id) => {
    if (!acRoot()) throw new Error("Dossier d'Assetto Corsa non configuré");
    let lap;
    if (String(id).startsWith('remote-')) {
      const board = telemetry.board();
      if (!board) throw new Error('Classement partagé non configuré');
      lap = await board.lap(String(id).slice(7));
    } else lap = telemetry.store.load(id);
    const status = ingame.ingameStatus(acRoot());
    if (!status.installed || !status.upToDate) ingame.installIngame(acRoot(), allDriftCourses()); // the ghost needs the app 1.4
    return ghosts.writeGhost(ingame.appDir(acRoot()), lap);
  });
  handle('battles:list', async ({ track, layout = '', mode = 'normal' }) => {
    const version = courseVersion(driftCourse({ track, layout }), mode);
    const view = (b) => ({ ...b, result: b.modes[mode] || null });
    const local = telemetry.battles.list({ track, layout }).map(view);
    const board = telemetry.board();
    let remote = [];
    let error = null;
    if (board) {
      try {
        remote = (await board.battles({ track, layout, rules: version })).map(view);
      } catch (err) {
        error = err.message;
      }
    }
    return { battles: dedupeBattles([...local, ...remote]).filter((b) => b.result), error };
  });
  handle('champ:list', async () => {
    const list = (sync.manifest && sync.manifest.championships) || [];
    const board = telemetry.board();
    const out = [];
    for (const c of list) {
      const rounds = [];
      for (const round of c.rounds || []) {
        const version = courseVersion(driftCourse(round), round.mode);
        const rules = `${version}@${round.id}`;
        const kind = round.kind === 'battle' ? 'drift' : round.kind;
        const inWindow = (date) => Date.parse(date) >= Date.parse(round.start) && Date.parse(date) <= Date.parse(round.end);
        let entries = null;
        let battles = null;
        let error = null;
        if (board && champ.roundStatus(round) !== 'upcoming') {
          try {
            entries = (await board.list({ track: round.track, layout: round.layout || '', kind, rules, limit: 100 })).map((r) => ({ name: r.driver, steamId: r.steam_id, score: Number(r.score) }));
            if (round.kind === 'battle') battles = (await board.battles({ track: round.track, layout: round.layout || '', rules })).map((b) => ({ ...b.modes[round.mode], date: b.date }));
          } catch (err) {
            error = err.message;
          }
        }
        if (!entries) entries = telemetry.store.leaderboard({ track: round.track, layout: round.layout || '', kind, mode: round.mode, rules: version, from: round.start, to: round.end }).map((l) => ({ name: l.driver.name, steamId: l.driver.steamId, score: l.result.score }));
        if (!battles) battles = telemetry.battles.list({ track: round.track, layout: round.layout || '' }).filter((b) => inWindow(b.date) && b.modes[round.mode] && b.modes[round.mode].rules === version).map((b) => ({ ...b.modes[round.mode], date: b.date }));
        rounds.push({ ...round, ...champ.roundResults(round, { entries, battles: dedupeBattles(battles.map((b) => ({ ...b, pair: b.drivers.map((d) => d.name.toLowerCase()).sort().join('|'), track: round.track }))), points: c.points }), error });
      }
      out.push({ ...c, rounds, standings: champ.standings(c, rounds) });
    }
    return out;
  });
  handle('telemetry:board', async (q) => {
    if (q.kind !== 'time') q.rules = courseVersion(driftCourse(q), q.mode || 'normal');
    const local = telemetry.store.leaderboard(q);
    const board = telemetry.board();
    if (!board) return { local, remote: null };
    try {
      return { local, remote: await board.list(q) };
    } catch (err) {
      return { local, remote: null, error: err.message };
    }
  });
  handle('telemetry:delete', (id) => telemetry.store.remove(id));
  handle('telemetry:export', async (id) => {
    const lap = telemetry.store.load(id);
    const r = await dialog.showSaveDialog(win, { title: 'Exporter le tour', defaultPath: `${lap.driver.name}-${lap.track}-${fmtLap(lap.lapMs).replace(/[:.]/g, '-')}.lkslap`, filters: [{ name: 'Tour LKS', extensions: ['lkslap'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, telemetry.store.export(id));
    return r.filePath;
  });
  handle('telemetry:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importer des tours', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Tour LKS', extensions: ['lkslap'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => telemetry.store.import(fs.readFileSync(f)));
  });
  handle('tools:status', () => telemetryTools.toolsStatus().map((t) => ({ ...t, autoStart: Boolean((settings.data.tools || {})[t.id]) })));
  handle('tools:launch', (id) => telemetryTools.launchTool(id));
  handle('tools:autoStart', (id, on) => {
    settings.update({ tools: { [id]: Boolean(on) } });
    return true;
  });
  handle('ingame:status', () => (acRoot() ? ingame.ingameStatus(acRoot()) : { installed: null }));
  handle('ingame:install', () => {
    if (!acRoot()) throw new Error("Dossier d'Assetto Corsa non configuré");
    return ingame.installIngame(acRoot(), allDriftCourses());
  });
  handle('ingame:remove', () => ingame.removeIngame(acRoot()));
  handle('admin:testLeaderboard', async (cfg) => {
    const board = new Leaderboard(cfg || {});
    await board.list({ track: '__test__', layout: '', kind: 'time', limit: 1 });
    return true;
  });
  handle('admin:leaderboardSql', () => fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'leaderboard.sql'), 'utf8'));
  handle('setups:status', () => setupsSync.status());
  handle('discord:status', () => ({ configured: Boolean(presence.clientId), enabled: settings.data.discordPresence !== false, connected: presence.connected }));
  handle('admin:localSetups', () => {
    const names = Object.fromEntries(scanContent(false).cars.map((c) => [c.id, c.name]));
    return localSetupCars(docsDir()).map((c) => ({ ...c, name: names[c.car] || c.car }));
  });
  handle('admin:publishSetups', (cars) =>
    withAdmin(async () => {
      const names = Object.fromEntries(scanContent(false).cars.map((c) => [c.id, c.name]));
      const pub = getPublisher();
      const r = await pub.publishSetups(docsDir(), cars, names);
      await refreshManifest({ autoSync: false });
      return r;
    }),
  );
  handle('admin:removeSetups', (cars) =>
    withAdmin(async () => {
      const pub = getPublisher();
      await pub.removeSetups(cars);
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
  handle('admin:publishBranding', (dir) =>
    withAdmin(async () => {
      const pub = getPublisher();
      const r = await pub.publishBranding(dir);
      await refreshManifest({ autoSync: false });
      return r;
    }),
  );
  handle('admin:saveDriftCourse', ({ track, layout = '', lapId, section, clips, rules, refLine, remove }) =>
    withAdmin(async () => {
      const pub = getPublisher();
      if (!pub.manifest) await pub.open();
      const key = `${track}|${layout}`;
      const all = { ...(pub.manifest.drift || {}) };
      if (remove) delete all[key];
      else {
        const sec = [Math.max(0, Number(section[0]) || 0), Math.min(1, Number(section[1]) || 1)];
        if (!(sec[1] > sec[0])) throw new Error('Début et fin du parcours invalides');
        const course = { section: sec, clips: (clips || []).slice(0, 30).map((c, i) => ({ name: String(c.name || `Clip ${i + 1}`).slice(0, 30), kind: c.kind === 'outer' ? 'outer' : 'inner', x: Number(c.x), z: Number(c.z), r: Math.min(15, Math.max(1, Number(c.r) || 3)) })), refLine: [], refSpeed: 0 };
        if (lapId) {
          const lap = String(lapId).startsWith('remote-') ? await telemetry.board().lap(String(lapId).slice(7)) : telemetry.store.load(lapId);
          if (lap.track !== track || (lap.layout || '') !== layout) throw new Error("Ce tour n'est pas sur ce circuit");
          Object.assign(course, referenceFrom(lap.samples, sec), { refDriver: lap.driver.name });
        } else if (Array.isArray(refLine)) Object.assign(course, { refLine: refLine.slice(0, 2000).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]), refDriver: 'ligne IA' });
        else if (all[key]) Object.assign(course, { refLine: all[key].refLine || [], refSpeed: all[key].refSpeed || 0, refDriver: all[key].refDriver, slipSign: all[key].slipSign });
        if (rules) course.rules = cleanRules(rules);
        all[key] = course;
      }
      await pub.updateMeta({ drift: all });
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
  handle('admin:saveChampionships', (list) =>
    withAdmin(async () => {
      const pub = getPublisher();
      await pub.updateMeta({ championships: champ.cleanChampionships(list) });
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
  handle('admin:updateMeta', (patch) =>
    withAdmin(async () => {
      const pub = getPublisher();
      await pub.updateMeta(patch);
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
}

app.whenReady().then(async () => {
  settings = new Settings(app.getPath('userData'));
  branding = new BrandingManager({ dataDir: app.getPath('userData') });
  protocol.handle('lks-img', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(`${url.hostname}${url.pathname}`);
    const file = url.hostname === 'branding' ? branding.file(rel.split('/').pop()) : acRoot() ? resolveContentFile(acRoot(), rel) : null;
    if (!file || !fs.existsSync(file)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  setupSync();
  setupCsp();
  setupSync_();
  setupHosting();
  setupTelemetry();
  setupGame();
  setupIpc();
  createWindow();
  win.once('ready-to-show', applyBrandIcon);
  await firstRunDetection();
  computeWhatsNew();
  send('settings:changed', settings.public());
  refreshManifest({ autoSync: true }).catch(() => {});
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  // never leave a server running or ports open behind us
  if (host.running) host.stop();
  closePorts();
});
