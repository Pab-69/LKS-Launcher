import { api, h, clear, icon, guard, dateFr, toast, seg, field, localImg, modal, confirmBox } from '../ui.js';
import { store } from '../store.js';

let tab = 'photos';
const isAdmin = () => Boolean(store.settings && store.settings.admin && store.settings.admin.hasToken);

/** The group's photos (sent by the members) and the liveries of the group's cars. */
export default function gallery(root) {
  const body = h('div');
  const tabs = h('div.toolbar');
  root.append(
    h('div.view-head',
      h('div', h('h1', 'Galerie'), h('p', 'Les photos du groupe et les livrées des voitures LKS.')),
      h('div.grow'),
      h('div.actions', h('button.btn.btn-primary', { on: { click: addPhoto } }, icon('upload'), 'Ajouter une photo'))),
    tabs,
    body,
  );

  async function render() {
    clear(tabs);
    tabs.append(seg([['photos', 'Photos'], ['liveries', 'Livrées']], tab, (v) => { tab = v; render(); }));
    clear(body);
    const data = await guard(() => api.call('gallery:list'));
    if (!data) return;
    if (tab === 'liveries') return renderLiveries(data.liveries);
    if (!data.configured) {
      body.append(h('div.empty', h('strong', 'Galerie pas encore activée'), 'Les admins doivent configurer le classement partagé (Publication → Classement).'));
      return;
    }
    if (data.error) body.append(h('div.notice', `Galerie indisponible : ${data.error}`));
    if (!data.photos.length) {
      body.append(h('div.empty', h('strong', 'Pas encore de photo'), 'Ajoute ta première : en jeu, F8 prend une capture (dans Documents/Assetto Corsa/screens).'));
      return;
    }
    const grid = h('div.gallery-grid');
    for (const p of data.photos) {
      grid.append(h('figure.gallery-item',
        h('img', { src: p.url, alt: p.caption || 'Photo', loading: 'lazy', on: { click: () => zoom(p.url, p.caption) } }),
        h('figcaption',
          p.caption ? h('div', p.caption) : '',
          h('div.s', [p.author, p.carName, p.trackName, dateFr(p.date)].filter(Boolean).join(' · ')),
          isAdmin() ? h('button.btn.btn-sm.btn-ghost', { title: 'Masquer pour tout le monde', on: { click: async () => { if (await confirmBox('Masquer la photo', 'Elle ne sera plus visible dans la galerie du groupe.', 'Masquer') && (await guard(() => api.call('admin:galleryHide', p.id), 'Photo masquée'))) render(); } } }, icon('trash')) : '')));
    }
    body.append(grid);
  }

  function renderLiveries(list) {
    if (!list.length) {
      body.append(h('div.empty', h('strong', 'Aucune livrée'), 'Installe les voitures du groupe dans Contenu.'));
      return;
    }
    const byCar = new Map();
    for (const l of list) byCar.set(l.carName, [...(byCar.get(l.carName) || []), l]);
    for (const [car, skins] of byCar) {
      body.append(h('h2.section', car), h('div.gallery-grid', skins.map((l) => h('figure.gallery-item',
        h('img', { src: localImg(l.preview), alt: l.name, loading: 'lazy', on: { click: () => zoom(localImg(l.preview), `${car} — ${l.name}`) } }),
        h('figcaption', h('div', l.name))))));
    }
    body.append(h('p.hint', 'Tu as fait une livrée ? Propose-la au groupe dans Contenu → Propositions.'));
  }

  function zoom(src, caption) {
    modal({ title: caption || 'Photo', body: h('img.gallery-zoom', { src, alt: caption || '' }) });
  }

  function addPhoto() {
    const data = { caption: '' };
    const m = modal({
      title: 'Ajouter une photo',
      small: true,
      body: h('div.grid',
        field('Légende', h('input.input', { maxlength: 200, placeholder: 'Calmont au coucher du soleil…', on: { input: (e) => { data.caption = e.target.value; } } })),
        h('p.hint', { style: { margin: 0 } }, 'JPEG, PNG ou WebP, 10 Mo maximum. Visible par tout le groupe.')),
      foot: [
        h('button.btn.btn-ghost', { on: { click: () => m.close() } }, 'Annuler'),
        h('button.btn.btn-primary', { on: { click: async () => {
          const id = await guard(() => api.call('gallery:add', { caption: data.caption.trim() }));
          if (id) {
            m.close();
            toast('Photo ajoutée à la galerie', 'success');
            tab = 'photos';
            render();
          }
        } } }, 'Choisir la photo…'),
      ],
    });
  }

  render();
}
