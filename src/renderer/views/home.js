import { api, h, clear, icon, bytes, guard, dateFr } from '../ui.js';
import { store, subscribe } from '../store.js';

export default function home(root, _params, { go }) {
  const statusBox = h('div');
  const serversBox = h('div');
  const newsBox = h('div.panel');

  root.append(
    h('section.hero',
      h('img.hero-logo', { src: 'img/logo.png', alt: 'Lowkey Syndicate' }),
      h('div.hero-body',
        h('h1', 'Bienvenue au garage'),
        h('p', 'Le contenu du Syndicate se met à jour tout seul. Prends ta caisse, choisis ta piste, et roule.'),
        h('div.hero-actions',
          h('button.btn.btn-primary.btn-lg', { on: { click: () => go('servers') } }, icon('play'), 'Rejoindre'),
          h('button.btn.btn-lg', { on: { click: () => go('solo') } }, 'Solo'),
        ),
      ),
    ),
    statusBox,
    h('div.grid.grid-2.mt',
      h('div', h('h2.section', 'Serveurs LKS'), serversBox),
      h('div', h('h2.section', 'Actus du Syndicate'), newsBox),
    ),
  );

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

  async function renderNews() {
    const manifest = await guard(() => api.call('sync:manifest'));
    clear(newsBox);
    const news = (manifest && manifest.news) || [];
    if (manifest && manifest.motd) newsBox.append(h('div.notice.info', manifest.motd));
    if (!news.length) {
      newsBox.append(h('p.muted', { style: { margin: 0 } }, 'Pas encore de news. Les admins peuvent en publier depuis l’onglet Publication.'));
      return;
    }
    for (const n of news.slice(0, 6)) newsBox.append(h('div.news-item', h('div.date', dateFr(n.date)), h('h4', n.title), h('p', n.body)));
  }

  renderStatus();
  renderServers();
  renderNews();
  return subscribe((patch) => {
    if ('summary' in patch || 'content' in patch || 'settings' in patch) renderStatus();
    if ('summary' in patch && patch.summary && !patch.summary.running) {
      /* manifest may have changed */
    }
  });
}
