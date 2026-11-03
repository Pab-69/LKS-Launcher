import { api, h, clear, icon, guard, field, toggle, select, NATIONS, toast } from '../ui.js';
import { store, subscribe, saveSettings, loadContent } from '../store.js';
import { showTour } from '../tour.js';

export default function settings(root, params) {
  const body = h('div');
  root.append(
    h('div.view-head', h('div', h('h1', 'Paramètres'), h('p', 'Profil pilote, dossier du jeu et options du launcher.'))),
    body,
  );

  let acValid = null;
  async function checkAc(dir) {
    acValid = dir ? await api.call('settings:validateAcRoot', dir) : false;
  }

  async function render() {
    const s = store.settings;
    if (!s) return;
    await checkAc(s.acRoot);
    clear(body);
    if (params.welcome) {
      body.append(h('div.notice.info', h('span.grow', 'Vérifie le dossier du jeu et ton nom de pilote. Le contenu s’installera ensuite tout seul.')));
    }

    const acInput = h('input.input', { value: s.acRoot, placeholder: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa', on: { change: (e) => setAc(e.target.value.trim()) } });
    const profile = h('div.panel', h('h3', 'Profil pilote'),
      h('div.grid.grid-2',
        field('Nom de pilote', h('input.input', { value: s.driverName, maxlength: 40, on: { change: (e) => saveSettings({ driverName: e.target.value.trim() }) } }), 'Affiché en ligne et dans les résultats.'),
        field('Nationalité', select(NATIONS.map(([c, n]) => [c, `${n} (${c})`]), s.nationality, (v) => saveSettings({ nationality: v }))),
        field('Équipe', h('input.input', { value: s.team, on: { change: (e) => saveSettings({ team: e.target.value.trim() }) } })),
        field('Steam ID', h('input.input', { value: s.steamId, placeholder: '7656119…', on: { change: (e) => saveSettings({ steamId: e.target.value.trim() }) } }), 'Détecté automatiquement depuis Steam. Il reste sur ton PC (seuls les serveurs de jeu que tu rejoins le reçoivent).'),
      ),
    );

    const game = h('div.panel', h('h3', 'Assetto Corsa'),
      field('Dossier du jeu',
        h('div.input-row', acInput,
          h('button.btn', { on: { click: async () => { const dir = await api.call('dialog:pickFolder', 'Dossier assettocorsa'); if (dir) setAc(dir); } } }, icon('folder'), 'Parcourir'),
          h('button.btn', { on: { click: detect } }, 'Détecter')),
        acValid ? h('span', { style: { color: 'var(--ok)' } }, '✔ Installation valide') : h('span', { style: { color: 'var(--accent-2)' } }, '✖ acs.exe / content/cars introuvables dans ce dossier'),
      ),
      h('div.mt'),
      toggle('Synchronisation automatique', s.autoSync, (v) => saveSettings({ autoSync: v }), 'Installe les nouveautés LKS dès qu’elles sont publiées (vérifié toutes les 5 min).'),
      toggle('Réduire le launcher pendant le jeu', s.closeOnLaunch, (v) => saveSettings({ closeOnLaunch: v })),
      field('Pendant le jeu, afficher', select([['', 'Demander à chaque fois'], ['telemetry', 'La télémétrie en direct'], ['launcher', 'Le launcher']], (() => { try { return localStorage.getItem('lks.duringGame') || ''; } catch { return ''; } })(), (v) => { try { localStorage.setItem('lks.duringGame', v); } catch { /* ignore */ } })),
      h('div.row', h('button.btn.btn-sm', { on: { click: () => showTour() } }, 'Revoir la présentation du launcher')),
      toggle('Afficher mon activité sur Discord', s.discordPresence !== false, (v) => saveSettings({ discordPresence: v }), 'Affiche ta voiture et ta piste sur ton profil Discord.'),
      toggle('Me montrer en ligne aux membres', s.showOnline !== false, (v) => saveSettings({ showOnline: v }), 'Les membres voient sur l’Accueil que tu es là, et sur quel serveur tu roules (pour te rejoindre).'),
      toggle('Partager mon direct pendant les soirées', s.liveShare !== false, (v) => saveSettings({ liveShare: v }), 'Pendant une soirée du calendrier, les juges voient ton angle, ta vitesse et tes clips en direct.'),
      toggle('Annoncer mes records et battles sur le Discord du groupe', s.discordShare !== false, (v) => saveSettings({ discordShare: v }), 'Seulement si les admins ont réglé le salon des annonces.'),
      toggle('Rappels des events', s.eventNotifications !== false, (v) => saveSettings({ eventNotifications: v }), 'Notification 15 min avant chaque event.'),
      h('div.row.mt',
        h('button.btn.btn-sm', { on: { click: () => api.call('shell:open', 'ac') } }, icon('folder'), 'Dossier du jeu'),
        h('button.btn.btn-sm', { on: { click: () => api.call('shell:open', 'docs') } }, icon('folder'), 'Documents/Assetto Corsa'),
      ),
    );

    const info = store.info || {};
    const u = store.updater;
    const stateText = u ? { idle: '', checking: 'Recherche de mise à jour…', latest: '✔ Tu as la dernière version', downloading: `Téléchargement de la v${u.version || ''}…`, ready: `La v${u.version} est prête à être installée`, error: /sign/i.test(u.error || '') ? 'La mise à jour n’a pas pu s’installer toute seule : télécharge l’installeur et lance-le (une seule fois).' : `Impossible de vérifier : ${u.error}`, dev: 'Mode développement (pas de mise à jour)', unavailable: 'Mises à jour automatiques indisponibles pour cette copie (réinstalle avec l’installeur officiel)' }[u.state] || '' : '';
    const gfxSafe = h('div');
    api.call('app:graphicsSafe').then((on) => {
      gfxSafe.append(toggle('Mode compatibilité de l’affichage', on, async (v) => {
        await api.call('app:graphicsSafe', v);
        toast('Pris en compte au prochain démarrage du launcher', 'info');
      }, 'Si le launcher plante ou devient noir quand le jeu plante. Activé tout seul après deux plantages de ce genre.'));
    }).catch(() => {});
    const launcher = h('div.panel', h('h3', 'Launcher'),
      h('div.row.wrap',
        h('span', `Version ${info.version || '?'}`),
        h('span.muted', stateText),
        u && u.state === 'ready'
          ? h('button.btn.btn-sm.btn-primary.right', { on: { click: () => guard(() => api.call('updater:install')) } }, icon('refresh'), 'Redémarrer et mettre à jour')
          : h('button.btn.btn-sm.right', { disabled: u && (u.state === 'checking' || u.state === 'downloading'), on: { click: async () => { const r = await guard(() => api.call('updater:check')); if (r && r.state === 'dev') toast('Mises à jour désactivées en mode développement', 'info'); } } }, icon('refresh'), 'Vérifier les mises à jour'),
      ),
      u && u.state === 'error' && /sign/i.test(u.error || '') ? h('div.row.mt', h('button.btn.btn-sm.btn-primary', { on: { click: () => api.call('shell:open', 'https://github.com/Pab-69/LKS-Launcher/releases/latest/download/LKS-Launcher-Setup.exe') } }, icon('download'), 'Télécharger l’installeur')) : null,
      u && u.state === 'downloading' ? h('div.row.mt', h('div.progress', h('div.progress-fill', { style: { width: `${(u.percent || 0).toFixed(0)}%` } })), h('span.hint', `${(u.percent || 0).toFixed(0)} %`)) : null,
      h('p.hint', 'Les mises à jour du launcher se téléchargent toutes seules en arrière-plan (uniquement les parties modifiées) et s’installent en un clic, ou automatiquement à la fermeture du launcher.'),
      h('p.hint.mt', 'Logiciel libre sous licence GPL-3.0, fourni sans aucune garantie. ', h('a.link', { on: { click: () => api.call('shell:open', 'https://github.com/Pab-69/LKS-Launcher') } }, 'Code source'), ' · Le nom, le logo et les visuels du Lowkey Syndicate restent la propriété de l’association.'),
      h('details.mt',
        h('summary.muted', { style: { cursor: 'pointer' } }, 'Avancé'),
        h('div.grid.mt',
          gfxSafe,
          field('URL du manifeste de contenu', h('input.input.mono', { value: s.manifestUrl, on: { change: (e) => saveSettings({ manifestUrl: e.target.value.trim() }) } }), 'Fichier qui liste les voitures/circuits/serveurs LKS. Ne changez que si un admin vous le demande.'),
        ),
      ),
    );

    let token = '';
    const admin = h('div.panel', h('h3', 'Accès admin (publication)'),
      h('p.hint', { style: { marginTop: 0 } }, "Pour publier du contenu. Il faut un token GitHub (fine-grained) avec « Contents: Read and write » sur le dépôt."),
      h('div.grid.grid-2',
        field('Dépôt de contenu', h('input.input.mono', { value: s.admin.repo, placeholder: 'Pab-69/LKS-Launcher', on: { change: (e) => saveSettings({ admin: { repo: e.target.value } }) } })),
        field('Tag de release', h('input.input.mono', { value: s.admin.tag, on: { change: (e) => saveSettings({ admin: { tag: e.target.value } }) } })),
      ),
      h('div.mt', field('Token GitHub', h('div.input-row',
        h('input.input.mono', { type: 'password', placeholder: s.admin.hasToken ? '•••••••••• (enregistré)' : 'github_pat_…', on: { input: (e) => { token = e.target.value; } } }),
        h('button.btn', { on: { click: async () => { if (!token) return; await saveSettings({ admin: { token } }); toast('Token enregistré (chiffré)', 'success'); render(); } } }, 'Enregistrer'),
        s.admin.hasToken ? h('button.btn.btn-ghost', { on: { click: async () => { await saveSettings({ admin: { token: '' } }); render(); } } }, 'Supprimer') : null,
      ))),
      s.admin.hasToken ? h('div.row.mt',
        h('button.btn.btn-sm', { on: { click: testAdmin } }, icon('shield'), 'Tester l’accès'),
        h('button.btn.btn-sm.btn-primary', { on: { click: () => window.lksGo('admin') } }, 'Ouvrir la publication'),
      ) : null,
    );

    body.append(profile, h('div.mt'), game, h('div.mt'), launcher, h('div.mt'), admin);
  }

  async function setAc(dir) {
    await saveSettings({ acRoot: dir });
    await loadContent(true).catch(() => {});
    render();
  }

  async function detect() {
    const r = await guard(() => api.call('settings:detect'));
    if (!r) return;
    const patch = {};
    if (r.acRoot) patch.acRoot = r.acRoot;
    if (r.steamId) patch.steamId = r.steamId;
    if (r.personaName && !store.settings.driverName) patch.driverName = r.personaName;
    if (!r.acRoot) toast('Assetto Corsa introuvable automatiquement : utilisez « Parcourir »', 'warn');
    else toast('Assetto Corsa détecté', 'success');
    await saveSettings(patch);
    await loadContent(true).catch(() => {});
    render();
  }

  async function testAdmin() {
    const r = await guard(() => api.call('admin:test'));
    if (r) toast(`Accès OK à ${r.name} — ${r.cars} voiture(s), ${r.tracks} circuit(s) publiés`, 'success', 6000);
  }

  render();
  return subscribe((patch) => {
    if ('settings' in patch && !root.contains(document.activeElement)) render();
    if ('updater' in patch) render();
  });
}
