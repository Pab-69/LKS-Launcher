import { api, h, clear, icon, bytes, guard, dateFr, img, localImg, seg, STATUS_LABEL, confirmBox } from '../ui.js';
import { store, subscribe, loadContent } from '../store.js';

let tab = 'car';
let filter = 'all';
let query = '';

export default function content(root) {
  const grid = h('div.cards');
  const head = h('div');
  const searchInput = h('input.input', { placeholder: 'Rechercher…', value: query, on: { input: (e) => { query = e.target.value; render(); } } });
  let items = [];

  root.append(
    h('div.view-head',
      h('div', h('h1', 'Contenu LKS'), h('p', 'Les voitures et circuits du groupe, installés automatiquement.')),
      h('div.grow'),
      h('div.actions',
        h('button.btn', { on: { click: async () => { await guard(() => api.call('sync:refresh')); await load(); } } }, icon('refresh'), 'Actualiser'),
        h('button.btn', { title: 'Recalcule la version de chaque dossier installé', on: { click: () => guard(() => api.call('sync:verify', true), 'Vérification lancée') } }, icon('shield'), 'Vérifier'),
        h('button.btn.btn-primary', { on: { click: () => guard(() => api.call('sync:start')) } }, icon('download'), 'Tout synchroniser'),
      ),
    ),
    head,
    h('div.toolbar',
      seg([['car', 'Voitures'], ['track', 'Circuits']], tab, (v) => { tab = v; render(); }),
      seg([['all', 'Tout'], ['pending', 'À mettre à jour'], ['ok', 'À jour']], filter, (v) => { filter = v; render(); }),
      h('div.search', icon('search'), searchInput),
      h('button.btn.btn-ghost.btn-sm.right', { on: { click: () => api.call('shell:open', tab === 'car' ? 'cars' : 'tracks') } }, icon('folder'), 'Ouvrir le dossier'),
    ),
    grid,
  );

  async function load() {
    items = (await guard(() => api.call('sync:list'))) || [];
    render();
  }

  function localPreview(item) {
    const c = store.content;
    if (!c || item.status === 'missing') return '';
    if (item.kind === 'car') {
      const car = c.cars.find((x) => x.id === item.id);
      const skin = car && car.skins.find((s) => s.preview);
      return skin ? localImg(skin.preview) : '';
    }
    const t = c.tracks.find((x) => x.id === item.id);
    return t && t.preview ? localImg(t.preview) : '';
  }

  function render() {
    clear(head);
    const s = store.summary;
    if (s && s.manifestError) head.append(h('div.notice', s.manifestError));
    if (s && !store.settings.acRoot) head.append(h('div.notice.bad', "Configurez le dossier d'Assetto Corsa dans les Paramètres pour installer le contenu."));

    clear(grid);
    const q = query.trim().toLowerCase();
    const list = items
      .filter((i) => i.kind === tab)
      .filter((i) => filter === 'all' || (filter === 'ok' ? i.status === 'ok' : i.status !== 'ok'))
      .filter((i) => !q || `${i.name} ${i.id} ${i.brand || ''} ${i.country || ''}`.toLowerCase().includes(q));
    if (!list.length) {
      grid.append(h('div.empty', { style: { gridColumn: '1/-1' } }, h('strong', items.length ? 'Rien ici' : 'Aucun contenu publié'), items.length ? 'Aucun élément ne correspond au filtre.' : 'Dès qu’un admin publie une voiture ou un circuit, il apparaîtra ici.'));
      return;
    }
    for (const item of list) grid.append(card(item));
  }

  function card(item) {
    const [label, cls] = STATUS_LABEL[item.status] || ['?', ''];
    const src = localPreview(item) || item.preview || '';
    const busy = item.queued;
    let action;
    if (item.status === 'ok') {
      action = h('button.btn.btn-ghost.btn-sm', { title: 'Retélécharger', disabled: busy, on: { click: async () => {
        if (await confirmBox('Réinstaller', `Retélécharger « ${item.name} » ? Le dossier actuel sera remplacé.`, 'Réinstaller')) guard(() => api.call('sync:start', [{ kind: item.kind, id: item.id }]));
      } } }, icon('refresh'));
    } else {
      action = h('button.btn.btn-primary.btn-sm', { disabled: busy || item.status === 'noac', on: { click: () => guard(() => api.call('sync:start', [{ kind: item.kind, id: item.id }])) } },
        busy ? 'En file…' : item.status === 'missing' ? 'Installer' : 'Mettre à jour');
    }
    const sub = item.kind === 'car' ? [item.brand, item.carClass].filter(Boolean).join(' · ') : [item.country, item.layouts && item.layouts.length > 1 ? `${item.layouts.length} tracés` : ''].filter(Boolean).join(' · ');
    return h('div.card',
      h('div.card-media', img(src, '', item.kind === 'car' ? 'LKS' : 'TRACK'), h(`span.tag.${cls}`, label)),
      h('div.card-body',
        h('div.card-title', item.name),
        h('div.card-sub', sub || item.id),
        item.notes ? h('div.card-sub', { title: item.notes }, `« ${item.notes} »`) : null,
        h('div.card-foot', h('span.card-sub', `${bytes(item.size)} · ${dateFr(item.publishedAt)}`), action),
      ),
    );
  }

  load();
  if (!store.content) loadContent().then(render).catch(() => {});
  return subscribe((patch) => {
    if ('summary' in patch) load();
    else if ('content' in patch) render();
  });
}
