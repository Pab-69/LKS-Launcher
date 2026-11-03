import { api, h, clear, icon, guard, img, localImg, field, modal, toast, confirmBox } from '../ui.js';
import { store, saveSettings, loadContent } from '../store.js';
import { vpnCard } from './vpnCard.js';

const SESSION_NAMES = { 0: 'Réservation', 1: 'Essais', 2: 'Qualif', 3: 'Course' };

export default function servers(root, params, { go }) {
  let list = [];
  const infos = new Map();
  let selected = params.select || null;
  let carChoice = null;
  let password = '';

  const listBox = h('div');
  const MSG_EMPTY = 'Aucune partie en cours. Lance-en une dans Héberger : elle apparaît ici pour tout le groupe.';
  const detail = h('div');
  root.append(
    h('div.view-head',
      h('div', h('h1', 'Serveurs'), h('p', 'Les parties lancées depuis le launcher, les serveurs du groupe et les tiens.')),
      h('div.grow'),
      h('div.actions',
        h('button.btn.btn-primary', { on: { click: joinWithCode } }, icon('play'), 'Rejoindre avec un code'),
        h('button.btn', { on: { click: addServer } }, icon('plus'), 'Ajouter un serveur'),
        h('button.btn', { on: { click: () => refresh(true) } }, icon('refresh'), 'Actualiser'),
      ),
    ),
    listBox,
    detail,
  );

  async function load() {
    list = (await guard(() => api.call('servers:list'))) || [];
    // server of a friend (from « En ligne maintenant ») that is not in the list
    if (params.server && params.select && !list.some((s) => s.key === params.select)) list.push({ ...params.server, key: params.select, source: 'custom' });
    if (!selected && list.length) selected = list[0].key;
    renderList();
    await refresh(false, false);
  }

  async function refresh(manual, reload = true) {
    if (reload) {
      // games hosted from the launcher come and go
      const fresh = await api.call('servers:list').catch(() => null);
      if (fresh) {
        const extra = list.filter((s) => params.server && s.key === params.select && !fresh.some((f) => f.key === s.key));
        list = [...fresh, ...extra];
      }
    }
    await Promise.all(list.map(async (s) => {
      infos.set(s.key, await api.call('servers:info', s));
    }));
    renderList();
    if (manual || !detail.firstChild) renderDetail();
  }

  function renderList() {
    clear(listBox);
    if (!list.length) {
      listBox.append(h('div.empty', h('strong', 'Aucun serveur'), MSG_EMPTY));
      return;
    }
    for (const s of list) {
      const info = infos.get(s.key);
      listBox.append(
        h('div.server-row', { class: s.key === selected ? 'selected' : '', on: { click: () => { selected = s.key; carChoice = null; renderList(); renderDetail(); } } },
          h(`span.dot.${info ? (info.online ? 'on' : 'off') : ''}`),
          h('div',
            h('div.server-name', info && info.online ? info.name : s.name, ' ', s.source === 'lks' ? h('span.tag.lks', { style: { verticalAlign: 'middle' } }, 'LKS') : null, s.source === 'launcher' ? h('span.tag.lks', { style: { verticalAlign: 'middle' } }, s.mine ? 'Ta partie' : 'Partie LKS') : null, info && info.hasPassword ? h('span.muted', { title: 'Mot de passe' }, ' 🔒') : null),
            h('div.server-sub', s.description || `${s.ip}:${s.httpPort}`),
          ),
          h('div.server-sub', info && info.online ? `${trackLabel(info.track)} · ${info.cars.length} voiture(s)` : info ? 'Hors ligne' : 'Interrogation…'),
          h('div.players', info && info.online ? [String(info.clients), h('small', `/${info.maxClients}`)] : '—'),
          h('div.ping', info && info.online ? `${info.ping} ms` : ''),
          h('div', s.source === 'custom' ? h('button.btn.btn-ghost.btn-sm.btn-danger', { title: 'Retirer', on: { click: (e) => { e.stopPropagation(); removeServer(s); } } }, icon('trash')) : null),
        ),
      );
    }
  }

  function trackLabel(t) {
    const content = store.content;
    const id = String(t || '').split('/').pop();
    const local = content && content.tracks.find((x) => id === x.id || id.startsWith(`${x.id}-`));
    return local ? local.name : id;
  }

  async function renderDetail() {
    clear(detail);
    const server = list.find((s) => s.key === selected);
    if (!server) return;
    const info = infos.get(server.key);
    if (!info) return;
    if (!info.online) {
      if (info.hosted) {
        detail.append(h('div.notice.bad.mt', `Partie injoignable : ${info.error}.`), h('div.mt', vpnCard({ highlight: true })));
        return;
      }
      detail.append(h('div.notice.bad.mt', `Serveur injoignable (${info.error || 'hors ligne'}). Vérifiez l'IP et le port HTTP (souvent 8081).`));
      return;
    }
    const content = await loadContent(true);
    const check = await guard(() => api.call('servers:checkContent', info));
    const left = h('div.panel');
    const right = h('div.panel');
    detail.append(h('div.server-detail', left, right));

    // ---------- content check + car choice
    left.append(h('h3', 'Choisir sa voiture'));
    if (check && (check.installable.length || check.outdated.length)) {
      const targets = [...check.installable, ...check.outdated.map((o) => ({ kind: o.kind, id: o.id }))];
      left.append(h('div.notice.info',
        h('span.grow', `${targets.length} élément(s) LKS à installer ou mettre à jour pour ce serveur.`),
        h('button.btn.btn-primary.btn-sm', { on: { click: () => guard(() => api.call('sync:start', targets), 'Téléchargement lancé') } }, icon('download'), 'Installer')));
    }
    if (check && check.notAvailable.length) {
      left.append(h('div.notice.bad', `Contenu manquant non fourni par LKS : ${check.notAvailable.join(', ')}`));
    }

    let entries = [];
    try {
      entries = await api.call('servers:cars', { ...server, ip: info.ip, httpPort: info.httpPort });
    } catch {
      entries = info.cars.map((m) => ({ model: m, skin: '', connected: false }));
    }
    const models = [...new Set([...info.cars, ...entries.map((e) => e.model)])];
    const grid = h('div.car-pick');
    for (const model of models) {
      const slots = entries.filter((e) => e.model === model);
      const free = slots.filter((e) => !e.connected);
      const local = content.cars.find((c) => c.id === model);
      const firstFree = free[0] || slots[0] || { skin: '' };
      const skin = local && (local.skins.find((s) => s.id === firstFree.skin) || local.skins[0]);
      const disabled = !local || (slots.length > 0 && free.length === 0);
      if (!carChoice && !disabled) carChoice = { model, skin: firstFree.skin || (skin && skin.id) || '' };
      grid.append(h('button.car-opt', {
        class: carChoice && carChoice.model === model ? 'on' : '',
        disabled,
        on: { click: () => { carChoice = { model, skin: firstFree.skin || (skin && skin.id) || '' }; grid.querySelectorAll('.car-opt').forEach((b) => b.classList.remove('on')); grid.children[models.indexOf(model)].classList.add('on'); } },
      },
      skin && skin.preview ? h('img', { src: localImg(skin.preview), loading: 'lazy', alt: '' }) : h('div.ph'),
      h('div.t', local ? local.name : model),
      h('div.s', !local ? 'Non installée' : slots.length ? `${free.length}/${slots.length} place(s) libre(s)` : 'Disponible')));
    }
    left.append(grid);

    // ---------- server info + join
    const drivers = entries.filter((e) => e.connected && e.driver).map((e) => e.driver);
    right.append(
      h('h3', info.name),
      h('div.grid',
        kv('Circuit', trackLabel(info.track)),
        kv('Session', `${SESSION_NAMES[info.session] || '—'}${info.timeLeft ? ` · ${Math.round(info.timeLeft / 60)} min restantes` : ''}`),
        kv('Pilotes', `${info.clients} / ${info.maxClients}`),
        drivers.length ? kv('En piste', drivers.join(', ')) : null,
        kv('Adresse', `${info.ip}:${info.tcpPort}`),
      ),
    );
    if (info.hasPassword) {
      password = server.password || password;
      right.append(h('div.mt', field('Mot de passe', h('input.input', { type: 'password', value: password, on: { input: (e) => { password = e.target.value; } } }))));
    }
    const ready = check && !check.trackMissing && check.outdated.length === 0;
    right.append(...[
      h('button.btn.btn-primary.btn-lg.mt', { style: { width: '100%' }, disabled: store.summary && store.summary.running, on: { click: () => join(server, info, check) } }, icon('play'), 'Rejoindre'),
      !ready && check ? h('div.hint.mt', check.trackMissing ? 'Le circuit doit être installé avant de rejoindre.' : 'Mettez à jour le contenu avant de rejoindre (sinon le serveur refusera la connexion).') : null,
    ].filter(Boolean));
  }

  function kv(k, v) {
    return h('div', h('div.label', k), h('div', { style: { fontSize: '15px' } }, v));
  }

  async function join(server, info, check) {
    if (!store.settings.driverName) {
      toast('Renseignez votre nom de pilote dans les Paramètres', 'warn');
      return go('settings');
    }
    if (!carChoice) return toast('Choisissez une voiture disponible', 'warn');
    if (check && check.outdated.length) {
      const ok = await confirmBox('Contenu pas à jour', 'Certains éléments ne sont pas à jour : le serveur risque de refuser la connexion (checksum). Rejoindre quand même ?', 'Rejoindre');
      if (!ok) return;
    }
    await guard(() => api.call('game:joinServer', {
      ip: info.ip,
      tcpPort: info.tcpPort,
      httpPort: info.httpPort,
      serverName: info.name,
      track: info.track,
      car: carChoice.model,
      skin: carChoice.skin,
      password,
    }));
  }

  function joinWithCode() {
    let code = '';
    const m = modal({
      title: 'Rejoindre avec un code',
      small: true,
      body: h('div.grid',
        h('p.muted', { style: { margin: 0 } }, 'Colle le code « LKS-… » reçu.'),
        h('input.input.mono', { placeholder: 'LKS-…', autofocus: true, on: { input: (e) => { code = e.target.value; } } })),
      foot: [h('button.btn.btn-primary', { on: { click: async () => {
        let inv;
        try {
          inv = await api.call('host:decodeInvite', code);
        } catch (err) {
          return toast(err.message, 'warn');
        }
        // keep the private game in the list (with its password) so it is easy to come back
        const customServers = (store.settings.customServers || []).filter((x) => !(x.ip === inv.address && Number(x.httpPort) === inv.httpPort));
        customServers.push({ name: inv.name, ip: inv.address, httpPort: inv.httpPort, password: inv.password, private: true });
        await saveSettings({ customServers });
        m.close();
        // VPN code: make sure this member is on the VPN too
        if (inv.kind === 'zerotier' || inv.kind === 'radmin') {
          const vs = await api.call('vpn:status').catch(() => null);
          if (vs && vs.configured && vs.provider === inv.kind && !vs.connected) {
            modal({
              title: 'Connecte-toi au VPN',
              small: true,
              body: h('div.grid',
                h('p.muted', { style: { margin: 0 } }, 'Ce code passe par le VPN. Connecte-toi, puis clique sur Rejoindre.'),
                vpnCard({ highlight: true })),
            });
          }
        }
        selected = `${inv.address}:${inv.httpPort}`;
        password = inv.password;
        carChoice = null;
        clear(detail); // show the private game, not the previously selected server
        load();
      } } }, 'Rejoindre')],
    });
    setTimeout(() => { const i = m.box.querySelector('input'); if (i) i.focus(); }, 30);
  }

  function addServer() {
    const data = { name: '', ip: '', httpPort: 8081 };
    const m = modal({
      title: 'Ajouter un serveur',
      small: true,
      body: h('div.grid',
        field('Nom', h('input.input', { placeholder: 'Mon serveur', on: { input: (e) => { data.name = e.target.value; } } })),
        field('Adresse IP ou nom d’hôte', h('input.input', { placeholder: '123.45.67.89', on: { input: (e) => { data.ip = e.target.value.trim(); } } })),
        field('Port HTTP', h('input.input', { type: 'number', value: 8081, on: { input: (e) => { data.httpPort = Number(e.target.value); } } }), 'Le port HTTP du serveur (HTTP_PORT dans server_cfg.ini), souvent 8081.'),
      ),
      foot: [h('button.btn.btn-primary', { on: { click: async () => {
        if (!data.ip) return toast('Adresse requise', 'warn');
        const customServers = [...(store.settings.customServers || []), { name: data.name || data.ip, ip: data.ip, httpPort: data.httpPort || 8081 }];
        await saveSettings({ customServers });
        m.close();
        selected = `${data.ip}:${data.httpPort || 8081}`;
        clear(detail);
        load();
      } } }, 'Ajouter')],
    });
  }

  async function removeServer(s) {
    const customServers = (store.settings.customServers || []).filter((x) => !(x.ip === s.ip && Number(x.httpPort) === Number(s.httpPort)));
    await saveSettings({ customServers });
    load();
  }

  load();
  const timer = setInterval(() => refresh(false), 20000);
  return () => clearInterval(timer);
}
