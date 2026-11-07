import { api, h, clear, bytes, toast, lapTime, guard, modal, icon } from './ui.js';
import { store, set, subscribe, loadContent, saveSettings } from './store.js';
import { randomShowcase, brandUrl, onBrand, initBrand } from './showcase.js';
import home from './views/home.js';
import content from './views/content.js';
import solo from './views/solo.js';
import servers from './views/servers.js';
import settings from './views/settings.js';
import admin from './views/admin.js';
import graphics from './views/graphics.js';
import donate from './views/donate.js';
import shop from './views/shop.js';
import host from './views/host.js';
import telemetry from './views/telemetry.js';
import competition from './views/competition.js';
import gallery from './views/gallery.js';
import { showTour } from './tour.js';

const routes = { home, content, solo, servers, host, telemetry, competition, gallery, graphics, donate, shop, settings, admin };
const viewEl = document.getElementById('view');
let current = null;
let cleanup = null;

export function go(route, params) {
  if (!routes[route]) route = 'home';
  if (cleanup) cleanup();
  cleanup = null;
  current = route;
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  clear(viewEl);
  viewEl.scrollTop = 0;
  const result = routes[route](viewEl, params || {}, { go });
  if (typeof result === 'function') cleanup = result;
  else if (result && typeof result.then === 'function') result.then((fn) => { if (typeof fn === 'function' && current === route) cleanup = fn; });
}
window.lksGo = go;

document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', () => go(a.dataset.route)));
document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => api.call('window:action', b.dataset.win)));

// ------------------------------------------------------------ chrome (sidebar, syncbar, overlay)
function renderChrome() {
  const s = store.settings;
  if (s) {
    document.getElementById('nav-admin').hidden = !s.admin.verified;
    const chip = clear(document.getElementById('driver-chip'));
    chip.append(h('span.flag', s.nationality || '—'), h('span', s.driverName || 'Pilote sans nom'));
  }
  const badge = document.getElementById('badge-content');
  const pending = store.summary ? store.summary.pending : 0;
  badge.hidden = !pending;
  badge.textContent = pending;
  renderSyncbar();
}

async function refreshGraphicsBadge() {
  try {
    const s = await api.call('csp:status');
    document.getElementById('badge-graphics').hidden = Boolean(s.installed && s.preset) || !store.settings || !store.settings.acRoot;
  } catch {
    /* ignore */
  }
}
api.on('csp:changed', refreshGraphicsBadge);
setInterval(refreshGraphicsBadge, 15000);

function renderSyncbar() {
  const bar = document.getElementById('syncbar');
  const p = store.progress;
  const v = store.verify;
  const running = store.summary && store.summary.running;
  const fill = document.getElementById('syncbar-fill');
  const prog = fill.parentElement;
  if (p || running) {
    bar.hidden = false;
    document.getElementById('syncbar-cancel').hidden = false;
    if (!p) {
      document.getElementById('syncbar-title').textContent = 'Préparation…';
      document.getElementById('syncbar-detail').textContent = '';
      prog.classList.add('indeterminate');
      return;
    }
    prog.classList.remove('indeterminate');
    const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
    fill.style.width = `${pct}%`;
    const phase = { download: 'Téléchargement', extract: 'Installation', done: 'Terminé' }[p.phase] || p.phase;
    document.getElementById('syncbar-title').textContent = `${phase} — ${p.name || p.id}`;
    const parts = [`${pct.toFixed(0)} %`];
    if (p.phase === 'download') parts.push(`${bytes(p.done)} / ${bytes(p.total)}`, p.speed ? `${bytes(p.speed)}/s` : '');
    if (p.remaining) parts.push(`${p.remaining} en attente`);
    document.getElementById('syncbar-detail').textContent = parts.filter(Boolean).join(' · ');
  } else if (v) {
    bar.hidden = false;
    document.getElementById('syncbar-cancel').hidden = true;
    prog.classList.remove('indeterminate');
    fill.style.width = `${(v.index / v.count) * 100}%`;
    document.getElementById('syncbar-title').textContent = `Vérification — ${v.name || v.id}`;
    document.getElementById('syncbar-detail').textContent = `${v.index} / ${v.count}`;
  } else {
    bar.hidden = true;
  }
}

document.getElementById('syncbar-cancel').addEventListener('click', () => api.call('sync:cancel'));

// What to show while the game runs ('' = ask, 'telemetry', 'launcher'); per PC.
function duringGame() {
  try {
    return localStorage.getItem('lks.duringGame') || '';
  } catch {
    return '';
  }
}
function setDuringGame(v) {
  try {
    localStorage.setItem('lks.duringGame', v);
  } catch {
    /* ignore */
  }
}

/** Thin strip while the game runs: the launcher stays usable underneath. */
function renderGameStrip() {
  const strip = document.getElementById('game-strip');
  if (!strip) return;
  clear(strip);
  strip.hidden = !(store.game && store.game.running);
  if (strip.hidden) return;
  strip.append(
    h('span.dot'),
    h('span', 'Assetto Corsa en cours'),
    h('a.link', { on: { click: () => go('telemetry', { tab: 'live' }) } }, 'Télémétrie en direct'),
  );
}

