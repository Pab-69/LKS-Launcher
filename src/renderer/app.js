import { api, h, clear, bytes, toast, lapTime, guard } from './ui.js';
import { store, set, subscribe, loadContent } from './store.js';
import { randomShowcase } from './showcase.js';
import home from './views/home.js';
import content from './views/content.js';
import solo from './views/solo.js';
import servers from './views/servers.js';
import settings from './views/settings.js';
import admin from './views/admin.js';
import graphics from './views/graphics.js';

const routes = { home, content, solo, servers, graphics, settings, admin };
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
    document.getElementById('nav-admin').hidden = !s.admin.hasToken;
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

function renderGameOverlay(info) {
  const el = document.getElementById('game-overlay');
  clear(el);
  const car = randomShowcase();
  el.append(h('img.bg', { src: car.image, alt: '' }));
  if (store.game.running) {
    el.hidden = false;
    el.append(h('div.inner', h('img', { src: 'img/logo.png', alt: '' }), h('h2', 'Assetto Corsa en cours'), h('p.muted', 'Bonne session. Le launcher reprend la main à la fermeture du jeu.')));
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

function renderUpdater() {
  const b = document.getElementById('updater-badge');
  const u = store.updater;
  b.hidden = !u || !['downloading', 'ready'].includes(u.state);
  if (!u) return;
  if (u.state === 'downloading') b.textContent = `Mise à jour du launcher ${u.percent ? `${u.percent.toFixed(0)} %` : '…'}`;
  if (u.state === 'ready') b.textContent = `Redémarrer pour installer v${u.version}`;
  b.onclick = () => u.state === 'ready' && api.call('updater:install');
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
api.on('game:state', (g) => {
  set({ game: g });
  renderGameOverlay(g);
});

// ------------------------------------------------------------ boot
(async () => {
  const [info, s, summary] = await Promise.all([api.call('app:info'), api.call('settings:get'), api.call('sync:summary')]);
  document.getElementById('app-version').textContent = `LKS Launcher v${info.version}`;
  set({ info, settings: s, summary });
  const first = !s.acRoot || !s.driverName;
  go(first ? 'settings' : 'home', first ? { welcome: true } : {});
  refreshGraphicsBadge();
  guard(() => loadContent());
})();
