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
const { HostList, newHostId, bestAddress } = require('./hostList');
const { Community, decisionOf, MAX_UPLOAD, MAX_PHOTO } = require('./community');
const { zipFolder, extractZip } = require('./zip');
const { Webhooks } = require('./webhook');
const { GitHub } = require('./github');
const { Publisher, isOfficial } = require('./publisher');
const { listFiles, hashFolder } = require('./hash');
const { contentDir } = require('./acContent');
const acContent = require('./acContent');
const { CspManager, checkVcRedist, compareVersions } = require('./csp');
const graphics = require('./graphics');
const crashlog = require('./crashlog');
const applog = require('./applog');
const { BrandingManager } = require('./branding');
const { SetupSync, localSetupCars } = require('./setups');
const { DiscordPresence } = require('./discord');
const { appConfig } = require('./config');
const { buildServerConfig, ServerHost, serverExe, serverStopReason, LOBBY_REFUSED } = require('./hosting');
const { firewallStatus, fixFirewall } = require('./firewall');
const { findGateway, isPrivateIp, boxGuide } = require('./upnp');
const { networkAddresses, LABELS: NET_LABELS } = require('./netinfo');
const { encodeInvite, decodeInvite } = require('../shared/invite');
const vpn = require('./vpn');
const { TelemetryManager } = require('./telemetry');
const { SharedMemorySource, SimulatedSource } = require('./telemetry/source');
const { Simulator } = require('./telemetry/simulator');
const telemetryTools = require('./telemetry/tools');
const ingame = require('./telemetry/ingame');
const { Leaderboard } = require('./telemetry/leaderboard');
const { courseVersion, referenceFrom, driftOf, MODE_LABELS, MODE_IDS, MODES } = require('./telemetry/drift');
const ailine = require('./telemetry/ailine');
const { autoCourse } = ailine;
const { bundledCourse, bundledCourses } = require('./telemetry/courses');
const { hasGates } = require('./telemetry/geo');
const { lineFromRuns } = require('./telemetry/reference');
const judging = require('./telemetry/judging');
const { collectRuns } = require('./telemetry/tandem');
const ghosts = require('./telemetry/ghosts');
const champ = require('./telemetry/championship');
const { dedupe: dedupeBattles } = require('./telemetry/battles');
const { ruledBattles } = require('./telemetry/rounds');

const MANIFEST_POLL_MS = 5 * 60 * 1000;

// Dev/test hook: isolated profile folder.
if (process.env.LKS_USER_DATA) app.setPath('userData', process.env.LKS_USER_DATA);

// Launcher log + compatibility mode: when the game crashes the graphics driver
// (it happens with heavy CSP settings), the launcher window can go down too.
applog.init(app.getPath('userData'));
if (applog.graphicsSafe(app.getPath('userData'))) {
  app.disableHardwareAcceleration();
  applog.log('start: compatibility mode (no hardware acceleration)');
}
process.on('uncaughtException', (err) => applog.log('uncaught', err));
process.on('unhandledRejection', (err) => applog.log('unhandled rejection', err instanceof Error ? err : String(err)));
let gpuCrashes = 0;
app.on('child-process-gone', (_e, d) => {
  applog.log('process gone', { type: d.type, reason: d.reason, exitCode: d.exitCode });
  if (d.type === 'GPU' && d.reason !== 'clean-exit' && ++gpuCrashes >= 2 && !applog.graphicsSafe(app.getPath('userData'))) {
    applog.setGraphicsSafe(app.getPath('userData'), true); // next start without hardware acceleration
    applog.log('graphics process crashed twice: compatibility mode from next start');
  }
});

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
let hostTrace = []; // what the box search did, for the diagnostic
let hostOpts = null; // settings of the running server (for an automatic restart)
let hostStopRequested = false;
let hostRestarts = []; // times of the automatic restarts
let lastHostStop = null; // why the server stopped, shown on the Héberger page
let hostAd = null; // { id, secret, timer }: the game announced in the launcher's server list
let appQuitting = false;

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
  // window content crashed (often with a graphics driver reset): reload it
  win.webContents.on('render-process-gone', (_e, d) => {
    applog.log('window gone', { reason: d.reason, exitCode: d.exitCode });
    if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win && !win.isDestroyed() && win.reload(), 1500);
  });
  win.on('unresponsive', () => applog.log('window unresponsive'));
  // closing the window would stop the hosted game for everyone: ask first
  win.on('close', (e) => {
    if (appQuitting || !host.running) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'Serveur en cours',
      message: 'Ton serveur tourne encore.',
      detail: 'Fermer le launcher arrête la partie pour tout le monde. Tu peux le réduire : le serveur continue.',
      buttons: ['Réduire', 'Arrêter le serveur et quitter', 'Annuler'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) win.minimize();
    if (choice === 1) {
      hostStopRequested = true;
      appQuitting = true;
      app.quit();
    }
  });
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

/**
 * Solo, hosting and joining are limited to the group's content (published on
 * the launcher), unless the admins allow everything (Publication).
 * No restriction while the group has published nothing yet.
 */
function contentRestricted() {
  const m = sync && sync.manifest;
  if (!m || m.allowAllContent) return false;
  return (m.cars || []).length + (m.tracks || []).length > 0;
}

function assertGroupContent({ cars = [], track } = {}) {
  if (!contentRestricted()) return;
  const ids = lksIds();
  const nameOf = (list, id) => ((list || []).find((x) => x.id === id) || {}).name || id;
  const badCar = cars.find((id) => id && !ids.car.has(id));
  if (badCar) throw new Error(`« ${nameOf(contentCache && contentCache.cars, badCar)} » n’est pas sur le launcher LKS : seules les voitures du groupe sont autorisées.`);
  if (track && !ids.track.has(track)) throw new Error(`« ${nameOf(contentCache && contentCache.tracks, track)} » n’est pas sur le launcher LKS : seuls les circuits du groupe sont autorisés.`);
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
  const notify = settings.data.eventNotifications !== false && Notification.isSupported();
  const now = Date.now();
  for (const ev of sync.manifest.events || []) {
    const start = Date.parse(ev.date);
    if (!start || !ev.id) continue;
    const minutes = Math.round((start - now) / 60000);
    // one hour before: install the event's track and cars if some are missing
    const key60 = `${ev.id}:60`;
    if (minutes <= 60 && minutes > 0 && !notifiedEvents.has(key60) && acRoot() && !game.running && settings.data.autoSync !== false) {
      notifiedEvents.add(key60);
      const targets = [...(ev.track ? [{ kind: 'track', id: ev.track }] : []), ...(ev.cars || []).map((id) => ({ kind: 'car', id }))].filter((t) => sync.findItem(t.kind, t.id));
      if (targets.length) {
        try {
          sync.enqueue(targets);
        } catch (err) {
          applog.log('event prepare', err.message);
        }
      }
    }
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
    if (!body || !notify) continue;
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
/** Games hosted from the launcher: listed only in the launcher (never in the public AC lobby). */
function hostList() {
  const cfg = sync.manifest && sync.manifest.leaderboard;
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  try {
    return new HostList(cfg);
  } catch {
    return null;
  }
}

/** Readable names (installed content first, then the group's manifest). */
function carLabel(id) {
  const c = (contentCache && contentCache.cars.find((x) => x.id === id)) || ((sync && sync.manifest && sync.manifest.cars) || []).find((x) => x.id === id);
  return (c && c.name) || id;
}
function trackLabel(id, layout) {
  const t = (contentCache && contentCache.tracks.find((x) => x.id === id)) || ((sync && sync.manifest && sync.manifest.tracks) || []).find((x) => x.id === id);
  const l = t && (t.layouts || []).find((x) => x.id === (layout || ''));
  const name = (t && t.name) || id;
  if (!l || !l.name || l.name === name) return name;
  return l.name.startsWith(name) ? l.name : `${name} — ${l.name}`;
}

// ---------------------------------------------------------------- Discord channels (webhooks set by the admins)
const webhooks = new Webhooks({ fetchImpl: (...a) => net.fetch(...a), getConfig: () => (sync && sync.manifest && sync.manifest.discord) || null });
function discordPost(channel, text, file) {
  return webhooks.post(channel, text, file).catch((err) => {
    console.warn('[discord]', err.message);
    return false;
  });
}

// ---------------------------------------------------------------- community (proposals, presence)
function community() {
  const cfg = sync.manifest && sync.manifest.leaderboard;
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  try {
    return new Community(cfg);
  } catch {
    return null;
  }
}

const validId = (v) => typeof v === 'string' && /^[\w.-]{1,80}$/.test(v);
const validSkin = (v) => typeof v === 'string' && /^[\w. -]{1,80}$/.test(v) && !v.includes('..');

/** Folder (and zip name) of what a member proposes. */
function proposalSource({ kind, car, skin, track }) {
  if (!validId(car)) throw new Error('Voiture invalide');
  if (kind === 'car') return path.join(acRoot(), 'content', 'cars', car);
  if (kind === 'skin') {
    if (!validSkin(skin)) throw new Error('Livrée invalide');
    return path.join(acRoot(), 'content', 'cars', car, 'skins', skin);
  }
  if (kind === 'setup') {
    if (track && !validId(track)) throw new Error('Circuit invalide');
    return path.join(docsDir(), 'setups', car, ...(track ? [track] : []));
  }
  throw new Error('Type de proposition inconnu');
}

/** Zip a proposal into a Buffer (setups: only the member's own files, not the group's LKS_ ones). */
async function zipProposal(p) {
  const src = proposalSource(p);
  if (!fs.existsSync(src)) throw new Error('Dossier introuvable sur ce PC');
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'lks-prop-'));
  try {
    let folder = src;
    if (p.kind === 'setup') {
      folder = path.join(tmp, 'setups');
      const walk = (dir, rel) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(dir, e.name), r);
          else if (/\.(ini|sp)$/i.test(e.name) && !e.name.toUpperCase().startsWith('LKS_')) {
            fs.mkdirSync(path.dirname(path.join(folder, ...r.split('/'))), { recursive: true });
            fs.copyFileSync(path.join(dir, e.name), path.join(folder, ...r.split('/')));
          }
        }
      };
      walk(src, p.track || '');
      if (!fs.existsSync(folder)) throw new Error('Aucun setup à toi pour cette voiture');
    }
    const out = path.join(tmp, 'proposal.zip');
    await zipFolder(folder, out);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Where an accepted proposal is installed on the admin's PC (to test it, then publish it). */
function proposalTarget(p) {
  if (p.kind === 'car') return path.join(acRoot(), 'content', 'cars', p.car);
  if (p.kind === 'skin') return path.join(acRoot(), 'content', 'cars', p.car, 'skins', p.skin);
  return path.join(docsDir(), 'setups', p.car);
}

