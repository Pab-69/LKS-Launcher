import { api, h, clear, icon, guard, toast, seg, select, field, toggle, lapTime, dateFr, confirmBox } from '../ui.js';
import { store } from '../store.js';

// state kept while switching tabs
let tab = 'live';
let compare = { a: null, b: null };
let boardQuery = { track: '', layout: '', car: '', kind: 'time' };

const COLORS = { a: '#e01b3a', b: '#ece5da', grid: '#261e22', text: '#6c615c' };
const COL = { d: 0, t: 1, speed: 2, gas: 3, brake: 4, gear: 5, rpm: 6, steer: 7, angle: 8, x: 9, z: 10 };

const fmtDelta = (ms) => (ms == null ? '—' : `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(2)}`);
const comboLabel = (l) => [trackName(l.track, l.layout), carName(l.car)].join(' · ');

function carName(id) {
  const c = store.content && store.content.cars.find((x) => x.id === id);
  return c ? c.name : id;
}
function trackName(id, layout) {
  const t = store.content && store.content.tracks.find((x) => x.id === id);
  if (!t) return layout ? `${id} (${layout})` : id;
  const l = t.layouts.find((x) => x.id === (layout || ''));
  return l && l.name !== t.name ? l.name : t.name;
}

/** Time at distance d (linear interpolation on the lap samples). */
function timeAt(samples, d) {
  if (!samples.length) return null;
  let lo = 0;
  let hi = samples.length - 1;
  if (d <= samples[0][0]) return samples[0][1];
  if (d >= samples[hi][0]) return samples[hi][1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid][0] <= d) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  return a[1] + ((b[1] - a[1]) * (d - a[0])) / (b[0] - a[0] || 1);
}

function valueAt(samples, d, col) {
  let best = samples[0];
  for (const s of samples) {
    if (s[0] > d) break;
    best = s;
  }
  return best ? best[col] : null;
}

// ---------------------------------------------------------------- charts (canvas)
const charts = new Set();
let cursorD = null;

function chart({ height = 130, series, yMin, yMax, label, unit = '', zero = false }) {
  const wrap = h('div.chart', h('div.chart-label', label));
  const canvas = h('canvas');
  const readout = h('div.chart-readout');
  wrap.append(canvas, readout);
  const state = { canvas, readout, series, yMin, yMax, unit, zero, height };
  const draw = () => {
    const w = wrap.clientWidth || 600;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, height);
    const lo = state.yMin;
    const hi = state.yMax;
    const y = (v) => height - 6 - ((v - lo) / (hi - lo || 1)) * (height - 12);
    g.strokeStyle = COLORS.grid;
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const yy = 6 + ((height - 12) * i) / 4;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(w, yy);
      g.stroke();
    }
    if (zero && lo < 0 && hi > 0) {
      g.strokeStyle = '#3a2d33';
      g.beginPath();
      g.moveTo(0, y(0));
      g.lineTo(w, y(0));
      g.stroke();
    }
    for (const s of state.series) {
      g.strokeStyle = s.color;
      g.lineWidth = s.width || 1.6;
      g.setLineDash(s.dash || []);
      g.beginPath();
      s.points.forEach(([d, v], i) => (i ? g.lineTo(d * w, y(v)) : g.moveTo(d * w, y(v))));
      g.stroke();
    }
    g.setLineDash([]);
    if (cursorD != null) {
      g.strokeStyle = 'rgba(236,229,218,0.5)';
      g.beginPath();
      g.moveTo(cursorD * w, 0);
      g.lineTo(cursorD * w, height);
      g.stroke();
      readout.textContent = state.series.map((s) => `${s.name} ${s.at ? s.at(cursorD) : ''}`).join('   ');
    } else readout.textContent = '';
  };
  state.draw = draw;
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    cursorD = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    charts.forEach((c) => c.draw());
  });
  canvas.addEventListener('mouseleave', () => {
    cursorD = null;
    charts.forEach((c) => c.draw());
  });
  charts.add(state);
  requestAnimationFrame(draw);
  return wrap;
}

