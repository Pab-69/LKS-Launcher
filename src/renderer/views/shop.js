import { api, h, clear, guard, icon } from '../ui.js';
import { safeUrl } from './donate.js';

const TEASERS = [
  { title: 'Hoodie Syndicate', sub: 'Brodé, logo gothique', img: 'img/cars/bmw-m2.jpg' },
  { title: 'T-shirt Drift Team', sub: 'Noir, impression blanche', img: 'img/cars/silvia-s15.jpg' },
  { title: 'Pack de stickers', sub: 'Pour la vraie voiture aussi', img: 'img/cars/supra-a90.jpg' },
  { title: 'Livrée sur mesure', sub: 'Ta voiture aux couleurs LKS', img: 'img/cars/bmw-m2.jpg' },
];

export default function shop(root) {
  const body = h('div');
  root.append(body);

  async function load() {
    const manifest = (await guard(() => api.call('sync:manifest'))) || {};
    render(manifest.shop || {});
  }

  function render(s) {
    clear(body);
    const url = s.open ? safeUrl(s.url) : null;
    body.append(
      h('section.hero.page-hero.shop-hero',
        h('div.hero-slides', h('img.on', { src: 'img/cars/bmw-m2.jpg', alt: '', style: { objectPosition: 'center 55%' } })),
        h('div.hero-shade'),
        h('div.hero-content',
          h('div.picker-k', 'Boutique officielle'),
          h('h1', 'La Boutique du Syndicate'),
          h('p', s.message || 'Hoodies, t-shirts, stickers et livrées aux couleurs du Lowkey Syndicate.'),
          url
            ? h('div.hero-actions', h('button.btn.btn-primary.btn-lg', { on: { click: () => api.call('shell:open', url) } }, 'Ouvrir la boutique'))
            : h('div.soon-stamp', 'Bientôt disponible'),
        ),
      ),
      h('h2.section', url ? 'À la une' : 'Ce qui arrive'),
    );
    const grid = h('div.shop-grid');
    for (const t of TEASERS) {
      grid.append(
        h('div.shop-item', { class: url ? '' : 'locked' },
          h('div.shop-media', h('img', { src: t.img, alt: '', loading: 'lazy' }), url ? null : h('span.shop-lock', icon('lock'))),
          h('div.card-body', h('div.card-title', t.title), h('div.card-sub', t.sub), h('div.card-foot', h('span.tag.warn', 'Bientôt'))),
        ),
      );
    }
    body.append(grid);
    if (!url) body.append(h('p.hint.mt', { style: { textAlign: 'center' } }, 'L’ouverture sera annoncée dans les actus du launcher.'));
  }

  load();
}