async function installProposal(p) {
  if (!p.direct) throw new Error('Proposition par lien : télécharge-la depuis le lien et installe-la à la main');
  if (!validId(p.car) || (p.kind === 'skin' && !validSkin(p.skin)) || (p.track && !validId(p.track))) throw new Error('Proposition invalide');
  const target = proposalTarget(p);
  if (p.kind !== 'setup' && fs.existsSync(target)) throw new Error(`${p.kind === 'car' ? 'Une voiture' : 'Une livrée'} du même nom existe déjà sur ce PC (${path.basename(target)})`);
  if (p.kind === 'skin' && !fs.existsSync(path.join(acRoot(), 'content', 'cars', p.car))) throw new Error('La voiture de cette livrée n’est pas installée');
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'lks-prop-'));
  try {
    const res = await net.fetch(p.download);
    if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
    const zipFile = path.join(tmp, 'p.zip');
    fs.writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
    if (p.kind === 'setup') {
      // the member's setups, renamed with their name so nothing of the admin's is overwritten
      const out = path.join(tmp, 'x');
      await extractZip(zipFile, out);
      const tag = String(p.author || 'membre').replace(/[^\w-]/g, '').slice(0, 20) || 'membre';
      const walk = (dir, rel) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const r = [...rel, e.name];
          if (e.isDirectory()) walk(path.join(dir, e.name), r);
          else if (/\.(ini|sp)$/i.test(e.name)) {
            const dest = path.join(target, ...rel, `${tag}_${e.name}`);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(dir, e.name), dest);
          }
        }
      };
      walk(out, []);
    } else await extractZip(zipFile, target);
    contentCache = null;
    return target;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- who is online (every minute)
let currentServer = null; // server joined from the launcher: { name, ip, port, httpPort }
let presenceTimer = null;
/**
 * Id of this launcher's driver on the group's server: random, made once. The
 * Steam ID never leaves the PC (it only serves to recognise your own laps here).
 */
function playerId() {
  if (!/^p-[0-9a-f]{16}$/.test(settings.data.playerId || '')) settings.update({ playerId: `p-${require('crypto').randomBytes(8).toString('hex')}` });
  return settings.data.playerId;
}

function presenceIdentity() {
  if (!settings.data.presenceId || !settings.data.presenceSecret) {
    const crypto = require('crypto');
    settings.update({ presenceId: `p${crypto.randomBytes(8).toString('hex')}`, presenceSecret: crypto.randomBytes(24).toString('hex') });
  }
  return { id: settings.data.presenceId, secret: settings.data.presenceSecret };
}

function presenceNow() {
  const l = lastLaunch || {};
  if (game.running && l.kind === 'online') return { state: 'online', server: currentServer, car: l.car, track: l.track, layout: l.layout };
  if (game.running) return { state: 'solo', car: l.car, track: l.track, layout: l.layout };
  if (hostState && host.running) return { state: 'hosting', server: hostAd ? { name: hostState.name, hostId: hostAd.id } : null, track: hostState.trackId, layout: hostState.layoutId };
  return { state: 'launcher' };
}

async function updatePresence() {
  const c = community();
  if (!c) return;
  const me = presenceIdentity();
  if (settings.data.showOnline === false) {
    await c.removePresence(me.id, me.secret).catch(() => {});
    return;
  }
  await c.setPresence({ ...me, name: settings.data.driverName || 'Pilote', ...presenceNow() }).catch((err) => applog.log('presence', err.message));
}

function startPresence() {
  clearInterval(presenceTimer);
  updatePresence();
  presenceTimer = setInterval(updatePresence, 60000);
}

function announceHost() {
  if (!hostState || !hostAd) return Promise.resolve();
  const list = hostList();
  if (!list) {
    hostState.listed = { state: 'unavailable', error: 'le serveur du groupe n’est pas configuré (Publication → Classement)' };
    return Promise.resolve();
  }
  const s = hostState;
  return list.announce({
    id: hostAd.id,
    secret: hostAd.secret,
    name: s.name,
    hostDriver: settings.data.driverName || '',
    addresses: computeInvites().map((i) => ({ kind: i.kind, address: i.address })),
    tcpPort: s.ports.tcp,
    httpPort: s.ports.http,
    hasPassword: Boolean(s.password),
    track: s.trackId,
    layout: s.layoutId,
    cars: s.cars,
    slots: s.slots,
  }).then(() => {
    if (hostState) hostState.listed = { state: 'ok' };
  }).catch((err) => {
    if (hostState) hostState.listed = { state: 'failed', error: err.message };
    applog.log('host announce failed', err.message);
  }).finally(() => send('host:changed'));
}

function startAnnounce() {
  if (!hostAd) hostAd = { ...newHostId(), timer: null };
  clearInterval(hostAd.timer);
  announceHost();
  setTimeout(announceHost, 15000); // the box / VPN addresses are known a bit later
  hostAd.timer = setInterval(announceHost, 60000);
}

function stopAnnounce() {
  if (!hostAd) return Promise.resolve();
  const ad = hostAd;
  hostAd = null;
  clearInterval(ad.timer);
  const list = hostList();
  return list ? list.remove(ad.id, ad.secret).catch(() => {}) : Promise.resolve();
}

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
  if (ext && ['open', 'manual'].includes(hostState.upnp.state) && !isPrivateIp(ext)) invites.push(make('internet', ext));
  // several « home network » cards: keep the one the box answered on
  const lanOfBox = gateway && gateway.localAddress;
  for (const n of networkAddresses()) {
    if (n.kind === 'lan' && lanOfBox && n.address !== lanOfBox && networkAddresses().some((x) => x.address === lanOfBox)) continue;
    invites.push(make(n.kind, n.address));
  }
  return invites;
}

async function openPorts() {
  const ports = hostState.ports;
  hostState.upnp = { state: 'working' };
  send('host:changed');
  const trace = [];
  hostTrace = trace;
  try {
    gateway = await findGateway({ trace });
    const wanted = [[ports.tcp, 'TCP'], [ports.udp, 'UDP'], [ports.http, 'TCP']];
    for (const [port, proto] of wanted) {
      if (mappedPorts.some((m) => m[0] === port && m[1] === proto)) continue;
      await gateway.map(port, proto, `LKS Launcher ${proto} ${port}`);
      mappedPorts.push([port, proto]);
      trace.push(`port ${proto} ${port} : ouvert`);
    }
    const externalIp = await gateway.externalIp().catch((e) => {
      trace.push(`adresse publique : ${e.message}`);
      return null;
    });
    trace.push(`adresse publique : ${externalIp || 'inconnue'}`);
    if (externalIp && isPrivateIp(externalIp)) {
      hostState.upnp = { state: 'cgnat', externalIp, error: "Ta box n'a pas d'adresse publique (IP partagée / 4G) : passe par Radmin VPN ou ZeroTier." };
    } else {
      hostState.upnp = { state: 'open', externalIp };
    }
  } catch (err) {
    // the box may still say its public address (useful once the ports are opened by hand)
    const externalIp = gateway ? await gateway.externalIp().catch(() => null) : null;
    hostState.upnp = { state: 'failed', error: err.message, externalIp };
    trace.push(`échec : ${err.message}${err.code ? ` (code ${err.code})` : ''}`);
    trace.push(`adresse publique : ${externalIp || 'inconnue'}`);
    applog.log('upnp failed', err.message, err.code || '');
  }
  if (!hostState) return;
  // for opening the ports by hand: the address of this PC on the home network
  const lan = (gateway && gateway.localAddress) || ((networkAddresses().find((n) => n.kind === 'lan') || {}).address) || '';
  hostState.lanAddress = lan;
  if (gateway) hostState.boxGuide = boxGuide({ ...gateway.box, host: gateway.box.host || new URL(gateway.location || 'http://192.168.1.1').hostname });
  hostState.invites = computeInvites();
  send('host:changed');
}

/** Ports opened by hand in the box: internet invitation with the public address. */
async function useManualPorts() {
  let ip = hostState.upnp && hostState.upnp.externalIp;
  if (!ip || isPrivateIp(ip)) {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(6000) }).catch(() => null);
    ip = res && res.ok ? (await res.json().catch(() => ({}))).ip : null;
  }
  if (!ip) throw new Error('Adresse publique introuvable : vérifie ta connexion internet');
  if (isPrivateIp(ip)) throw new Error('Ta connexion n’a pas d’adresse publique à elle (IP partagée) : passe par le VPN.');
  hostState.upnp = { state: 'manual', externalIp: ip };
  hostTrace.push(`ports ouverts à la main, adresse publique ${ip}`);
  hostState.invites = computeInvites();
  send('host:changed');
}

/** Does the Windows firewall let the players reach the server? */
async function checkFirewall() {
  if (!hostState) return;
  hostState.firewall = { checking: true };
  send('host:changed');
  const st = await firewallStatus(serverExe(acRoot()));
  if (!hostState) return;
  hostState.firewall = st;
  if (st.checked && !st.ok) applog.log('firewall blocks the server', st);
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
  const s = { running: host.running, serverFound: Boolean(acRoot() && serverExe(acRoot())), log: host.log.slice(-120), networks: networkAddresses(), state: hostState, lastStop: lastHostStop };
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
 * published by the admins, otherwise the official one shipped with the
 * launcher (worked out from the track itself), otherwise the one generated
 * from the installed track's AI line.
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
  const published = all[`${c.track}|${c.layout || ''}`] || Object.entries(all).find(([k]) => k.toLowerCase() === `${c.track}|${c.layout || ''}`.toLowerCase())?.[1];
  if (published) return { course: published, source: 'published' };
  const official = bundledCourse(c.track, c.layout || '');
  if (official) return { course: official, source: 'official' };
  const auto = autoDriftCourse(c.track, c.layout || '');
  return { course: auto, source: auto ? 'auto' : null };
}
const driftCourse = (c) => driftCourseInfo(c).course;

/**
 * Track / layout ids as the launcher knows them. Online, the game gives the
 * layout in lower case (« calmont » for « Calmont »): without this, no course
 * is found and laps are filed under another name.
 */
let canonicalMemo = { at: 0, map: new Map() };
function canonicalCombo(c) {
  // called on every frame: remembered (the list of tracks changes rarely)
  if (Date.now() - canonicalMemo.at > 30000) canonicalMemo = { at: Date.now(), map: new Map() };
  const memoKey = `${c.track}|${c.layout || ''}`;
  if (!canonicalMemo.map.has(memoKey)) canonicalMemo.map.set(memoKey, canonicalIds(c));
  const ids = canonicalMemo.map.get(memoKey);
  return ids ? { ...c, ...ids } : c;
}