function renderGameOverlay(info) {
  const el = document.getElementById('game-overlay');
  clear(el);
  const car = randomShowcase();
  if (car) el.append(h('img.bg', { src: car.image, alt: '' }));
  renderGameStrip();
  if (store.game.running) {
    // while playing: live telemetry or the launcher, as chosen last time
    const choice = duringGame();
    if (choice === 'telemetry') {
      el.hidden = true;
      if (current !== 'telemetry') go('telemetry', { tab: 'live' });
      return;
    }
    if (choice === 'launcher') {
      el.hidden = true;
      return;
    }
    const pick = (v) => {
      setDuringGame(v);
      el.hidden = true;
      if (v === 'telemetry') go('telemetry', { tab: 'live' });
    };
    el.hidden = false;
    el.append(h('div.inner',
      brandUrl('logo.png') ? h('img', { src: brandUrl('logo.png'), alt: '' }) : h('div.brand-text', 'Lowkey Syndicate'),
      h('h2', 'Assetto Corsa en cours'),
      h('p.muted', 'Bonne session. Tu peux suivre ta télémétrie en direct pendant que tu roules.'),
      h('div.row', { style: { justifyContent: 'center' } },
        h('button.btn.btn-primary', { on: { click: () => pick('telemetry') } }, 'Télémétrie en direct'),
        h('button.btn', { on: { click: () => pick('launcher') } }, 'Utiliser le launcher')),
      h('p.hint', 'Le launcher retient ton choix pour les prochaines sessions.')));
    return;
  }
  if (info && (info.results || info.error)) {
    el.hidden = false;
    const inner = h('div.inner');
    if (info.error) inner.append(h('h2', 'Lancement impossible'), h('p', info.error));
    else {
      inner.append(h('h2', 'Résultats de la session'));
      for (const s of info.results || []) {
        const rows = [];
        if (s.raceResult && s.raceResult.length && s.type === 3) s.raceResult.forEach((name, i) => rows.push(h('tr', h('td', `P${i + 1}`), h('td', name))));
        inner.append(
          h('div.results.panel',
            h('h3', s.name || 'Session'),
            h('div.row', h('span.muted', 'Meilleur tour :'), h('strong', lapTime(s.bestLapPlayer)), h('span.muted.right', `${(s.playerLaps || []).length} tour(s)`)),
            rows.length ? h('table.mt', h('tr', h('th', 'Pos.'), h('th', 'Pilote')), rows) : null,
          ),
        );
      }
    }
    inner.append(h('button.btn.btn-primary', { on: { click: () => { el.hidden = true; } } }, 'Fermer'));
    el.append(inner);
    return;
  }
  el.hidden = true;
}

let bannerDismissedFor = null;

export function installUpdate() {
  return guard(() => api.call('updater:install'));
}

export function showNotes(title, notes) {
  modal({
    title,
    small: true,
    body: h('div.notes', notes || 'Améliorations et corrections.'),
    foot: [h('button.btn.btn-primary', { on: { click: () => document.getElementById('modal-root').click() } }, 'Super')],
  });
}

function renderUpdater() {
  const b = document.getElementById('updater-badge');
  const banner = document.getElementById('update-banner');
  const u = store.updater;
  b.hidden = !u || !['downloading', 'ready'].includes(u.state);
  banner.hidden = !u || u.state !== 'ready' || bannerDismissedFor === u.version;
  if (!u) return;
  if (u.state === 'downloading') b.textContent = `Mise à jour v${u.version || ''} : ${u.percent ? `${u.percent.toFixed(0)} %` : '…'}`;
  if (u.state === 'ready') b.textContent = `Mettre à jour vers v${u.version}`;
  b.onclick = () => (u.state === 'ready' ? installUpdate() : window.lksGo('settings'));
  if (u.state === 'ready' && !banner.hidden) {
    clear(banner);
    banner.append(
      h('span.update-cross'),
      h('div.update-text', h('strong', `La version ${u.version} du launcher est prête`), h('span', 'Elle s’installe en quelques secondes, sans repasser par l’installeur. Sinon, elle s’installera toute seule à la fermeture.')),
      u.notes ? h('button.btn.btn-ghost.btn-sm', { on: { click: () => showNotes(`Nouveautés de la v${u.version}`, u.notes) } }, 'Nouveautés') : null,
      h('button.btn.btn-primary.btn-sm', { on: { click: installUpdate } }, icon('refresh'), 'Redémarrer et mettre à jour'),
      h('button.btn.btn-ghost.btn-sm', { title: 'Plus tard', on: { click: () => { bannerDismissedFor = u.version; renderUpdater(); } } }, icon('x')),
    );
  }
}

subscribe((patch) => {
  if ('settings' in patch || 'summary' in patch || 'progress' in patch || 'verify' in patch) renderChrome();
  if ('updater' in patch) renderUpdater();
});

