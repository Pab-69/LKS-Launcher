import { api, h, clear, icon, bytes, guard, dateFr, toast, field, select, confirmBox, modal } from '../ui.js';
import { store } from '../store.js';

/** Ask for a short text (Electron has no window.prompt). Resolves null when cancelled. */
function askText(title, label) {
  return new Promise((resolve) => {
    let value = '';
    let done = false;
    const m = modal({
      title,
      small: true,
      body: field(label, h('input.input', { maxlength: 300, on: { input: (e) => { value = e.target.value; } } })),
      foot: [
        h('button.btn.btn-ghost', { on: { click: () => m.close() } }, 'Annuler'),
        h('button.btn.btn-primary', { on: { click: () => { done = true; m.close(); resolve(value.trim()); } } }, 'Valider'),
      ],
      onClose: () => {
        if (!done) resolve(null);
      },
    });
  });
}

const isAdmin = () => Boolean(store.settings && store.settings.admin && store.settings.admin.verified);
const KIND_LABEL = { car: 'Voiture', skin: 'Livrée', setup: 'Setups' };
const STATUS = { pending: ['En attente', 'plain'], accepted: ['Acceptée', 'ok'], refused: ['Refusée', 'bad'] };

/**
 * Members propose a car, a livery or setups; the admins test them and accept
 * or refuse them. Rendered inside the Contenu view (onglet « Propositions »).
 */
