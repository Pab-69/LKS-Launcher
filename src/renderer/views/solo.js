import { api, h, clear, icon, guard, img, localImg, seg, toggle, range, select, field, modal, toast } from '../ui.js';
import { store, subscribe, loadContent, playable } from '../store.js';

const ASSIST_PRESETS = {
  pro: { idealLine: false, autoBlip: false, stabilityControl: 0, autoBrake: false, autoShifter: false, abs: 1, tractionControl: 1, autoClutch: false, visualDamage: true, damage: 100, fuelRate: 1, tyreWear: 1, tyreBlankets: true, slipstream: 1 },
  normal: { idealLine: false, autoBlip: true, stabilityControl: 0, autoBrake: false, autoShifter: false, abs: 1, tractionControl: 1, autoClutch: true, visualDamage: true, damage: 50, fuelRate: 1, tyreWear: 1, tyreBlankets: true, slipstream: 1 },
  easy: { idealLine: true, autoBlip: true, stabilityControl: 50, autoBrake: false, autoShifter: true, abs: 2, tractionControl: 2, autoClutch: true, visualDamage: true, damage: 0, fuelRate: 0, tyreWear: 0, tyreBlankets: true, slipstream: 1 },
};

const TIME_FMT = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}`;

export default function solo(root, params) {
  const saved = store.settings.solo || {};
  const o = { ...saved, ...(params.preset || {}) };
  const assists = { ...store.settings.assists };
  let content = playable(store.content);

  const left = h('div');
  const right = h('div.grid');
  const summaryLine = h('div.summary-line');
  root.append(
    h('div.view-head', h('div', h('h1', 'Solo'), h('p', 'Entraînement, course contre l’IA ou hotlap. Les réglages sont mémorisés.'))),
    h('div.solo', left, right),
    h('div.launch-bar', summaryLine, store.settings.admin && store.settings.admin.hasToken ? h('button.btn', { title: 'Publier cette session pour tout le monde', on: { click: sharePreset } }, 'Partager') : null, h('button.btn.btn-primary.btn-lg', { on: { click: launch } }, icon('play'), 'Lancer')),
  );

  const car = () => content && content.cars.find((c) => c.id === o.car);
  const track = () => content && content.tracks.find((t) => t.id === o.track);
  const layout = () => {
    const t = track();
    return t ? t.layouts.find((l) => l.id === (o.layout || '')) || t.layouts[0] : null;
  };

  function ensureDefaults() {
    if (!content) return;
    const cars = o.lksOnly ? content.cars.filter((c) => c.lks) : content.cars;
    const tracks = o.lksOnly ? content.tracks.filter((t) => t.lks) : content.tracks;
    if (!car()) o.car = (cars.find((c) => c.lks) || cars[0] || {}).id || '';
    if (!track()) o.track = (tracks.find((t) => t.lks) || tracks[0] || {}).id || '';
    const c = car();
    if (c && !c.skins.some((s) => s.id === o.skin)) o.skin = (c.skins[0] || {}).id || '';
    const t = track();
    if (t && t.layouts.length && !t.layouts.some((l) => l.id === o.layout)) o.layout = t.layouts[0].id;
    const weathers = content.weathers || [];
    if (weathers.length && !weathers.some((w) => w.id === o.weather)) o.weather = (weathers.find((w) => w.id === '3_clear') || weathers[0]).id;
  }

  function renderLeft() {
    clear(left);
    if (!content) {
      left.append(h('div.empty', h('span.spinner'), h('p', 'Lecture du contenu…')));
      return;
    }
    if (!content.cars.length) {
      left.append(content.restricted
        ? h('div.empty', h('strong', 'Aucune voiture du groupe installée'), 'Va dans Contenu pour télécharger les voitures et circuits LKS.')
        : h('div.empty', h('strong', 'Aucune voiture trouvée'), "Vérifiez le dossier d'Assetto Corsa dans les Paramètres."));
      return;
    }
    const c = car();
    const t = track();
    const l = layout();
    const skin = c && c.skins.find((s) => s.id === o.skin);

    left.append(
      h('div.picker', { on: { click: () => pickCar() } },
        h('div.picker-media', img(skin && skin.preview ? localImg(skin.preview) : '', '', 'CAR')),
        h('div',
          h('div.picker-k', 'Voiture'),
          h('div.picker-v', c ? c.name : '—'),
          h('div.picker-s', c ? [c.brand, c.carClass, c.specs && c.specs.bhp, c.specs && c.specs.weight].filter(Boolean).join(' · ') : ''),
          c && c.lks ? h('span.tag.lks.mt', 'LKS') : null,
        ),
      ),
    );
    if (c && c.skins.length) {
      const strip = h('div.skins');
      for (const s of c.skins) {
        strip.append(h('button.skin', { class: s.id === o.skin ? 'on' : '', title: s.name, on: { click: () => { o.skin = s.id; renderLeft(); renderSummary(); } } },
          s.preview ? h('img', { src: localImg(s.preview), loading: 'lazy', alt: '' }) : h('div', { style: { aspectRatio: '16/9' } }), h('span', s.name)));
      }
      left.append(strip);
    }
    left.append(
      h('div.picker.mt', { on: { click: () => pickTrack() } },
        h('div.picker-media', l && l.preview ? img(localImg(l.preview)) : l && l.outline ? img(localImg(l.outline), 'outline') : img('', '', 'TRACK')),
        h('div',
          h('div.picker-k', 'Circuit'),
          h('div.picker-v', t ? t.name : '—'),
          h('div.picker-s', l ? [l.name !== (t && t.name) ? l.name : '', l.length, l.pitboxes ? `${l.pitboxes} stands` : ''].filter(Boolean).join(' · ') : ''),
          t && t.lks ? h('span.tag.lks.mt', 'LKS') : null,
        ),
      ),
    );
    if (t && t.layouts.length > 1) {
      left.append(h('div.mt', field('Tracé', select(t.layouts.map((x) => [x.id, x.name]), o.layout, (v) => { o.layout = v; renderLeft(); renderRight(); renderSummary(); }))));
    }
  }

  function renderRight() {
    clear(right);
    const l = layout();
    const maxAi = Math.max(0, ((l && l.pitboxes) || 24) - 1);
    if (o.aiCount > maxAi) o.aiCount = maxAi;

    const session = h('div.panel', h('h3', 'Session'),
      seg([['practice', 'Entraînement'], ['race', 'Course'], ['hotlap', 'Hotlap']], o.mode, (v) => { o.mode = v; renderRight(); renderSummary(); }));
    const sGrid = h('div.grid.mt');
    if (o.mode === 'practice') {
      sGrid.append(range('Durée', { min: 0, max: 180, step: 5, value: o.durationMinutes, format: (v) => (v ? `${v} min` : 'Illimitée'), onInput: (v) => { o.durationMinutes = v; renderSummary(); } }));
      sGrid.append(range('Voitures IA sur la piste', { min: 0, max: maxAi, value: o.aiCount, onInput: (v) => { o.aiCount = v; renderSummary(); } }));
    }
    if (o.mode === 'race') {
      sGrid.append(range('Tours', { min: 1, max: 100, value: o.laps, format: (v) => `${v} tour${v > 1 ? 's' : ''}`, onInput: (v) => { o.laps = v; renderSummary(); } }));
      sGrid.append(range('Adversaires IA', { min: 1, max: Math.max(1, maxAi), value: Math.max(1, o.aiCount), onInput: (v) => { o.aiCount = v; renderSummary(); } }));
      if (!o.aiCount) o.aiCount = 1;
      sGrid.append(field('Position de départ', select([['last', 'Dernier'], ['1', 'Pole position'], ['random', 'Aléatoire']], String(o.startPosition), (v) => { o.startPosition = v; })));
    }
    if (o.mode !== 'hotlap' && (o.mode === 'race' || o.aiCount > 0)) {
      sGrid.append(range('Niveau IA', { min: 70, max: 100, value: o.aiLevel, format: (v) => `${v} %`, onInput: (v) => { o.aiLevel = v; } }));
      sGrid.append(range('Agressivité IA', { min: 0, max: 100, value: o.aiAggression, format: (v) => `${v} %`, onInput: (v) => { o.aiAggression = v; } }));
    }
    session.append(sGrid);

    const cond = h('div.panel', h('h3', 'Conditions'),
      h('div.grid',
        range('Heure', { min: 8, max: 18, step: 0.5, value: o.timeOfDay, format: TIME_FMT, onInput: (v) => { o.timeOfDay = v; renderSummary(); } }),
        field('Météo', select((content ? content.weathers : []).map((w) => [w.id, w.name]), o.weather, (v) => { o.weather = v; })),
        h('div.grid.grid-2',
          range('Air', { min: 0, max: 40, value: o.ambient, format: (v) => `${v} °C`, onInput: (v) => { o.ambient = v; if (o.road < v) o.road = v + 4; } }),
          range('Piste', { min: 0, max: 55, value: o.road, format: (v) => `${v} °C`, onInput: (v) => { o.road = v; } }),
        ),
        field('Grip de la piste', select([['optimum', 'Optimal'], ['fast', 'Rapide'], ['green', 'Verte']], o.trackGrip, (v) => { o.trackGrip = v; })),
        range("Vitesse de l'heure", { min: 1, max: 60, value: o.timeMult || 1, format: (v) => `x${v}`, onInput: (v) => { o.timeMult = v; } }),
      ),
    );

    const ass = h('div.panel', h('h3', 'Aides & réalisme'),
      seg([['pro', 'Pro'], ['normal', 'Normal'], ['easy', 'Débutant'], ['custom', 'Perso']], assists.preset || 'custom', (v) => {
        assists.preset = v;
        if (ASSIST_PRESETS[v]) Object.assign(assists, ASSIST_PRESETS[v]);
        renderRight();
      }));
    const custom = (fn) => (v) => { fn(v); assists.preset = 'custom'; };
    ass.append(
      h('div.grid.grid-2.mt',
        field('ABS', select([['0', 'Off'], ['1', 'Origine'], ['2', 'On']], String(assists.abs), custom((v) => { assists.abs = Number(v); }))),
        field('Antipatinage', select([['0', 'Off'], ['1', 'Origine'], ['2', 'On']], String(assists.tractionControl), custom((v) => { assists.tractionControl = Number(v); }))),
      ),
      h('div.mt'),
      toggle('Trajectoire idéale', assists.idealLine, custom((v) => { assists.idealLine = v; })),
      toggle('Embrayage auto', assists.autoClutch, custom((v) => { assists.autoClutch = v; })),
      toggle('Boîte auto', assists.autoShifter, custom((v) => { assists.autoShifter = v; })),
      toggle('Talon-pointe auto', assists.autoBlip, custom((v) => { assists.autoBlip = v; })),
      toggle('Pneus préchauffés', assists.tyreBlankets, custom((v) => { assists.tyreBlankets = v; })),
      toggle('Pénalités (coupes de piste)', o.penalties === true, (v) => { o.penalties = v; }),
      h('div.grid.mt',
        range('Dégâts', { min: 0, max: 100, step: 10, value: assists.damage, format: (v) => `${v} %`, onInput: custom((v) => { assists.damage = v; }) }),
        range('Consommation', { min: 0, max: 3, step: 1, value: assists.fuelRate, format: (v) => (v ? `x${v}` : 'Off'), onInput: custom((v) => { assists.fuelRate = v; }) }),
        range('Usure pneus', { min: 0, max: 3, step: 1, value: assists.tyreWear, format: (v) => (v ? `x${v}` : 'Off'), onInput: custom((v) => { assists.tyreWear = v; }) }),
      ),
    );
    right.append(session, cond, ass);
  }

  function renderSummary() {
    const c = car();
    const t = track();
    const mode = { practice: 'Entraînement', race: 'Course', hotlap: 'Hotlap' }[o.mode];
    const extra = o.mode === 'race' ? `${o.laps} tours · ${o.aiCount} IA` : o.mode === 'practice' ? `${o.durationMinutes ? `${o.durationMinutes} min` : 'illimité'}${o.aiCount ? ` · ${o.aiCount} IA` : ''}` : '';
    summaryLine.textContent = c && t ? `${mode} — ${c.name} @ ${(layout() || t).name} · ${TIME_FMT(o.timeOfDay)}${extra ? ` · ${extra}` : ''}` : '';
  }

  function pickerModal(title, list, current, onPick, kind) {
    let q = '';
    let lksOnly = Boolean(o.lksOnly);
    const grid = h('div.car-pick');
    const draw = () => {
      clear(grid);
      const s = q.toLowerCase();
      for (const x of list.filter((i) => (!lksOnly || i.lks) && (!s || `${x.name} ${x.id} ${x.brand || ''} ${x.country || ''}`.toLowerCase().includes(s))).slice(0, 300)) {
        const preview = kind === 'car' ? (x.skins.find((k) => k.preview) || {}).preview : x.preview;
        grid.append(h('button.car-opt', { class: x.id === current ? 'on' : '', on: { click: () => { onPick(x.id); m.close(); } } },
          preview ? h('img', { src: localImg(preview), loading: 'lazy', alt: '' }) : h('div.ph'),
          h('div.t', x.name, x.lks ? h('span.tag.lks', { style: { marginLeft: '6px', verticalAlign: 'middle' } }, 'LKS') : null),
          h('div.s', kind === 'car' ? [x.brand, x.carClass].filter(Boolean).join(' · ') || x.id : [x.country, x.layouts.length > 1 ? `${x.layouts.length} tracés` : ''].filter(Boolean).join(' · ') || x.id)));
      }
    };
    const m = modal({
      title,
      body: h('div',
        h('div.toolbar',
          h('div.search', { style: { flex: 1 } }, icon('search'), h('input.input', { placeholder: 'Rechercher…', autofocus: true, on: { input: (e) => { q = e.target.value; draw(); } } })),
          content.restricted ? h('span.hint', 'Contenu du groupe uniquement') : h('label.row', h('input', { type: 'checkbox', checked: lksOnly, on: { change: (e) => { lksOnly = e.target.checked; o.lksOnly = lksOnly; draw(); } } }), 'LKS uniquement'),
        ),
        grid),
    });
    draw();
    setTimeout(() => m.box.querySelector('input.input').focus(), 30);
  }

  function pickCar() {
    pickerModal('Choisir une voiture', content.cars, o.car, (id) => { o.car = id; o.skin = ''; ensureDefaults(); renderLeft(); renderSummary(); }, 'car');
  }
  function pickTrack() {
    pickerModal('Choisir un circuit', content.tracks, o.track, (id) => { o.track = id; o.layout = ''; ensureDefaults(); renderLeft(); renderRight(); renderSummary(); }, 'track');
  }

  async function sharePreset() {
    if (!car() || !track()) return toast('Choisissez une voiture et un circuit', 'warn');
    let name = `${(layout() || track()).name} — ${{ practice: 'Entraînement', race: 'Course', hotlap: 'Hotlap' }[o.mode]}`;
    let description = '';
    const ok = await new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: 'Partager la session',
        small: true,
        body: h('div.grid',
          h('p.muted', { style: { margin: 0 } }, 'Elle apparaîtra sur l’accueil de tout le monde.'),
          field('Nom', h('input.input', { value: name, on: { input: (e) => { name = e.target.value; } } })),
          field('Description (optionnel)', h('input.input', { placeholder: 'ex : drift de nuit, pneus usés…', on: { input: (e) => { description = e.target.value; } } })),
        ),
        foot: [h('button.btn.btn-ghost', { on: { click: () => m.close() } }, 'Annuler'), h('button.btn.btn-primary', { on: { click: () => { done = true; m.close(); } } }, 'Publier')],
        onClose: () => resolve(done),
      });
    });
    if (!ok || !name.trim()) return;
    const keys = ['mode', 'car', 'skin', 'track', 'layout', 'durationMinutes', 'laps', 'aiCount', 'aiLevel', 'aiAggression', 'startPosition', 'timeOfDay', 'timeMult', 'weather', 'ambient', 'road', 'trackGrip', 'penalties'];
    const settings = Object.fromEntries(keys.map((k) => [k, o[k]]));
    const manifest = await guard(() => api.call('sync:manifest'));
    if (!manifest) return;
    const soloPresets = [...(manifest.soloPresets || []), { id: `p${Date.now().toString(36)}`, name: name.trim(), description: description.trim(), settings }];
    await guard(() => api.call('admin:updateMeta', { soloPresets }), 'Session partagée');
  }

  async function launch() {
    if (!car() || !track()) return toast('Choisissez une voiture et un circuit', 'warn');
    if (o.mode === 'race' && !o.aiCount) o.aiCount = 1;
    await guard(() => api.call('game:launchSolo', { ...o, assists }));
  }

  function renderAll() {
    ensureDefaults();
    renderLeft();
    renderRight();
    renderSummary();
  }

  renderAll();
  if (!content) loadContent().then((c) => { content = playable(c); renderAll(); }).catch((e) => toast(e.message, 'error'));
  return subscribe((patch) => {
    if ('content' in patch && patch.content) {
      content = playable(patch.content);
      renderAll();
    }
  });
}
