import { api, h, clear, icon, guard, toast, seg, select, field, toggle, range, lapTime, dateFr, confirmBox } from '../ui.js';
import { store } from '../store.js';

// state kept while switching tabs
let tab = 'live';
let compare = { a: null, b: null };
let boardQuery = { track: '', layout: '', car: '', kind: 'time' };
let compareMode = 'time';
let judgeMode = 'normal'; // debutant | normal | pro
let editor = null; // drift course editor state
let battleQuery = { track: '', layout: '' };
let champIndex = 0;
let champEditor = null; // admins: championships being edited

const COLORS = { a: '#e01b3a', b: '#ece5da', grid: '#261e22', text: '#6c615c' };
const COL = { d: 0, t: 1, speed: 2, gas: 3, brake: 4, gear: 5, rpm: 6, steer: 7, angle: 8, x: 9, z: 10 };
const MODES = [['debutant', 'Débutant'], ['normal', 'Normal'], ['pro', 'Compétition']];
const MODE_LABEL = Object.fromEntries(MODES);

const fmtDelta = (ms) => (ms == null ? '—' : `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(2)}`);
const comboLabel = (l) => [trackName(l.track, l.layout), carName(l.car)].join(' · ');
const isAdmin = () => Boolean(store.settings && store.settings.admin && store.settings.admin.hasToken);
const getCourseInfo = (track, layout) => api.call('drift:course', { track, layout: layout || '' }).catch(() => ({ course: null, source: null }));
const getCourse = (track, layout) => getCourseInfo(track, layout).then((r) => r.course);

/** Judged result of a lap (drift or tandem) in the selected mode. */
function resultOf(lap, kind = 'drift', mode = judgeMode) {
  const d = lap && (kind === 'tandem' ? lap.tandem : lap.drift);
  if (!d) return null;
  if (d.modes && d.modes[mode]) return d.modes[mode];
  return mode === 'normal' && kind === 'drift' && d.score !== undefined ? d : null;
}
const note = (d, empty = 'Pas de drift') => (d && d.score > 0 ? `${d.score.toFixed(1)}/100` : d && d.zeroed ? '0/100' : empty);

/** "Angle 28 · Vitesse 24 · Ligne 30 · Clips 3/4 · −3" (or the tandem details) */
function breakdown(d) {
  if (!d) return '';
  if (d.zeroed) return `Run à 0 : ${d.zeroed}`;
  if (!(d.score > 0)) return '';
  const parts = [];
  if (d.proximity !== undefined) {
    parts.push(`Proximité ${Math.round(d.proximity)}`, `Angle copié ${Math.round(d.angleMatch)}`, `Ligne ${Math.round(d.line)}`, `Drift ${Math.round(d.drift)}`, `${d.avgGap} m en moy.`);
  } else if (d.angle !== undefined) {
    parts.push(`Angle ${Math.round(d.angle)}`, `Vitesse ${Math.round(d.speed)}`);
    if (d.line !== null && d.line !== undefined) parts.push(`Ligne ${Math.round(d.line)}`);
    if (d.clips && d.clips.length) parts.push(`Clips ${d.clips.filter((c) => c.hit).length}/${d.clips.length}`);
  }
  if (d.penalty) parts.push(`−${d.penalty}`);
  return parts.join(' · ');
}

/** The leader of a tandem run, as a lap (same distance axis as the chaser). */
function leadLap(lap) {
  const t = lap.tandem;
  return {
    id: `${lap.id}-lead`,
    driver: { name: t.lead.name, steamId: '' },
    car: t.lead.car || lap.car,
    track: lap.track,
    layout: lap.layout,
    lapMs: lap.lapMs,
    topSpeed: Math.max(...t.leadSamples.map((s) => s[3])),
    valid: true,
    drift: {},
    samples: lap.samples.map((s, i) => { const l = t.leadSamples[i]; return [s[0], s[1], l[3], 0, 0, 0, 0, 0, l[2], l[0], l[1], 0, l[4]]; }),
  };
}

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

const CLIP_COLORS = { inner: '#e3a33a', outer: '#9fb4d8' };

/**
 * Track map from lap trajectories. Options: live (no hover cursor), course
 * (drift clips + reference line), section (judged part, editor), onClick(x, z)
 * for the course editor.
 */
