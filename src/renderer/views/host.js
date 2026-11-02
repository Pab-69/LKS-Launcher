import { api, h, clear, icon, guard, field, select, seg, toggle, range, toast, localImg, modal } from '../ui.js';
import { store, loadContent, playable } from '../store.js';
import { vpnCard } from './vpnCard.js';

const TIME_FMT = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}`;
const NET_HELP = {
  internet: 'Joueurs sur internet.',
  radmin: 'Joueurs sur le même réseau Radmin VPN.',
  zerotier: 'Joueurs sur le même réseau ZeroTier.',
  tailscale: 'Joueurs sur le même réseau Tailscale.',
  hamachi: 'Joueurs sur le même réseau Hamachi.',
  lan: 'Joueurs chez toi, sur la même box.',
};

function randomPassword() {
  const words = ['drift', 'touge', 'kaido', 'syndic', 'nuit', 'gomme', 'turbo', 'apex'];
  return `${words[Math.floor(Math.random() * words.length)]}${Math.floor(100 + Math.random() * 900)}`;
}

export default function hostView(root, _params, { go }) {
  const saved = (store.settings && store.settings.host) || {};
  const o = {
    name: saved.name || `Partie de ${(store.settings && store.settings.driverName) || 'LKS'}`,
    track: saved.track || '',
    layout: saved.layout || '',
    cars: Array.isArray(saved.cars) ? saved.cars : [],
    slots: saved.slots || 12,
    mode: saved.mode || 'free',
    qualifyMinutes: saved.qualifyMinutes ?? 10,
    raceLaps: saved.raceLaps || 10,
    timeOfDay: saved.timeOfDay ?? 14,
    weather: saved.weather || '3_clear',
    ambient: saved.ambient ?? 22,
    road: saved.road ?? 28,
    damage: saved.damage ?? 50,
    password: saved.password || randomPassword(),
    lobby: Boolean(saved.lobby),
    upnp: saved.upnp !== false,
    ports: saved.ports || { tcp: 9600, udp: 9600, http: 8081 },
  };
  let st = null;
  let content = playable(store.content);
  let busy = false;
  let carQuery = '';
  let vpnEl = null; // kept across refreshes (an install can take a while)
  const body = h('div');
  root.append(
    h('div.view-head', h('div', h('h1', 'Héberger'), h('p', 'Lance une partie depuis ton PC, gratuitement.'))),
    body,
  );

  async function load() {
    if (!content) content = playable(await loadContent().catch(() => null));
    st = await guard(() => api.call('host:status'));
    render();
  }

  function render() {
    clear(body);
    if (!st || !content) {
      body.append(h('div.empty', h('span.spinner'), h('p', 'Chargement…')));
      return;
    }
    if (!store.settings.acRoot) {
      body.append(h('div.notice.bad', "Configure d'abord le dossier d'Assetto Corsa dans les Paramètres."));
      return;
    }
    if (!st.serverFound) {
      body.append(h('div.notice.bad', h('span.grow', "Le serveur d'Assetto Corsa est introuvable (dossier assettocorsa/server). Dans Steam : clic droit sur Assetto Corsa → Propriétés → Fichiers installés → Vérifier l'intégrité des fichiers.")));
    }
    if (st.running) renderRunning();
    else renderForm();
    renderHelp();
  }

  /** Windows firewall: allowed, or blocking the players (with a fix). */
  function firewallBox(fw) {
    if (!fw) return null;
    if (fw.checking) return h('p.hint.mt', 'Vérification du pare-feu Windows…');
    if (!fw.checked) return null;
    if (fw.ok) return h('div.mt', h('span.tag.ok', 'Pare-feu Windows : serveur autorisé'));
    const why = fw.blocked
      ? 'Windows bloque le serveur (souvent après un clic sur « Annuler » quand il a demandé l’autorisation).'
      : `Le serveur n’est pas autorisé sur ton réseau actuel (${(fw.missingFor || []).join(', ').replace('Public', 'public').replace('Private', 'privé')}).`;
    return h('div.notice.mt',
      h('span.grow', h('strong', 'Le pare-feu Windows bloque les joueurs. '), why),
      h('button.btn.btn-sm.btn-primary', { disabled: busy, on: { click: async () => { busy = true; render(); await guard(() => api.call('host:fixFirewall'), 'Serveur autorisé dans le pare-feu'); busy = false; await load(); } } }, 'Autoriser le serveur'));
  }

  // ---------------------------------------------------------------- running server
  function renderRunning() {
    const s = st.state || {};
    const info = st.info;
    const minutes = Math.floor((st.uptime || 0) / 60000);
    body.append(
      h('div.panel.host-live',
        h('div.row.wrap',
          h('span.dot.on'),
          h('div', h('div.picker-k', 'Serveur en ligne'), h('div.event-title', s.name)),
          h('div.right.host-players', info ? [String(info.clients), h('small', `/${info.maxClients}`)] : '…'),
        ),
        h('p.muted', `${s.track}${s.layout && s.layout !== s.track ? ` — ${s.layout}` : ''} · ${s.slots} places · depuis ${minutes} min${s.password ? ' · mot de passe : ' : ''}`, s.password ? h('strong', s.password) : null),
        h('div.row.mt',
          h('button.btn.btn-primary', { disabled: busy || (store.game && store.game.running), on: { click: joinOwn } }, icon('play'), 'Rejoindre ma partie'),
          h('button.btn.btn-danger', { disabled: busy, on: { click: stop } }, icon('x'), 'Arrêter le serveur'),
        ),
      ),
    );

    // invitation codes
    const up = s.upnp || {};
    const upText = {
      working: ['Ouverture des ports de ta box…', 'info'],
      open: [`Ports ouverts sur ta box (${up.externalIp})`, 'ok'],
      manual: [`Ports ouverts à la main (${up.externalIp})`, 'ok'],
      failed: [`Ports non ouverts : ${up.error}`, 'warn'],
      cgnat: [up.error, 'warn'],
      off: ['Ouverture automatique des ports désactivée', 'plain'],
    }[up.state] || ['', 'plain'];
    const inv = h('div.grid');
    for (const i of s.invites || []) {
      inv.append(h('div.invite',
        h('div', h('div.invite-label', i.label), h('div.hint', NET_HELP[i.kind] || ''), h('code.invite-code', i.code)),
        h('button.btn.btn-sm', { on: { click: async () => { await api.call('clipboard:write', i.code); toast('Code copié', 'success'); } } }, 'Copier')));
    }
    if (!(s.invites || []).length) inv.append(h('p.muted', { style: { margin: 0 } }, 'Aucun réseau détecté.'));
    const portsKo = up.state === 'failed' || up.state === 'cgnat';
    body.append(
      h('h2.section', 'Inviter'),
      h('div.panel',
        upText[0] ? h(`span.tag.${upText[1]}`, upText[0]) : null,
        h('p.hint', 'Envoie un code. Il se colle dans Serveurs → Rejoindre avec un code (mot de passe inclus).'),
        inv),
      portsKo ? h('div.notice.mt', h('span.grow', 'Ports non ouverts : les joueurs hors de chez toi ne peuvent pas se connecter. Passez par le VPN et envoie le code VPN.')) : null,
      up.state === 'failed' ? h('div.panel.mt', h('h3', 'Ouvrir les ports à la main'),
        s.boxGuide
          ? h('p', { style: { marginTop: 0 } }, h('strong', `${s.boxGuide.brand} : `), s.boxGuide.steps, ' ', h('a.link', { on: { click: () => api.call('shell:open', s.boxGuide.url) } }, 'Ouvrir l’interface de la box'))
          : h('p.hint', { style: { marginTop: 0 } }, 'Ajoute ces redirections dans l’interface de ta box (souvent « NAT / PAT », « Redirection de ports » ou « Gestion des ports ») :'),
        h('div.ports-table',
          h('span.label', 'Protocole'), h('span.label', 'Port'), h('span.label', 'Vers'),
          ...[['TCP', s.ports && s.ports.tcp], ['UDP', s.ports && s.ports.udp], ['TCP', s.ports && s.ports.http]].flatMap(([proto, port]) => [h('span', proto), h('strong', String(port || '?')), h('code', s.lanAddress || 'ce PC')])),
        h('p.hint', 'Astuce : dans la box, donne une adresse fixe à ce PC (« bail statique » / « IP fixe » dans le DHCP), sinon la redirection peut se perdre au prochain redémarrage.'),
        h('div.row.mt',
          h('button.btn.btn-sm.btn-primary', { disabled: busy, on: { click: async () => { busy = true; render(); await guard(() => api.call('host:manualPorts'), 'Code internet prêt'); busy = false; await load(); } } }, icon('check'), 'J’ai ouvert les ports à la main'),
          h('button.btn.btn-sm', { disabled: busy, on: { click: async () => { busy = true; render(); await guard(() => api.call('host:retryPorts')); busy = false; await load(); } } }, icon('refresh'), 'Réessayer l’ouverture automatique'))) : null,
      firewallBox(s.firewall) || '',
      h('div.mt', (() => { vpnEl = vpnEl || vpnCard(); vpnEl.classList.toggle('vpn-highlight', portsKo); return vpnEl; })()),
    );
    body.append(
      h('div.row.mt', h('button.btn.btn-sm', { on: { click: async () => { const t = await guard(() => api.call('host:diagnostic')); if (t) { await api.call('clipboard:write', t); toast('Diagnostic copié : colle-le dans ton message', 'success'); } } } }, 'Copier le diagnostic'), h('span.hint', 'Ce que le launcher a essayé avec ta box et le pare-feu, à envoyer si ça ne marche pas.')),
      h('details.mt', h('summary.muted', { style: { cursor: 'pointer' } }, 'Journal du serveur'), h('div.log.mt', (st.log || []).join('\n') || '…')));
  }

  // ---------------------------------------------------------------- configuration form
  function renderForm() {
    const tracks = content.tracks;
    if (!tracks.some((t) => t.id === o.track)) o.track = (tracks.find((t) => t.lks) || tracks[0] || {}).id || '';
    const track = tracks.find((t) => t.id === o.track);
    if (track && !track.layouts.some((l) => l.id === o.layout)) o.layout = track.layouts[0].id;
    const layout = track && track.layouts.find((l) => l.id === o.layout);
    const maxSlots = Math.max(2, Math.min(32, (layout && layout.pitboxes) || 24));
    if (o.slots > maxSlots) o.slots = maxSlots;
    o.cars = o.cars.filter((id) => content.cars.some((c) => c.id === id));
    if (!o.cars.length) o.cars = content.cars.filter((c) => c.lks).slice(0, 3).map((c) => c.id);

    const left = h('div.grid');
    left.append(
      h('div.panel', h('h3', 'Circuit'),
        h('div.grid.grid-2',
          field('Circuit', select(tracks.map((t) => [t.id, `${t.name}${t.lks ? ' · LKS' : ''}`]), o.track, (v) => { o.track = v; o.layout = ''; render(); })),
          track && track.layouts.length > 1 ? field('Tracé', select(track.layouts.map((l) => [l.id, l.name]), o.layout, (v) => { o.layout = v; render(); })) : h('div'),
        ),
        layout && (layout.preview || layout.outline) ? h('div.host-track', h('img', { src: localImg(layout.preview || layout.outline), alt: '' }), h('span.hint', `${layout.pitboxes || '?'} stands · ${layout.length || ''}`)) : null,
      ),
    );

    const carList = h('div.host-cars');
    const drawCars = () => {
      clear(carList);
      const q = carQuery.toLowerCase();
      const list = [...content.cars].sort((a, b) => Number(b.lks) - Number(a.lks)).filter((c) => !q || `${c.name} ${c.id}`.toLowerCase().includes(q));
      for (const c of list.slice(0, 200)) {
        const on = o.cars.includes(c.id);
        const skin = c.skins.find((k) => k.preview);
        carList.append(h('button.car-opt', { class: on ? 'on' : '', on: { click: () => { o.cars = on ? o.cars.filter((x) => x !== c.id) : [...o.cars, c.id]; drawCars(); summary(); } } },
          skin ? h('img', { src: localImg(skin.preview), loading: 'lazy', alt: '' }) : h('div.ph'),
          h('div.t', c.name, c.lks ? h('span.tag.lks', { style: { marginLeft: '6px' } }, 'LKS') : null)));
      }
    };
    drawCars();
    left.append(h('div.panel', h('h3', 'Voitures autorisées'),
      h('div.search', icon('search'), h('input.input', { placeholder: 'Rechercher…', value: carQuery, on: { input: (e) => { carQuery = e.target.value; drawCars(); } } })),
      h('div.mt', carList)));

    const right = h('div.grid',
      h('div.panel', h('h3', 'Partie'),
        h('div.grid',
          field('Nom de la partie', h('input.input', { value: o.name, maxlength: 60, on: { input: (e) => { o.name = e.target.value; } } })),
          range('Places', { min: 2, max: maxSlots, value: o.slots, onInput: (v) => { o.slots = v; summary(); } }),
          seg([['free', 'Libre (drift, balade)'], ['race', 'Course']], o.mode, (v) => { o.mode = v; render(); }),
          o.mode === 'race' ? h('div.grid.grid-2',
            range('Qualifs', { min: 0, max: 60, step: 5, value: o.qualifyMinutes, format: (v) => (v ? `${v} min` : 'Aucune'), onInput: (v) => { o.qualifyMinutes = v; } }),
            range('Course', { min: 1, max: 60, value: o.raceLaps, format: (v) => `${v} tours`, onInput: (v) => { o.raceLaps = v; } })) : null,
          field('Mot de passe', h('div.input-row',
            h('input.input.mono', { value: o.password, on: { input: (e) => { o.password = e.target.value.trim(); } } }),
            h('button.btn.btn-sm', { on: { click: () => { o.password = randomPassword(); render(); } } }, 'Générer'))),
        )),
      h('div.panel', h('h3', 'Conditions'),
        h('div.grid',
          range('Heure', { min: 8, max: 18, step: 0.5, value: o.timeOfDay, format: TIME_FMT, onInput: (v) => { o.timeOfDay = v; } }),
          field('Météo', select((content.weathers || []).map((w) => [w.id, w.name]), o.weather, (v) => { o.weather = v; })),
          range('Dégâts', { min: 0, max: 100, step: 10, value: o.damage, format: (v) => `${v} %`, onInput: (v) => { o.damage = v; } }),
        )),
      h('div.panel', h('h3', 'Réseau'),
        toggle('Ouvrir les ports de ma box automatiquement (UPnP)', o.upnp, (v) => { o.upnp = v; }, 'Pour les joueurs qui ne sont pas chez toi.'),
        toggle('Visible dans la liste publique du jeu', o.lobby, (v) => { o.lobby = v; }, 'Désactivé : seuls ceux qui ont le code peuvent rejoindre.'),
        h('details.mt', h('summary.muted', { style: { cursor: 'pointer' } }, 'Ports (avancé)'),
          h('div.grid.grid-2.mt',
            field('Port jeu (TCP + UDP)', h('input.input', { type: 'number', value: o.ports.tcp, on: { input: (e) => { o.ports = { ...o.ports, tcp: Number(e.target.value), udp: Number(e.target.value) }; } } })),
            field('Port HTTP', h('input.input', { type: 'number', value: o.ports.http, on: { input: (e) => { o.ports = { ...o.ports, http: Number(e.target.value) }; } } })),
          ))),
    );
    body.append(h('div.solo', left, right));
    const sum = h('div.summary-line');
    const summary = () => { sum.textContent = `${o.cars.length} voiture(s) · ${o.slots} places · ${o.mode === 'race' ? 'course' : 'session libre'}${track ? ` · ${(layout || track).name}` : ''}`; };
    summary();
    body.append(h('div.launch-bar', sum,
      h('button.btn', { disabled: busy || !st.serverFound, on: { click: () => start(false) } }, 'Lancer le serveur'),
      h('button.btn.btn-primary.btn-lg', { disabled: busy || !st.serverFound, on: { click: () => start(true) } }, icon('play'), 'Lancer et rejoindre')));
  }

  function renderHelp() {
    body.append(
      h('h2.section', 'Problème de connexion ?'),
      h('div.grid.grid-3',
        h('div.panel', h('h3', '1. Pare-feu Windows'), h('p.muted', { style: { margin: 0 } }, 'Au premier lancement, Windows demande d’autoriser « acServer ». Coche « Réseaux privés » et « Réseaux publics », puis Autoriser.')),
        h('div.panel', h('h3', '2. Ta box'), h('p.muted', { style: { margin: 0 } }, 'Active l’UPnP dans l’interface de ta box (souvent activé par défaut). Avec une IP partagée, la 4G ou la 5G, ça ne suffit pas : passe à l’étape 3.')),
        h('div.panel', h('h3', '3. VPN gratuit'), h('p.muted', { style: { margin: 0 } }, 'Passez par le VPN, ou installez tous ',
          h('a.link', { on: { click: () => api.call('shell:open', 'https://www.radmin-vpn.com/fr/') } }, 'Radmin VPN'), ' ou ',
          h('a.link', { on: { click: () => api.call('shell:open', 'https://www.zerotier.com/download/') } }, 'ZeroTier'),
          ' et rejoignez le même réseau.')),
      ),
    );
  }

  async function start(andJoin) {
    if (!o.cars.length) return toast('Choisis au moins une voiture', 'warn');
    busy = true;
    render();
    try {
      st = await api.call('host:start', { ...o });
      toast('Serveur lancé', 'success');
      if (andJoin) {
        // wait until the server answers, then join it
        for (let i = 0; i < 20; i++) {
          st = await api.call('host:status');
          if (st.info) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (st.info) await joinOwn();
        else toast('Le serveur ne répond pas encore : regarde le journal', 'warn', 7000);
      }
    } catch (err) {
      toast(err.message, 'error', 8000);
    } finally {
      busy = false;
      load();
    }
  }

  async function joinOwn() {
    const s = st.state || {};
    const car = o.cars[0] || (s.cars || [])[0];
    let choice = car;
    if ((s.cars || []).length > 1) {
      choice = await new Promise((resolve) => {
        let picked = null;
        const grid = h('div.car-pick');
        for (const id of s.cars) {
          const c = content.cars.find((x) => x.id === id);
          const skin = c && c.skins.find((k) => k.preview);
          grid.append(h('button.car-opt', { on: { click: () => { picked = id; m.close(); } } }, skin ? h('img', { src: localImg(skin.preview), alt: '' }) : h('div.ph'), h('div.t', c ? c.name : id)));
        }
        const m = modal({ title: 'Ta voiture', body: grid, onClose: () => resolve(picked) });
      });
      if (!choice) return;
    }
    const c = content.cars.find((x) => x.id === choice);
    await guard(() => api.call('game:joinServer', {
      ip: '127.0.0.1', tcpPort: s.ports.tcp, httpPort: s.ports.http, serverName: s.name, track: `${o.track}${o.layout ? `-${o.layout}` : ''}`,
      car: choice, skin: c && c.skins[0] ? c.skins[0].id : '', password: s.password,
    }));
  }

  async function stop() {
    busy = true;
    await guard(() => api.call('host:stop'), 'Serveur arrêté, ports refermés');
    busy = false;
    setTimeout(load, 500);
  }

  let logTimer = null;
  const offs = [
    window.lks.on('host:changed', () => load()),
    window.lks.on('host:log', () => {
      clearTimeout(logTimer);
      logTimer = setTimeout(async () => {
        const logEl = root.querySelector('.log');
        if (!logEl) return;
        const s = await api.call('host:status');
        logEl.textContent = (s.log || []).join('\n');
      }, 400);
    }),
  ];
  const poll = setInterval(() => { if (st && st.running) load(); }, 5000);
  load();
  return () => {
    clearInterval(poll);
    clearTimeout(logTimer);
    offs.forEach((off) => off());
  };
}
