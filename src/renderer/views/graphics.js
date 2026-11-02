import { api, h, clear, icon, guard, bytes, toast, confirmBox, select } from '../ui.js';
import { store } from '../store.js';

const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x86.exe';

export default function graphicsView(root) {
  let st = null;
  let busy = false;
  let chosenVersion = null;
  const body = h('div');
  const progFill = h('div.progress-fill');
  const progBox = h('div.row.mt', { hidden: true }, h('div.progress', progFill), h('span.hint'));

  root.append(
    h('div.view-head', h('div', h('h1', 'Graphismes'), h('p', 'Le Custom Shaders Patch et des réglages optimisés pour ta machine. Aucune bidouille, tout est automatique.'))),
    body,
  );

  const offs = [
    window.lks.on('csp:progress', (p) => {
      progBox.hidden = !p;
      if (!p) return;
      const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
      progFill.style.width = `${pct}%`;
      progBox.querySelector('.hint').textContent = p.phase === 'download' ? `Téléchargement du CSP… ${bytes(p.done)}${p.total ? ` / ${bytes(p.total)}` : ''}` : p.phase === 'extract' ? 'Installation…' : 'Terminé';
    }),
    window.lks.on('csp:changed', () => load()),
  ];

  async function load() {
    const res = await guard(() => api.call('graphics:status'));
    if (res) st = res;
    render();
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    render();
    try {
      await fn();
    } finally {
      busy = false;
      await load();
    }
  }

  function render() {
    clear(body);
    if (!st) {
      body.append(h('div.empty', h('span.spinner'), h('p', 'Analyse de ta configuration…')));
      return;
    }
    if (!store.settings.acRoot) body.append(h('div.notice.bad', "Configure d'abord le dossier d'Assetto Corsa dans les Paramètres."));
    if (st.gameRunning) body.append(h('div.notice', 'Assetto Corsa est lancé : ferme le jeu pour changer les graphismes.'));
    if (st.vcRedist === false) {
      body.append(h('div.notice.bad',
        h('span.grow', 'Le CSP a besoin de « Microsoft Visual C++ Redistributable (x86) ». Il ne semble pas installé sur ce PC.'),
        h('button.btn.btn-sm', { on: { click: () => api.call('shell:open', VC_REDIST_URL) } }, icon('download'), 'Télécharger (Microsoft)')));
    }

    const recommended = st.presets.find((p) => p.id === st.gpu.recommended);
    const cspOk = st.csp.installed && st.csp.enabled && !st.needsUpdate;
    const allGood = cspOk && st.preset;

    // ---------- one-click
    body.append(
      h('div.panel.oneclick',
        h('div.oneclick-main',
          h('div',
            h('div.picker-k', 'Configuration en 1 clic'),
            h('div.oneclick-title', allGood ? 'Ton jeu est prêt' : 'Rends ton jeu magnifique'),
            h('p.muted', { style: { margin: '6px 0 0', maxWidth: '620px' } },
              allGood
                ? `CSP v${st.csp.version} actif avec le préréglage « ${labelOf(st.preset)} ». Tu peux changer de préréglage plus bas à tout moment.`
                : `Installe le Custom Shaders Patch officiel (ciel et météo dynamiques, lumières, reflets, nouveaux shaders) et applique les meilleurs réglages pour ta carte graphique.`),
          ),
          h('div.oneclick-side',
            spec('Carte graphique', st.gpu.name ? shortGpu(st.gpu.name) : 'Non détectée'),
            spec('Écran', `${st.display.width}×${st.display.height} · ${st.display.refresh} Hz`),
            spec('Préréglage conseillé', recommended ? recommended.label : '—'),
          ),
        ),
        h('div.row.mt',
          h('button.btn.btn-primary.btn-lg', {
            disabled: busy || st.gameRunning || !store.settings.acRoot,
            on: { click: () => run(() => guard(() => api.call('graphics:oneClick', st.gpu.recommended))) },
          }, busy ? h('span.spinner') : icon('check'), allGood ? 'Tout réappliquer' : 'Tout configurer pour moi'),
          h('span.hint', !st.csp.installed || st.needsUpdate ? `Téléchargement d'environ ${st.versions && st.versions.all.length ? sizeOf(st.target.version) : '120 Mo'} depuis le site officiel du CSP (acstuff).` : ''),
        ),
        progBox,
      ),
    );

    // ---------- CSP panel
    const versions = st.versions ? [...new Set([st.target.version, st.versions.recommended, st.versions.latest].filter(Boolean))] : [];
    if (!chosenVersion || !versions.includes(chosenVersion)) chosenVersion = st.target.version || versions[0] || null;
    const tags = [];
    if (!st.csp.installed) tags.push(h('span.tag.bad', 'Non installé'));
    else {
      tags.push(h(`span.tag.${st.csp.enabled ? 'ok' : 'warn'}`, st.csp.enabled ? `v${st.csp.version} actif` : `v${st.csp.version} désactivé`));
      if (st.needsUpdate) tags.push(h('span.tag.warn', `Mise à jour v${st.target.version}`));
    }
    const versionLabel = (v) => `v${v}${v === st.target.version && st.target.source === 'lks' ? ' — imposée par le Syndicate' : v === (st.versions || {}).recommended ? ' — recommandée (stable)' : v === (st.versions || {}).latest ? ' — dernière (test)' : ''}`;

    body.append(
      h('h2.section', 'Custom Shaders Patch'),
      h('div.grid.grid-2',
        h('div.panel',
          h('h3', 'État'),
          h('div.row.wrap', tags),
          h('p.muted', 'Le CSP est l’extension gratuite créée par Ilja Jusupov (x4fab) qu’utilise Content Manager. Le launcher le télécharge directement depuis le site officiel, rien n’est modifié.'),
          versions.length
            ? h('div.field', h('label', 'Version'), select(versions.map((v) => [v, versionLabel(v)]), chosenVersion, (v) => { chosenVersion = v; }))
            : h('div.notice', 'Site du CSP injoignable pour le moment. Réessaie plus tard.'),
          h('div.row.mt',
            h('button.btn.btn-primary', { disabled: busy || st.gameRunning || !chosenVersion, on: { click: () => run(() => guard(() => api.call('csp:install', chosenVersion))) } }, icon('download'),
              !st.csp.installed ? 'Installer' : st.csp.version === chosenVersion ? 'Réinstaller' : 'Installer cette version'),
            st.csp.installed
              ? h('button.btn', { disabled: busy || st.gameRunning, on: { click: () => run(() => guard(() => api.call('csp:setEnabled', !st.csp.enabled), st.csp.enabled ? 'CSP désactivé' : 'CSP activé')) } }, st.csp.enabled ? 'Désactiver' : 'Activer')
              : null,
          ),
        ),
        h('div.panel',
          h('h3', 'Ce que ça change'),
          h('ul.features',
            h('li', h('strong', 'Ciel, nuages et météo dynamiques'), ' — lever/coucher de soleil, nuit, pluie.'),
            h('li', h('strong', 'Phares et lumières dynamiques'), ' — les phares éclairent vraiment la route.'),
            h('li', h('strong', 'Reflets et nouveaux shaders'), ' — peinture, vitres, piste mouillée.'),
            h('li', h('strong', 'Herbe 3D, fumée et étincelles'), ' — effets bien plus réalistes.'),
            h('li', h('strong', 'Réglages en jeu'), ' — tout reste modifiable dans le menu CSP du jeu.'),
          ),
        ),
      ),
    );

    // ---------- presets
    const grid = h('div.preset-grid');
    for (const p of st.presets) {
      const active = st.preset === p.id;
      const rec = st.gpu.recommended === p.id;
      grid.append(h('div.preset', { class: active ? 'on' : '' },
        h('div.row', rec ? h('span.tag.ok', 'Conseillé pour ton PC') : null, active ? h('span.tag.lks', 'Actif') : null),
        h('div.preset-name', p.label),
        h('div.preset-tag', p.tagline),
        h('p', p.description),
        h('ul', p.features.map((f) => h('li', f))),
        h('button.btn', { class: active ? '' : rec ? 'btn-primary' : '', disabled: busy || st.gameRunning || !store.settings.acRoot, on: { click: () => run(() => applyPreset(p)) } }, active ? 'Réappliquer' : 'Appliquer'),
      ));
    }
    body.append(...[
      h('h2.section', 'Préréglages LKS'),
      !cspOk ? h('div.notice.info', 'Les préréglages marchent aussi sans le CSP, mais c’est avec lui que le jeu devient vraiment beau.') : null,
      grid,
      h('div.row.mt',
        h('span.hint', `Résolution appliquée : ${st.display.width}×${st.display.height} plein écran à ${st.display.refresh} Hz. Le mode caméra (VR, triple écran) et tes autres réglages sont conservés.`),
        st.hasBackup ? h('button.btn.btn-sm.btn-ghost.right', { disabled: busy || st.gameRunning, on: { click: restore } }, icon('refresh'), 'Restaurer mes réglages d’origine') : null,
      ),
    ].filter(Boolean));
  }

  async function applyPreset(p) {
    if (st.gpu.recommended && order(p.id) > order(st.gpu.recommended)) {
      const ok = await confirmBox('Préréglage exigeant', `« ${p.label} » est plus lourd que le préréglage conseillé pour ta carte graphique. Le jeu risque de saccader. Appliquer quand même ?`, 'Appliquer');
      if (!ok) return;
    }
    await guard(() => api.call('graphics:apply', p.id), `Préréglage « ${p.label} » appliqué`);
  }

  async function restore() {
    const ok = await confirmBox('Restaurer', 'Remettre les fichiers de réglages (vidéo + CSP) tels qu’ils étaient avant le premier préréglage LKS ?', 'Restaurer');
    if (ok) await run(() => guard(() => api.call('graphics:restore'), 'Réglages d’origine restaurés'));
  }

  function order(id) {
    return st.presets.findIndex((p) => p.id === id);
  }
  function labelOf(id) {
    const p = st.presets.find((x) => x.id === id);
    return p ? p.label : id;
  }
  function sizeOf(v) {
    const e = (st.versions.all || []).find((x) => x.version === v);
    return e ? `${Math.round(e.sizeMb)} Mo` : '120 Mo';
  }
  function spec(k, v) {
    return h('div', h('div.label', k), h('div.spec-v', v));
  }
  function shortGpu(name) {
    return name.split('|')[0].replace(/\(R\)|\(TM\)|NVIDIA,|AMD,|Intel,/gi, '').replace(/\s+/g, ' ').trim();
  }

  load();
  return () => offs.forEach((off) => off());
}
