import { api, h, clear, guard, icon } from '../ui.js';
import { brandShowcase } from '../showcase.js';

const KINDS = {
  paypal: 'PayPal',
  kofi: 'Ko-fi',
  tipeee: 'Tipeee',
  twitch: 'Twitch',
  patreon: 'Patreon',
  other: 'Lien',
};

/** Only https links are ever opened (in the system browser). */
export function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function heroImage(list, preferred) {
  const pick = list[preferred] || list[0];
  return h('div.hero-slides', pick ? h('img.on', { src: pick.image, alt: '', style: { objectPosition: pick.position || 'center' } }) : null);
}

export default function donate(root) {
  const body = h('div');
  root.append(body);

  async function load() {
    const manifest = (await guard(() => api.call('sync:manifest'))) || {};
    render(manifest.donate || {});
  }

  function render(d) {
    clear(body);
    const links = (Array.isArray(d.links) ? d.links : []).map((l) => ({ ...l, url: safeUrl(l.url) })).filter((l) => l.url);
    const goal = d.goal && Number(d.goal.target) > 0 ? d.goal : null;

    body.append(
      h('section.hero.page-hero.donate-hero',
        heroImage(brandShowcase(), 2),
        h('div.hero-shade'),
        h('div.hero-content',
          h('div.picker-k', 'Soutenir'),
          h('h1', 'Faire un don'),
          h('p', d.message || 'Le launcher et les serveurs sont gratuits. Les dons aident à les payer.'),
        ),
      ),
    );

    if (goal) {
      const current = Math.max(0, Number(goal.current) || 0);
      const target = Number(goal.target);
      const pct = Math.min(100, (current / target) * 100);
      const cur = goal.currency || '€';
      body.append(
        h('div.panel.mt',
          h('h3', goal.label || 'Objectif du mois'),
          h('div.goal-row', h('span.goal-v', `${current} ${cur}`), h('span.muted', `sur ${target} ${cur}`), h('span.goal-pct.right', `${pct.toFixed(0)} %`)),
          h('div.progress.goal-bar', h('div.progress-fill', { style: { width: `${pct}%` } })),
        ),
      );
    }

    body.append(h('h2.section', 'Liens'));
    if (!links.length) {
      body.append(h('div.empty', h('strong', 'Bientôt'), 'Les liens pour faire un don arrivent très vite.'));
    } else {
      const grid = h('div.donate-grid');
      for (const l of links) {
        const host = new URL(l.url).hostname.replace(/^www\./, '');
        grid.append(
          h('button.donate-link', { on: { click: () => api.call('shell:open', l.url) } },
            h('span.donate-kind', KINDS[l.kind] || KINDS.other),
            h('span.donate-label', l.label || KINDS[l.kind] || host),
            h('span.donate-host', host, ' ↗'),
          ),
        );
      }
      body.append(grid, h('p.hint.mt', 'Le paiement se fait dans ton navigateur, sur le site du service choisi. Le launcher ne voit jamais tes informations bancaires.'));
    }

    body.append(
      h('h2.section', 'Où va l’argent'),
      h('div.grid.grid-3',
        h('div.panel', h('h3', 'Serveurs'), h('p.muted', { style: { margin: 0 } }, 'Serveurs en ligne 24h/24.')),
        h('div.panel', h('h3', 'Voitures & livrées'), h('p.muted', { style: { margin: 0 } }, 'Mods, livrées et circuits créés ou achetés pour le groupe.')),
        h('div.panel', h('h3', 'Events'), h('p.muted', { style: { margin: 0 } }, 'Lots et organisation des soirées et des compétitions.')),
      ),
      h('p.hint.mt', { style: { textAlign: 'center' } }, icon('check'), ' Les dons sont facultatifs.'),
    );
  }

  load();
}