function canonicalIds(c) {
  const lower = (v) => String(v || '').toLowerCase();
  const known = [
    ...Object.keys(bundledCourses()),
    ...Object.keys((sync && sync.manifest && sync.manifest.drift) || {}),
    ...((sync && sync.manifest && sync.manifest.tracks) || []).flatMap((t) => (t.layouts && t.layouts.length ? t.layouts : [{ id: '' }]).map((l) => `${t.id}|${l.id || ''}`)),
    ...((contentCache && contentCache.tracks) || []).flatMap((t) => (t.layouts && t.layouts.length ? t.layouts : [{ id: '' }]).map((l) => `${t.id}|${l.id || ''}`)),
  ];
  const key = `${c.track}|${c.layout || ''}`;
  if (known.includes(key)) return null;
  const hit = known.find((k) => lower(k) === lower(key));
  if (!hit) return null;
  const i = hit.indexOf('|');
  return { track: hit.slice(0, i), layout: hit.slice(i + 1) };
}

/** Courses for the in-game app: published ones + automatic ones for the group's tracks. */
function allDriftCourses() {
  const out = {};
  for (const t of (sync.manifest && sync.manifest.tracks) || []) {
    for (const l of t.layouts && t.layouts.length ? t.layouts : [{ id: '' }]) {
      const c = driftCourse({ track: t.id, layout: l.id || '' });
      if (c) out[`${t.id}|${l.id || ''}`] = c;
    }
  }
  return { ...bundledCourses(), ...out, ...((sync.manifest && sync.manifest.drift) || {}) };
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
/** Per-zone targets of a clip (for Amateur): angle 0-80°, speed 0-250 km/h. */
function clipTarget(t) {
  if (!t || typeof t !== 'object') return {};
  const angle = Math.round(Math.min(80, Math.max(0, Number(t.angle) || 0)));
  const speed = Math.round(Math.min(250, Math.max(0, Number(t.speed) || 0)));
  return angle || speed ? { target: { angle, speed } } : {};
}

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
    if (telemetry.attachMeasures(path.join(appDir, 'measures'))) send('telemetry:lap', null);
    if (telemetry.attachGhosts(path.join(appDir, 'ghosts'))) {
      send('telemetry:lap', null);
      if (telemetry.recorder.combo) refreshGhostLibrary(telemetry.recorder.combo, true).catch((err) => console.warn('[ghost]', err.message));
    }
  } catch (err) {
    console.warn('[ghost]', err.message);
  }
  const dir = path.join(appDir, 'runs');
  if (!fs.existsSync(dir)) return;
  for (const lap of collectRuns(dir, { name: settings.data.driverName || '', steamId: settings.data.steamId || '' })) {
    try {
      await telemetry.addTandemRun({ ...lap, ...canonicalCombo(lap) });
    } catch (err) {
      console.warn('[tandem]', err.message);
    }
  }
}

/**
 * Ghosts to pick in game for the track being driven: the best runs with a
 * ghost (this PC and the shared leaderboard), one per driver.
 */
const libraryState = { key: null, at: 0 };
async function refreshGhostLibrary(combo, force = false) {
  if (!telemetry || !acRoot() || !combo) return;
  const appDir = ingame.appDir(acRoot());
  if (!fs.existsSync(appDir)) return;
  const key = `${combo.track}|${combo.layout || ''}`;
  if (!force && libraryState.key === key && Date.now() - libraryState.at < 5 * 60 * 1000) return;
  libraryState.key = key;
  libraryState.at = Date.now();
  const scoreOf = (l) => {
    const r = driftOf(l, 'normal', 'drift');
    return r && r.score > 0 ? r.score : null;
  };
  const picks = [];
  const seen = new Set();
  const local = telemetry.store
    .list({ track: combo.track, layout: combo.layout || '' })
    .filter((l) => l.ghost && !l.tandem)
    .sort((a, b) => (scoreOf(b) || 0) - (scoreOf(a) || 0) || a.lapMs - b.lapMs);
  for (const l of local) {
    const who = (l.driver.name || '').toLowerCase();
    if (seen.has(who)) continue;
    seen.add(who);
    try {
      picks.push({ id: l.id, lap: telemetry.store.load(l.id), score: scoreOf(l) });
    } catch {
      /* lap gone */
    }
    if (picks.length >= 6) break;
  }
  const board = telemetry.board();
  if (board) {
    try {
      const rows = await board.list({ track: combo.track, layout: combo.layout || '', kind: 'drift', rules: courseVersion(driftCourse(combo), 'normal'), limit: 30 });
      for (const r of (rows || []).filter((x) => x.meta && x.meta.ghost)) {
        const who = String(r.driver || '').toLowerCase();
        if (seen.has(who)) continue;
        seen.add(who);
        try {
          picks.push({ id: `r${r.id}`, lap: await board.lap(r.id), score: r.score === null ? null : Number(r.score) });
        } catch {
          /* unreadable */
        }
        if (picks.length >= 12) break;
      }
    } catch (err) {
      console.warn('[ghost] classement :', err.message);
    }
  }
  picks.sort((a, b) => (b.score || 0) - (a.score || 0));
  ghosts.writeLibrary(appDir, picks);
}

// ---------------------------------------------------------------- driver categories (Débutant / Amateur / Pro)
// Set by the group's server from each driver's best notes (docs/leaderboard.sql,
// lks_update_category). Each category has its own judging (drift modes).
const CATEGORY_MODE = { debutant: 'debutant', amateur: 'normal', pro: 'pro' };
let categories = { at: 0, map: {} }; // driver name (lower case) -> { category, avg, runs }
async function refreshCategories(force) {
  const c = community();
  if (!c || (!force && Date.now() - categories.at < 300000)) return categories.map;
  try {
    const rows = await c.categories();
    categories = { at: Date.now(), map: Object.fromEntries(rows.map((r) => [String(r.name).trim().toLowerCase(), r])) };
  } catch (err) {
    categories.at = Date.now();
    applog.log('categories', err.message);
  }
  return categories.map;
}
function categoryOf(name) {
  const r = categories.map[String(name || '').trim().toLowerCase()];
  return r && CATEGORY_MODE[r.category] ? r.category : 'debutant';
}
const myMode = () => CATEGORY_MODE[categoryOf(settings.data.driverName)];

/**
 * Note of the run just finished, for the in-game app (apps/lua/LKS/score.json):
 * the app shows it right after the run, with each clip and each zone.
 */
function writeScoreForGame(lap, pbDrift = [], pbTandem = []) {
  if (!acRoot() || !lap) return;
  const dir = ingame.appDir(acRoot());
  if (!fs.existsSync(dir)) return;
  const mode = myMode();
  const tandem = lap.tandem && lap.tandem.modes ? lap.tandem.modes[mode] || lap.tandem : null;
  const d = lap.drift && lap.drift.modes ? lap.drift.modes[mode] || lap.drift : lap.drift;
  if (!tandem && !(d && d.score !== undefined)) return;
  const base = tandem || d;
  const data = {
    category: categoryOf(settings.data.driverName),
    id: lap.id,
    track: lap.track,
    layout: lap.layout || '',
    kind: tandem ? 'tandem' : 'drift',
    driver: lap.driver && lap.driver.name,
    score: base.score,
    record: (tandem ? pbTandem : pbDrift).includes(mode),
    ...(tandem
      ? { tandem: { proximity: tandem.proximity, angleMatch: tandem.angleMatch, line: tandem.line, avgGap: tandem.avgGap, lead: lap.tandem.lead && lap.tandem.lead.name } }
      : { angle: d.angle, speed: d.speed, line: d.line, penalty: d.penalty, zeroed: d.zeroed || null }),
    clips: ((d && d.clips) || []).map((c) => ({ name: c.name, hit: c.hit, ...(c.cover !== undefined ? { cover: c.cover } : {}) })),
    zones: ((d && d.zones) || []).map((z) => ({ name: z.name, score: z.score })),
    modes: lap.drift && lap.drift.modes ? Object.fromEntries(Object.entries(lap.drift.modes).map(([m, r]) => [m, r.score])) : undefined,
  };
  lastGameScore = { at: Date.now(), data };
  try {
    fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(data));
  } catch (err) {
    console.warn('[score]', err.message);
  }
}

/**
 * Every run's note goes to the group (not only the records): the judges and
 * the members see it a few seconds after the run.
 */
function shareRun(lap) {
  const c = community();
  if (!c || !lap || settings.data.telemetry.shareLaps === false) return;
  if (((lap.driver && lap.driver.steamId) || '') !== (settings.data.steamId || '')) return; // a run where you led: the chaser's launcher sends it
  // the note of the driver's category; the three notes go along (they decide the category)
  const mode = myMode();
  const tandem = lap.tandem && lap.tandem.modes ? lap.tandem.modes[mode] || lap.tandem : null;
  const d = lap.drift && lap.drift.modes ? lap.drift.modes[mode] || lap.drift : lap.drift;
  const base = tandem || d;
  if (!base || !(base.score >= 0)) return;
  const all = (tandem ? lap.tandem : lap.drift) || {};
  const detail = {
    category: categoryOf(settings.data.driverName),
    modes: all.modes ? Object.fromEntries(Object.entries(all.modes).map(([m, r]) => [m, r && Number.isFinite(r.score) ? r.score : 0])) : undefined,
    angle: d && d.angle,
    speed: d && d.speed,
    line: d && d.line,
    penalty: d && d.penalty,
    zeroed: (d && d.zeroed) || null,
    avgAngle: d && d.avgAngle,
    avgSpeed: d && d.avgSpeed,
    clips: ((d && d.clips) || []).slice(0, 30).map((k) => ({ name: k.name, hit: k.hit, ...(k.cover !== undefined ? { cover: k.cover } : {}) })),
    zones: ((d && d.zones) || []).slice(0, 30).map((z) => ({ name: z.name, score: z.score })),
    penalties: ((d && d.penalties) || []).slice(0, 10).map((x) => x.label),
    ...(tandem ? { lead: lap.tandem.lead && lap.tandem.lead.name, proximity: tandem.proximity, avgGap: tandem.avgGap } : {}),
  };
  // same id for the same run, whoever sends it again
  const hash = require('crypto').createHash('sha1').update(`${playerId()}|${lap.id}`).digest('hex');
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  c.addRun({ id, driver: lap.driver.name, car: lap.car, track: lap.track, layout: lap.layout, kind: tandem ? 'tandem' : 'drift', score: base.score, detail })
    .then(() => refreshCategories(true)) // the server may have moved the driver up or down
    .catch((err) => applog.log('run share', err.message));
}

