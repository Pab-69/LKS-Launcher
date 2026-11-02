'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');

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

async function refreshManifest({ autoSync } = {}) {
  const before = sync.manifest.updatedAt;
  await sync.loadManifest();
  send('sync:changed', sync.summary());
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
  });
  setInterval(() => refreshManifest({ autoSync: true }).catch(() => {}), MANIFEST_POLL_MS);
}

function setupGame() {
  game.on('started', () => {
    send('game:state', { running: true });
    if (settings.data.closeOnLaunch && win) win.minimize();
  });
  game.on('exited', (info) => {
    send('game:state', { running: false, ...info });
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    refreshManifest({ autoSync: true }).catch(() => {});
  });
}

function ensureReady() {
  if (!acRoot() || !isAcRoot(acRoot())) throw new Error("Dossier d'Assetto Corsa introuvable : configurez-le dans les Paramètres");
  if (game.running) throw new Error('Assetto Corsa est déjà en cours');
  if (sync.running) throw new Error('Synchronisation en cours, patientez quelques instants');
}

function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.on('checking-for-update', () => send('updater:status', { state: 'checking' }));
  updater.on('update-available', (i) => send('updater:status', { state: 'downloading', version: i.version }));
  updater.on('update-not-available', () => send('updater:status', { state: 'latest' }));
  updater.on('download-progress', (p) => send('updater:status', { state: 'downloading', percent: p.percent }));
  updater.on('update-downloaded', (i) => send('updater:status', { state: 'ready', version: i.version }));
  updater.on('error', (e) => send('updater:status', { state: 'error', error: e.message }));
  updater.checkForUpdates().catch(() => {});
  setInterval(() => updater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
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
    const map = { ac: acRoot(), docs: docsDir(), cars: path.join(acRoot(), 'content', 'cars'), tracks: path.join(acRoot(), 'content', 'tracks') };
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
    game.launch(acRoot(), docsDir());
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
    game.launch(acRoot(), docsDir());
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

  // Updater
  handle('updater:check', async () => {
    if (!updater) return { state: app.isPackaged ? 'error' : 'dev' };
    await updater.checkForUpdates();
    return { state: 'checking' };
  });
  handle('updater:install', () => updater && updater.quitAndInstall());

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
      manifest: { name: pub.manifest.name, motd: pub.manifest.motd || '', servers: pub.manifest.servers, news: pub.manifest.news, updatedAt: pub.manifest.updatedAt },
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
  protocol.handle('lks-img', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(`${url.hostname}${url.pathname}`);
    const file = acRoot() ? resolveContentFile(acRoot(), rel) : null;
    if (!file || !fs.existsSync(file)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  setupSync();
  setupGame();
  setupIpc();
  createWindow();
  await firstRunDetection();
  send('settings:changed', settings.public());
  refreshManifest({ autoSync: true }).catch(() => {});
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());