export function renderProposals(box) {
  const form = h('div.panel');
  const list = h('div');
  box.append(form, h('h2.section', 'Propositions du groupe'), list);
  const draft = { kind: 'skin', car: '', skin: '', track: '', title: '', message: '', link: '' };
  let sources = null;

  async function load() {
    sources = await guard(() => api.call('proposals:sources'));
    drawForm();
    drawList();
  }

  function drawForm() {
    clear(form);
    form.append(h('h3', 'Proposer au groupe'));
    if (!sources) return;
    if (!sources.configured) {
      form.append(h('p.muted', { style: { margin: 0 } }, 'Les propositions ne sont pas encore activées : les admins doivent configurer le classement partagé (Publication → Classement).'));
      return;
    }
    const kindSel = select([['skin', 'Une livrée pour une voiture du groupe'], ['car', 'Une voiture'], ['setup', 'Mes setups pour une voiture']], draft.kind, (v) => { Object.assign(draft, { kind: v, car: '', skin: '' }); drawForm(); });
    const rows = [field('Quoi', kindSel)];
    if (draft.kind === 'car') {
      if (!sources.cars.length) rows.push(h('p.hint', 'Aucune voiture hors du groupe dans ton dossier Assetto Corsa. Installe-la d’abord (content/cars), puis reviens ici.'));
      else rows.push(field('Voiture', select([['', '— choisir —'], ...sources.cars.map((c) => [c.id, `${c.name} (${c.id})`])], draft.car, (v) => { draft.car = v; draft.title = draft.title || (sources.cars.find((c) => c.id === v) || {}).name || ''; drawForm(); })));
    } else if (draft.kind === 'skin') {
      rows.push(field('Voiture', select([['', '— choisir —'], ...sources.skins.map((c) => [c.car, c.name])], draft.car, (v) => { Object.assign(draft, { car: v, skin: '' }); drawForm(); })));
      const car = sources.skins.find((c) => c.car === draft.car);
      if (car) rows.push(field('Livrée', select([['', '— choisir —'], ...car.skins.map((k) => [k.id, k.name === k.id ? k.id : `${k.name} (${k.id})`])], draft.skin, (v) => { draft.skin = v; draft.title = draft.title || `Livrée ${(car.skins.find((k) => k.id === v) || {}).name || v}`; drawForm(); }), 'Le dossier de ta livrée dans content/cars/<voiture>/skins.'));
    } else {
      if (!sources.setups.length) rows.push(h('p.hint', 'Aucun setup à toi dans Documents/Assetto Corsa/setups.'));
      else rows.push(field('Voiture', select([['', '— choisir —'], ...sources.setups.map((c) => [c.car, `${c.name} (${c.count} setup${c.count > 1 ? 's' : ''})`])], draft.car, (v) => { draft.car = v; draft.title = draft.title || `Setups ${(sources.setups.find((c) => c.car === v) || {}).name || v}`; drawForm(); })));
    }
    rows.push(
      field('Titre', h('input.input', { value: draft.title, maxlength: 80, on: { input: (e) => { draft.title = e.target.value; } } })),
      field('Message aux admins', h('input.input', { value: draft.message, maxlength: 600, placeholder: 'pourquoi elle irait bien au groupe, d’où elle vient…', on: { input: (e) => { draft.message = e.target.value; } } })),
      field('Lien de téléchargement (seulement si c’est trop gros)', h('input.input.mono', { value: draft.link, placeholder: 'https://drive.google.com/… (laisser vide pour envoyer le fichier)', on: { input: (e) => { draft.link = e.target.value.trim(); } } }), `Sans lien, le launcher envoie le dossier directement (${bytes(sources.maxUpload)} max).`),
    );
    const send = h('button.btn.btn-primary', { on: { click: async () => {
      if (!draft.car || (draft.kind === 'skin' && !draft.skin)) return toast('Choisis ce que tu proposes', 'warn');
      if (!draft.title.trim()) return toast('Donne un titre', 'warn');
      if (draft.link && !/^https:\/\/\S{4,}$/.test(draft.link)) return toast('Le lien doit commencer par https://', 'warn');
      send.disabled = true;
      send.textContent = draft.link ? 'Envoi…' : 'Préparation et envoi du dossier…';
      const id = await guard(() => api.call('proposals:submit', { ...draft, title: draft.title.trim() }), 'Proposition envoyée aux admins');
      send.disabled = false;
      send.textContent = 'Envoyer';
      if (id) {
        Object.assign(draft, { car: '', skin: '', title: '', message: '', link: '' });
        drawForm();
        drawList();
      }
    } } }, icon('upload'), 'Envoyer');
    form.append(h('div.grid.grid-2', ...rows), h('div.row.mt', h('span.hint', 'Les admins la testent, puis l’acceptent (elle arrive chez tout le monde) ou la refusent. Tu vois la réponse ici.'), h('div.right', send)));
  }

  async function drawList() {
    clear(list);
    const res = await api.call('proposals:list').catch((err) => ({ error: err.message, items: [] }));
    if (res.error) list.append(h('div.notice', `Propositions indisponibles : ${res.error}`));
    if (!res.items.length) {
      list.append(h('div.empty', h('strong', 'Aucune proposition'), 'Propose une livrée, une voiture ou tes setups au groupe.'));
      return;
    }
    const wrap = h('div.list');
    for (const p of res.items) {
      const [label, cls] = STATUS[p.decision.status] || STATUS.pending;
      const admin = isAdmin() ? adminActions(p) : null;
      wrap.append(h('div.list-row.proposal-row',
        h('div',
          h('div.t', `${KIND_LABEL[p.kind] || p.kind} · ${p.title}`, p.mine ? h('span.tag.plain', { style: { marginLeft: '6px' } }, 'à toi') : ''),
          h('div.s', `${p.author} · ${dateFr(p.date)} · ${p.car}${p.skin ? ` / ${p.skin}` : ''}${p.direct ? ` · ${bytes(p.size)}` : ' · lien'}`),
          p.message ? h('div.s', `« ${p.message} »`) : '',
          p.decision.note ? h('div.s', `Réponse des admins : ${p.decision.note}`) : '',
        ),
        h('div.row', voteBox(p), h(`span.tag.${cls}`, label), admin || '')));
    }
    list.append(wrap);
  }

  /** Members' votes: one per launcher, click again to take it back. */
  function voteBox(p) {
    const vote = async (value) => {
      if (await guard(() => api.call('proposals:vote', { id: p.id, value: p.myVote === value ? 0 : value }))) drawList();
    };
    return h('div.vote-box',
      h(`button.btn.btn-sm${p.myVote === 1 ? '.btn-primary' : ''}`, { title: 'Pour', on: { click: () => vote(1) } }, `👍 ${p.up || 0}`),
      h(`button.btn.btn-sm${p.myVote === -1 ? '.btn-primary' : ''}`, { title: 'Contre', on: { click: () => vote(-1) } }, `👎 ${p.down || 0}`));
  }

  function adminActions(p) {
    const box = h('div.row');
    const decide = async (status, publish) => {
      let note = '';
      if (status === 'refused') {
        note = await askText('Refuser la proposition', 'Raison (le membre la verra)');
        if (note === null) return;
      }
      const r = await guard(() => api.call('admin:proposalDecide', { id: p.id, status, note, publish }), status === 'accepted' ? (publish ? 'Acceptée et publiée' : 'Acceptée') : status === 'refused' ? 'Refusée' : 'Remise en attente');
      if (r) drawList();
    };
    if (p.direct) box.append(h('button.btn.btn-sm', { title: 'Télécharge et installe sur ce PC pour la tester en jeu', on: { click: async () => { const where = await guard(() => api.call('admin:proposalInstall', p.id)); if (where) toast(`Installée pour test : ${where}`, 'success', 7000); } } }, icon('download'), 'Tester'));
    else box.append(h('button.btn.btn-sm', { on: { click: () => api.call('shell:open', p.link) } }, 'Ouvrir le lien'));
    if (p.decision.status !== 'accepted') {
      box.append(h('button.btn.btn-sm.btn-primary', { title: p.kind === 'setup' ? 'Publie les setups de cette voiture' : 'Publie la voiture (avec la livrée) pour tout le groupe', on: { click: async () => {
        if (await confirmBox('Accepter', `Accepter « ${p.title} » et la publier pour tout le groupe ? Il faut l’avoir installée (Tester).`, 'Accepter et publier')) decide('accepted', true);
      } } }, 'Accepter'));
    }
    if (p.decision.status !== 'refused') box.append(h('button.btn.btn-sm.btn-ghost', { on: { click: () => decide('refused', false) } }, 'Refuser'));
    if (p.decision.status !== 'pending') box.append(h('button.btn.btn-sm.btn-ghost', { title: 'Remettre en attente', on: { click: () => decide('pending', false) } }, icon('refresh')));
    return box;
  }

  load();
}