// ------------------------------------------------------------ events from main
api.on('sync:changed', (summary) => set({ summary }));
api.on('sync:progress', (progress) => set({ progress }));
api.on('sync:verify', (verify) => set({ verify }));
api.on('toast', (t) => toast(t.text, t.kind));
api.on('settings:changed', (s) => set({ settings: s }));
api.on('content:changed', () => loadContent(true).catch(() => {}));
api.on('updater:status', (u) => set({ updater: u }));
api.on('navigate', (n) => go(n.route, n.params || {}));
api.on('game:state', (g) => {
  set({ game: g });
  renderGameOverlay(g);
});

// ------------------------------------------------------------ game closed right away: say why
function showCrash(c) {
  if (!c) return;
  let ref = null;
  const actions = [];
  const ids = new Set(c.hints.map((x) => x.id.split('-')[0]));
  if (ids.has('display') && c.canRestore) {
    actions.push(h('button.btn.btn-primary', { on: { click: async () => { if (await guard(() => api.call('graphics:restore'), 'Réglages graphiques d’origine remis')) ref.close(); } } }, 'Revenir aux réglages graphiques d’origine'));
  }
  if (ids.has('app')) actions.push(h('button.btn', { on: { click: async () => { if (await guard(() => api.call('ingame:remove'), 'Appli en jeu retirée')) ref.close(); } } }, 'Retirer l’appli en jeu'));
  if (c.hints.some((x) => x.id === 'track-missing-csp')) actions.push(h('button.btn.btn-primary', { on: { click: async () => { if (await guard(() => api.call('csp:setEnabled', true), 'Custom Shaders Patch réactivé')) ref.close(); } } }, 'Réactiver le CSP'));
  else if (ids.has('track') && c.launch && c.launch.kind === 'solo') actions.push(h('button.btn.btn-primary', { on: { click: () => { ref.close(); go('solo'); } } }, 'Choisir un autre tracé'));
  if (ids.has('car') || ids.has('track') || ids.has('skin')) actions.push(h('button.btn', { on: { click: () => { ref.close(); go('content'); api.call('sync:verify', true); } } }, 'Vérifier le contenu'));
  ref = modal({
    title: 'Le jeu s’est fermé',
    body: [
      h('p', { style: { marginTop: 0 } }, c.launch ? 'Assetto Corsa s’est arrêté juste après le lancement.' : 'Assetto Corsa s’est arrêté.'),
      h('ul.crash-hints', ...c.hints.map((x) => h('li', x.text))),
      c.errors.length ? h('details.crash-details', h('summary', 'Ce que dit le jeu'), h('pre.log', c.errors.join('\n'))) : null,
    ],
    foot: [
      ...actions,
      c.canSend ? h('button.btn', { on: { click: async (e) => { e.target.disabled = true; if (!(await guard(() => api.call('game:sendReport'), 'Rapport envoyé aux admins sur Discord'))) e.target.disabled = false; } } }, 'Envoyer aux admins') : null,
      h('button.btn', { on: { click: async () => { await api.call('clipboard:write', c.report); toast('Rapport copié : colle-le sur le Discord', 'success'); } } }, 'Copier le rapport'),
      h('button.btn.btn-ghost', { on: { click: () => api.call('shell:open', 'logs') } }, 'Ouvrir les journaux'),
    ],
  });
}
api.on('game:crash', showCrash);

// ------------------------------------------------------------ brand (downloaded, not bundled)
function renderBrand() {
  const wide = brandUrl('logo-wide.png');
  const titleImg = document.getElementById('brand-titlebar');
  titleImg.hidden = !wide;
  if (wide) titleImg.src = wide;
  document.getElementById('brand-name').hidden = Boolean(wide);
  const sigil = document.getElementById('brand-sigil');
  const logo = brandUrl('logo.png');
  sigil.hidden = !logo;
  if (logo) sigil.src = logo;
}
onBrand(renderBrand);

// ------------------------------------------------------------ boot
(async () => {
  const [info, s, summary] = await Promise.all([api.call('app:info'), api.call('settings:get'), api.call('sync:summary'), initBrand()]);
  document.getElementById('app-version').textContent = `LKS Launcher v${info.version}`;
  set({ info, settings: s, summary });
  api.call('updater:state').then((updater) => set({ updater })).catch(() => {});
  // first start (or first time with this version of the launcher): a short presentation, then what's new
  const whatsNew = () => api.call('app:whatsNew').then((w) => { if (w) showNotes(`Bienvenue dans la v${w.version}`, w.notes); }).catch(() => {});
  if (!s.tourSeen) showTour(() => { saveSettings({ tourSeen: true }).catch(() => {}); whatsNew(); });
  else whatsNew();
  const first = !s.acRoot || !s.driverName;
  go(first ? 'settings' : 'home', first ? { welcome: true } : {});
  refreshGraphicsBadge();
  guard(() => loadContent());
})();