/** Evening going on (from 30 min before to the end): live sharing for the judges. */
function soireeNow(now = Date.now()) {
  return (
    ((sync && sync.manifest && sync.manifest.events) || []).find((ev) => {
      const start = Date.parse(ev.date);
      return start && now >= start - 30 * 60000 && now <= start + (Number(ev.durationMinutes) || 120) * 60000;
    }) || null
  );
}

let liveShareAt = 0;
let liveShareBusy = false;
function shareLive() {
  if (liveShareBusy || Date.now() - liveShareAt < 1500) return;
  if (settings.data.telemetry.shareLaps === false || settings.data.liveShare === false || !soireeNow()) return;
  const live = telemetry && telemetry.live();
  const c = community();
  if (!c || !live || live.status !== 2) return;
  liveShareAt = Date.now();
  liveShareBusy = true;
  const me = presenceIdentity();
  const run = live.run || null;
  const clips = live.clips || null;
  c.setLive({
    ...me,
    name: settings.data.driverName || 'Pilote',
    car: live.car,
    track: live.track,
    layout: live.layout,
    data: {
      angle: Math.round(live.angle || 0),
      speed: Math.round(live.speed || 0),
      inRun: run ? Boolean(run.active) : true,
      d: Math.round((live.d || 0) * 1000) / 1000,
      ms: live.lapMs || 0,
      hit: clips ? clips.hit : 0,
      total: clips ? clips.total : 0,
      clips: clips ? clips.clips.slice(0, 30).map((k) => (k.hit ? 1 : 0)) : [],
      x: Math.round(live.x || 0),
      z: Math.round(live.z || 0),
    },
  })
    .catch((err) => applog.log('live share', err.message))
    .finally(() => {
      liveShareBusy = false;
    });
}

/** Championships with every round's results (qualifying, bracket, points). */
async function championshipsNow() {
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
          entries = (await board.list({ track: round.track, layout: round.layout || '', kind, rules, limit: 100 })).map((r) => ({ name: r.driver, score: Number(r.score) }));
          if (round.kind === 'battle') battles = (await board.battles({ track: round.track, layout: round.layout || '', rules })).map((b) => ({ ...b.modes[round.mode], date: b.date }));
        } catch (err) {
          error = err.message;
        }
      }
      if (!entries) entries = telemetry.store.leaderboard({ track: round.track, layout: round.layout || '', kind, mode: round.mode, rules: version, from: round.start, to: round.end }).map((l) => ({ name: l.driver.name, steamId: l.driver.steamId, score: l.result.score }));
      if (!battles) battles = telemetry.battles.list({ track: round.track, layout: round.layout || '' }).filter((b) => inWindow(b.date) && b.modes[round.mode] && b.modes[round.mode].rules === version).map((b) => ({ ...b.modes[round.mode], date: b.date }));
      if (round.category) {
        await refreshCategories();
        entries = champ.forCategory(round, entries, categoryOf);
      }
      const decisions = (sync.manifest && sync.manifest.judging) || [];
      const ruled = ruledBattles(round, battles, decisions);
      rounds.push({ ...round, ...champ.roundResults(round, { entries, battles: ruled, points: c.points }), error });
    }
    out.push({ ...c, rounds, standings: champ.standings(c, rounds) });
  }
  return out;
}

// ---------------------------------------------------------------- stream overlay (OBS)
let lastGameScore = null;
let obsRound = null;
let obsRoundAt = 0;
let liveOthersCache = null;
const STAGE = { 1: 'Finale', 2: 'Demi', 4: 'Quart', 8: '8e', 16: '16e' };
/** The battle round going on now, as lines for the overlay (bracket, or qualifying until the battles start). */
function roundLines(round) {
  const draw = round.draw;
  const lines = [];
  const stage = draw && draw.rounds.find((ms) => ms.some((m) => !m.winner && !m.bye)) || (draw && draw.rounds[draw.rounds.length - 1]);
  if (stage && stage.some((m) => m.battle || m.winner)) {
    for (const m of stage.filter((x) => !x.bye)) lines.push({ a: m.a || '—', b: m.b || '—', label: m.omt ? 'OMT' : STAGE[stage.length] || '', win: m.winner ? (m.winner === m.a ? 0 : 1) : null });
  } else {
    (round.qualifying || []).slice(0, round.bracket || 8).forEach((q, i) => lines.push({ a: `${i + 1}. ${q.name}`, b: (q.score || 0).toFixed(1), label: 'qualif', win: null }));
  }
  return { name: `${round.name} — ${lines.length && lines[0].label === 'qualif' ? 'qualifications' : 'battle'}`, lines };
}
function refreshObsRound() {
  if (Date.now() - obsRoundAt < 30000) return;
  obsRoundAt = Date.now();
  championshipsNow()
    .then((list) => {
      const live = list.flatMap((c) => c.rounds).find((r) => r.kind === 'battle' && r.status === 'live');
      obsRound = live ? roundLines(live) : null;
    })
    .catch(() => {});
}
function obsData() {
  refreshObsRound();
  const live = telemetry && telemetry.live();
  const on = live && live.status === 2;
  return {
    driver: settings.data.driverName || 'Pilote',
    live: on ? { angle: live.angle, speed: live.speed, clips: live.clips } : null,
    others: on && liveOthersCache ? liveOthersCache.others.slice(0, 3) : [],
    battle: on && liveOthersCache ? liveOthersCache.battle : null,
    score: lastGameScore && Date.now() - lastGameScore.at < 10 * 60000 ? lastGameScore.data : null,
    round: obsRound,
  };
}

/** Other cars seen by the in-game app (apps/lua/LKS/live.json, written 4 times a second). */
function liveOthers(live) {
  if (!acRoot()) return null;
  try {
    const file = path.join(ingame.appDir(acRoot()), 'live.json');
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs > 3000) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || data.track !== live.track || !Array.isArray(data.cars)) return null;
    const me = data.cars.find((c) => c.i === 0);
    const others = data.cars
      .filter((c) => c.i !== 0 && Number.isFinite(c.x) && Number.isFinite(c.z))
      .map((c) => ({ name: String(c.n || '?').slice(0, 40), car: String(c.c || ''), x: c.x, z: c.z, speed: Math.round(c.s || 0), angle: Math.round(c.a || 0), d: c.d, gap: me ? Math.round(Math.hypot(c.x - me.x, c.z - me.z)) : null }))
      .sort((a, b) => (a.gap ?? 1e9) - (b.gap ?? 1e9))
      .slice(0, 24);
    return { others, battle: data.battle || null };
  } catch {
    return null; // file being written: next time
  }
}

function setupTelemetry() {
  const source = process.env.LKS_TELEMETRY_SIM ? new SimulatedSource(new Simulator({ lapMs: 30000 })) : new SharedMemorySource();
  telemetry = new TelemetryManager({
    dataDir: app.getPath('userData'),
    source,
    getDriver: () => ({ name: settings.data.driverName || 'Pilote', steamId: settings.data.steamId || '' }),
    getBoardConfig: () => sync.manifest.leaderboard || null,
    getPlayer: playerId,
    // battles launched in game: each driver's notes come from his own PC (group's server)
    getExchange: () => (settings.data.telemetry.shareLaps !== false ? community() : null),
    getSettings: () => settings.data.telemetry,
    getCourse: driftCourse,
    canonical: canonicalCombo,
    getRounds: (combo) => champ.openRounds((sync.manifest && sync.manifest.championships) || [], combo),
    getObs: obsData,
    // the in-game app's exact clip distances (real car shape, every frame)
    getMeasureDir: () => (acRoot() ? path.join(ingame.appDir(acRoot()), 'measures') : null),
  });
  telemetry.on('battle', (b) => {
    const res = b.modes.normal;
    const me = (settings.data.driverName || '').trim().toLowerCase();
    const other = res.drivers.find((d) => d.name.trim().toLowerCase() !== me) || res.drivers[1];
    let text = `Battle ${res.drivers[0].name} – ${res.drivers[1].name} : ${res.omt ? 'one more time' : `${res.winner} gagne`}`;
    if (me && res.drivers.some((d) => d.name.trim().toLowerCase() === me)) text = `Battle contre ${other.name} : ${res.omt ? 'one more time !' : res.winner.trim().toLowerCase() === me ? 'gagnée' : 'perdue'} (${res.drivers.map((d) => d.total).join(' – ')})`;
    send('toast', { kind: res.omt ? 'info' : 'success', text });
    send('telemetry:lap', null);
    // posted once, by the launcher of the battle's first driver
    if (settings.data.discordShare !== false && (settings.data.driverName || '').trim().toLowerCase() === String(res.drivers[0].name).trim().toLowerCase()) {
      discordPost('news', `⚔️ Battle ${res.drivers[0].name} – ${res.drivers[1].name} sur ${trackLabel(b.track, b.layout)} : ${res.omt ? '**one more time**' : `**${res.winner}** gagne`} (${res.drivers.map((d) => d.total).join(' – ')})`);
    }
    // battle launched in game: the app shows the result
    if (b.tag && acRoot()) {
      try {
        fs.writeFileSync(path.join(ingame.appDir(acRoot()), 'result.json'), JSON.stringify({ tag: Number(b.tag) || b.tag, text }));
      } catch (err) {
        console.warn('[battle]', err.message);
      }
    }
  });
  telemetry.on('combo', (c) => refreshGhostLibrary(c).catch((err) => console.warn('[ghost]', err.message)));
  telemetry.on('reset', (r) => send('telemetry:reset', r));
  applyDriftCourses();
  telemetry.on('lap', ({ lap, pbTime, pbDrift, pbTandem }) => {
    send('telemetry:lap', lap);
    writeScoreForGame(lap, pbDrift, pbTandem);
    shareRun(lap);
    // the driver's new record (normal mode), on the group's channel
    const me = (settings.data.steamId || '') === ((lap.driver && lap.driver.steamId) || '');
    if (me && settings.data.discordShare !== false) {
      const where = `${carLabel(lap.car)} @ ${trackLabel(lap.track, lap.layout)}`;
      if (pbDrift && pbDrift.includes('normal')) discordPost('news', `🏁 **${lap.driver.name}** : record de drift **${lap.drift.modes ? lap.drift.modes.normal.score : lap.drift.score}/100** — ${where}`);
      else if (pbTandem && pbTandem.includes('normal')) discordPost('news', `🤝 **${lap.driver.name}** : record de tandem **${(lap.tandem.modes || {}).normal ? lap.tandem.modes.normal.score : lap.tandem.score}/100** derrière ${lap.tandem.lead && lap.tandem.lead.name} — ${where}`);
    }
    const label = (modes) => (modes.includes('normal') ? '' : ` (${MODE_LABELS[modes[0]]})`);
    if (pbTandem && pbTandem.length) send('toast', { kind: 'success', text: `Record de tandem : ${(lap.tandem.modes[pbTandem.includes('normal') ? 'normal' : pbTandem[0]] || {}).score}/100${label(pbTandem)}` });
    else if (pbDrift && pbDrift.length) send('toast', { kind: 'success', text: `Record de drift : ${(lap.drift.modes[pbDrift.includes('normal') ? 'normal' : pbDrift[0]] || {}).score}/100${label(pbDrift)}` });
    else if (pbTime) send('toast', { kind: 'success', text: `Record perso : ${fmtLap(lap.lapMs)}` });
  });
  telemetry.on('submitted', () => send('toast', { kind: 'info', text: 'Envoyé au classement' }));
  telemetry.on('submitError', (err) => send('toast', { kind: 'warn', text: err.message }));
  telemetry.on('warning', (err) => {
    console.warn('[telemetry]', err.message);
    applog.log('telemetry error', err.stack || err.message);
  });
  telemetry.start();
  setInterval(importTandemRuns, 5000);
  let othersCache = null;
  let othersAt = 0;
  setInterval(() => {
    const live = telemetry.live();
    if (!live) return;
    if (Date.now() - othersAt > 250) {
      othersAt = Date.now();
      othersCache = liveOthers(live);
      liveOthersCache = othersCache;
    }
    send('telemetry:live', othersCache ? { ...live, others: othersCache.others, battle: othersCache.battle } : live);
    shareLive();
  }, 100);
  applyDash();
}