function trackMap(laps, { height = 260, live } = {}) {
  const canvas = h('canvas.map');
  const draw = (pos) => {
    const all = laps.flatMap((l) => l.samples.map((s) => [s[COL.x], s[COL.z]]));
    if (!all.length) return;
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : 300;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const xs = all.map((p) => p[0]);
    const zs = all.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const k = Math.min((w - 20) / (maxX - minX || 1), (height - 20) / (maxZ - minZ || 1));
    const px = (x) => 10 + (x - minX) * k + (w - 20 - (maxX - minX) * k) / 2;
    const pz = (z) => 10 + (maxZ - z) * k;
    laps.forEach((l, i) => {
      g.strokeStyle = i === 0 ? COLORS.a : COLORS.b;
      g.lineWidth = i === 0 ? 3 : 1.5;
      g.beginPath();
      l.samples.forEach((s, j) => (j ? g.lineTo(px(s[COL.x]), pz(s[COL.z])) : g.moveTo(px(s[COL.x]), pz(s[COL.z]))));
      g.stroke();
    });
    const dot = (x, z, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(px(x), pz(z), 6, 0, Math.PI * 2);
      g.fill();
    };
    if (pos) dot(pos.x, pos.z, '#fff');
    else if (cursorD != null) {
      laps.forEach((l, i) => {
        const s = l.samples.find((x) => x[0] >= cursorD) || l.samples[l.samples.length - 1];
        dot(s[COL.x], s[COL.z], i === 0 ? COLORS.a : COLORS.b);
      });
    }
  };
  canvas.redraw = draw;
  if (!live) charts.add({ draw: () => draw() });
  requestAnimationFrame(() => draw());
  return canvas;
}