function trackMap(laps, { height = 260, live, course, onClick, section } = {}) {
  const canvas = h('canvas.map');
  let proj = null;
  const draw = (pos) => {
    const all = laps.flatMap((l) => l.samples.map((s) => [s[COL.x], s[COL.z]]));
    if (course) all.push(...(course.refLine || []), ...(course.clips || []).map((c) => [c.x, c.z]));
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
    const k = Math.min((w - 24) / (maxX - minX || 1), (height - 24) / (maxZ - minZ || 1));
    const ox = 12 + (w - 24 - (maxX - minX) * k) / 2;
    const px = (x) => ox + (x - minX) * k;
    const pz = (z) => 12 + (maxZ - z) * k;
    proj = { toWorld: (cx, cy) => [minX + (cx - ox) / k, maxZ - (cy - 12) / k], k };
    const path = (pts) => {
      g.beginPath();
      pts.forEach(([x, z], j) => (j ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
      g.stroke();
    };
    if (course && course.refLine && course.refLine.length) {
      g.strokeStyle = 'rgba(236,229,218,0.25)';
      g.lineWidth = 6;
      path(course.refLine);
    }
    laps.forEach((l, i) => {
      g.strokeStyle = i === 0 ? COLORS.a : COLORS.b;
      g.lineWidth = i === 0 ? 2.5 : 1.5;
      const pts = l.samples.map((s) => [s[COL.x], s[COL.z]]);
      if (section) {
        g.globalAlpha = 0.3;
        path(pts);
        g.globalAlpha = 1;
        path(l.samples.filter((s) => s[0] >= section[0] && s[0] <= section[1]).map((s) => [s[COL.x], s[COL.z]]));
        for (const [d, label] of [[section[0], 'Départ'], [section[1], 'Arrivée']]) {
          const s = l.samples.find((x) => x[0] >= d) || l.samples[l.samples.length - 1];
          g.fillStyle = '#ece5da';
          g.font = '600 11px Barlow Condensed, sans-serif';
          g.fillRect(px(s[COL.x]) - 3, pz(s[COL.z]) - 3, 6, 6);
          g.fillText(label, px(s[COL.x]) + 6, pz(s[COL.z]) - 6);
        }
      } else path(pts);
    });
    ((course && course.clips) || []).forEach((c, i) => {
      g.strokeStyle = CLIP_COLORS[c.kind] || CLIP_COLORS.inner;
      g.fillStyle = g.strokeStyle;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px(c.x), pz(c.z), Math.max(5, (c.r || 3) * k), 0, Math.PI * 2);
      g.stroke();
      g.font = '700 12px Barlow Condensed, sans-serif';
      g.fillText(String(i + 1), px(c.x) + Math.max(7, (c.r || 3) * k) + 2, pz(c.z) + 4);
    });
    const dot = (x, z, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(px(x), pz(z), 6, 0, Math.PI * 2);
      g.fill();
    };
    if (pos) dot(pos.x, pos.z, '#fff');
    else if (cursorD != null && !onClick) {
      laps.forEach((l, i) => {
        const s = l.samples.find((x) => x[0] >= cursorD) || l.samples[l.samples.length - 1];
        dot(s[COL.x], s[COL.z], i === 0 ? COLORS.a : COLORS.b);
      });
    }
  };
  canvas.redraw = draw;
  if (onClick) {
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('click', (e) => {
      if (!proj) return;
      const r = canvas.getBoundingClientRect();
      const [x, z] = proj.toWorld(e.clientX - r.left, e.clientY - r.top);
      onClick(x, z, proj.k);
    });
  }
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
    const tabs = [['live', 'En direct'], ['laps', 'Tours'], ['board', 'Classement'], ['compare', 'Comparer'], ['battles', 'Battles'], ['champ', 'Championnat']];
    if (isAdmin()) tabs.push(['course', 'Parcours drift']);
    tabs.push(['tools', 'Outils']);
    if (!tabs.some(([k]) => k === tab)) tab = 'live';
    tabsEl.append(seg(tabs, tab, (v) => { tab = v; render(); }));
  }

  function render() {
    charts.clear();
    if (liveOff) {
      liveOff();
      liveOff = null;
    }
    clear(body);
    renderTabs();
    ({ live: renderLive, laps: renderLaps, board: renderBoard, compare: renderCompare, battles: renderBattles, champ: renderChamp, course: renderCourse, tools: renderTools })[tab]();
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
    let mapKey = null;
    panel.append(
      h('div.live-grid',
        tile('speed', 'Vitesse', '.big'), tile('gear', 'Rapport', '.big'), tile('angle', 'Angle', '.big'), tile('delta', 'Écart', '.big'),
        h('div.live-tile.wide', h('div.label', 'Régime'), bar('rpm', 'rpm'), h('div.label.mt', 'Gaz'), bar('gas', 'gas'), h('div.label.mt', 'Frein'), bar('brake', 'brake')),
        h('div.live-tile.wide', h('div.label', 'Tour'), (el.lap = h('div.live-v', '—')), h('div.hint', 'Dernier ', (el.last = h('strong', '—')), ' · Meilleur ', (el.best = h('strong', '—')))),
        h('div.live-tile.wide', h('div.label', 'Clips'), (el.clips = h('div.clip-chips'))),
        h('div.live-tile.wide', h('div.label', 'Pneus (°C)'), (el.tyres = h('div.live-tyres')), h('div.hint.mt', (el.session = h('span', '—')))),
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
      el.tyres.textContent = (s.tyreTemps || []).map((t) => Math.round(t)).join('  ·  ');
      el.session.textContent = `${carName(s.car)} · ${trackName(s.track, s.layout)} · tour ${s.laps + 1}`;
      clear(el.clips);
      if (s.clips && s.clips.total) s.clips.clips.forEach((c, i) => el.clips.append(h(`span.clip-chip${c.hit ? '.hit' : ''}`, { title: c.dist == null ? '' : `${c.dist} m` }, `${i + 1}`, c.hit ? ' ✓' : '')));
      else el.clips.append(h('span.hint', 'Pas de clips sur ce circuit'));
      // map from the best lap on this car/track
      const key = `${s.car}|${s.track}|${s.layout}`;
      if (mapKey !== key) {
        mapKey = key;
        clear(el.mapWrap);
        const [laps, course] = await Promise.all([api.call('telemetry:laps', { car: s.car, track: s.track, layout: s.layout }).catch(() => []), getCourse(s.track, s.layout)]);
        const ref = laps.filter((l) => l.valid).sort((a, b) => a.lapMs - b.lapMs)[0] || laps[0];
        if (ref || (course && course.refLine && course.refLine.length)) {
          const full = ref ? await api.call('telemetry:lap', ref.id) : null;
          map = trackMap(full ? [full] : [], { height: 240, live: true, course });
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
      h('div.right', seg(MODES, judgeMode, (v) => { judgeMode = v; render(); })),
      h('button.btn.btn-sm', { on: { click: async () => { const r = await guard(() => api.call('telemetry:import')); if (r && r.length) { toast(`${r.length} tour(s) importé(s)`, 'success'); render(); } } } }, icon('download'), 'Importer')));
    if (!laps.length) {
      body.append(h('div.empty.mt', h('strong', 'Aucun tour'), 'Roule en solo ou en ligne : chaque tour complet est enregistré.'));
      return;
    }
    const list = h('div.list.mt');
    list.append(h('div.list-row.lap-row.head', h('span.label', 'Date'), h('span.label', 'Pilote · combo'), h('span.label', 'Temps'), h('span.label', `Note (${MODE_LABEL[judgeMode]})`), h('span')));
    for (const l of laps.slice(0, 300)) {
      const d = resultOf(l, 'drift');
      const t = l.tandem ? resultOf(l, 'tandem') : null;
      list.append(h('div.list-row.lap-row',
        h('span.s', dateFr(l.date)),
        h('div', h('div.t', `${l.driver.name}${l.imported ? ' (importé)' : ''}`), h('div.s', comboLabel(l))),
        h('div', h('strong', lapTime(l.lapMs)), ' ', l.valid ? null : h('span.tag.warn', 'invalide')),
        l.tandem
          ? h('div', h('strong', note(t, '—')), h('div.s', `Tandem derrière ${l.tandem.lead.name}`))
          : h('div', h('strong', note(d)), h('div.s', d && d.zeroed ? `Run à 0 : ${d.zeroed}` : d && d.score > 0 ? `${Math.round(d.avgAngle)}° moy. · ${Math.round(d.maxAngle)}° max` : '')),
        h('div.row',
          l.tandem ? h('button.btn.btn-sm', { on: { click: () => openTandem(l.id) } }, 'Voir') : null,
          l.ghost ? h('button.btn.btn-sm', { title: 'Rouler avec ce tour en fantôme', on: { click: () => useGhost(l.id) } }, 'Fantôme') : null,
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
    if (compareMode === 'tandem') compareMode = 'drift';
    toast(`Tour ${slot.toUpperCase()} : ${lap.driver.name}`, 'info');
    if (compare.a && compare.b) {
      tab = 'compare';
      render();
    }
  }

  async function useGhost(id) {
    const g = await guard(() => api.call('ghost:set', id));
    if (g) toast(`Fantôme prêt : ${g.driver} sur ${trackName(g.track, g.layout)}. Il part quand tu passes la ligne de départ.`, 'success', 7000);
  }

  async function openTandem(id) {
    const lap = await guard(() => api.call('telemetry:lap', id));
    if (!lap || !lap.tandem) return;
    compare = { a: lap, b: leadLap(lap) };
    compareMode = 'tandem';
    tab = 'compare';
    render();
  }

  // ------------------------------------------------------------ leaderboard
  async function combos() {
    const laps = (await api.call('telemetry:laps', {}).catch(() => [])) || [];
    const map = new Map();
    for (const l of laps) map.set(`${l.track}|${l.layout || ''}`, { track: l.track, layout: l.layout || '' });
    for (const t of (store.content && store.content.tracks) || []) for (const ly of t.layouts) map.set(`${t.id}|${ly.id}`, { track: t.id, layout: ly.id });
    return { laps, map };
  }

  function courseNotice(info, kind) {
    const course = info && info.course;
    const parts = [];
    if (kind === 'tandem') parts.push('Note du chase sur 100 : proximité 35, angle copié 25, ligne du leader 20, drift 20, moins les pénalités. Enregistré par l’appli en jeu quand une voiture roule devant toi.');
    else parts.push('Note sur 100 : angle 35, vitesse 30, ligne et clips 35, moins les pénalités.');
    if (course) parts.push(`${info.source === 'auto' ? 'Tracé automatique' : 'Parcours du groupe'} : ${(course.clips || []).length} clip(s).`);
    else parts.push('Pas de clips sur ce circuit : seuls l’angle et la vitesse comptent.');
    return h('div.notice.info.mt-s',
      h('span.grow', parts.join(' ')),
      isAdmin() ? h('button.btn.btn-sm', { on: { click: () => { editor = null; tab = 'course'; render(); } } }, course && info.source === 'published' ? 'Modifier' : 'Placer les clips') : null);
  }

  async function renderBoard() {
    const { laps, map: combosMap } = await combos();
    const keys = [...combosMap.keys()];
    if (!boardQuery.track && keys.length) {
      const first = laps[0] ? `${laps[0].track}|${laps[0].layout || ''}` : keys[0];
      Object.assign(boardQuery, combosMap.get(first));
    }
    const cars = [...new Set([...laps.map((l) => l.car), ...((store.content && store.content.cars) || []).filter((c) => c.lks).map((c) => c.id)])];
    const judged = boardQuery.kind !== 'time';
    body.append(h('div.toolbar',
      select(keys.map((k) => [k, trackName(combosMap.get(k).track, combosMap.get(k).layout)]), `${boardQuery.track}|${boardQuery.layout}`, (v) => { Object.assign(boardQuery, combosMap.get(v)); render(); }, 'board-select'),
      select([['', 'Toutes les voitures'], ...cars.map((c) => [c, carName(c)])], boardQuery.car, (v) => { boardQuery.car = v; render(); }, 'board-select'),
      seg([['time', 'Chrono'], ['drift', 'Drift'], ['tandem', 'Tandem']], boardQuery.kind, (v) => { boardQuery.kind = v; render(); }),
      judged ? seg(MODES, judgeMode, (v) => { judgeMode = v; render(); }) : null));
    if (!boardQuery.track) {
      body.append(h('div.empty', h('strong', 'Pas encore de tours'), 'Le classement se remplit dès ton premier tour.'));
      return;
    }
    const [res, info] = await Promise.all([guard(() => api.call('telemetry:board', { ...boardQuery, mode: judgeMode, car: boardQuery.car || undefined })), judged ? getCourseInfo(boardQuery.track, boardQuery.layout) : null]);
    if (!res) return;
    const remote = res.remote;
    if (res.error) body.append(h('div.notice', res.error));
    else if (!remote) body.append(h('div.notice.info', 'Classement partagé pas encore configuré : seuls tes tours et ceux importés apparaissent.'));
    if (judged) body.append(courseNotice(info, boardQuery.kind));
    const rows = remote
      ? remote.map((r) => ({ id: `remote-${r.id}`, driver: r.driver, car: r.car, lapMs: r.lap_ms, score: Number(r.score), d: (r.meta && (r.meta.drift || r.meta.tandem)) || null, lead: r.meta && r.meta.lead, ghost: Boolean(r.meta && r.meta.ghost), date: r.created_at, me: r.steam_id === store.settings.steamId }))
      : res.local.map((l) => ({ id: l.id, driver: l.driver.name, car: l.car, lapMs: l.lapMs, score: l.result ? l.result.score : 0, d: l.result, lead: l.tandem && l.tandem.lead, ghost: Boolean(l.ghost), date: l.date, me: l.driver.steamId === store.settings.steamId }));
    if (!rows.length) {
      body.append(h('div.empty.mt', h('strong', 'Personne pour l’instant'), boardQuery.kind === 'tandem' ? 'Installe l’appli en jeu (Outils) et suis un pote : ton chase est noté.' : judged ? 'Sois le premier à poser une run.' : 'Sois le premier à poser un temps.'));
      return;
    }
    const top = judged ? rows[0].score : rows[0].lapMs;
    const list = h('div.list.mt');
    rows.forEach((r, i) => {
      const value = judged ? `${r.score.toFixed(1)}` : lapTime(r.lapMs);
      const gap = i === 0 ? '' : judged ? `−${(top - r.score).toFixed(1)}` : `+${((r.lapMs - top) / 1000).toFixed(3)}`;
      const sub = [carName(r.car), r.lead ? `derrière ${r.lead.name}` : null].filter(Boolean).join(' · ');
      list.append(h('div.list-row.board-row', { class: r.me ? 'me' : '' },
        h('span.board-pos', `${i + 1}`),
        h('div', h('div.t', r.driver), h('div.s', sub), judged && breakdown(r.d) ? h('div.s', breakdown(r.d)) : null),
        h('strong.board-v', value, judged ? h('small', ' /100') : null),
        h('span.s', gap),
        h('div.row', h('span.s', dateFr(r.date)),
          r.ghost ? h('button.btn.btn-sm', { title: 'Rouler avec ce tour en fantôme', on: { click: () => useGhost(r.id) } }, 'Fantôme') : null,
          boardQuery.kind === 'tandem' ? h('button.btn.btn-sm', { on: { click: () => openTandem(r.id) } }, 'Voir')
            : rows.length > 1 || !r.me ? h('button.btn.btn-sm', { on: { click: () => compareWith(r, r.me ? rows[i === 0 ? 1 : i - 1] : null) } }, 'Comparer') : null)));
    });
    body.append(list);
  }

  async function compareWith(row, rival) {
    const drift = boardQuery.kind === 'drift';
    compareMode = drift ? 'drift' : 'time';
    if (rival) {
      // my own row: me against the driver just above (or below when I'm first)
      const [mine, theirs] = await Promise.all([guard(() => api.call('telemetry:lap', row.id)), guard(() => api.call('telemetry:lap', rival.id))]);
      if (!mine || !theirs) return;
      compare = { a: mine, b: theirs };
      tab = 'compare';
      render();
      return;
    }
    const other = await guard(() => api.call('telemetry:lap', row.id));
    if (!other) return;
    // A = my best on the same track (same car first), B = the chosen lap
    const mine = (await api.call('telemetry:laps', { track: other.track, layout: other.layout || '' })).filter((l) => !l.imported && !l.tandem && l.driver.steamId === store.settings.steamId && (drift ? resultOf(l) && resultOf(l).score > 0 : l.valid));
    const otherCar = (l) => (l.car === other.car ? 0 : 1);
    mine.sort((a, b) => otherCar(a) - otherCar(b) || (drift ? resultOf(b).score - resultOf(a).score : a.lapMs - b.lapMs));
    compare = { a: mine[0] ? await api.call('telemetry:lap', mine[0].id) : null, b: other };
    if (!compare.a) toast('Tu n’as pas encore de tour sur ce circuit : choisis un tour A dans « Tours »', 'info', 6000);
    tab = 'compare';
    render();
  }

  // ------------------------------------------------------------ compare
  async function renderCompare() {
    const { a, b } = compare;
    const tandem = compareMode === 'tandem' && a && a.tandem;
    if (compareMode === 'tandem' && !tandem) compareMode = 'drift';
    const drift = compareMode === 'drift';
    const modes = [['time', 'Chrono'], ['drift', 'Drift'], ...(a && a.tandem ? [['tandem', 'Tandem']] : [])];
    body.append(h('div.toolbar',
      seg(modes, compareMode, (v) => { if (v === 'tandem' && a && a.tandem) compare.b = leadLap(a); compareMode = v; render(); }),
      compareMode !== 'time' ? seg(MODES, judgeMode, (v) => { judgeMode = v; render(); }) : null));
    const value = (lap, slot) => {
      if (tandem) return slot === 'a' ? note(resultOf(lap, 'tandem'), '—') : 'Leader';
      return drift ? note(resultOf(lap)) : lapTime(lap.lapMs);
    };
    const cardLine = (lap, slot) => {
      if (tandem && slot === 'a') { const t = resultOf(lap, 'tandem') || {}; return t.zeroed ? `Run à 0 : ${t.zeroed}` : `${t.avgGap ?? '—'} m d’écart moyen · ${Math.round(t.avgAngle || 0)}° moy.`; }
      if (tandem) { const ang = lap.samples.map((x) => Math.min(90, x[COL.angle])); return `${Math.round(ang.reduce((p, v) => p + v, 0) / (ang.length || 1))}° moy. · ${Math.round(Math.max(...ang))}° max · ${Math.round(lap.topSpeed)} km/h max`; }
      if (drift) { const d = resultOf(lap) || {}; return d.zeroed ? `Run à 0 : ${d.zeroed}` : `${Math.round(d.avgAngle || 0)}° moy. · ${Math.round(d.maxAngle || 0)}° max · ${Math.round(d.avgSpeed || lap.topSpeed)} km/h`; }
      return `${Math.round(lap.topSpeed)} km/h max${lap.valid ? '' : ' · invalide'}`;
    };
    const card = (lap, slot) => h(`div.panel.cmp-card.${slot}`,
      h('div.picker-k', tandem ? (slot === 'a' ? 'Chase' : 'Leader') : `Tour ${slot.toUpperCase()}`),
      lap ? [h('div.cmp-time', value(lap, slot)), h('div.t', lap.driver.name), h('div.s', comboLabel(lap)),
        h('div.s', cardLine(lap, slot))]
        : h('p.muted', 'Choisis un tour dans « Tours » ou « Classement ».'));
    body.append(h('div.grid.grid-2', card(a, 'a'), card(b, 'b')));
    if (!a || !b) return;
    if (a.track !== b.track || (a.layout || '') !== (b.layout || '')) body.append(h('div.notice.mt', 'Ces deux tours ne sont pas sur le même circuit : la comparaison n’a pas de sens.'));
    const course = drift || tandem ? await getCourse(a.track, a.layout) : null;
    const pts = (lap, col) => lap.samples.map((s) => [s[COL.d], s[col]]);
    const at = (lap, col, unit = '', digits = 0) => (d) => {
      const v = valueAt(lap.samples, d, col);
      return v == null ? '' : `${Number(v).toFixed(digits)}${unit}`;
    };
    const maxSpeed = Math.max(...a.samples.map((s) => s[COL.speed]), ...b.samples.map((s) => s[COL.speed]));
    const maxAngle = Math.max(10, ...a.samples.map((s) => Math.min(90, s[COL.angle])), ...b.samples.map((s) => Math.min(90, s[COL.angle])));
    const speedChart = chart({ label: 'Vitesse (km/h)', yMin: 0, yMax: Math.ceil(maxSpeed / 20) * 20, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.speed), at: at(a, COL.speed, ' km/h') }, { name: 'B', color: COLORS.b, points: pts(b, COL.speed), at: at(b, COL.speed, ' km/h') }] });
    const angleChart = (height) => chart({ label: 'Angle (°)', height, yMin: 0, yMax: Math.ceil(maxAngle / 10) * 10, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.angle).map(([d, v]) => [d, Math.min(90, v)]), at: at(a, COL.angle, '°') }, { name: 'B', color: COLORS.b, points: pts(b, COL.angle).map(([d, v]) => [d, Math.min(90, v)]), at: at(b, COL.angle, '°') }] });
    const pedals = [
      chart({ label: 'Gaz', height: 80, yMin: 0, yMax: 1, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.gas), at: at(a, COL.gas, '', 2) }, { name: 'B', color: COLORS.b, points: pts(b, COL.gas), at: at(b, COL.gas, '', 2) }] }),
      chart({ label: 'Frein', height: 80, yMin: 0, yMax: 1, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.brake), at: at(a, COL.brake, '', 2) }, { name: 'B', color: COLORS.b, points: pts(b, COL.brake), at: at(b, COL.brake, '', 2) }] }),
      chart({ label: 'Rapport', height: 70, yMin: 0, yMax: 8, series: [{ name: 'A', color: COLORS.a, points: pts(a, COL.gear).map(([d, g]) => [d, g - 1]), at: (d) => String(valueAt(a.samples, d, COL.gear) - 1) }, { name: 'B', color: COLORS.b, points: pts(b, COL.gear).map(([d, g]) => [d, g - 1]), at: (d) => String(valueAt(b.samples, d, COL.gear) - 1) }] }),
    ];
    const legend = tandem ? ['■ Chase', '■ Leader'] : ['■ A', '■ B'];
    const mapPanel = h('div.panel.cmp-map', h('h3', 'Carte'), trackMap([a, b], { course }), h('div.hint', h('span', { style: { color: COLORS.a } }, legend[0]), '  ', h('span', { style: { color: COLORS.b } }, legend[1]), course && course.clips && course.clips.length ? ['  ', h('span', { style: { color: CLIP_COLORS.inner } }, '○ clip intérieur'), '  ', h('span', { style: { color: CLIP_COLORS.outer } }, '○ extérieur')] : null));

    if (!drift && !tandem) {
      const total = (b.lapMs - a.lapMs) / 1000;
      const delta = a.samples.map((s) => [s[0], (timeAt(b.samples, s[0]) - s[1]) / 1000]);
      const dMax = Math.max(0.5, ...delta.map((x) => Math.abs(x[1])));
      body.append(
        h('div.notice.info.mt', `${b.driver.name} est ${total > 0 ? `${total.toFixed(3)} s plus lent` : `${Math.abs(total).toFixed(3)} s plus rapide`} que ${a.driver.name}. Survole les courbes pour voir les valeurs.`),
        h('div.cmp-layout',
          h('div.cmp-charts',
            speedChart,
            chart({ label: 'Écart B − A (s)', yMin: -dMax, yMax: dMax, zero: true, series: [{ name: 'Écart', color: '#e3a33a', points: delta, at: (d) => { const v = valueAt(delta.map((x) => [x[0], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, x[1]]), d, 11); return v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)} s`; } }] }),
            ...pedals,
            angleChart(100)),
          mapPanel));
      return;
    }

    const judge = h('div.panel.judge', h('h3', `Jugement · ${MODE_LABEL[judgeMode]}`));
    const bar = (v, max) => `${max ? Math.max(0, Math.min(100, ((v || 0) / max) * 100)) : 0}%`;
    const line = (label, va, vb, max, single) => judge.append(h('div.judge-row',
      h('span.label', label),
      h('div.judge-bars',
        h('div.judge-bar.a', h('i', { style: { width: bar(va, max) } }), h('b', va == null ? '—' : String(Math.round(va * 10) / 10))),
        single ? null : h('div.judge-bar.b', h('i', { style: { width: bar(vb, max) } }), h('b', vb == null ? '—' : String(Math.round(vb * 10) / 10)))),
      h('span.s', max ? `/ ${max}` : '')));

    if (tandem) {
      const t = resultOf(a, 'tandem') || {};
      line('Proximité', t.proximity, null, 35, true);
      line('Angle copié', t.angleMatch, null, 25, true);
      line('Ligne', t.line, null, 20, true);
      line('Drift', t.drift, null, 20, true);
      line('Pénalités', t.penalty ? -t.penalty : 0, null, 0, true);
      line('Note', t.score, null, 100, true);
      const facts = h('div.panel', h('h3', 'Le chase'),
        h('div.clip-table', h('span.label', ''), h('span.label', ''), h('span.label', ''),
          h('span', 'Écart moyen'), h('strong', `${t.avgGap ?? '—'} m`), h('span'),
          h('span', 'Plus près'), h('strong', `${t.minGap ?? '—'} m`), h('span'),
          h('span', 'Différence d’angle'), h('strong', `${t.angleDiff ?? '—'}°`), h('span'),
          h('span', 'Écart à la ligne du leader'), h('strong', `${t.lineDist ?? '—'} m`), h('span')),
        (t.penalties || []).length ? h('div.hint.mt', t.penalties.map((p) => `${p.label} ${p.zero ? '(run à 0)' : `(−${p.points})`} à ${Math.round((p.d || 0) * 100)} %`).join(' · ')) : null);
      const gap = a.samples.map((s, i) => { const l = a.tandem.leadSamples[i]; return [s[0], Math.hypot(s[COL.x] - l[0], s[COL.z] - l[1])]; });
      const gMax = Math.max(10, ...gap.map((g) => g[1]));
      body.append(
        h('div.notice.info.mt', t.zeroed ? `Run à 0 : ${t.zeroed}.` : `${a.driver.name} derrière ${a.tandem.lead.name} : ${t.avgGap} m en moyenne. Survole les courbes pour voir les valeurs.`),
        h('div.grid.grid-2.mt', judge, facts),
        h('div.cmp-layout', h('div.cmp-charts',
          chart({ label: 'Écart avec le leader (m)', height: 120, yMin: 0, yMax: Math.ceil(gMax / 5) * 5, series: [{ name: 'Écart', color: '#e3a33a', points: gap, at: (d) => { const g = gap.find((x) => x[0] >= d) || gap[gap.length - 1]; return `${g[1].toFixed(1)} m`; } }] }),
          angleChart(130), speedChart, ...pedals.slice(0, 2)), mapPanel));
      return;
    }

    // drift: judged like a run, not on the clock
    const da = resultOf(a) || {};
    const db = resultOf(b) || {};
    const diff = (db.score || 0) - (da.score || 0);
    line('Angle', da.angle, db.angle, 35);
    line('Vitesse', da.speed, db.speed, 30);
    if (da.line != null || db.line != null) line('Ligne', da.line, db.line, 35);
    line('Pénalités', da.penalty ? -da.penalty : 0, db.penalty ? -db.penalty : 0, 0);
    line('Note', da.score, db.score, 100);
    const clipsPanel = h('div.panel', h('h3', 'Clips'));
    const clipsA = da.clips || [];
    const clipsB = db.clips || [];
    if (!clipsA.length && !clipsB.length) clipsPanel.append(h('p.muted', { style: { margin: 0 } }, 'Pas de clips sur ce circuit.'));
    else {
      const cell = (c) => (c ? h(`span.clip-chip${c.hit ? '.hit' : ''}`, c.hit ? `✓ ${c.dist} m` : c.dist == null ? '✗' : `✗ ${c.dist} m`) : h('span.s', '—'));
      clipsPanel.append(h('div.clip-table', h('span.label', 'Clip'), h('span.label', 'A'), h('span.label', 'B'),
        ...(clipsA.length >= clipsB.length ? clipsA : clipsB).flatMap((c, i) => [h('span', `${i + 1}. ${c.name}`), cell(clipsA[i]), cell(clipsB[i])])));
    }
    const pens = [['A', da], ['B', db]].flatMap(([slot, d]) => (d.penalties || []).map((p) => `${slot} : ${p.label} ${p.zero ? '(run à 0)' : `(−${p.points})`} à ${Math.round((p.d || 0) * 100)} %`));
    if (pens.length) clipsPanel.append(h('div.hint.mt', pens.join(' · ')));
    body.append(
      h('div.notice.info.mt', diff === 0 ? 'Même note.' : `${b.driver.name} a ${Math.abs(diff).toFixed(1)} point(s) de ${diff > 0 ? 'plus' : 'moins'} que ${a.driver.name}. Survole les courbes pour voir les valeurs.`),
      h('div.grid.grid-2.mt', judge, clipsPanel),
      h('div.cmp-layout', h('div.cmp-charts', angleChart(130), speedChart, ...pedals), mapPanel));
  }

  // ------------------------------------------------------------ drift course editor (admins)
  let presets = null;
  const deepMerge = (base, over) => {
    if (!over || typeof over !== 'object') return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
    return out;
  };

  function rulesPanel(onChange) {
    const wrap = h('div.panel.rules-panel');
    const draw = () => {
      clear(wrap);
      const m = editor.ruleMode;
      const r = deepMerge(presets[m], editor.rules[m]);
      const set = (patch) => { editor.rules[m] = deepMerge(editor.rules[m] || {}, patch); onChange(); draw(); };
      const action = (key, rule, extra, tandemKey) => {
        const patch = (p) => set(tandemKey ? { tandem: { [key]: { ...rule, ...p } } } : { [key]: { ...rule, ...p } });
        return h('div.rule-row',
          h('span', extra && extra.label),
          extra && extra.control ? extra.control : h('span'),
          select([['none', 'Ignoré'], ['points', 'Points en moins'], ['zero', 'Run à 0']], rule.action, (v) => patch({ action: v })),
          rule.action === 'points' ? h('input.input.rule-points', { type: 'number', min: 0, max: 100, value: rule.points, on: { change: (e) => patch({ points: Number(e.target.value) || 0 }) } }) : h('span'));
      };
      wrap.append(
        h('div.row', h('h3', { style: { margin: 0 } }, 'Règles'), h('div.right', seg(MODES, m, (v) => { editor.ruleMode = v; draw(); }))),
        h('p.hint', m === 'debutant' ? 'Mode débutant : plus tolérant, jamais de run à 0 par défaut.' : m === 'pro' ? 'Mode compétition : chaque faute peut mettre la run à 0.' : 'Mode normal : les fautes coûtent des points.'),
        range('Angle pour la note max', { min: 20, max: 60, step: 1, value: r.angleTarget, format: (v) => `${v}°`, onInput: (v) => { editor.rules[m] = deepMerge(editor.rules[m] || {}, { angleTarget: v }); onChange(); } }),
        range('Taille des clips', { min: 0.5, max: 2, step: 0.1, value: r.clipScale, format: (v) => `× ${v}`, onInput: (v) => { editor.rules[m] = deepMerge(editor.rules[m] || {}, { clipScale: v }); onChange(); } }),
        h('div.rule-row', h('span', 'Ligne parfaite / à 0'), h('span'),
          h('input.input.rule-points', { type: 'number', min: 0, max: 30, step: 0.5, value: r.lineTol[0], on: { change: (e) => set({ lineTol: [Number(e.target.value) || 0, r.lineTol[1]] }) } }),
          h('input.input.rule-points', { type: 'number', min: 1, max: 60, step: 0.5, value: r.lineTol[1], on: { change: (e) => set({ lineTol: [r.lineTol[0], Number(e.target.value) || 1] }) } })),
        h('div.label.mt', 'Fautes'),
        action('off', r.off, { label: 'Roues dehors', control: select([['1', '1 roue'], ['2', '2 roues'], ['3', '3 roues'], ['4', '4 roues']], String(r.off.wheels), (v) => set({ off: { ...r.off, wheels: Number(v) } })) }),
        action('straighten', r.straighten, { label: 'Regrip' }),
        action('reverse', r.reverse, { label: 'Drift dans le mauvais sens' }),
        action('spin', r.spin, { label: 'Tête-à-queue' }),
        action('missedClip', r.missedClip, { label: 'Clip raté (par clip)' }),
        h('div.label.mt', 'Tandem'),
        h('div.rule-row', h('span', 'Écart idéal / trop loin (m)'), h('span'),
          h('input.input.rule-points', { type: 'number', min: 0, max: 30, step: 0.5, value: r.tandem.gap[0], on: { change: (e) => set({ tandem: { gap: [Number(e.target.value) || 0, r.tandem.gap[1]] } }) } }),
          h('input.input.rule-points', { type: 'number', min: 1, max: 60, step: 0.5, value: r.tandem.gap[1], on: { change: (e) => set({ tandem: { gap: [r.tandem.gap[0], Number(e.target.value) || 1] } }) } })),
        action('contact', r.tandem.contact, { label: 'Contact' }, true),
        action('pass', r.tandem.pass, { label: 'Dépassement du leader' }, true),
        action('lost', r.tandem.lost, { label: 'Leader perdu' }, true),
        h('div.row.mt', h('button.btn.btn-sm.btn-ghost', { on: { click: () => { delete editor.rules[m]; onChange(); draw(); } } }, 'Règles par défaut')));
    };
    draw();
    return wrap;
  }

  async function renderCourse() {
    const { laps, map: combosMap } = await combos();
    const keys = [...combosMap.keys()];
    if (!keys.length) {
      body.append(h('div.empty', h('strong', 'Aucun circuit'), 'Installe le contenu ou roule une première fois.'));
      return;
    }
    if (!presets) presets = (await api.call('drift:modes')).presets;
    if (!editor) {
      const start = boardQuery.track ? `${boardQuery.track}|${boardQuery.layout}` : laps[0] ? `${laps[0].track}|${laps[0].layout || ''}` : keys[0];
      editor = { key: combosMap.has(start) ? start : keys[0] };
    }
    const { track, layout } = combosMap.get(editor.key);
    if (!editor.loaded) {
      const info = await getCourseInfo(track, layout);
      const course = info.course;
      Object.assign(editor, {
        loaded: true,
        source: info.source,
        existing: info.source === 'published' ? course : null,
        section: course ? [...(course.section || [0, 1])] : [0, 1],
        clips: course ? (course.clips || []).map((c) => ({ ...c })) : [],
        rules: course && course.rules ? JSON.parse(JSON.stringify(course.rules)) : {},
        autoRefLine: info.source === 'auto' ? course.refLine : null,
        ruleMode: 'normal',
        lapId: '',
        lap: null,
      });
    }
    const onTrack = laps.filter((l) => l.track === track && (l.layout || '') === layout && !l.tandem).sort((x, y) => ((resultOf(y) || {}).score || 0) - ((resultOf(x) || {}).score || 0));
    const currentLine = editor.autoRefLine || (editor.existing && editor.existing.refLine) || null;
    if (!editor.lapId && !(currentLine && currentLine.length) && onTrack[0]) editor.lapId = onTrack[0].id;
    if (editor.lapId && (!editor.lap || editor.lap.id !== editor.lapId)) editor.lap = await guard(() => api.call('telemetry:lap', editor.lapId));

    const sourceLabel = editor.source === 'published' ? 'Parcours publié' : editor.source === 'auto' ? 'Tracé automatique (ligne IA du circuit), pas encore publié' : 'Pas encore de parcours';
    body.append(h('div.toolbar',
      select(keys.map((k) => [k, trackName(combosMap.get(k).track, combosMap.get(k).layout)]), editor.key, (v) => { editor = { key: v }; render(); }, 'board-select'),
      select([...(currentLine && currentLine.length ? [['', editor.autoRefLine ? 'Ligne IA du circuit' : `Ligne actuelle (${(editor.existing && editor.existing.refDriver) || 'référence'})`]] : []), ...onTrack.map((l) => [l.id, `${l.driver.name} · ${note(resultOf(l))} · ${dateFr(l.date)}`])], editor.lapId, (v) => { editor.lapId = v; editor.lap = null; render(); }, 'board-select'),
      h('button.btn.btn-sm', { on: { click: async () => {
        const auto = await guard(() => api.call('drift:autoCourse', { track, layout }));
        if (!auto) return;
        Object.assign(editor, { clips: auto.clips.map((c) => ({ ...c })), autoRefLine: auto.refLine, section: [0, 1], lapId: '', lap: null, rules: deepMerge(auto.rules || {}, editor.rules) });
        toast(`${auto.clips.length} clips placés depuis la ligne IA`, 'success');
        render();
      } } }, 'Générer depuis la ligne IA'),
      h('span.hint', sourceLabel)));
    if (!editor.lap && !(currentLine && currentLine.length)) {
      body.append(h('div.empty', h('strong', 'Pas de ligne pour ce circuit'), 'Fais une run propre ici, ou clique « Générer depuis la ligne IA » si le circuit en a une.'));
      return;
    }
    const mapWrap = h('div.panel.course-map');
    const list = h('div.course-clips');
    let map = null;
    const courseView = () => ({ refLine: editor.lap ? [] : currentLine, clips: editor.clips });
    const redraw = () => map && map.redraw();
    const drawMap = () => {
      clear(mapWrap);
      charts.clear();
      map = trackMap(editor.lap ? [editor.lap] : [], { height: 470, course: courseView(), section: editor.lap ? editor.section : null, onClick: (x, z) => {
        if (editor.clips.length >= 30) return toast('30 clips maximum', 'warn');
        editor.clips.push({ name: `Clip ${editor.clips.length + 1}`, kind: 'inner', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: 3 });
        drawList();
        drawMap();
      } });
      mapWrap.append(h('h3', 'Carte'), map, h('div.hint', 'Clique sur la carte pour placer un clip. ', h('span', { style: { color: CLIP_COLORS.inner } }, 'Intérieur'), ' : la corde à frôler. ', h('span', { style: { color: CLIP_COLORS.outer } }, 'Extérieur'), ' : le mur ou la zone à approcher avec l’arrière.'));
    };
    const drawList = () => {
      clear(list);
      if (!editor.clips.length) list.append(h('p.muted', { style: { margin: 0 } }, 'Aucun clip pour l’instant.'));
      editor.clips.forEach((c, i) => list.append(h('div.course-clip',
        h('strong', `${i + 1}`),
        h('input.input', { value: c.name, maxlength: 30, on: { input: (e) => { c.name = e.target.value; } } }),
        select([['inner', 'Intérieur'], ['outer', 'Extérieur']], c.kind, (v) => { c.kind = v; redraw(); }),
        range('Taille', { min: 1, max: 10, step: 0.5, value: c.r, format: (v) => `${v} m`, onInput: (v) => { c.r = v; redraw(); } }),
        h('button.btn.btn-sm.btn-ghost', { title: 'Retirer', on: { click: () => { editor.clips.splice(i, 1); drawList(); drawMap(); } } }, icon('trash')))));
    };
    const side = h('div.course-side',
      h('div.panel',
        h('h3', 'Parcours'),
        editor.lap ? [
          range('Départ', { min: 0, max: 0.99, step: 0.01, value: editor.section[0], format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => { editor.section[0] = Math.min(v, editor.section[1] - 0.01); redraw(); } }),
          range('Arrivée', { min: 0.01, max: 1, step: 0.01, value: editor.section[1], format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => { editor.section[1] = Math.max(v, editor.section[0] + 0.01); redraw(); } }),
          h('p.hint', 'La partie notée de la run. La ligne et la vitesse de ce tour servent de référence.'),
        ] : h('p.hint', { style: { marginTop: 0 } }, 'Choisis une run pour changer la ligne de référence ou le départ et l’arrivée.'),
        h('h3.mt', 'Clips'),
        list),
      h('div.row.mt',
        editor.existing ? h('button.btn.btn-sm.btn-ghost', { on: { click: async () => {
          if (!(await confirmBox('Supprimer le parcours', 'Le circuit repassera sur le tracé automatique (s’il a une ligne IA).', 'Supprimer'))) return;
          if (await guard(() => api.call('admin:saveDriftCourse', { track, layout, remove: true }), 'Parcours supprimé')) { editor = { key: editor.key }; render(); }
        } } }, 'Supprimer') : null,
        h('button.btn.btn-sm.btn-primary.right', { on: { click: async () => {
          const ok = await guard(() => api.call('admin:saveDriftCourse', { track, layout, lapId: editor.lapId || null, section: editor.section, clips: editor.clips, rules: editor.rules, refLine: editor.lapId ? undefined : editor.autoRefLine || undefined }), 'Parcours publié : les runs sont notées avec ces clips et ces règles');
          if (ok) { editor = { key: editor.key }; render(); }
        } } }, icon('upload'), 'Publier')));
    body.append(h('div.course-layout', h('div.course-main', mapWrap, rulesPanel(() => {})), side));
    drawList();
    drawMap();
  }

  // ------------------------------------------------------------ battles
  async function renderBattles() {
    const { laps, map: combosMap } = await combos();
    const keys = [...combosMap.keys()];
    if (!battleQuery.track && keys.length) Object.assign(battleQuery, combosMap.get(boardQuery.track ? `${boardQuery.track}|${boardQuery.layout}` : laps[0] ? `${laps[0].track}|${laps[0].layout || ''}` : keys[0]) || combosMap.get(keys[0]));
    if (!presets) presets = (await api.call('drift:modes')).presets;
    body.append(h('div.toolbar',
      keys.length ? select(keys.map((k) => [k, trackName(combosMap.get(k).track, combosMap.get(k).layout)]), `${battleQuery.track}|${battleQuery.layout}`, (v) => { Object.assign(battleQuery, combosMap.get(v)); render(); }, 'board-select') : null,
      seg(MODES, judgeMode, (v) => { judgeMode = v; render(); })));
    const omt = presets[judgeMode].battle.omtGap;
    body.append(h('div.notice.info', `Battle : deux runs avec les rôles inversés, sur le même circuit, à moins de 20 min d’écart. Chaque pilote a (note en lead + note en chase) / 2. Moins de ${omt} point${omt > 1 ? 's' : ''} d’écart : one more time. L’appli en jeu enregistre les deux runs.`));
    if (!battleQuery.track) return;
    const res = await guard(() => api.call('battles:list', { ...battleQuery, mode: judgeMode }));
    if (!res) return;
    if (res.error) body.append(h('div.notice.mt', res.error));
    if (!res.battles.length) {
      body.append(h('div.empty.mt', h('strong', 'Pas encore de battle'), 'Roule en tandem avec un pote : un passage chacun devant, et la battle est jugée toute seule.'));
      return;
    }
    const list = h('div.grid.mt');
    for (const b of res.battles) {
      const r = b.result;
      const [a, c] = r.drivers;
      const me = (n) => (store.settings.driverName || '').trim().toLowerCase() === n.trim().toLowerCase();
      list.append(h('div.panel.battle-card',
        h('div.row',
          h('div', h('div.battle-title', `${a.name} vs ${c.name}`), h('div.s', `${dateFr(b.date)} · ${MODE_LABEL[judgeMode]}`)),
          h('div.right', r.omt ? h('span.tag.warn', 'One more time') : h('span.tag.ok', `${r.winner} gagne`))),
        h('div.battle-table',
          h('span.label', 'Pilote'), h('span.label', 'Lead'), h('span.label', 'Chase'), h('span.label', 'Total'),
          ...[a, c].flatMap((d) => [h(`span${d.name === r.winner ? '.battle-win' : ''}`, d.name, me(d.name) ? ' (toi)' : ''), h('span', d.lead.toFixed(1)), h('span', d.chase.toFixed(1)), h('strong', d.total.toFixed(1))])),
        b.remote ? h('p.hint', 'Battle partagée par un autre pilote.') : h('div.row.mt',
          ...b.runs.map((run, i) => h('button.btn.btn-sm', { on: { click: () => openTandem(run.lapId) } }, `Run ${i + 1} : ${run.lead} devant`)))));
    }
    body.append(list);
  }

  // ------------------------------------------------------------ championship
  const KIND_LABEL = { drift: 'Solo drift', tandem: 'Tandem', battle: 'Battle' };
  const STATUS_TAG = { upcoming: ['plain', 'À venir'], live: ['warn', 'En cours'], done: ['ok', 'Terminée'] };
  const toLocal = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const strip = (list) => list.map((c) => ({ id: c.id, name: c.name, points: [...c.points], rounds: c.rounds.map((r) => ({ id: r.id, name: r.name, track: r.track, layout: r.layout || '', kind: r.kind, mode: r.mode, start: r.start, end: r.end, bracket: r.bracket || 8 })) }));

  async function renderChamp() {
    const list = (await guard(() => api.call('champ:list'))) || [];
    if (champEditor) return renderChampEditor(list);
    if (!list.length) {
      body.append(h('div.empty', h('strong', 'Pas encore de championnat'), isAdmin() ? 'Crée-en un : des manches en solo, en tandem ou en battle, avec des points.' : 'Les admins n’en ont pas encore créé.'));
      if (isAdmin()) body.append(h('div.row.mt', h('button.btn.btn-primary', { on: { click: () => { champEditor = strip(list); champEditor.push(newChamp()); champIndex = champEditor.length - 1; render(); } } }, icon('plus'), 'Créer un championnat')));
      return;
    }
    champIndex = Math.min(champIndex, list.length - 1);
    const c = list[champIndex];
    body.append(h('div.toolbar',
      list.length > 1 ? select(list.map((x, i) => [String(i), x.name]), String(champIndex), (v) => { champIndex = Number(v); render(); }, 'board-select') : h('h2.champ-name', c.name),
      isAdmin() ? h('button.btn.btn-sm.right', { on: { click: () => { champEditor = strip(list); render(); } } }, 'Modifier') : null));
    // standings
    const st = h('div.panel', h('h3', 'Classement général'));
    if (!c.standings.length) st.append(h('p.muted', { style: { margin: 0 } }, 'Pas encore de points.'));
    else {
      st.append(h('div.champ-table', { style: { gridTemplateColumns: `40px minmax(0, 1fr) repeat(${c.rounds.length}, 44px) 70px` } },
        h('span.label', '#'), h('span.label', 'Pilote'), ...c.rounds.map((_, i) => h('span.label', { title: c.rounds[i].name }, `M${i + 1}`)), h('span.label', 'Points'),
        ...c.standings.flatMap((r, i) => [
          h('span.board-pos', `${i + 1}`),
          h('span', h('strong', r.name), h('span.s', ` ${r.wins} victoire${r.wins > 1 ? 's' : ''} · ${r.podiums} podium${r.podiums > 1 ? 's' : ''}`)),
          ...c.rounds.map((_, k) => h('span.s', r.rounds[k] ? String(r.rounds[k]) : '—')),
          h('strong.board-v', String(r.points))])));
    }
    body.append(st);
    // rounds
    c.rounds.forEach((r, i) => {
      const [tagCls, tagText] = STATUS_TAG[r.status];
      const panel = h('div.panel.mt',
        h('div.row',
          h('div', h('h3', { style: { margin: 0 } }, `M${i + 1} · ${r.name}`), h('div.s', `${trackName(r.track, r.layout)} · ${KIND_LABEL[r.kind]}${r.kind === 'battle' ? ` top ${r.bracket}` : ''} · ${MODE_LABEL[r.mode]} · du ${dateFr(r.start)} au ${dateFr(r.end)}`)),
          h(`span.tag.${tagCls}.right`, tagText)));
      if (r.error) panel.append(h('div.notice.mt', r.error));
      if (r.kind !== 'battle') {
        if (!r.results.length) panel.append(h('p.muted', r.status === 'upcoming' ? 'Pas encore commencée.' : 'Personne n’a encore roulé.'));
        else panel.append(resultsList(r.results.slice(0, 16), true));
      } else {
        panel.append(h('div.label.mt', 'Qualifications (solo)'));
        if (!r.qualifying.length) panel.append(h('p.muted', r.status === 'upcoming' ? 'Pas encore commencée.' : 'Personne n’a encore roulé.'));
        else panel.append(resultsList(r.qualifying.slice(0, r.bracket).map((q, k) => ({ position: k + 1, name: q.name, score: q.score })), false));
        if (r.qualifying.length >= 2) panel.append(h('div.label.mt', 'Tableau'), bracketView(r.draw));
        if (r.results.length) panel.append(h('div.label.mt', 'Résultat'), resultsList(r.results, true));
      }
      body.append(panel);
    });
  }

  function resultsList(rows, withPoints) {
    return h('div.champ-results', ...rows.map((x) => h('div.champ-result', h('span.board-pos', String(x.position)), h('span', x.name), h('span.s', x.score != null ? `${Number(x.score).toFixed(1)}/100` : ''), withPoints ? h('strong', `${x.points} pts`) : h('span'))));
  }

  function bracketView(br) {
    const names = ['Finale', 'Demi-finales', 'Quarts', 'Huitièmes', 'Seizièmes'];
    return h('div.bracket', ...br.rounds.map((matches, k) => h('div.bracket-col',
      h('div.label', names[br.rounds.length - 1 - k] || `Tour ${k + 1}`),
      ...matches.map((m) => h('div.bracket-match',
        ...[m.a, m.b].map((n) => h(`div.bracket-slot${n && m.winner === n ? '.win' : ''}`, n || (m.bye ? '—' : '?'))),
        h('div.s', m.bye ? 'Qualifié d’office' : m.winner ? (m.battle ? `${m.battle.drivers.map((d) => d.total.toFixed(1)).join(' – ')}` : '') : m.omt ? 'One more time' : m.a && m.b ? 'À jouer' : ''))))));
  }

  function newChamp() {
    return { id: Math.random().toString(36).slice(2, 8), name: 'Saison 1', points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], rounds: [] };
  }

  async function renderChampEditor() {
    const { map: combosMap } = await combos();
    const keys = [...combosMap.keys()];
    if (!champEditor.length) champEditor.push(newChamp());
    champIndex = Math.min(champIndex, champEditor.length - 1);
    const c = champEditor[champIndex];
    body.append(h('div.toolbar',
      select(champEditor.map((x, i) => [String(i), x.name]), String(champIndex), (v) => { champIndex = Number(v); render(); }, 'board-select'),
      h('button.btn.btn-sm', { on: { click: () => { champEditor.push(newChamp()); champIndex = champEditor.length - 1; render(); } } }, icon('plus'), 'Nouveau championnat'),
      h('button.btn.btn-sm.btn-ghost.right', { on: { click: () => { champEditor = null; render(); } } }, 'Annuler')));
    const roundsBox = h('div.grid');
    const drawRounds = () => {
      clear(roundsBox);
      if (!c.rounds.length) roundsBox.append(h('p.muted', { style: { margin: 0 } }, 'Aucune manche.'));
      c.rounds.forEach((r, i) => roundsBox.append(h('div.champ-round-edit',
        h('strong.champ-round-n', `M${i + 1}`),
        h('div.champ-round-fields',
          field('Nom', h('input.input', { value: r.name, maxlength: 60, on: { input: (e) => { r.name = e.target.value; } } })),
          field('Circuit', select(keys.map((k) => [k, trackName(combosMap.get(k).track, combosMap.get(k).layout)]), `${r.track}|${r.layout || ''}`, (v) => Object.assign(r, combosMap.get(v)))),
          field('Format', select([['drift', 'Solo drift'], ['tandem', 'Tandem'], ['battle', 'Battle']], r.kind, (v) => { r.kind = v; drawRounds(); })),
          field('Mode', select(MODES, r.mode, (v) => { r.mode = v; })),
          field('Début', h('input.input', { type: 'datetime-local', value: toLocal(r.start), on: { change: (e) => { r.start = new Date(e.target.value).toISOString(); } } })),
          field('Fin', h('input.input', { type: 'datetime-local', value: toLocal(r.end), on: { change: (e) => { r.end = new Date(e.target.value).toISOString(); } } })),
          r.kind === 'battle' ? field('Tableau', select([['4', 'Top 4'], ['8', 'Top 8'], ['16', 'Top 16']], String(r.bracket || 8), (v) => { r.bracket = Number(v); })) : h('span')),
        h('button.btn.btn-sm.btn-ghost', { title: 'Retirer', on: { click: () => { c.rounds.splice(i, 1); drawRounds(); } } }, icon('trash')))));
    };
    drawRounds();
    body.append(
      h('div.panel',
        h('div.grid.grid-2',
          field('Nom', h('input.input', { value: c.name, maxlength: 60, on: { input: (e) => { c.name = e.target.value; } } })),
          field('Points par place', h('input.input.mono', { value: c.points.join(', '), on: { change: (e) => { c.points = e.target.value.split(/[,; ]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0); } } }), '1er, 2e, 3e…')),
        h('h3.mt', 'Manches'),
        h('p.hint', 'Solo drift et tandem : la meilleure note de chaque pilote pendant la manche. Battle : qualifs en solo pendant la manche, puis tableau à élimination avec les battles.'),
        roundsBox,
        h('div.row.mt',
          h('button.btn.btn-sm', { on: { click: () => {
            if (!keys.length) return toast('Aucun circuit disponible', 'warn');
            const first = combosMap.get(keys[0]);
            const start = new Date();
            start.setMinutes(0, 0, 0);
            c.rounds.push({ id: Math.random().toString(36).slice(2, 8), name: `Manche ${c.rounds.length + 1}`, track: first.track, layout: first.layout, kind: 'drift', mode: 'normal', start: start.toISOString(), end: new Date(start.getTime() + 7 * 86400000).toISOString(), bracket: 8 });
            drawRounds();
          } } }, icon('plus'), 'Ajouter une manche'),
          h('button.btn.btn-sm.btn-ghost', { on: { click: async () => { if (await confirmBox('Supprimer', `Supprimer « ${c.name} » ?`, 'Supprimer')) { champEditor.splice(champIndex, 1); champIndex = 0; render(); } } } }, 'Supprimer ce championnat'),
          h('button.btn.btn-sm.btn-primary.right', { on: { click: async () => {
            if (await guard(() => api.call('admin:saveChampionships', champEditor), 'Championnat publié')) { champEditor = null; render(); }
          } } }, icon('upload'), 'Publier'))));
  }

  // ------------------------------------------------------------ tools
  async function renderTools() {
    const [st, tools, game, ghost] = await Promise.all([api.call('telemetry:status'), api.call('tools:status'), api.call('ingame:status'), api.call('ghost:status').catch(() => null)]);
    const setT = async (patch) => { await guard(() => api.call('telemetry:settings', patch)); render(); };
    body.append(
      h('div.grid.grid-2',
        h('div.panel', h('h3', 'Réglages'),
          toggle('Enregistrer mes tours', st.enabled !== false, (v) => setT({ enabled: v })),
          toggle('Envoyer mes records au classement', st.shareLaps !== false, (v) => setT({ shareLaps: v }), st.board ? 'Seuls tes meilleurs tours sont envoyés.' : 'Classement partagé pas encore configuré par les admins.')),
        h('div.panel', h('h3', 'Appli en jeu'),
          h('p.muted', { style: { marginTop: 0 } }, 'Angle, clips et écart avec ton meilleur tour pendant que tu roules. Elle enregistre aussi tes tandems : c’est elle qui voit la voiture devant toi. Custom Shaders Patch requis.'),
          h('div.row.wrap',
            game.installed ? h(`span.tag.${game.upToDate ? 'ok' : 'warn'}`, game.upToDate ? `Installée (v${game.installed})` : `Mise à jour v${game.available}`) : h('span.tag.plain', 'Non installée'),
            h('button.btn.btn-sm.btn-primary', { on: { click: async () => { if (await guard(() => api.call('ingame:install'), 'Appli installée')) render(); } } }, game.installed && game.upToDate ? 'Réinstaller' : 'Installer'),
            game.installed ? h('button.btn.btn-sm.btn-ghost', { on: { click: async () => { await guard(() => api.call('ingame:remove')); render(); } } }, 'Retirer') : null),
          h('p.hint', 'En jeu : barre d’applis à droite de l’écran, puis « LKS ».'),
          h('h3.mt', 'Fantôme'),
          ghost
            ? h('div.row.wrap', h('span', `${ghost.driver} · ${trackName(ghost.track, ghost.layout)} · ${lapTime(ghost.lapMs)}`), h('button.btn.btn-sm.btn-ghost', { on: { click: async () => { await api.call('ghost:clear'); render(); } } }, 'Retirer'))
            : h('p.muted', { style: { margin: 0 } }, 'Aucun. Choisis un tour avec « Fantôme » dans Tours ou Classement : une voiture translucide le rejoue pour que tu la suives.')),
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
