import { api, h, clear, guard, icon } from '../ui.js';
import { safeUrl, heroImage } from './donate.js';
import { brandShowcase } from '../showcase.js';

const TEASERS = [
  { title: 'Hoodie Syndicate', sub: 'Brodé, logo gothique' },
  { title: 'T-shirt Drift Team', sub: 'Noir, impression blanche' },
  { title: 'Pack de stickers', sub: 'Pour la vraie voiture aussi' },
  { title: 'Livrée sur mesure', sub: 'Ta voiture aux couleurs LKS' },
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
        heroImage(brandShowcase(), 0),
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
    const photos = brandShowcase();
    for (const [n, t] of TEASERS.entries()) {
      const photo = photos.length ? photos[n % photos.length].image : '';
      grid.append(
        h('div.shop-item', { class: url ? '' : 'locked' },
          h('div.shop-media', photo ? h('img', { src: photo, alt: '', loading: 'lazy' }) : null, url ? null : h('span.shop-lock', icon('lock'))),
          h('div.card-body', h('div.card-title', t.title), h('div.card-sub', t.sub), h('div.card-foot', h('span.tag.warn', 'Bientôt'))),
        ),
      );
    }
    body.append(grid);
    if (!url) body.append(h('p.hint.mt', { style: { textAlign: 'center' } }, 'L’ouverture sera annoncée dans les actus du launcher.'));
  }

  load();
}
