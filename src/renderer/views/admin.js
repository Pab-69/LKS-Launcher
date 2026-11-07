import { api, h, clear, icon, guard, field, seg, toggle, bytes, dateFr, toast, confirmBox, modal } from '../ui.js';
import { store } from '../store.js';

let tab = 'car';
let filter = 'published';

export default function admin(root) {
  let data = null;
  const versions = {};
  const selection = new Set();
  let query = '';
  let busy = false;

  const head = h('div');
  const listBox = h('div.list');
  const toolbar = h('div.toolbar');
  const metaBox = h('div.grid.grid-2.mt');
  const logEl = h('div.log', 'Prêt.');
  const progFill = h('div.progress-fill');
  const progLabel = h('span.hint');
  const actions = h('div.row');

  root.append(
    h('div.view-head',
      h('div', h('h1', 'Publication'), h('p', 'Publiez vos voitures et circuits : tous les membres les reçoivent automatiquement à jour.')),
      h('div.grow'),
      h('button.btn', { on: { click: load } }, icon('refresh'), 'Recharger'),
    ),
    head,
    toolbar,
    listBox,
    h('div.panel.mt',
      h('div.row', h('h3', { style: { margin: 0 } }, 'Journal'), h('div.progress', { style: { maxWidth: '320px', marginLeft: 'auto' } }, progFill), progLabel),
      h('div.mt', logEl),
    ),
    h('h2.section', 'Serveurs & actus'),
    metaBox,
  );

  const offs = [
    window.lks.on('admin:log', (line) => {
      if (logEl.textContent === 'Prêt.') logEl.textContent = '';
      logEl.textContent += `${line}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    }),
    window.lks.on('admin:progress', (p) => {
      if (!p) {
        progFill.style.width = '0';
        progLabel.textContent = '';
        return;
      }
      const pct = p.total ? (p.done / p.total) * 100 : 0;
      progFill.style.width = `${Math.min(100, pct)}%`;
      const step = { hash: 'Analyse', zip: 'Compression', upload: 'Envoi' }[p.step] || p.step;
      progLabel.textContent = `${step} ${pct.toFixed(0)} %`;
    }),
    window.lks.on('admin:busy', (b) => {
      busy = b;
      renderToolbar();
    }),
    window.lks.on('admin:hashed', ({ key, hash }) => {
      versions[key] = hash;
      renderList();
    }),
  ];

  async function load() {
    clear(head);
    head.append(h('div.notice.info', h('span.spinner'), h('span.grow', 'Connexion au dépôt de contenu…')));
    data = await guard(() => api.call('admin:overview'));
    clear(head);
    if (!data) {
      head.append(h('div.notice.bad', h('span.grow', 'Impossible de charger le dépôt de contenu. Vérifiez le token et le dépôt dans les Paramètres.'), h('button.btn.btn-sm', { on: { click: () => window.lksGo('settings') } }, 'Paramètres')));
      return;
    }
    head.append(h('div.notice.info', h('span.grow', 'Manifeste : ', h('span.mono', data.manifestUrl), ` — mis à jour ${dateFr(data.manifest.updatedAt)}`)));
    if (store.settings.manifestUrl !== data.manifestUrl) {
      head.append(h('div.notice', h('span.grow', "L'URL de manifeste de ce launcher ne pointe pas vers ce dépôt. Les membres doivent avoir la même URL (à mettre dans lks.config.json avant de compiler le launcher)."),
        h('button.btn.btn-sm', { on: { click: async () => { await api.call('settings:update', { manifestUrl: data.manifestUrl }); toast('URL mise à jour', 'success'); load(); } } }, 'Utiliser cette URL')));
    }
    renderToolbar();
    renderList();
    renderMeta();
  }

  function items() {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return (tab === 'car' ? data.cars : data.tracks)
      .filter((i) => (filter === 'all' ? true : filter === 'published' ? i.published : !i.published && !i.official))
      .filter((i) => !q || `${i.name} ${i.id} ${i.brand}`.toLowerCase().includes(q));
  }

  function statusOf(i) {
    if (i.remoteOnly) return ['En ligne seulement', 'info'];
    if (i.official) return ['Officiel Kunos', 'plain'];
    if (!i.published) return ['Non publié', ''];
    const local = versions[`${i.kind}/${i.id}`];
    if (local === undefined) return ['Publié', 'ok'];
    if (local === null) return ['Erreur lecture', 'bad'];
    return local === i.remoteVersion ? ['Publié · identique', 'ok'] : ['Modifié localement', 'warn'];
  }

  function renderToolbar() {
    clear(toolbar);
    const sel = [...selection].map((k) => {
      const [kind, ...rest] = k.split('/');
      return { kind, id: rest.join('/') };
    });
    toolbar.append(
      seg([['car', 'Voitures'], ['track', 'Circuits']], tab, (v) => { tab = v; renderList(); }),
      seg([['published', 'Publiés'], ['unpublished', 'Non publiés'], ['all', 'Tout']], filter, (v) => { filter = v; renderList(); }),
      h('div.search', icon('search'), h('input.input', { placeholder: 'Rechercher…', value: query, on: { input: (e) => { query = e.target.value; renderList(); } } })),
      h('button.btn.btn-sm', { disabled: busy, title: 'Compare vos dossiers locaux à la version publiée', on: { click: detectChanges } }, icon('shield'), 'Détecter les modifs'),
      h('div.right.row',
        h('span.hint', `${sel.length} sélectionné(s)`),
        h('button.btn.btn-sm.btn-danger', { disabled: busy || !sel.length, on: { click: () => removeSel(sel) } }, icon('trash'), 'Retirer'),
        h('button.btn.btn-primary', { disabled: busy || !sel.length, on: { click: () => publishSel(sel) } }, busy ? h('span.spinner') : icon('upload'), busy ? 'Publication…' : 'Publier'),
      ),
    );
  }

  function renderList() {
    clear(listBox);
    const list = items();
    if (!data) return;
    if (!list.length) {
      listBox.append(h('div.empty', h('strong', 'Rien ici'), filter === 'published' ? 'Aucun élément publié dans cette catégorie. Passez sur « Non publiés » pour en ajouter.' : 'Aucun élément.'));
      return;
    }
    const allKeys = list.filter((i) => !i.remoteOnly || true).map((i) => `${i.kind}/${i.id}`);
    listBox.append(h('div.list-row', { style: { background: 'transparent', border: 0, padding: '0 14px' } },
      h('input', { type: 'checkbox', checked: allKeys.every((k) => selection.has(k)), on: { change: (e) => { allKeys.forEach((k) => (e.target.checked ? selection.add(k) : selection.delete(k))); renderList(); renderToolbar(); } } }),
      h('span.label', 'Nom'), h('span.label', 'État'), h('span.label', 'Publié le'), h('span.label', 'Taille')));
    for (const i of list.slice(0, 400)) {
      const key = `${i.kind}/${i.id}`;
      const [label, cls] = statusOf(i);
      listBox.append(h('div.list-row',
        h('input', { type: 'checkbox', checked: selection.has(key), on: { change: (e) => { e.target.checked ? selection.add(key) : selection.delete(key); renderToolbar(); } } }),
        h('div', h('div.t', i.name), h('div.s', [i.id, i.brand].filter(Boolean).join(' · '))),
        h('div', h(`span.tag.${cls || 'plain'}`, label)),
        h('div.s', i.publishedAt ? dateFr(i.publishedAt) : '—'),
        h('div.s', i.size ? bytes(i.size) : '—'),
      ));
    }
  }

  async function detectChanges() {
    const targets = (tab === 'car' ? data.cars : data.tracks).filter((i) => i.published && !i.remoteOnly).map((i) => ({ kind: i.kind, id: i.id }));
    if (!targets.length) return toast('Rien de publié à comparer', 'info');
    toast(`Analyse de ${targets.length} dossier(s)…`, 'info');
    await guard(() => api.call('admin:localVersions', targets));
    renderList();
  }

  async function publishSel(sel) {
    const publishable = sel.filter((s) => {
      const i = [...data.cars, ...data.tracks].find((x) => x.kind === s.kind && x.id === s.id);
      return i && !i.remoteOnly && !i.official;
    });
    if (!publishable.length) return toast('Ces éléments ne sont pas installés sur ce PC', 'warn');
    let notes = '';
    let force = false;
    const go = await new Promise((resolve) => {
      let ok = false;
      const m = modal({
        title: `Publier ${publishable.length} élément(s)`,
        small: true,
        body: h('div.grid',
          h('p', { style: { margin: 0, color: 'var(--text-2)' } }, 'Les dossiers vont être compressés et envoyés. Les membres recevront la mise à jour automatiquement. Seuls les éléments réellement modifiés sont renvoyés.'),
          field('Note de version (optionnel)', h('input.input', { placeholder: 'ex : nouveau setup, livrées 2026…', on: { input: (e) => { notes = e.target.value; } } })),
          h('label.row', h('input', { type: 'checkbox', on: { change: (e) => { force = e.target.checked; } } }), 'Forcer le renvoi même si identique'),
        ),
        foot: [h('button.btn.btn-ghost', { on: { click: () => m.close() } }, 'Annuler'), h('button.btn.btn-primary', { on: { click: () => { ok = true; m.close(); } } }, icon('upload'), 'Publier')],
        onClose: () => resolve(ok),
      });
    });
    if (!go) return;
    logEl.textContent = '';
    const report = await guard(() => api.call('admin:publish', publishable, { notes, force }));
    if (report) {
      const okCount = report.filter((r) => r.status === 'published').length;
      const errCount = report.filter((r) => r.status === 'error').length;
      toast(`${okCount} publié(s), ${report.length - okCount - errCount} inchangé(s)${errCount ? `, ${errCount} erreur(s)` : ''}`, errCount ? 'warn' : 'success', 6000);
      selection.clear();
      for (const r of report) if (r.version) versions[`${r.kind}/${r.id}`] = r.version;
      load();
    }
  }

  async function removeSel(sel) {
    const ok = await confirmBox('Retirer du LKS', `Retirer ${sel.length} élément(s) du manifeste ? Ils ne seront plus distribués (les membres gardent leur copie locale).`, 'Retirer');
    if (!ok) return;
    if (await guard(() => api.call('admin:remove', sel), 'Retiré du manifeste')) {
      selection.clear();
      load();
    }
  }

  // ------------------------------------------------------------ servers & news
  function renderMeta() {
    clear(metaBox);
    const servers = (data.manifest.servers || []).map((s) => ({ ...s }));
    const news = (data.manifest.news || []).map((n) => ({ ...n }));
    let motd = data.manifest.motd || '';
    let cspPin = (data.manifest.csp && data.manifest.csp.version) || '';
    const don = JSON.parse(JSON.stringify(data.manifest.donate || { message: '', links: [], goal: null }));
    don.links = Array.isArray(don.links) ? don.links : [];
    const goal = don.goal || { label: 'Objectif du mois', current: 0, target: 0, currency: '€' };
    const shopCfg = { open: false, url: '', message: '', ...(data.manifest.shop || {}) };
    const linkList = h('div.grid');
    const drawLinks = () => {
      clear(linkList);
      don.links.forEach((l, idx) => linkList.append(h('div.input-row',
        h('select.input', { style: { width: '130px', flex: 'none' }, on: { change: (e) => { l.kind = e.target.value; } } },
          ['paypal', 'kofi', 'tipeee', 'twitch', 'patreon', 'other'].map((k) => h('option', { value: k, selected: (l.kind || 'other') === k }, k))),
        h('input.input', { value: l.label || '', placeholder: 'Nom affiché', on: { input: (e) => { l.label = e.target.value; } } }),
        h('input.input.mono', { value: l.url || '', placeholder: 'https://…', on: { input: (e) => { l.url = e.target.value.trim(); } } }),
        h('button.btn.btn-sm.btn-ghost', { on: { click: () => { don.links.splice(idx, 1); drawLinks(); } } }, icon('trash')))));
    };
    drawLinks();

    const srvList = h('div.grid');
    const drawServers = () => {
      clear(srvList);
      servers.forEach((s, idx) => {
        srvList.append(h('div.panel', { style: { background: 'var(--bg-2)', padding: '12px' } },
          h('div.grid.grid-2',
            field('Nom', h('input.input', { value: s.name || '', on: { input: (e) => { s.name = e.target.value; } } })),
            field('Description', h('input.input', { value: s.description || '', on: { input: (e) => { s.description = e.target.value; } } })),
            field('IP / hôte', h('input.input', { value: s.ip || '', on: { input: (e) => { s.ip = e.target.value.trim(); } } })),
            field('Port HTTP', h('input.input', { type: 'number', value: s.httpPort || 8081, on: { input: (e) => { s.httpPort = Number(e.target.value); } } })),
          ),
          h('div.row.mt',
            field('Mot de passe (optionnel)', h('input.input', { value: s.password || '', on: { input: (e) => { s.password = e.target.value; } } }), 'Pré-rempli chez les membres. Attention : le manifeste est public.'),
            h('button.btn.btn-sm.btn-danger.right', { on: { click: () => { servers.splice(idx, 1); drawServers(); } } }, icon('trash')),
          ),
        ));
      });
    };
    drawServers();

    const newsList = h('div');
    const drawNews = () => {
      clear(newsList);
      news.forEach((n, idx) => newsList.append(h('div.news-item', h('div.row', h('div', h('div.date', dateFr(n.date)), h('h4', n.title)), h('button.btn.btn-sm.btn-ghost.right', { on: { click: () => { news.splice(idx, 1); drawNews(); } } }, icon('trash'))), h('p', n.body))));
    };
    drawNews();
    let nt = '';
    let nb = '';
    const titleIn = h('input.input', { placeholder: 'Titre', on: { input: (e) => { nt = e.target.value; } } });
    const bodyIn = h('textarea.input', { placeholder: 'Message', on: { input: (e) => { nb = e.target.value; } } });

    // ---------- events calendar
    const events = (data.manifest.events || []).map((e) => ({ ...e }));
    const eventList = h('div.grid');
    const serverOptions = [['', '— aucun —'], ...servers.filter((s) => s.ip).map((s) => [`${s.ip}:${s.httpPort || 8081}`, s.name || s.ip])];
    const toLocalInput = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    let group = { cars: [], tracks: [] }; // the group's content, for the event's track and cars
    api.call('sync:manifest').then((m) => { if (m) { group = m; drawEvents(); } }).catch(() => {});
    const trackOptions = () => [['', '— libre —'], ...(group.tracks || []).flatMap((t) => (t.layouts && t.layouts.length > 1 ? t.layouts.map((l) => [`${t.id}|${l.id}`, `${t.name} — ${l.name || l.id || 'principal'}`]) : [[`${t.id}|${(t.layouts && t.layouts[0] && t.layouts[0].id) || ''}`, t.name]]))];
    const drawEvents = () => {
      clear(eventList);
      events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      events.forEach((ev, idx) => {
        const past = Date.parse(ev.date) + (Number(ev.durationMinutes) || 120) * 60000 < Date.now();
        eventList.append(h('div.panel', { style: { background: 'var(--bg-2)', padding: '12px', opacity: past ? 0.55 : 1 } },
          h('div.grid.grid-2',
            field('Titre', h('input.input', { value: ev.title || '', on: { input: (e) => { ev.title = e.target.value; } } })),
            field('Date et heure', h('input.input', { type: 'datetime-local', value: toLocalInput(ev.date), on: { change: (e) => { ev.date = new Date(e.target.value).toISOString(); } } })),
            field('Serveur', h('select.input', { on: { change: (e) => { ev.server = e.target.value; } } }, serverOptions.map(([v, l]) => h('option', { value: v, selected: (ev.server || '') === v }, l)))),
            field('Durée (min)', h('input.input', { type: 'number', value: ev.durationMinutes || 120, on: { input: (e) => { ev.durationMinutes = Number(e.target.value); } } })),
            field('Circuit', h('select.input', { on: { change: (e) => { const [t, l] = e.target.value.split('|'); ev.track = t || ''; ev.layout = l || ''; } } }, trackOptions().map(([v, l]) => h('option', { value: v, selected: `${ev.track || ''}|${ev.layout || ''}` === v || (!ev.track && !v) }, l)))),
            field('Battle de la soirée', h('div.row',
              h('select.input', { on: { change: (e) => { const size = Number(e.target.value); ev.battle = size ? { size, mode: (ev.battle && ev.battle.mode) || 'normal' } : null; } } },
                [[0, 'Non'], [4, 'Oui : top 4'], [8, 'Oui : top 8'], [16, 'Oui : top 16']].map(([v, l]) => h('option', { value: v, selected: ((ev.battle && ev.battle.size) || 0) === v }, l))),
              h('select.input', { on: { change: (e) => { if (ev.battle) ev.battle.mode = e.target.value; } } },
                [['debutant', 'Débutant'], ['normal', 'Amateur'], ['pro', 'Pro']].map(([v, l]) => h('option', { value: v, selected: ((ev.battle && ev.battle.mode) || 'normal') === v }, l)))),
              'Qualifs en solo pendant la soirée, puis tableau des meilleurs : dans Télémétrie → Championnat « Soirées LKS ». Il faut choisir le circuit.'),
            field('Voitures imposées', h('div.event-cars', (group.cars || []).map((c) => h('label.row', h('input', { type: 'checkbox', checked: (ev.cars || []).includes(c.id), on: { change: (e) => { ev.cars = e.target.checked ? [...new Set([...(ev.cars || []), c.id])] : (ev.cars || []).filter((x) => x !== c.id); } } }), c.name)))),
          ),
          h('div.row.mt',
            field('Description', h('input.input', { value: ev.description || '', placeholder: 'voitures imposées, règles…', on: { input: (e) => { ev.description = e.target.value; } } })),
            h('button.btn.btn-sm.btn-danger.right', { on: { click: () => { events.splice(idx, 1); drawEvents(); } } }, icon('trash')),
          )));
      });
      if (!events.length) eventList.append(h('p.muted', { style: { margin: 0 } }, 'Aucun event prévu.'));
    };
    drawEvents();

    // ---------- quick solo sessions
    const presets = (data.manifest.soloPresets || []).map((p) => ({ ...p }));
    const presetList = h('div.list');
    const drawPresets = () => {
      clear(presetList);
      if (!presets.length) presetList.append(h('p.muted', { style: { margin: 0 } }, 'Aucune session. Dans Solo, règle une session puis clique sur « Partager ».'));
      presets.forEach((p, idx) => presetList.append(h('div.row', { style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
        h('div', h('div', { style: { fontWeight: 700 } }, p.name), h('div.hint', [p.settings && p.settings.car, p.settings && p.settings.track].filter(Boolean).join(' @ '))),
        h('button.btn.btn-sm.btn-danger.right', { on: { click: () => { presets.splice(idx, 1); drawPresets(); } } }, icon('trash')))));
    };
    drawPresets();

    // ---------- shared setups
    const setupBox = h('div');
    const published = data.manifest.setups || [];
    (async () => {
      const local = (await guard(() => api.call('admin:localSetups'))) || [];
      const chosen = new Set();
      clear(setupBox);
      if (!local.length && !published.length) {
        setupBox.append(h('p.muted', { style: { margin: 0 } }, 'Aucun setup trouvé dans Documents/Assetto Corsa/setups. Enregistre tes setups dans le jeu, puis reviens ici.'));
        return;
      }
      for (const c of local) {
        const pub = published.find((p) => p.car === c.car);
        setupBox.append(h('label.row', { style: { padding: '5px 0' } },
          h('input', { type: 'checkbox', on: { change: (e) => (e.target.checked ? chosen.add(c.car) : chosen.delete(c.car)) } }),
          h('span', c.name), h('span.hint', `${c.count} setup(s)`), pub ? h('span.tag.ok', { style: { marginLeft: 'auto' } }, `Publiés (${pub.files})`) : null));
      }
      for (const p of published.filter((x) => !local.some((c) => c.car === x.car))) {
        setupBox.append(h('div.row', { style: { padding: '5px 0' } }, h('span', p.name), h('span.tag.info', 'En ligne seulement')));
      }
      setupBox.append(h('div.row.mt',
        published.length ? h('button.btn.btn-sm.btn-danger', { on: { click: async () => {
          const cars = [...chosen].filter((c) => published.some((p) => p.car === c));
          if (!cars.length) return toast('Coche les voitures dont il faut retirer les setups', 'warn');
          if (await guard(() => api.call('admin:removeSetups', cars), 'Setups retirés')) load();
        } } }, icon('trash'), 'Retirer') : null,
        h('button.btn.btn-sm.btn-primary.right', { on: { click: async () => {
          if (!chosen.size) return toast('Coche au moins une voiture', 'warn');
          logEl.textContent = '';
          if (await guard(() => api.call('admin:publishSetups', [...chosen]), 'Setups publiés')) load();
        } } }, icon('upload'), 'Publier les setups')));
    })();

    // ---------- Discord
    const discord = { clientId: '', inviteUrl: '', webhook: '', reportWebhook: '', ...(data.manifest.discord || {}) };

    // ---------- leaderboard
    const board = { url: '', anonKey: '', ...(data.manifest.leaderboard || {}) };

    // ---------- VPN
    const vpnCfg = { provider: '', networkId: '', networkName: '', password: '', ...(data.manifest.vpn || {}) };
    const vpnBox = h('div.mt');
    const drawVpn = async () => {
      clear(vpnBox);
      if (vpnCfg.provider === 'zerotier') {
        const rules = await api.call('vpn:rules');
        vpnBox.append(
          h('ol.vpn-steps',
            h('li', 'Crée un compte gratuit sur ', h('a.link', { on: { click: () => api.call('shell:open', 'https://my.zerotier.com') } }, 'my.zerotier.com'), ', puis « Create A Network ».'),
            h('li', 'Dans les réglages du réseau, passe « Access Control » sur ', h('strong', 'Public'), ' : les membres rejoignent sans validation et sans compte.'),
            h('li', 'Dans « Flow Rules », colle ces règles pour que seul le jeu passe par le réseau (le reste des PC reste invisible) :'),
          ),
          h('div.row', h('pre.log', { style: { flex: 1, margin: 0 } }, rules), h('button.btn.btn-sm', { on: { click: async () => { await api.call('clipboard:write', rules); toast('Règles copiées', 'success'); } } }, 'Copier')),
          h('div.mt', field('Network ID (16 caractères)', h('input.input.mono', { value: vpnCfg.networkId, placeholder: '8056c2e21c000001', on: { input: (e) => { vpnCfg.networkId = e.target.value.trim().toLowerCase(); } } }))),
          h('p.hint', 'L’offre gratuite de ZeroTier est limitée à 10 appareils. Au-delà, préfère Radmin VPN.'),
        );
      } else if (vpnCfg.provider === 'radmin') {
        vpnBox.append(
          h('ol.vpn-steps',
            h('li', 'Installe ', h('a.link', { on: { click: () => api.call('shell:open', 'https://www.radmin-vpn.com/fr/') } }, 'Radmin VPN'), ', puis Réseau → Créer un réseau.'),
            h('li', 'Indique ici le nom et le mot de passe choisis : chaque membre les verra dans son launcher, avec un bouton pour les copier.'),
          ),
          h('div.grid.grid-2',
            field('Nom du réseau', h('input.input.mono', { value: vpnCfg.networkName, on: { input: (e) => { vpnCfg.networkName = e.target.value.trim(); } } })),
            field('Mot de passe du réseau', h('input.input.mono', { value: vpnCfg.password, on: { input: (e) => { vpnCfg.password = e.target.value; } } }))),
          h('p.hint', 'Le mot de passe est visible par tous ceux qui ont le launcher (le manifeste est public) : n’en réutilise pas un important.'),
        );
      }
    };
    drawVpn();

    // ---------- history
    const history = data.manifest.history || [];

    metaBox.append(
      h('div.panel', h('h3', 'Calendrier des events'),
        h('p.hint', { style: { marginTop: 0 } }, 'Affiché sur l’accueil avec un compte à rebours. Notification 15 min avant. Le circuit et les voitures choisis sont installés chez tout le monde 1 h avant. Annoncé sur Discord si le salon des annonces est réglé.'),
        eventList,
        h('div.row.mt',
          h('button.btn.btn-sm', { on: { click: () => { const d = new Date(Date.now() + 86400000); d.setHours(21, 0, 0, 0); events.push({ id: `e${Date.now().toString(36)}`, title: 'Soirée LKS', date: d.toISOString(), durationMinutes: 120, server: serverOptions[1] ? serverOptions[1][0] : '' }); drawEvents(); } } }, icon('plus'), 'Ajouter un event'),
          h('button.btn.btn-sm.btn-primary.right', { on: { click: () => {
            if (events.some((e) => !e.title || Number.isNaN(Date.parse(e.date)))) return toast('Chaque event a besoin d’un titre et d’une date', 'warn');
            guard(() => api.call('admin:updateMeta', { events }), 'Calendrier publié');
          } } }, 'Enregistrer le calendrier'))),
      h('div.panel', h('h3', 'Sessions rapides'), presetList,
        h('div.row.mt', h('button.btn.btn-sm.btn-primary.right', { on: { click: () => guard(() => api.call('admin:updateMeta', { soloPresets: presets }), 'Sessions enregistrées') } }, 'Enregistrer'))),
      h('div.panel', h('h3', 'Setups partagés'),
        h('p.hint', { style: { marginTop: 0 } }, 'Installés à côté des setups de chacun (préfixe LKS_), sans rien écraser.'),
        setupBox),
      h('div.panel', h('h3', 'Discord'),
        h('p.hint', { style: { marginTop: 0 } }, 'Crée une application « Lowkey Syndicate » sur discord.com/developers/applications et colle son Application ID ici.'),
        h('div.grid',
          field('Application ID', h('input.input.mono', { value: discord.clientId, placeholder: '123456789012345678', on: { input: (e) => { discord.clientId = e.target.value.trim(); } } })),
          field('Lien d’invitation du serveur Discord', h('input.input.mono', { value: discord.inviteUrl, placeholder: 'https://discord.gg/…', on: { input: (e) => { discord.inviteUrl = e.target.value.trim(); } } })),
          field('Webhook du salon des annonces', h('input.input.mono', { value: discord.webhook, placeholder: 'https://discord.com/api/webhooks/…', on: { input: (e) => { discord.webhook = e.target.value.trim(); } } })),
          field('Webhook du salon des admins (rapports de plantage)', h('input.input.mono', { value: discord.reportWebhook, placeholder: 'https://discord.com/api/webhooks/…', on: { input: (e) => { discord.reportWebhook = e.target.value.trim(); } } })),
        ),
        h('p.hint', 'Webhook : dans Discord, Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l’URL. Annonces : soirées, records, battles, propositions. Admins : rapports de plantage envoyés par les membres. Les membres ont ces liens dans le launcher : si un lien est utilisé pour du spam, régénère-le dans Discord et recolle-le ici.'),
        h('div.row.mt', h('button.btn.btn-sm.btn-primary.right', { on: { click: () => {
          if (discord.clientId && !/^\d{15,25}$/.test(discord.clientId)) return toast('L’Application ID est un nombre de 17 à 20 chiffres', 'warn');
          if (discord.inviteUrl && !/^https:\/\//.test(discord.inviteUrl)) return toast('Le lien doit commencer par https://', 'warn');
          const hook = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/;
          if (discord.webhook && !hook.test(discord.webhook)) return toast('Le webhook des annonces n’est pas une adresse de webhook Discord', 'warn');
          if (discord.reportWebhook && !hook.test(discord.reportWebhook)) return toast('Le webhook des admins n’est pas une adresse de webhook Discord', 'warn');
          guard(() => api.call('admin:updateMeta', { discord }), 'Réglages Discord publiés');
        } } }, 'Enregistrer'))),
      h('div.panel', h('h3', 'VPN'),
        h('p.hint', { style: { marginTop: 0 } }, 'Si la box d’un hôte ne peut pas ouvrir ses ports, tout le monde passe par ce VPN. Deux choix gratuits :'),
        field('Type', h('select.input', { on: { change: (e) => { vpnCfg.provider = e.target.value; drawVpn(); } } },
          [['', 'Aucun'], ['zerotier', 'ZeroTier : connexion en un clic dans le launcher (10 appareils max, gratuit)'], ['radmin', 'Radmin VPN : sans limite, les membres rejoignent à la main']].map(([v, l]) => h('option', { value: v, selected: (vpnCfg.provider || '') === v }, l)))),
        vpnBox,
        h('div.row.mt', h('button.btn.btn-sm.btn-primary.right', { on: { click: () => {
          if (vpnCfg.provider === 'zerotier' && !/^[0-9a-f]{16}$/.test(vpnCfg.networkId || '')) return toast('L’identifiant ZeroTier fait 16 caractères (0-9, a-f)', 'warn');
          if (vpnCfg.provider === 'radmin' && !vpnCfg.networkName) return toast('Indique le nom du réseau Radmin VPN', 'warn');
          const value = vpnCfg.provider === 'zerotier' ? { provider: 'zerotier', networkId: vpnCfg.networkId } : vpnCfg.provider === 'radmin' ? { provider: 'radmin', networkName: vpnCfg.networkName, password: vpnCfg.password || '' } : null;
          guard(() => api.call('admin:updateMeta', { vpn: value }), 'VPN enregistré');
        } } }, 'Enregistrer'))),
      h('div.panel', h('h3', 'Classement et serveur du groupe'),
        h('p.hint', { style: { marginTop: 0 } }, 'Classement, notes des runs, qui est en ligne, propositions, galerie. Deux choix : ton propre serveur (dossier « server » du launcher sur GitHub, avec sa notice) ou un projet Supabase gratuit. Aucun Steam ID n’est envoyé.'),
        h('p.hint', 'Ton serveur : lance « ./lks.sh install », puis colle ici l’adresse et la clé qu’il affiche. Supabase :'),
        h('ol.vpn-steps',
          h('li', 'Crée un projet sur ', h('a.link', { on: { click: () => api.call('shell:open', 'https://supabase.com/dashboard/new') } }, 'supabase.com'), '.'),
          h('li', 'SQL Editor → colle le script et lance-le. ', h('a.link', { on: { click: async () => { await api.call('clipboard:write', await api.call('admin:leaderboardSql')); toast('Script copié', 'success'); } } }, 'Copier le script')),
          h('li', 'Project Settings → API : copie l’URL et la clé « anon public ».')),
        h('div.grid',
          field('Adresse du serveur', h('input.input.mono', { value: board.url, placeholder: 'https://lks.mondomaine.fr ou https://xxxx.supabase.co', on: { input: (e) => { board.url = e.target.value.trim().replace(/\/+$/, ''); } } })),
          field('Clé publique (anon)', h('input.input.mono', { value: board.anonKey, placeholder: 'eyJhbGciOi…', on: { input: (e) => { board.anonKey = e.target.value.trim(); } } }))),
        h('div.row.mt',
          h('button.btn.btn-sm', { on: { click: () => guard(() => api.call('admin:testLeaderboard', board), 'Connexion OK') } }, 'Tester'),
          board.url ? h('button.btn.btn-sm.btn-ghost', { on: { click: () => guard(() => api.call('admin:updateMeta', { leaderboard: null }), 'Classement retiré') } }, 'Retirer') : null,
          h('button.btn.btn-sm.btn-primary.right', { on: { click: async () => {
            if (!/^https:\/\/[\w.-]+$/.test(board.url)) return toast('L’adresse doit ressembler à https://lks.mondomaine.fr', 'warn');
            if (!board.anonKey) return toast('Colle la clé publique (anon)', 'warn');
            if (!(await guard(() => api.call('admin:testLeaderboard', board)))) return;
            guard(() => api.call('admin:updateMeta', { leaderboard: { url: board.url, anonKey: board.anonKey } }), 'Classement enregistré');
          } } }, 'Enregistrer'))),
      h('div.panel', h('h3', 'Historique des publications'),
        history.length
          ? h('div.history', history.map((e) => h('div.history-row', h('span.hint', dateFr(e.date)), h('strong', e.by), h('span', e.action))))
          : h('p.muted', { style: { margin: 0 } }, 'Les prochaines publications apparaîtront ici, avec le nom de l’admin.')),
    );
    const brand = data.manifest.branding;
    metaBox.append(
      h('div.panel', { style: { gridColumn: '1 / -1' } }, h('h3', 'Identité visuelle (logo & vitrine)'),
        h('p.hint', { style: { marginTop: 0 } }, 'Le logo et les photos ne sont pas inclus dans le launcher : ils restent la propriété de l’association (tous droits réservés) et sont téléchargés par chaque launcher depuis le dépôt de contenu. Choisis le dossier du pack « identité visuelle » (logo.png, logo-wide.png, icon.png, showcase.json et les photos).'),
        h('div.row.wrap',
          brand ? h('span.tag.ok', `Publiée — ${brand.files.length} fichier(s), ${brand.showcase} voiture(s) en vitrine`) : h('span.tag.warn', 'Pas encore publiée : les launchers affichent un thème neutre'),
          h('button.btn.btn-sm.btn-primary.right', { disabled: busy, on: { click: async () => {
            const dir = await api.call('dialog:pickFolder', 'Dossier de l’identité visuelle');
            if (!dir) return;
            logEl.textContent = '';
            const r = await guard(() => api.call('admin:publishBranding', dir));
            if (r) { toast(`Identité visuelle publiée (${r.files} fichiers, ${r.showcase} voitures)`, 'success'); load(); }
          } } }, icon('upload'), 'Publier depuis un dossier…'),
        )),
    );
    metaBox.append(
      h('div.panel', h('h3', 'Serveurs'), srvList,
        h('div.row.mt',
          h('button.btn.btn-sm', { on: { click: () => { servers.push({ name: 'Nouveau serveur', ip: '', httpPort: 8081 }); drawServers(); } } }, icon('plus'), 'Ajouter'),
          h('button.btn.btn-sm.btn-primary.right', { on: { click: () => guard(() => api.call('admin:updateMeta', { servers: servers.filter((s) => s.ip) }), 'Serveurs publiés') } }, 'Enregistrer les serveurs'),
        )),
      h('div.panel', h('h3', 'Actus & message du jour'),
        field('Message du jour (bandeau sur l’accueil)', h('input.input', { value: motd, on: { input: (e) => { motd = e.target.value; } } })),
        h('div.grid.mt', titleIn, bodyIn),
        h('div.row.mt',
          h('button.btn.btn-sm', { on: { click: () => { if (!nt) return; news.unshift({ title: nt, body: nb, date: new Date().toISOString() }); nt = ''; nb = ''; titleIn.value = ''; bodyIn.value = ''; drawNews(); } } }, icon('plus'), 'Ajouter l’actu'),
          h('button.btn.btn-sm.btn-primary.right', { on: { click: () => guard(() => api.call('admin:updateMeta', { news, motd }), 'Actus publiées') } }, 'Enregistrer les actus'),
        ),
        h('div.mt', newsList)),
      h('div.panel', h('h3', 'Custom Shaders Patch du groupe'),
        h('p.hint', { style: { marginTop: 0 } }, 'Vide : version recommandée par acstuff. Sinon, indique une version (ex. 0.2.11) pour que tout le monde ait la même.'),
        h('div.input-row',
          h('input.input.mono', { value: cspPin, placeholder: 'recommandée (auto)', on: { input: (e) => { cspPin = e.target.value.trim(); } } }),
          h('button.btn.btn-primary', { on: { click: () => {
            if (cspPin && !/^\d+\.\d+\.\d+$/.test(cspPin)) return toast('Format attendu : 0.2.11', 'warn');
            guard(() => api.call('admin:updateMeta', { csp: cspPin ? { version: cspPin } : null }), 'Version CSP publiée');
          } } }, 'Enregistrer'),
        )),
      h('div.panel', h('h3', 'Dons'),
        field('Message', h('textarea.input', { value: don.message || '', placeholder: 'Message (optionnel)', on: { input: (e) => { don.message = e.target.value; } } })),
        h('div.grid.grid-3.mt',
          field('Objectif (texte)', h('input.input', { value: goal.label, on: { input: (e) => { goal.label = e.target.value; } } })),
          field('Récolté', h('input.input', { type: 'number', value: goal.current, on: { input: (e) => { goal.current = Number(e.target.value); } } })),
          field('Objectif (0 = masqué)', h('input.input', { type: 'number', value: goal.target, on: { input: (e) => { goal.target = Number(e.target.value); } } })),
        ),
        h('div.label.mt', 'Liens (PayPal, Ko-fi, Tipeee…) — https uniquement'),
        h('div.mt', linkList),
        h('div.row.mt',
          h('button.btn.btn-sm', { on: { click: () => { don.links.push({ kind: 'paypal', label: '', url: '' }); drawLinks(); } } }, icon('plus'), 'Ajouter un lien'),
          h('button.btn.btn-sm.btn-primary.right', { on: { click: () => {
            const bad = don.links.find((l) => !/^https:\/\/[^\s]+$/.test(l.url || ''));
            if (bad) return toast('Chaque lien doit commencer par https://', 'warn');
            guard(() => api.call('admin:updateMeta', { donate: { message: don.message, links: don.links, goal: goal.target > 0 ? goal : null } }), 'Page de dons publiée');
          } } }, 'Enregistrer les dons'),
        )),
      h('div.panel', h('h3', 'Contenu autorisé'),
        toggle('Solo, Héberger et serveurs : contenu du launcher uniquement', !data.manifest.allowAllContent, (v) => guard(() => api.call('admin:updateMeta', { allowAllContent: !v }), v ? 'Limité au contenu du launcher' : 'Tout le contenu installé est autorisé'),
          'Les membres ne peuvent rouler qu’avec les voitures et circuits publiés ici. Désactive-le pour tester une voiture avant de la publier.')),
      h('div.panel', h('h3', 'Boutique'),
        h('p.hint', { style: { marginTop: 0 } }, 'Tant que la boutique est fermée, la page affiche « Bientôt disponible ».'),
        field('Message', h('input.input', { value: shopCfg.message, placeholder: 'Hoodies, t-shirts, stickers…', on: { input: (e) => { shopCfg.message = e.target.value; } } })),
        h('div.mt', field('Lien de la boutique', h('input.input.mono', { value: shopCfg.url, placeholder: 'https://…', on: { input: (e) => { shopCfg.url = e.target.value.trim(); } } }))),
        h('label.row.mt', h('input', { type: 'checkbox', checked: Boolean(shopCfg.open), on: { change: (e) => { shopCfg.open = e.target.checked; } } }), 'Boutique ouverte'),
        h('div.row.mt', h('button.btn.btn-sm.btn-primary.right', { on: { click: () => {
          if (shopCfg.open && !/^https:\/\//.test(shopCfg.url)) return toast('Ajoute un lien https:// avant d’ouvrir la boutique', 'warn');
          guard(() => api.call('admin:updateMeta', { shop: shopCfg }), 'Boutique mise à jour');
        } } }, 'Enregistrer la boutique'))),
    );
  }

  load();
  return () => offs.forEach((off) => off());
}
