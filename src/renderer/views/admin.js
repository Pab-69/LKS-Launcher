import { api, h, clear, icon, guard, field, seg, bytes, dateFr, toast, confirmBox, modal } from '../ui.js';
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

    metaBox.append(
      h('div.panel', h('h3', 'Serveurs du Syndicate'), srvList,
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
        h('p.hint', { style: { marginTop: 0 } }, 'Laisse vide pour que chacun reçoive la version recommandée par acstuff. Indique une version (ex. 0.2.11) pour que tout le Syndicate ait exactement la même, utile si un serveur exige une version précise.'),
        h('div.input-row',
          h('input.input.mono', { value: cspPin, placeholder: 'recommandée (auto)', on: { input: (e) => { cspPin = e.target.value.trim(); } } }),
          h('button.btn.btn-primary', { on: { click: () => {
            if (cspPin && !/^\d+\.\d+\.\d+$/.test(cspPin)) return toast('Format attendu : 0.2.11', 'warn');
            guard(() => api.call('admin:updateMeta', { csp: cspPin ? { version: cspPin } : null }), 'Version CSP publiée');
          } } }, 'Enregistrer'),
        )),
      h('div.panel', h('h3', 'Dons'),
        field('Message', h('textarea.input', { value: don.message || '', placeholder: 'Pourquoi soutenir le Syndicate…', on: { input: (e) => { don.message = e.target.value; } } })),
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