// ---------------------------------------------------------------- view
export default function telemetryView(root, params = {}) {
  if (params.tab) tab = params.tab;
  const body = h('div');
  const tabsEl = h('div.toolbar');
  root.append(
    h('div.view-head', h('div', h('h1', 'Télémétrie'), h('p', 'Tes tours, ton classement et la comparaison entre pilotes.'))),
    tabsEl,
    body,
  );
  let liveOff = null;

  function renderTabs() {
    clear(tabsEl);
    tabsEl.append(seg([['live', 'En direct'], ['laps', 'Tours'], ['board', 'Classement'], ['compare', 'Comparer'], ['tools', 'Outils']], tab, (v) => { tab = v; render(); }));
  }

  function render() {
    charts.clear();
    if (liveOff) {
      liveOff();
      liveOff = null;
    }
    clear(body);
    renderTabs();
    ({ live: renderLive, laps: renderLaps, board: renderBoard, compare: renderCompare, tools: renderTools })[tab]();
  }

  // ------------------------------------------------------------ live
  async function renderLive() {
    const st = await guard(() => api.call('telemetry:status'));
    if (st && st.enabled === false) {
      body.append(h('div.notice', h('span.grow', 'La télémétrie est désactivée.'), h('button.btn.btn-sm', { on: { click: () => { tab = 'tools'; render(); } } }, 'Réglages')));
      return;
    }
    if (st && st.error) body.append(h('div.notice', st.error));
    const waiting = h('div.empty', h('strong', 'En attente du jeu'), 'Lance une session : les données s’affichent ici.');
    const panel = h('div.live', { hidden: true });
    const el = {};
    const tile = (k, label, cls = '') => h(`div.live-tile${cls}`, h('div.label', label), (el[k] = h('div.live-v', '—')));
    const bar = (k, cls) => h('div.live-bar', (el[k] = h(`i.${cls}`)));
    let map = null;
    let mapLap = null;
    panel.append(
      h('div.live-grid',
        tile('speed', 'Vitesse', '.big'), tile('gear', 'Rapport', '.big'), tile('angle', 'Angle', '.big'), tile('delta', 'Écart', '.big'),
        h('div.live-tile.wide', h('div.label', 'Régime'), bar('rpm', 'rpm'), h('div.label.mt', 'Gaz'), bar('gas', 'gas'), h('div.label.mt', 'Frein'), bar('brake', 'brake')),
        h('div.live-tile.wide', h('div.label', 'Tour'), (el.lap = h('div.live-v', '—')), h('div.hint', 'Dernier ', (el.last = h('strong', '—')), ' · Meilleur ', (el.best = h('strong', '—')), ' · Score ', (el.score = h('strong', '0')))),
        h('div.live-tile.wide', h('div.label', 'Pneus (°C)'), (el.tyres = h('div.live-tyres'))),
        h('div.live-tile.wide', h('div.label', 'Session'), (el.session = h('div.hint', '—'))),
      ),
      (el.mapWrap = h('div.panel.mt')),
    );
    body.append(waiting, panel);
    const update = async (s) => {
      const on = s && s.status === 2;
      waiting.hidden = on;
      panel.hidden = !on;
      if (!on) return;
      el.speed.textContent = Math.round(s.speed);
      el.gear.textContent = s.gear;
      el.angle.textContent = `${Math.round(s.angle)}°`;
      el.delta.textContent = fmtDelta(s.delta);
      el.delta.className = `live-v ${s.delta == null ? '' : s.delta <= 0 ? 'pos' : 'neg'}`;
      el.rpm.style.width = `${s.maxRpm ? Math.min(100, (s.rpm / s.maxRpm) * 100) : 0}%`;
      el.gas.style.width = `${s.gas * 100}%`;
      el.brake.style.width = `${s.brake * 100}%`;
      el.lap.textContent = lapTime(s.lapMs);
      el.last.textContent = lapTime(s.lastMs);
      el.best.textContent = lapTime(s.bestMs);
      el.score.textContent = s.lapScore;
      el.tyres.textContent = (s.tyreTemps || []).map((t) => Math.round(t)).join('  ·  ');
      el.session.textContent = `${carName(s.car)} · ${trackName(s.track, s.layout)} · tour ${s.laps + 1}`;
      // map from the best lap on this car/track
      const key = `${s.car}|${s.track}|${s.layout}`;
      if (mapLap !== key) {
        mapLap = key;
        clear(el.mapWrap);
        const laps = await api.call('telemetry:laps', { car: s.car, track: s.track, layout: s.layout }).catch(() => []);
        const ref = laps.filter((l) => l.valid).sort((a, b) => a.lapMs - b.lapMs)[0] || laps[0];
        if (ref) {
          const full = await api.call('telemetry:lap', ref.id);
          map = trackMap([full], { height: 240, live: true });
          el.mapWrap.append(h('h3', 'Carte'), map);
        } else el.mapWrap.append(h('p.muted', { style: { margin: 0 } }, 'La carte apparaît après ton premier tour complet.'));
      }
      if (map) map.redraw({ x: s.x, z: s.z });
    };
    update(st && st.live);
    liveOff = window.lks.on('telemetry:live', update);
  }

  // ------------------------------------------------------------ laps
  async function renderLaps() {
    const laps = (await guard(() => api.call('telemetry:laps', {}))) || [];
    body.append(h('div.row.wrap',
      h('p.muted', { style: { margin: 0 } }, `${laps.length} tour(s) enregistré(s). Choisis A et B pour les comparer.`),
      h('button.btn.btn-sm.right', { on: { click: async () => { const r = await guard(() => api.call('telemetry:import')); if (r && r.length) { toast(`${r.length} tour(s) importé(s)`, 'success'); render(); } } } }, icon('download'), 'Importer')));
    if (!laps.length) {
      body.append(h('div.empty.mt', h('strong', 'Aucun tour'), 'Roule en solo ou en ligne : chaque tour complet est enregistré.'));
      return;
    }
    const list = h('div.list.mt');
    list.append(h('div.list-row.lap-row.head', h('span.label', 'Date'), h('span.label', 'Pilote · combo'), h('span.label', 'Temps'), h('span.label', 'Drift'), h('span')));
    for (const l of laps.slice(0, 300)) {
      list.append(h('div.list-row.lap-row',
        h('span.s', dateFr(l.date)),
        h('div', h('div.t', `${l.driver.name}${l.imported ? ' (importé)' : ''}`), h('div.s', comboLabel(l))),
        h('div', h('strong', lapTime(l.lapMs)), ' ', l.valid ? null : h('span.tag.warn', 'invalide')),
        h('span.s', `${l.drift.score} pts · ${Math.round(l.drift.maxAngle)}°`),
        h('div.row',
          h('button.btn.btn-sm', { title: 'Tour A', on: { click: () => pick('a', l.id) } }, 'A'),
          h('button.btn.btn-sm', { title: 'Tour B', on: { click: () => pick('b', l.id) } }, 'B'),
          l.imported ? null : h('button.btn.btn-sm.btn-ghost', { title: 'Exporter', on: { click: async () => { const f = await guard(() => api.call('telemetry:export', l.id)); if (f) toast('Tour exporté', 'success'); } } }, icon('upload')),
          h('button.btn.btn-sm.btn-ghost', { title: 'Supprimer', on: { click: async () => { if (await confirmBox('Supprimer', 'Supprimer ce tour ?', 'Supprimer')) { await api.call('telemetry:delete', l.id); render(); } } } }, icon('trash')))));
    }
    body.append(list);
  }

  async function pick(slot, id) {
    const lap = await guard(() => api.call('telemetry:lap', id));
    if (!lap) return;
    compare[slot] = lap;
    toast(`Tour ${slot.toUpperCase()} : ${lap.driver.name} ${lapTime(lap.lapMs)}`, 'info');
    if (compare.a && compare.b) {
      tab = 'compare';
      render();
    }
  }

  // ------------------------------------------------------------ leaderboard
  async function renderBoard() {
    const laps = (await api.call('telemetry:laps', {}).catch(() => [])) || [];
    const combos = new Map();
    for (const l of laps) combos.set(`${l.track}|${l.layout || ''}`, { track: l.track, layout: l.layout || '' });
    for (const t of (store.content && store.content.tracks) || []) for (const ly of t.layouts) combos.set(`${t.id}|${ly.id}`, { track: t.id, layout: ly.id });
    const keys = [...combos.keys()];
    if (!boardQuery.track && keys.length) {
      const first = laps[0] ? `${laps[0].track}|${laps[0].layout || ''}` : keys[0];
      Object.assign(boardQuery, combos.get(first));
    }
    const cars = [...new Set([...laps.map((l) => l.car), ...((store.content && store.content.cars) || []).filter((c) => c.lks).map((c) => c.id)])];
    body.append(h('div.toolbar',
      select(keys.map((k) => [k, trackName(combos.get(k).track, combos.get(k).layout)]), `${boardQuery.track}|${boardQuery.layout}`, (v) => { Object.assign(boardQuery, combos.get(v)); render(); }, 'board-select'),
      select([['', 'Toutes les voitures'], ...cars.map((c) => [c, carName(c)])], boardQuery.car, (v) => { boardQuery.car = v; render(); }, 'board-select'),
      seg([['time', 'Chrono'], ['drift', 'Drift']], boardQuery.kind, (v) => { boardQuery.kind = v; render(); })));
    if (!boardQuery.track) {
      body.append(h('div.empty', h('strong', 'Pas encore de tours'), 'Le classement se remplit dès ton premier tour.'));
      return;
    }
    const res = await guard(() => api.call('telemetry:board', { ...boardQuery, car: boardQuery.car || undefined }));
    if (!res) return;
    const remote = res.remote;
    if (res.error) body.append(h('div.notice', res.error));
    else if (!remote) body.append(h('div.notice.info', 'Classement partagé pas encore configuré : seuls tes tours et ceux importés apparaissent.'));
    const rows = remote
      ? remote.map((r) => ({ id: `remote-${r.id}`, driver: r.driver, car: r.car, lapMs: r.lap_ms, score: r.score, date: r.created_at, me: r.steam_id === store.settings.steamId }))
      : res.local.map((l) => ({ id: l.id, driver: l.driver.name, car: l.car, lapMs: l.lapMs, score: l.drift.score, date: l.date, me: l.driver.steamId === store.settings.steamId }));
    if (!rows.length) {
      body.append(h('div.empty', h('strong', 'Personne pour l’instant'), 'Sois le premier à poser un temps.'));
      return;
    }
    const time = boardQuery.kind === 'time';
    const top = time ? rows[0].lapMs : rows[0].score;
    const list = h('div.list');
    rows.forEach((r, i) => {
      const value = time ? lapTime(r.lapMs) : `${r.score} pts`;
      const gap = i === 0 ? '' : time ? `+${((r.lapMs - top) / 1000).toFixed(3)}` : `${r.score - top}`;
      list.append(h('div.list-row.board-row', { class: r.me ? 'me' : '' },
        h('span.board-pos', `${i + 1}`),
        h('div', h('div.t', r.driver), h('div.s', carName(r.car))),
        h('strong.board-v', value),
        h('span.s', gap),
        h('div.row', h('span.s', dateFr(r.date)), h('button.btn.btn-sm', { on: { click: () => compareWith(r) } }, 'Comparer'))));
    });
    body.append(list);
  }

  async function compareWith(row) {
    const other = await guard(() => api.call('telemetry:lap', row.id));
    if (!other) return;
    // A = my best on the same track (same car first), B = the chosen lap
    const mine = (await api.call('telemetry:laps', { track: other.track, layout: other.layout || '' })).filter((l) => !l.imported && l.driver.steamId === store.settings.steamId && (boardQuery.kind === 'drift' || l.valid));
    const drift = boardQuery.kind === 'drift';
    const otherCar = (l) => (l.car === other.car ? 0 : 1);
    mine.sort((a, b) => otherCar(a) - otherCar(b) || (drift ? b.drift.score - a.drift.score : a.lapMs - b.lapMs));
    compare = { a: mine[0] ? await api.call('telemetry:lap', mine[0].id) : null, b: other };
    if (!compare.a) toast('Tu n’as pas encore de tour sur ce circuit : choisis un tour A dans « Tours »', 'info', 6000);
    tab = 'compare';
    render();
  }

  // ------------------------------------------------------------ compare
  function renderCompare() {
    const { a, b } = compare;
    const card = (lap, slot) => h(`div.panel.cmp-card.${slot}`,
      h('div.picker-k', `Tour ${slot.toUpperCase()}`),
      lap ? [h('div.cmp-time', lapTime(lap.lapMs)), h('div.t', lap.driver.name), h('div.s', comboLabel(lap)), h('div.s', `${lap.drift.score} pts drift · ${Math.round(lap.drift.maxAngle)}° max · ${Math.round(lap.topSpeed)} km/h`)]
        : h('p.muted', 'Choisis un tour dans « Tours » ou « Classement ».'));
    body.append(h('div.grid.grid-2', card(a, 'a'), card(b, 'b')));
    if (!a || !b) return;
    if (a.track !== b.track || (a.layout || '') !== (b.layout || '')) body.append(h('div.notice.mt', 'Ces deux tours ne sont pas sur le même circuit : la comparaison n’a pas de sens.'));
    const pts = (lap, col) => lap.samples.map((s) => [s[COL.d], s[col]]);
    const at = (lap, col, unit = '', digits = 0) => (d) => {
      const v = valueAt(lap.samples, d, col);
      return v == null ? '' : `${Number(v).toFixed(digits)}${unit}`;
    };
    const total = (b.lapMs - a.lapMs) / 1000;
    const delta = a.samples.map((s) => [s[0], ((timeAt(b.samples, s[0]) - s[1]) / 1000)]);
    const dMax = Math.max(0.5, ...delta.map((x) => Math.abs(x[1])));
    const maxSpeed = Math.max(...a.samples.map((s) => s[COL.speed]), ...b.samples.map((s) => s[COL.speed]));
    const maxAngle = Math.max(10, ...a.samples.map((s) => s[COL.angle]), ...b.samples.map((s) => s[COL.angle]));
    body.append(
      h('div.notice.info.mt', `${b.driver.name} est ${total > 0 ? `${total.toFixed(3)} s plus lent` : `${Math.abs(total).toFixed(3)} s plus rapide`} que ${a.driver.name}. Survole les courbes pour voir les valeurs.`),
      h('div.cmp-layout',
        h('div.cmp-charts',
          chart({ label: 'Vitesse (km/h)', yMin: 0, yMax: Math.ceil(maxSpeed / 20) * 20, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.speed), at: at(a, COL.speed, ' km/h') }, { name: 'B', color: COLORS.b, points: pts(b, COL.speed), at: at(b, COL.speed, ' km/h') }] }),
          chart({ label: 'Écart B − A (s)', yMin: -dMax, yMax: dMax, zero: true, series: [{ name: 'Écart', color: '#e3a33a', points: delta, at: (d) => { const v = valueAt(delta.map((x) => [x[0], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, x[1]]), d, 11); return v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)} s`; } }] }),
          chart({ label: 'Gaz', height: 80, yMin: 0, yMax: 1, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.gas), at: at(a, COL.gas, '', 2) }, { name: 'B', color: COLORS.b, points: pts(b, COL.gas), at: at(b, COL.gas, '', 2) }] }),
          chart({ label: 'Frein', height: 80, yMin: 0, yMax: 1, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.brake), at: at(a, COL.brake, '', 2) }, { name: 'B', color: COLORS.b, points: pts(b, COL.brake), at: at(b, COL.brake, '', 2) }] }),
          chart({ label: 'Angle (°)', height: 100, yMin: 0, yMax: Math.ceil(maxAngle / 10) * 10, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.angle), at: at(a, COL.angle, '°') }, { name: 'B', color: COLORS.b, points: pts(b, COL.angle), at: at(b, COL.angle, '°') }] }),
          chart({ label: 'Rapport', height: 70, yMin: 0, yMax: 8, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.gear).map(([d, g]) => [d, g - 1]), at: (d) => String(valueAt(a.samples, d, COL.gear) - 1) }, { name: 'B', color: COLORS.b, points: pts(b, COL.gear).map(([d, g]) => [d, g - 1]), at: (d) => String(valueAt(b.samples, d, COL.gear) - 1) }] }),
        ),
        h('div.panel.cmp-map', h('h3', 'Carte'), trackMap([a, b]), h('div.hint', h('span', { style: { color: COLORS.a } }, '■ A'), '  ', h('span', { style: { color: COLORS.b } }, '■ B'))),
      ),
    );
  }

  // ------------------------------------------------------------ tools
  async function renderTools() {
    const [st, tools, game] = await Promise.all([api.call('telemetry:status'), api.call('tools:status'), api.call('ingame:status')]);
    const setT = async (patch) => { await guard(() => api.call('telemetry:settings', patch)); render(); };
    body.append(
      h('div.grid.grid-2',
        h('div.panel', h('h3', 'Réglages'),
          toggle('Enregistrer mes tours', st.enabled !== false, (v) => setT({ enabled: v })),
          toggle('Envoyer mes records au classement', st.shareLaps !== false, (v) => setT({ shareLaps: v }), st.board ? 'Seuls tes meilleurs tours sont envoyés.' : 'Classement partagé pas encore configuré par les admins.')),
        h('div.panel', h('h3', 'Appli en jeu'),
          h('p.muted', { style: { marginTop: 0 } }, 'Angle de drift, score et écart avec ton meilleur tour, affichés pendant que tu roules (Custom Shaders Patch requis).'),
          h('div.row.wrap',
            game.installed ? h(`span.tag.${game.upToDate ? 'ok' : 'warn'}`, game.upToDate ? `Installée (v${game.installed})` : `Mise à jour v${game.available}`) : h('span.tag.plain', 'Non installée'),
            h('button.btn.btn-sm.btn-primary', { on: { click: async () => { if (await guard(() => api.call('ingame:install'), 'Appli installée')) render(); } } }, game.installed && game.upToDate ? 'Réinstaller' : 'Installer'),
            game.installed ? h('button.btn.btn-sm.btn-ghost', { on: { click: async () => { await guard(() => api.call('ingame:remove')); render(); } } }, 'Retirer') : null),
          h('p.hint', 'En jeu : barre d’applis à droite de l’écran, puis « LKS ».')),
        h('div.panel', h('h3', 'Tableau de bord sur téléphone'),
          toggle('Activer', Boolean(st.dashEnabled), (v) => setT({ dashEnabled: v }), 'Ouvre l’adresse sur ton téléphone, connecté au même Wi-Fi.'),
          st.dash.running ? h('div.grid.mt', st.dash.urls.map((u) => h('div.row', h('code.invite-code', u), h('button.btn.btn-sm', { on: { click: async () => { await api.call('clipboard:write', u); toast('Adresse copiée', 'success'); } } }, 'Copier')))) : null),
        ...tools.map((t) => h('div.panel', h('h3', t.name), h('p.muted', { style: { marginTop: 0 } }, t.description),
          h('div.row.wrap',
            t.installed ? h('button.btn.btn-sm.btn-primary', { on: { click: () => guard(() => api.call('tools:launch', t.id), `${t.name} lancé`) } }, icon('play'), 'Lancer') : h('button.btn.btn-sm', { on: { click: () => api.call('shell:open', t.url) } }, icon('download'), 'Télécharger'),
            t.installed ? null : h('span.hint', 'Puis relance cette page.')),
          t.installed ? toggle('Lancer avec le jeu', t.autoStart, async (v) => { await api.call('tools:autoStart', t.id, v); }) : null)),
      ),
    );
  }

  const offLap = window.lks.on('telemetry:lap', () => { if (tab === 'laps' || tab === 'board') render(); });
  const onResize = () => charts.forEach((c) => c.draw());
  window.addEventListener('resize', onResize);
  render();
  return () => {
    if (liveOff) liveOff();
    offLap();
    window.removeEventListener('resize', onResize);
    charts.clear();
  };
}