/** Start the hosted server (also used to restart it after an unexpected stop). */
function startHost(opts) {
  if (!acRoot() || !isAcRoot(acRoot())) throw new Error("Dossier d'Assetto Corsa introuvable : configure-le dans les Paramètres");
  const content = scanContent(true);
  const track = content.tracks.find((t) => t.id === opts.track);
  if (!track) throw new Error('Circuit non installé');
  const layout = track.layouts.find((l) => l.id === (opts.layout || '')) || track.layouts[0];
  const cars = (opts.cars || []).map((id) => content.cars.find((c) => c.id === id)).filter(Boolean);
  if (!cars.length) throw new Error('Choisis au moins une voiture installée');
  assertGroupContent({ cars: cars.map((c) => c.id), track: track.id });
  const maxSlots = Math.max(2, layout.pitboxes || 24);
  const slots = Math.min(Number(opts.slots) || 12, maxSlots);
  const config = buildServerConfig({
    ...opts,
    lobby: false, // the public AC lobby rate-limits and kills the server: launcher list instead
    layout: layout.id,
    slots,
    cars: cars.map((c) => ({ id: c.id, skins: c.skins.map((k) => k.id) })),
    ports: opts.ports,
  });
  host.start({ acRoot: acRoot(), config, pack: { cars: cars.map((c) => c.id), track: track.id, layout: layout.id }, label: `${track.name}` });
  hostState = { name: opts.name || 'Partie LKS', ports: config.ports, password: opts.password || '', track: track.name, layout: layout.name, trackId: track.id, layoutId: layout.id, slots, cars: cars.map((c) => c.id), upnp: { state: opts.upnp === false ? 'off' : 'working' }, invites: [] };
  hostState.invites = computeInvites();
  settings.update({ host: { ...opts, manualPorts: Boolean(settings.data.host && settings.data.host.manualPorts) } });
  if (!game.running) setPresence({ details: 'Héberge une partie', state: `${track.name} — ${slots} places`, startedAt: Date.now() });
  if (settings.data.host && settings.data.host.manualPorts) useManualPorts().catch((err) => {
    hostState.upnp = { state: 'failed', error: err.message };
    send('host:changed');
  });
  else if (opts.upnp !== false) openPorts();
  checkFirewall();
  if (opts.launcherList !== false) startAnnounce();
  else {
    stopAnnounce();
    hostState.listed = { state: 'off' };
  }
  hostOpts = opts;
  hostStopRequested = false;
  lastHostStop = null;
  send('host:changed');
}

