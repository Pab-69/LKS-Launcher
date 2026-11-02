import { api, h, clear, icon, bytes, guard, dateFr } from '../ui.js';
import { store, subscribe } from '../store.js';
import { brandShowcase, brandUrl, onBrand } from '../showcase.js';
import { localImg } from '../ui.js';

export default function home(root, _params, { go }) {
  const statusBox = h('div');
  const eventBox = h('div');
  const presetsBox = h('div');
  let countdownTimer = null;
  let cspState = null;
  api.call('csp:status').then((s) => { cspState = s; renderStatus(); }).catch(() => {});
  const serversBox = h('div');
  const newsBox = h('div.panel');

  const slidesEl = h('div.hero-slides');
  const captionEl = h('div.hero-caption');
  const garageEl = h('div.garage');
  let slides = brandShowcase();
  const logoBox = h('div.hero-logo-box');
  let index = 0;
  let timer = null;

  root.append(
    h('section.hero',
      slidesEl,
      h('div.hero-shade'),
      h('div.hero-content',
        logoBox,
        h('h1', 'Bienvenue au garage'),
        h('p', 'Le contenu du Syndicate se met à jour tout seul. Prends ta caisse, choisis ta piste, et roule.'),
        h('div.hero-actions',
          h('button.btn.btn-primary.btn-lg', { on: { click: () => go('servers') } }, icon('play'), 'Rejoindre'),
          h('button.btn.btn-lg', { on: { click: () => go('solo') } }, 'Solo'),
        ),
      ),
      captionEl,
    ),
    statusBox,
    eventBox,
    presetsBox,
    h('h2.section.garage-title', 'Le Garage'),
    garageEl,
    h('div.grid.grid-2',
      h('div', h('h2.section', 'Serveurs LKS'), serversBox),
      h('div', h('h2.section', 'Actus du Syndicate'), newsBox),
    ),
  );

  function renderShowcase() {
    clear(slidesEl);
    clear(garageEl);
    clear(captionEl);
    clear(logoBox);
    const logo = brandUrl('logo.png');
    logoBox.append(logo ? h('img.hero-logo', { src: logo, alt: 'Lowkey Syndicate' }) : h('div.brand-text.hero-brand', 'Lowkey Syndicate'));
    const garageTitle = root.querySelector('.garage-title');
    if (garageTitle) garageTitle.hidden = !slides.length;
    garageEl.hidden = !slides.length;
    if (!slides.length) return;
    slides.forEach((car, i) => {
      slidesEl.append(h('img', { src: car.image, alt: '', class: i === index ? 'on' : '', style: { objectPosition: car.position || 'center' } }));
      garageEl.append(h('button.garage-car', { on: { click: () => show(i, true) } },
        h('img', { src: car.image, alt: car.title, loading: 'lazy', style: { objectPosition: car.position || 'center' } }),
        h('div.cap', h('div.v', car.title), h('div.s', car.subtitle || ''))));
    });
    show(index);
  }

  function show(i, user) {
    if (!slides.length) return;
    index = (i + slides.length) % slides.length;
    [...slidesEl.children].forEach((img, n) => {
      if (n === index) {
        img.classList.remove('on');
        void img.offsetWidth; // restart the slow zoom
        img.classList.add('on');
      } else img.classList.remove('on');
    });
    const car = slides[index];
    clear(captionEl);
    captionEl.append(
      h('div.k', 'Garage LKS'),
      h('div.v', car.title),
      h('div.s', car.subtitle || ''),
      h('div.hero-dots', slides.map((_, n) => h('button', { class: n === index ? 'on' : '', 'aria-label': `Voiture ${n + 1}`, on: { click: () => show(n, true) } }))),
    );
    if (user) {
      root.querySelector('.hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
      restart();
    }
  }

  function restart() {
    clearInterval(timer);
    timer = setInterval(() => show(index + 1), 7000);
  }

  function renderStatus() {
    clear(statusBox);
    const s = store.summary;
    const settings = store.settings;
    if (!s || !settings) return;
    if (!settings.acRoot) {
      statusBox.append(h('div.notice.bad.mt', h('span.grow', "Dossier d'Assetto Corsa introuvable."), h('button.btn.btn-sm', { on: { click: () => go('settings') } }, 'Configurer')));
    } else if (s.manifestError) {
      statusBox.append(h('div.notice.mt', h('span.grow', s.manifestError)));
    }
    if (s.pending > 0 && !s.running && settings.acRoot) {
      statusBox.append(
        h('div.notice.info.mt',
          h('span.grow', `${s.pending} élément(s) à installer ou mettre à jour${s.downloadSize ? ` (${bytes(s.downloadSize)})` : ''}.`),
          h('button.btn.btn-primary.btn-sm', { on: { click: () => guard(() => api.call('sync:start')) } }, icon('download'), 'Synchroniser'),
        ),
      );
    }
    if (cspState && settings.acRoot && (!cspState.installed || !cspState.preset)) {
      statusBox.append(
        h('div.notice.info.mt',
          h('span.grow', !cspState.installed ? 'Le Custom Shaders Patch n’est pas installé : ton jeu peut être bien plus beau.' : 'Applique un préréglage graphique LKS pour profiter pleinement du CSP.'),
          h('button.btn.btn-primary.btn-sm', { on: { click: () => go('graphics') } }, 'Rendre mon jeu magnifique'),
        ),
      );
    }
    const content = store.content || { cars: [], tracks: [] };
    statusBox.append(
      h('div.stat-row',
        stat('Contenu LKS', `${s.ok}`, `/ ${s.total} à jour`),
        stat('À mettre à jour', `${s.pending}`, s.pending ? bytes(s.downloadSize) : 'rien à faire'),
        stat('Voitures installées', `${content.cars.length}`, ''),
        stat('Circuits installés', `${content.tracks.length}`, ''),
      ),
    );
  }

  function stat(k, v, small) {
    return h('div.stat', h('div.k', k), h('div.v', v, ' ', h('small', small)));
  }

  async function renderServers() {
    const list = (await guard(() => api.call('servers:list'))) || [];
    clear(serversBox);
    const lks = list.filter((x) => x.source === 'lks');
    if (!lks.length) {
      serversBox.append(h('div.empty', h('strong', 'Aucun serveur'), 'Les serveurs du Syndicate apparaîtront ici.'));
      return;
    }
    for (const server of lks) {
      const row = h('div.server-row', { style: { gridTemplateColumns: '10px minmax(0,1fr) 80px' }, on: { click: () => go('servers', { select: server.key }) } },
        h('span.dot'), h('div', h('div.server-name', server.name), h('div.server-sub', server.description || `${server.ip}`)), h('div.players', '…'));
      serversBox.append(row);
      api.call('servers:info', server).then((info) => {
        row.querySelector('.dot').className = `dot ${info.online ? 'on' : 'off'}`;
        row.querySelector('.players').innerHTML = '';
        row.querySelector('.players').append(info.online ? h('span', `${info.clients}`, h('small', `/${info.maxClients}`)) : h('small', 'hors ligne'));
        if (info.online) {
          const id = String(info.track || '').split('/').pop();
          const t = store.content && store.content.tracks.find((x) => id === x.id || id.startsWith(`${x.id}-`));
          row.querySelector('.server-sub').textContent = t ? t.name : id;
        }
      });
    }
  }

  // ---------- next event (from the group's calendar)
  function renderEvent(manifest) {
    clear(eventBox);
    clearInterval(countdownTimer);
    const now = Date.now();
    const next = (manifest.events || [])
      .filter((e) => Date.parse(e.date) + (Number(e.durationMinutes) || 120) * 60000 > now)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
    if (!next) return;
    const start = Date.parse(next.date);
    const timer = h('div.event-countdown');
    const join = h('button.btn.btn-primary', { on: { click: () => go('servers', next.server ? { select: next.server } : {}) } }, icon('play'), 'Rejoindre');
    const tick = () => {
      const diff = start - Date.now();
      if (diff <= 0) {
        timer.textContent = 'En cours';
        join.disabled = false;
        return;
      }
      const d = Math.floor(diff / 86400000);
      const hh = Math.floor((diff % 86400000) / 3600000);
      const mm = Math.floor((diff % 3600000) / 60000);
      const ss = Math.floor((diff % 60000) / 1000);
      timer.textContent = d > 0 ? `${d} j ${hh} h ${String(mm).padStart(2, '0')}` : `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      join.disabled = diff > 15 * 60000; // the server opens 15 min before
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
    eventBox.append(
      h('h2.section', 'Prochain event'),
      h('div.panel.event-card',
        h('div.event-main',
          h('div.picker-k', new Date(start).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })),
          h('div.event-title', next.title || 'Event LKS'),
          next.description ? h('p.muted', { style: { margin: '4px 0 0', whiteSpace: 'pre-line' } }, next.description) : null,
        ),
        h('div.event-side', timer, join, h('div.hint', 'Rappel 15 min avant')),
      ),
    );
  }

  // ---------- quick solo sessions published by the group
  function renderPresets(manifest) {
    clear(presetsBox);
    const presets = manifest.soloPresets || [];
    if (!presets.length) return;
    const content = store.content || { cars: [], tracks: [] };
    const grid = h('div.cards');
    for (const p of presets) {
      const s = p.settings || {};
      const car = content.cars.find((c) => c.id === s.car);
      const track = content.tracks.find((t) => t.id === s.track);
      const layout = track && (track.layouts.find((l) => l.id === (s.layout || '')) || track.layouts[0]);
      const skin = car && (car.skins.find((k) => k.id === s.skin) || car.skins[0]);
      const ready = Boolean(car && track);
      const img = layout && layout.preview ? localImg(layout.preview) : skin && skin.preview ? localImg(skin.preview) : '';
      const mode = { practice: 'Entraînement', race: 'Course', hotlap: 'Hotlap' }[s.mode] || 'Solo';
      grid.append(
        h('div.card',
          h('div.card-media', img ? h('img', { src: img, alt: '' }) : h('div.placeholder'), h('span.tag.lks', 'LKS')),
          h('div.card-body',
            h('div.card-title', p.name),
            h('div.card-sub', [mode, car ? car.name : s.car, layout ? layout.name : s.track].filter(Boolean).join(' · ')),
            p.description ? h('div.card-sub', { title: p.description }, p.description) : null,
            h('div.card-foot',
              ready ? h('span.card-sub', 'Prêt') : h('span.card-sub', 'Contenu manquant'),
              h('button.btn.btn-primary.btn-sm', { disabled: !ready, on: { click: () => guard(() => api.call('game:launchSolo', { ...store.settings.solo, ...s, assists: store.settings.assists })) } }, icon('play'), 'Lancer'),
            ),
          ),
        ),
      );
    }
    presetsBox.append(h('h2.section', 'Sessions du Syndicate'), grid);
  }

  async function renderNews() {
    const manifest = await guard(() => api.call('sync:manifest'));
    if (manifest) {
      renderEvent(manifest);
      renderPresets(manifest);
    }
    clear(newsBox);
    const news = (manifest && manifest.news) || [];
    if (manifest && manifest.motd) newsBox.append(h('div.notice.info', manifest.motd));
    if (!news.length) {
      newsBox.append(h('p.muted', { style: { margin: 0 } }, 'Pas encore de news. Les admins peuvent en publier depuis l’onglet Publication.'));
      return;
    }
    for (const n of news.slice(0, 6)) newsBox.append(h('div.news-item', h('div.date', dateFr(n.date)), h('h4', n.title), h('p', n.body)));
  }

  renderShowcase();
  restart();
  const offBrand = onBrand(() => {
    slides = brandShowcase();
    index = 0;
    renderShowcase();
  });
  renderStatus();
  renderServers();
  renderNews();
  let lastManifest = store.summary && store.summary.manifestUpdatedAt;
  const unsub = subscribe((patch) => {
    if ('summary' in patch || 'content' in patch || 'settings' in patch) renderStatus();
    if ('content' in patch) renderServers();
    if ('content' in patch || ('summary' in patch && patch.summary && patch.summary.manifestUpdatedAt !== lastManifest)) {
      lastManifest = patch.summary ? patch.summary.manifestUpdatedAt : lastManifest;
      renderNews();
    }
  });
  return () => {
    clearInterval(timer);
    clearInterval(countdownTimer);
    unsub();
    offBrand();
  };
}