function setupHosting() {
  host.on('stopped', (info = {}) => {
    const unexpected = !hostStopRequested && !appQuitting;
    const uptime = host.info ? Date.now() - host.info.startedAt : 0;
    lastHostStop = { at: new Date().toISOString(), code: info.code === undefined ? null : info.code, error: info.error || null, byUser: !unexpected, uptimeMs: uptime, log: host.log.slice(-25), reason: serverStopReason(host.log), ports: hostState && hostState.ports };
    applog.log('server stopped', { code: lastHostStop.code, unexpected, uptimeMs: uptime, reason: lastHostStop.reason });
    hostState = null;
    // stopped on its own: start it again with the same settings (3 times in 15 min at most)
    const now = Date.now();
    hostRestarts = hostRestarts.filter((t) => now - t < 15 * 60 * 1000);
    // the public list refused it (too many registrations): restart off the list, invite codes still work
    const lobbyRefused = unexpected && lastHostStop.reason === LOBBY_REFUSED && hostOpts && hostOpts.lobby;
    if (lobbyRefused) hostOpts = { ...hostOpts, lobby: false };
    if (unexpected && hostOpts && (lobbyRefused || hostRestarts.length < 3)) {
      hostRestarts.push(now);
      lastHostStop.restarted = true;
      lastHostStop.lobbyOff = lobbyRefused;
      send('toast', { kind: 'warn', text: lobbyRefused
        ? 'La liste publique du jeu refuse ton serveur pour l’instant : relancé sans elle, les codes d’invitation marchent toujours'
        : `Le serveur s’est arrêté tout seul${lastHostStop.reason ? ` (${lastHostStop.reason})` : ''} : redémarrage…` });
      setTimeout(() => {
        try {
          const keep = lastHostStop;
          startHost(hostOpts);
          lastHostStop = keep; // still shown on the page
          send('host:changed');
        } catch (err) {
          lastHostStop.restarted = false;
          lastHostStop.error = err.message;
          closePorts();
          send('host:changed');
        }
      }, 3000);
      send('host:changed');
      return;
    }
    closePorts();
    stopAnnounce();
    if (unexpected) {
      send('toast', { kind: 'error', text: `Le serveur s’est arrêté${lastHostStop.reason ? ` : ${lastHostStop.reason}` : ''}` });
      if (Notification.isSupported()) new Notification({ title: 'Serveur arrêté', body: lastHostStop.reason || 'Le serveur Assetto Corsa s’est arrêté tout seul.' }).show();
    }
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
    setTimeout(updatePresence, 2000);
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
    setTimeout(updatePresence, 1000);
    applog.log('game exited', { code: info.code, durationMs: info.durationMs, error: info.error, launch: lastLaunch });
    if (telemetry) telemetry.source.detach();
    send('game:state', { running: false, ...info });
    if (!info.error && crashlog.looksLikeCrash(info)) {
      try {
        lastCrash = { ...crashlog.diagnose({ ...info, launch: lastLaunch, version: app.getVersion(), docsDir: docsDir(), launcherLog: applog.tail(20), cspEnabled: Boolean(csp.status().enabled) }), launch: lastLaunch, at: new Date().toISOString(), canRestore: graphics.hasBackup(docsDir()) };
        send('game:crash', { ...lastCrash, canSend: webhooks.configured('reports') });
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
    // end of the session: only the best passages stay (after the last in-game runs are imported)
    if (telemetry && settings.data.telemetry.keepAll !== true) {
      setTimeout(async () => {
        try {
          await importTandemRuns();
          const n = await telemetry.purgeSession();
          if (n) {
            applog.log('telemetry purge', { removed: n });
            send('telemetry:lap', null);
          }
        } catch (err) {
          console.warn('[purge]', err.message);
        }
      }, 120000);
    }
  });
}

/** The game crashes while loading a layout without its physics file: say it before launching. */
function checkTrackFiles(track, layoutId) {
  const dir = path.join(acRoot(), 'content', 'tracks', track.id);
  if (acContent.layoutHasPhysics(dir, layoutId)) return;
  const others = track.layouts.filter((l) => l.id !== layoutId && acContent.layoutHasPhysics(dir, l.id));
  const where = layoutId ? `${track.id}/${layoutId}/data/surfaces.ini` : `${track.id}/data/surfaces.ini`;
  throw new Error(others.length
    ? `Ce tracé de ${track.name} est incomplet (il manque ${where}). Choisis un autre tracé : ${others.map((l) => l.name).join(', ')}.`
    : `${track.name} est incomplet (il manque ${where}) : le jeu planterait au chargement. Réinstalle le circuit.`);
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
  // in-game app already installed: keep it up to date (new runs, start lights, battles)
  try {
    const status = ingame.ingameStatus(acRoot());
    if (status.installed && !status.upToDate) ingame.installIngame(acRoot(), allDriftCourses());
    if (status.installed && launch && launch.track) refreshGhostLibrary({ track: launch.track, layout: launch.layout || '' }, true).catch(() => {});
  } catch (err) {
    console.warn('[ingame]', err.message);
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
  // Signature check of the downloaded installer. Until the installers are signed
  // (SignPath), an unsigned update is accepted: the updater still checks its
  // SHA-512 from the GitHub release. A signed one must come from the right publisher.
  // TODO: remove once the installers are signed.
  try {
    const { verifySignature } = require('electron-updater/out/windowsExecutableCodeSignatureVerifier');
    updater.verifyUpdateCodeSignature = async (publisherNames, file) => {
      const problem = await verifySignature(publisherNames, file, updater.logger || console);
      if (problem && /"Status"\s*:\s*2\b/.test(problem)) return null; // 2 = NotSigned
      return problem;
    };
  } catch {
    /* older updater: default check */
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
    if (patch && 'showOnline' in patch) updatePresence();
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
      restricted: contentRestricted(),
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
  handle('game:lastCrash', () => (lastCrash ? { ...lastCrash, canSend: webhooks.configured('reports') } : null));
  handle('game:sendReport', async () => {
    if (!lastCrash) throw new Error('Pas de rapport');
    if (!webhooks.configured('reports')) throw new Error('Les admins n’ont pas encore réglé le salon des rapports');
    const who = settings.data.driverName || 'Un membre';
    const l = lastCrash.launch || {};
    const ok = await webhooks.post('reports', `💥 Plantage chez **${who}** (launcher ${app.getVersion()}) — ${l.car ? carLabel(l.car) : '?'} @ ${l.track ? trackLabel(l.track, l.layout) : '?'}\n${crashlog.scrub((lastCrash.hints || []).map((x) => `• ${x.text}`).join('\n')).slice(0, 1200)}`, { name: 'rapport.txt', content: crashlog.scrub(lastCrash.report) });
    if (!ok) throw new Error('Envoi impossible');
    return true;
  });
  handle('app:graphicsSafe', (on) => {
    if (typeof on === 'boolean') applog.setGraphicsSafe(app.getPath('userData'), on);
    return applog.graphicsSafe(app.getPath('userData'));
  });
  handle('game:launchSolo', (opts) => {
    ensureReady();
    const s = settings.data;
    const content = scanContent(false);
    const car = content.cars.find((c) => c.id === opts.car);
    const track = content.tracks.find((t) => t.id === opts.track);
    if (!car) throw new Error('Voiture introuvable : choisissez une voiture installée');
    if (!track) throw new Error('Circuit introuvable : choisissez un circuit installé');
    assertGroupContent({ cars: [car.id], track: track.id });
    const layout = track.layouts.find((l) => l.id === (opts.layout || '')) || track.layouts[0];
    checkTrackFiles(track, layout.id);
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
    assertGroupContent({ cars: [opts.car], track });
    checkTrackFiles(content.tracks.find((t) => t.id === track), layout || '');
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
    currentServer = { name: opts.serverName || '', ip: opts.ip, port: opts.tcpPort, httpPort: opts.httpPort };
    startGame({ kind: 'online', mode: opts.serverName || '', car: opts.car, track, layout });
    setTimeout(updatePresence, 3000);
    return true;
  });

  // Servers
  handle('servers:list', async () => {
    const fromManifest = (sync.manifest.servers || []).map((x) => ({ ...x, source: 'lks' }));
    const custom = (settings.data.customServers || []).map((x) => ({ ...x, source: 'custom' }));
    const list = hostList();
    const hosted = list ? await list.list().catch((err) => {
      applog.log('host list failed', err.message);
      return [];
    }) : [];
    const launcher = hosted.filter((e) => e.addresses.length).map((e) => ({
      name: e.name,
      ip: e.addresses[0].address,
      httpPort: e.httpPort,
      addresses: e.addresses,
      hostDriver: e.hostDriver,
      mine: Boolean(hostAd && hostAd.id === e.id),
      description: `Hébergée par ${e.hostDriver || 'un membre'} depuis le launcher`,
      source: 'launcher',
      key: `lks-host:${e.id}`,
    }));
    return [...launcher, ...[...fromManifest, ...custom].map((x) => ({ ...x, httpPort: Number(x.httpPort) || 8081, key: `${x.ip}:${x.httpPort || 8081}` }))];
  });
  handle('servers:info', async (server) => {
    if (!Array.isArray(server.addresses)) return getServerInfo(server);
    // a game hosted from the launcher: use whichever of its addresses answers from here
    const best = await bestAddress(server, getServerInfo);
    if (best) return best.info;
    const kinds = server.addresses.map((a) => NET_LABELS[a.kind] || a.kind).join(', ');
    return { online: false, name: server.name, ip: server.ip, httpPort: server.httpPort, error: `aucune adresse ne répond (${kinds}). Si l'hôte n'a pas pu ouvrir ses ports, rejoignez le VPN du groupe`, hosted: true };
  });
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
      manifest: { allowAllContent: Boolean(pub.manifest.allowAllContent), drift: pub.manifest.drift || {}, leaderboard: pub.manifest.leaderboard || null, vpn: pub.manifest.vpn || null, history: (pub.manifest.history || []).slice(0, 30), events: pub.manifest.events || [], soloPresets: pub.manifest.soloPresets || [], discord: pub.manifest.discord || null, setups: (pub.manifest.setups || []).map((s) => ({ car: s.car, name: s.name, files: s.files.length, publishedAt: s.publishedAt })), branding: pub.manifest.branding ? { version: pub.manifest.branding.version, files: pub.manifest.branding.files.map((f) => f.name), showcase: (pub.manifest.branding.showcase || []).length } : null, name: pub.manifest.name, motd: pub.manifest.motd || '', csp: pub.manifest.csp || null, donate: pub.manifest.donate || null, shop: pub.manifest.shop || null, servers: pub.manifest.servers, news: pub.manifest.news, updatedAt: pub.manifest.updatedAt },
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
    hostRestarts = [];
    startHost(opts);
    return hostStatus();
  });
  handle('host:diagnostic', async () => {
    const st = await hostStatus();
    const s = hostState || { ports: (lastHostStop && lastHostStop.ports) || (hostOpts && hostOpts.ports) };
    const net = require('os').networkInterfaces();
    const lines = [
      `LKS Launcher ${app.getVersion()} — diagnostic hébergement (${new Date().toISOString()})`,
      `Serveur : ${st.running ? 'lancé' : 'arrêté'} · trouvé : ${st.serverFound ? 'oui' : 'non'} · joueurs : ${st.info ? `${st.info.clients}/${st.info.maxClients}` : 'pas de réponse locale'}`,
      `Ports : TCP ${s.ports && s.ports.tcp} · UDP ${s.ports && s.ports.udp} · HTTP ${s.ports && s.ports.http}`,
      `UPnP : ${(s.upnp && s.upnp.state) || '—'}${s.upnp && s.upnp.error ? ` — ${s.upnp.error}` : ''}${s.upnp && s.upnp.externalIp ? ` — IP publique ${s.upnp.externalIp}` : ''}`,
      ...hostTrace.map((l) => `  · ${l}`),
      `Pare-feu Windows : ${s.firewall ? JSON.stringify(s.firewall) : 'non vérifié'}`,
      `Réseaux détectés : ${st.networks.map((n) => `${n.kind}=${n.address}`).join(', ') || 'aucun'}`,
      `Cartes : ${Object.entries(net).map(([k, v]) => `${k}=${(v || []).filter((a) => a.family === 'IPv4').map((a) => a.address).join('/')}`).join(', ')}`,
      `Codes d'invitation : ${(s.invites || []).map((i) => i.kind).join(', ') || 'aucun'}`,
      `Liste du launcher : ${s.listed ? `${s.listed.state}${s.listed.error ? ` — ${s.listed.error}` : ''}` : '—'}`,
      `Dernier arrêt : ${lastHostStop ? `${lastHostStop.at} · ${lastHostStop.byUser ? 'demandé' : 'tout seul'} · code ${lastHostStop.code} · après ${Math.round(lastHostStop.uptimeMs / 60000)} min · ${lastHostStop.reason || 'cause inconnue'}${lastHostStop.restarted ? ` · relancé${lastHostStop.lobbyOff ? ' hors liste publique' : ''}` : ''}` : 'aucun'}`,
      ...(lastHostStop && !lastHostStop.byUser ? ['--- journal au moment de l’arrêt', ...lastHostStop.log] : []),
      '--- journal du serveur',
      ...(st.log || []).slice(-40),
    ];
    return lines.join('\n');
  });
  // ports opened by hand in the box: give the internet invitation code
  handle('host:manualPorts', async () => {
    if (!hostState) throw new Error('Aucun serveur lancé');
    await useManualPorts();
    settings.update({ host: { ...(settings.data.host || {}), manualPorts: true } }); // the box keeps them: remember
    return hostStatus();
  });
  handle('host:retryPorts', async () => {
    if (!hostState) throw new Error('Aucun serveur lancé');
    settings.update({ host: { ...(settings.data.host || {}), manualPorts: false } });
    await openPorts();
    return hostStatus();
  });


  handle('host:fixFirewall', async () => {
    await fixFirewall(serverExe(acRoot()));
    await checkFirewall();
    return hostStatus();
  });
  handle('host:stop', async () => {
    hostStopRequested = true;
    host.stop();
    await Promise.all([closePorts(), stopAnnounce()]);
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
  handle('telemetry:diagnostic', () => {
    const live = telemetry.live();
    const r = telemetry.recorder;
    const combo = r.combo;
    const info = combo ? driftCourseInfo(combo) : null;
    const c = info && info.course;
    const err = telemetry.tickError || telemetry.source.error;
    return [
      `LKS Launcher ${app.getVersion()} — diagnostic télémétrie (${new Date().toISOString()})`,
      `Télémétrie : ${settings.data.telemetry.enabled === false ? 'désactivée' : 'activée'} · données du jeu : ${live ? `oui (statut ${live.status}, session ${live.session})` : 'aucune'}${err ? ` · erreur : ${err.message || err}` : ''}`,
      `Circuit : ${combo ? `${combo.track} | ${combo.layout || '(sans tracé)'} · voiture ${combo.car}` : '—'}`,
      `Parcours : ${c ? `${info.source} · ${(c.clips || []).length} clip(s) · portes ${c.start && c.finish ? 'oui' : 'non'} · ligne ${(c.refLine || []).length} points` : 'aucun (tours chronométrés)'}`,
      c && c.start ? `Porte de départ : ${JSON.stringify(c.start)} · arrivée ${JSON.stringify(c.finish)}` : null,
      live ? `Position : x ${Math.round(live.x * 10) / 10} · z ${Math.round(live.z * 10) / 10} · d ${live.d == null ? '—' : Math.round(live.d * 1000) / 1000} · tours ${live.laps} · run ${live.run ? JSON.stringify(live.run) : '—'}` : null,
      `Départ : plus près de la porte ${r.diag.startMin == null ? '—' : `${r.diag.startMin} m`} · passages ${JSON.stringify(r.diag.startCross)} · runs démarrées ${JSON.stringify(r.diag.starts)} · finies ${r.diag.runs}${r.diag.rejected ? ` · refusée ${JSON.stringify(r.diag.rejected)}` : ''}`,
      `Remises à zéro : ${r.diag.resets.map((x) => `${x.at.slice(11, 19)} ${x.why}${x.running ? ' (run en cours)' : ''}`).join(', ') || 'aucune'}`,
      `Tours enregistrés sur ce circuit : ${combo ? telemetry.store.list({ track: combo.track, layout: combo.layout || '' }).length : '—'}`,
    ].filter(Boolean).join('\n');
  });
  handle('telemetry:categories', async () => {
    const map = await refreshCategories(false);
    return { mine: categoryOf(settings.data.driverName), me: settings.data.driverName || '', map, modes: CATEGORY_MODE, up: 75, down: 35 };
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
  // edges of the road (AI line of the installed track), for the course editor
  handle('drift:road', ({ track, layout }) => {
    try {
      return ailine.trackRoad(acRoot(), track, layout || '');
    } catch {
      return null;
    }
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
  // the driver's profile: runs, records per track, battles, progression week by week
  handle('telemetry:profile', () => {
    const me = settings.data.steamId || '';
    const myName = (settings.data.driverName || '').trim().toLowerCase();
    const own = telemetry.store.list({}).filter((l) => !l.imported && ((l.driver.steamId || '') === me || (!me && (l.driver.name || '').trim().toLowerCase() === myName)));
    const score = (l, kind) => {
      const r = driftOf(l, 'normal', kind);
      return r && r.score > 0 ? r.score : 0;
    };
    const tracks = new Map();
    let driftSeconds = 0;
    for (const l of own) {
      const key = `${l.track}|${l.layout || ''}`;
      const t = tracks.get(key) || { track: l.track, layout: l.layout || '', name: trackLabel(l.track, l.layout), runs: 0, best: 0, bestCar: '', bestDate: null, bestTandem: 0 };
      t.runs++;
      const sd = l.tandem ? 0 : score(l, 'drift');
      if (sd > t.best) Object.assign(t, { best: sd, bestCar: carLabel(l.car), bestDate: l.date });
      if (l.tandem) t.bestTandem = Math.max(t.bestTandem, score(l, 'tandem'));
      tracks.set(key, t);
      const d = driftOf(l, 'normal', 'drift');
      if (d && d.driftTime) driftSeconds += d.driftTime;
    }
    // best solo score per week, last 12 weeks
    const week = 7 * 86400000;
    const now = Date.now();
    const weeks = Array.from({ length: 12 }, (_, i) => ({ from: now - (12 - i) * week, best: 0, runs: 0 }));
    for (const l of own) {
      const t = Date.parse(l.date);
      const w = weeks.find((x) => t >= x.from && t < x.from + week);
      if (!w) continue;
      w.runs++;
      if (!l.tandem) w.best = Math.max(w.best, score(l, 'drift'));
    }
    const battles = telemetry.battles.items
      .map((b) => ({ b, r: b.modes && b.modes.normal }))
      .filter(({ r }) => r && r.drivers && r.drivers.some((d) => d.name.trim().toLowerCase() === myName))
      .map(({ b, r }) => {
        const other = r.drivers.find((d) => d.name.trim().toLowerCase() !== myName) || {};
        const won = !r.omt && String(r.winner || '').trim().toLowerCase() === myName;
        return { date: b.date, track: trackLabel(b.track, b.layout), against: other.name || '?', result: r.omt ? 'omt' : won ? 'won' : 'lost', score: r.drivers.map((d) => d.total).join(' – ') };
      })
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const won = battles.filter((x) => x.result === 'won').length;
    const best = Math.max(0, ...[...tracks.values()].map((t) => t.best));
    const bestTandem = Math.max(0, ...[...tracks.values()].map((t) => t.bestTandem));
    const allClips = own.some((l) => {
      const d = !l.tandem && driftOf(l, 'normal', 'drift');
      return d && Array.isArray(d.clips) && d.clips.length >= 3 && d.clips.every((c) => c.hit);
    });
    const soloRuns = own.filter((l) => !l.tandem).length;
    const badges = [
      ['first', 'Première run', 'Une run enregistrée', soloRuns >= 1],
      ['runs50', '50 runs', '50 runs en solo', soloRuns >= 50],
      ['runs200', '200 runs', '200 runs en solo', soloRuns >= 200],
      ['score60', 'Ça glisse', 'Une note de 60/100 ou plus', best >= 60],
      ['score75', 'Pilote confirmé', 'Une note de 75/100 ou plus', best >= 75],
      ['score90', 'Note de juge', 'Une note de 90/100 ou plus', best >= 90],
      ['clips', 'Tous les clips', 'Une run avec tous les clips (3 ou plus)', allClips],
      ['tandem', 'Premier tandem', 'Un tandem enregistré', own.some((l) => l.tandem)],
      ['tandem60', 'Collé au pare-choc', 'Un chase noté 60/100 ou plus', bestTandem >= 60],
      ['battle1', 'Première victoire', 'Une battle gagnée', won >= 1],
      ['battle5', 'Cinq victoires', '5 battles gagnées', won >= 5],
      ['tracks3', 'Globe-trotter', 'Des runs sur 3 circuits', tracks.size >= 3],
      ['weeks4', 'Fidèle', 'Des runs 4 semaines différentes', weeks.filter((w) => w.runs).length >= 4],
      ['hour', 'Une heure en glisse', '60 minutes de glisse au total', driftSeconds >= 3600],
    ].map(([id, name, how, earned]) => ({ id, name, how, earned }));
    return {
      name: settings.data.driverName || 'Pilote',
      badges,
      runs: own.filter((l) => !l.tandem).length,
      tandems: own.filter((l) => l.tandem).length,
      driftMinutes: Math.round(driftSeconds / 60),
      tracks: [...tracks.values()].sort((a, b) => b.best - a.best),
      weeks: weeks.map((w) => ({ from: new Date(w.from).toISOString(), best: w.best, runs: w.runs })),
      battles: { won: battles.filter((x) => x.result === 'won').length, lost: battles.filter((x) => x.result === 'lost').length, omt: battles.filter((x) => x.result === 'omt').length, last: battles.slice(0, 8) },
    };
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
    const decisions = (sync.manifest && sync.manifest.judging) || [];
    const all = dedupeBattles([...local, ...remote]).filter((b) => b.result).map((b) => ({ ...b, result: judging.judged(b.result, judging.decisionFor(decisions, b)) }));
    return { battles: all, error };
  });
  // a judge overrules a battle (admins): winner, one more time, or back to the launcher's result
  handle('admin:judgeBattle', ({ battle, winner, omt, note, remove }) =>
    withAdmin(async () => {
      const pub = getPublisher();
      if (!pub.manifest) await pub.open();
      const key = { pair: battle.pair || judging.pairOf(battle.result.drivers.map((d) => d.name)), track: battle.track, layout: battle.layout || '', date: battle.date };
      let list = (pub.manifest.judging || []).filter((d) => !(judging.decisionFor([d], { ...key, result: battle.result })));
      if (!remove) list.push({ ...key, winner: omt ? null : winner, omt: Boolean(omt), note, by: settings.data.driverName || 'admin', at: new Date().toISOString() });
      list = judging.cleanJudging(list);
      await pub.updateMeta({ judging: list });
      await refreshManifest({ autoSync: false });
      if (!remove && settings.data.discordShare !== false) {
        const names = battle.result.drivers.map((d) => d.name).join(' – ');
        discordPost('news', `⚖️ Décision du juge, battle ${names} sur ${trackLabel(battle.track, battle.layout)} : ${omt ? '**one more time**' : `**${winner}** gagne`}${note ? ` (${note})` : ''}`);
      }
      return true;
    }),
  );
  handle('champ:list', () => championshipsNow());
  
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
  handle('admin:saveDriftCourse', ({ track, layout = '', lapId, section, clips, rules, refLine, refDriver, remove, lineEdited }) =>
    withAdmin(async () => {
      const pub = getPublisher();
      if (!pub.manifest) await pub.open();
      const key = `${track}|${layout}`;
      const all = { ...(pub.manifest.drift || {}) };
      if (remove) delete all[key];
      else {
        const sec = [Math.max(0, Number(section[0]) || 0), Math.min(1, Number(section[1]) || 1)];
        if (!(sec[1] > sec[0])) throw new Error('Début et fin du parcours invalides');
        const course = { section: sec, clips: (clips || []).slice(0, 30).map((c, i) => ({ name: String(c.name || `Clip ${i + 1}`).slice(0, 30), kind: c.kind === 'outer' ? 'outer' : 'inner', x: Number(c.x), z: Number(c.z), r: Math.min(15, Math.max(0.5, Number(c.r) || 3)), ...(Number.isFinite(Number(c.y)) && c.y !== null && c.y !== '' ? { y: Number(c.y) } : {}), ...(Array.isArray(c.path) && c.path.length > 1 ? { path: c.path.slice(0, 60).map((q) => [Math.round((Number(q[0]) || 0) * 100) / 100, Math.round((Number(q[1]) || 0) * 100) / 100]) } : {}), ...clipTarget(c.target) })), refLine: [], refSpeed: 0 };
        // runs between gates (official course): keep its gates, start spot and zones
        const gated = [all[key], bundledCourse(track, layout)].find((c) => hasGates(c));
        if (gated) for (const k of ['progress', 'staging', 'start', 'finish', 'zones']) if (gated[k] !== undefined) course[k] = gated[k];
        const cleanLine = (pts) => pts.slice(0, 4000).map((p) => [Math.round((Number(p[0]) || 0) * 100) / 100, Math.round((Number(p[1]) || 0) * 100) / 100]);
        if (lapId) {
          const lap = String(lapId).startsWith('remote-') ? await telemetry.board().lap(String(lapId).slice(7)) : telemetry.store.load(lapId);
          if (lap.track !== track || (lap.layout || '') !== layout) throw new Error("Ce tour n'est pas sur ce circuit");
          Object.assign(course, referenceFrom(lap.samples, sec), { refDriver: lap.driver.name });
          // the line adjusted by hand on top of this run (its speed stays the reference)
          if (lineEdited && Array.isArray(refLine) && refLine.length > 1) Object.assign(course, { refLine: cleanLine(refLine), refDriver: `${lap.driver.name}, ajustée à la main` });
        } else if (lineEdited && Array.isArray(refLine) && refLine.length > 1) {
          // line adjusted by hand: the reference speed of the current course stays
          Object.assign(course, { refLine: cleanLine(refLine), refSpeed: (all[key] && all[key].refSpeed) || 0, refDriver: typeof refDriver === 'string' && refDriver ? refDriver.slice(0, 60) : 'ligne ajustée à la main', ...(all[key] && all[key].slipSign ? { slipSign: all[key].slipSign } : {}) });
        } else if (Array.isArray(refLine)) Object.assign(course, { refLine: refLine.slice(0, 2000).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]), refDriver: typeof refDriver === 'string' && refDriver ? refDriver.slice(0, 60) : gated ? 'ligne officielle' : 'ligne IA' });
        else if (all[key]) Object.assign(course, { refLine: all[key].refLine || [], refSpeed: all[key].refSpeed || 0, refDriver: all[key].refDriver, slipSign: all[key].slipSign });
        if (rules) course.rules = cleanRules(rules);
        all[key] = course;
      }
      await pub.updateMeta({ drift: all });
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
  // judges: every driver's live state (during an evening) and the notes of the latest runs
  handle('judge:feed', async ({ track, layout } = {}) => {
    const c = community();
    if (!c) return { configured: false };
    const soiree = soireeNow();
    const since = new Date(Date.now() - 12 * 3600000).toISOString();
    const onTrack = track || (soiree && soiree.track) || undefined;
    const onLayout = track ? layout || '' : soiree && soiree.track ? soiree.layout || '' : undefined;
    const [live, runs] = await Promise.all([c.live().catch(() => []), c.runs({ track: onTrack, layout: onLayout, since, limit: 80 })]);
    return {
      configured: true,
      soiree: soiree ? { title: soiree.title, track: soiree.track || '', layout: soiree.layout || '', trackName: soiree.track ? trackLabel(soiree.track, soiree.layout) : '' } : null,
      live: live.map((p) => ({ ...p, carName: carLabel(p.car), trackName: trackLabel(p.track, p.layout) })),
      runs: runs.map((r) => ({ ...r, carName: carLabel(r.car), trackName: trackLabel(r.track, r.layout) })),
    };
  });

  handle('community:online', async () => {
    const c = community();
    if (!c) return { configured: false, people: [] };
    const myId = settings.data.presenceId;
    const people = (await c.presence()).filter((p) => p.id !== myId).map((p) => ({ ...p, carName: p.car ? carLabel(p.car) : '', trackName: p.track ? trackLabel(p.track, p.layout) : '' }));
    return { configured: true, people };
  });

  // ------------------------------------------------------------ proposals (members → admins)
  handle('proposals:sources', () => {
    const content = scanContent(false);
    const groupCars = new Set(((sync.manifest && sync.manifest.cars) || []).map((c) => c.id));
    return {
      cars: content.cars.filter((c) => !groupCars.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
      skins: content.cars.filter((c) => groupCars.has(c.id)).map((c) => ({ car: c.id, name: c.name, skins: (c.skins || []).map((k) => ({ id: k.id, name: k.name || k.id })) })),
      setups: localSetupCars(docsDir()).map((c) => ({ ...c, name: (content.cars.find((x) => x.id === c.car) || {}).name || c.car })),
      configured: Boolean(community()),
      maxUpload: MAX_UPLOAD,
    };
  });
  handle('proposals:list', async () => {
    const c = community();
    if (!c) return { configured: false, items: [] };
    const mine = new Set(settings.data.myProposals || []);
    const votes = settings.data.myVotes || {};
    const items = (await c.proposals()).map((p) => ({ ...p, decision: decisionOf(sync.manifest, p.id), mine: mine.has(p.id), myVote: votes[p.id] || 0 }));
    return { configured: true, items };
  });
  handle('proposals:submit', async (p) => {
    const c = community();
    if (!c) throw new Error('Les propositions ne sont pas encore activées par les admins (serveur du groupe)');
    if (!['car', 'skin', 'setup'].includes(p.kind)) throw new Error('Type de proposition inconnu');
    let zip = null;
    if (!p.link) {
      zip = await zipProposal(p);
      if (zip.length > MAX_UPLOAD) throw new Error(`Trop gros pour l’envoi direct (${Math.round(zip.length / 1048576)} Mo, 50 Mo max) : mets-le sur Google Drive, Mega ou Discord et colle le lien`);
    }
    const id = await c.propose({ ...p, zip, author: settings.data.driverName || 'Pilote' });
    settings.update({ myProposals: [...(settings.data.myProposals || []), id].slice(-100) });
    discordPost('news', `📦 **${settings.data.driverName || 'Un membre'}** propose ${p.kind === 'car' ? 'une voiture' : p.kind === 'skin' ? 'une livrée' : 'des setups'} : **${String(p.title || p.car).slice(0, 80)}**`);
    return id;
  });
  handle('proposals:vote', async ({ id, value }) => {
    const c = community();
    if (!c) throw new Error('Votes indisponibles');
    const me = presenceIdentity();
    await c.vote(id, me.id, me.secret, value);
    const votes = { ...(settings.data.myVotes || {}) };
    if (value) votes[id] = value;
    else delete votes[id];
    settings.update({ myVotes: votes });
    return true;
  });

  // ------------------------------------------------------------ gallery: the group's liveries + members' photos
  handle('gallery:list', async () => {
    const ids = lksIds();
    const liveries = scanContent(false).cars.filter((c) => ids.car.has(c.id)).flatMap((c) => (c.skins || []).filter((k) => k.preview).map((k) => ({ car: c.id, carName: c.name, skin: k.id, name: k.name, preview: k.preview })));
    const c = community();
    let photos = [];
    let error = null;
    if (c) {
      try {
        const hidden = new Set((sync.manifest && sync.manifest.galleryHidden) || []);
        photos = (await c.photos()).filter((p) => !hidden.has(p.id)).map((p) => ({ ...p, carName: p.car ? carLabel(p.car) : '', trackName: p.track ? trackLabel(p.track) : '' }));
      } catch (err) {
        error = err.message;
      }
    }
    return { liveries, photos, configured: Boolean(c), error };
  });
  handle('gallery:add', async ({ caption, car, track }) => {
    const c = community();
    if (!c) throw new Error('La galerie n’est pas encore activée par les admins');
    const screens = path.join(docsDir(), 'screens');
    const r = await dialog.showOpenDialog(win, { title: 'Choisir une photo', defaultPath: fs.existsSync(screens) ? screens : app.getPath('pictures'), properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
    const size = fs.statSync(file).size;
    if (size > MAX_PHOTO) throw new Error(`Image trop grosse (${Math.round(size / 1048576)} Mo, 10 Mo max)`);
    // without the hidden data of the file (GPS position, camera, date…)
    const id = await c.addPhoto({ image: require('./imagemeta').stripImage(fs.readFileSync(file), ext), ext, author: settings.data.driverName || 'Pilote', caption, car, track });
    discordPost('news', `📸 **${settings.data.driverName || 'Un membre'}** a ajouté une photo à la galerie${caption ? ` : ${String(caption).slice(0, 120)}` : ''}`);
    return id;
  });
  handle('admin:galleryHide', (id) =>
    withAdmin(async () => {
      const pub = getPublisher();
      if (!pub.manifest) await pub.open();
      const list = [...new Set([...(pub.manifest.galleryHidden || []), String(id)])].slice(-500);
      await pub.updateMeta({ galleryHidden: list });
      await refreshManifest({ autoSync: false });
      return true;
    }),
  );
  handle('admin:proposalInstall', (id) =>
    withAdmin(async () => {
      const c = community();
      const p = c && (await c.proposals()).find((x) => x.id === id);
      if (!p) throw new Error('Proposition introuvable');
      return installProposal(p);
    }),
  );
  handle('admin:proposalDecide', ({ id, status, note, publish }) =>
    withAdmin(async () => {
      if (!['accepted', 'refused', 'pending'].includes(status)) throw new Error('Décision invalide');
      const c = community();
      const p = c && (await c.proposals()).find((x) => x.id === id);
      if (!p) throw new Error('Proposition introuvable');
      const pub = getPublisher();
      if (!pub.manifest) await pub.open();
      // accepted: publish what was installed from the proposal
      let report = null;
      if (status === 'accepted' && publish) {
        if (p.kind === 'setup') report = await pub.publishSetups(docsDir(), [p.car], Object.fromEntries(scanContent(true).cars.map((x) => [x.id, x.name])));
        else {
          if (!fs.existsSync(path.join(acRoot(), 'content', 'cars', p.car))) throw new Error('Installe d’abord la proposition pour la tester');
          await pub.open();
          report = await pub.publishItems(acRoot(), [{ kind: 'car', id: p.car }], {});
        }
      }
      const all = { ...(pub.manifest.proposals || {}) };
      if (status === 'pending') delete all[id];
      else all[id] = { status, note: String(note || '').slice(0, 300), by: settings.data.driverName || 'admin', at: new Date().toISOString() };
      await pub.updateMeta({ proposals: all });
      await refreshManifest({ autoSync: false });
      if (status === 'accepted') discordPost('news', `✅ Proposition acceptée : **${p.title}** de ${p.author}${publish ? ' — dispo dans le launcher' : ''}`);
      return { decision: all[id] || null, report };
    }),
  );
  // reference line from the group's best runs (local + shared leaderboard), one run per driver
  handle('admin:lineFromRuns', ({ track, layout = '' }) =>
    withAdmin(async () => {
      const course = driftCourse({ track, layout });
      const version = courseVersion(course, 'normal');
      const seen = new Set();
      const laps = [];
      const take = (lap) => {
        const who = String((lap.driver && lap.driver.name) || '').toLowerCase();
        if (seen.has(who) || laps.length >= 8) return;
        seen.add(who);
        laps.push(lap);
      };
      const local = telemetry.store
        .list({ track, layout })
        .filter((l) => !l.tandem && (driftOf(l, 'normal', 'drift') || {}).rules === version && (driftOf(l, 'normal', 'drift') || {}).score > 0)
        .sort((x, y) => driftOf(y, 'normal', 'drift').score - driftOf(x, 'normal', 'drift').score);
      for (const l of local.slice(0, 20)) {
        try {
          take(telemetry.store.load(l.id));
        } catch {
          /* gone */
        }
      }
      const board = telemetry.board();
      if (board) {
        try {
          for (const r of (await board.list({ track, layout, kind: 'drift', rules: version, limit: 10 })) || []) take(await board.lap(r.id));
        } catch (err) {
          console.warn('[ligne]', err.message);
        }
      }
      const res = lineFromRuns(laps, course);
      if (!res) throw new Error('Pas assez de runs notées sur ce parcours pour en tirer une ligne.');
      return res;
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
      // events with a battle: one round each in the « Soirées LKS » championship
      if (patch && Array.isArray(patch.events)) {
        if (!pub.manifest) await pub.open();
        const championships = champ.syncSoirees(pub.manifest.championships || [], patch.events);
        if (championships) patch = { ...patch, championships };
      }
      // new events: announced on the group's channel
      if (patch && Array.isArray(patch.events)) {
        if (!pub.manifest) await pub.open();
        const known = new Set(((pub.manifest && pub.manifest.events) || []).map((e) => e.id));
        for (const ev of patch.events.filter((e) => e.id && !known.has(e.id) && Date.parse(e.date) > Date.now())) {
          const when = new Date(ev.date).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
          const what = [ev.track ? trackLabel(ev.track, ev.layout) : null, (ev.cars || []).length ? (ev.cars || []).map(carLabel).join(', ') : null].filter(Boolean).join(' · ');
          setTimeout(() => discordPost('news', `📅 **${ev.title || 'Soirée LKS'}** — ${when}${what ? `\n${what}` : ''}${ev.description ? `\n${ev.description}` : ''}`), 2000);
        }
      }
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
  refreshManifest({ autoSync: true }).catch(() => {}).finally(startPresence);
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  appQuitting = true;
  // never leave a server running or ports open behind us
  if (host.running) host.stop();
  closePorts();
  stopAnnounce();
  const c = community();
  if (c && settings.data.presenceId) c.removePresence(settings.data.presenceId, settings.data.presenceSecret).catch(() => {});
});
