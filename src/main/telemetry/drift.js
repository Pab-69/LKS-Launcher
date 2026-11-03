'use strict';

/**
 * Drift judging, like a competition run (never the clock).
 *
 * Solo run (note sur 100):  angle + vitesse + ligne/clips, minus penalties.
 * Tandem (chase, note sur 100): proximité + angle copié + ligne du leader + drift du chaser.
 *
 * Three modes judge every run at once, each with its own leaderboard:
 *   debutant (forgiving), normal, pro (« Compétition »: mistakes = run à 0).
 * Admins can change any rule per track (course.rules[mode]), e.g. « 2 roues
 * dehors = 0 », « regrip = 0 », « drift dans le mauvais sens = 0 ».
 *
 * Course (per track/layout, published in the manifest or generated from the
 * track's AI line):
 *   { section: [dStart, dEnd], clips: [{ name, kind: 'inner'|'outer', x, z, r, path? }],
 *   (a clip with a path is a long zone painted along the road: hit within r of the path)
 *     refLine: [[x, z], …], refSpeed, slipSign, rules: { debutant: {…}, normal: {…}, pro: {…} } }
 */

const crypto = require('crypto');

// sample columns (see recorder COLUMNS); 12 = signed slip angle, 13 = contact (tandem), 14 = heading
const C = { d: 0, t: 1, speed: 2, angle: 8, x: 9, z: 10, out: 11, slip: 12, contact: 13, yaw: 14 };
// the front and the rear of the car, from its centre (a drift car is about 4.4 m long)
const HALF_LENGTH = 2.0;
// lead sample columns (tandem)
const LC = { x: 0, z: 1, angle: 2, speed: 3, slip: 4 };

const DRIFT_ANGLE = 12; // ° minimum to count as sideways
const DRIFT_SPEED = 25; // km/h
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;

const MODE_IDS = ['debutant', 'normal', 'pro'];
const MODE_LABELS = { debutant: 'Débutant', normal: 'Normal', pro: 'Compétition' };

// rule = { action: 'none' | 'points' | 'zero', points }
const MODES = {
  debutant: {
    weights: { angle: 35, speed: 30, line: 35 },
    angleMin: 5,
    angleTarget: 30,
    speedAbs: [20, 70],
    speedRef: [0.4, 0.85],
    lineTol: [3, 12],
    clipScale: 1.5,
    off: { wheels: 4, action: 'points', points: 2 },
    straighten: { minMs: 900, action: 'points', points: 1 },
    reverse: { action: 'points', points: 3 },
    spin: { action: 'points', points: 10 },
    missedClip: { action: 'none', points: 0 },
    battle: { omtGap: 1 },
    tandem: { weights: { proximity: 35, angle: 25, line: 20, drift: 20 }, gap: [3, 18], lostGap: 40, contact: { action: 'points', points: 3 }, pass: { action: 'points', points: 5 }, lost: { action: 'points', points: 3 } },
  },
  normal: {
    weights: { angle: 35, speed: 30, line: 35 },
    angleMin: 10,
    angleTarget: 40,
    speedAbs: [30, 90],
    speedRef: [0.5, 1],
    lineTol: [1.5, 7.5],
    clipScale: 1,
    off: { wheels: 3, action: 'points', points: 5 },
    straighten: { minMs: 600, action: 'points', points: 3 },
    reverse: { action: 'points', points: 10 },
    spin: { action: 'points', points: 20 },
    missedClip: { action: 'none', points: 2 },
    battle: { omtGap: 2 },
    tandem: { weights: { proximity: 35, angle: 25, line: 20, drift: 20 }, gap: [2, 12], lostGap: 25, contact: { action: 'points', points: 10 }, pass: { action: 'zero', points: 0 }, lost: { action: 'points', points: 10 } },
  },
  pro: {
    weights: { angle: 35, speed: 30, line: 35 },
    angleMin: 15,
    angleTarget: 45,
    speedAbs: [40, 100],
    speedRef: [0.6, 1],
    lineTol: [1, 5],
    clipScale: 0.8,
    off: { wheels: 2, action: 'zero', points: 0 },
    straighten: { minMs: 400, action: 'zero', points: 0 },
    reverse: { action: 'zero', points: 0 },
    spin: { action: 'zero', points: 0 },
    missedClip: { action: 'points', points: 5 },
    battle: { omtGap: 3 },
    tandem: { weights: { proximity: 35, angle: 25, line: 20, drift: 20 }, gap: [1.5, 9], lostGap: 18, contact: { action: 'zero', points: 0 }, pass: { action: 'zero', points: 0 }, lost: { action: 'zero', points: 0 } },
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

/** Short fingerprint of a reference line (official courses: the line can change with the same number of points). */
function lineSignature(line = []) {
  let a = 0;
  line.forEach((p, i) => {
    a += p[0] * ((i % 7) + 1) + p[1] * ((i % 5) + 1);
  });
  return Math.round(a);
}

/** Distance from (x, z) to a clip: to its centre, or to its path for a long zone. */
function clipDist(c, x, z) {
  const p = c.path;
  if (!Array.isArray(p) || p.length < 2) return Math.hypot(x - c.x, z - c.z);
  let best = Infinity;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const l2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    best = Math.min(best, Math.hypot(x - ax - vx * k, z - az - vz * k));
  }
  return best;
}

/**
 * Point of the car judged for a clip: the front for a corde (inner), the rear
 * for an outer zone, as the judges do. Without the heading (older laps): the centre.
 */
function judgedPoint(c, x, z, yaw) {
  if (!Number.isFinite(yaw) || yaw === null) return [x, z];
  const k = c.kind === 'outer' ? -HALF_LENGTH : HALF_LENGTH;
  return [x + Math.sin(yaw) * k, z + Math.cos(yaw) * k];
}

/** Position along a zone's path (m from its start) and distance to it. */
function alongPath(path, x, z) {
  let best = null;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const len = Math.hypot(vx, vz) || 1e-9;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (len * len)));
    const dist = Math.hypot(x - ax - vx * k, z - az - vz * k);
    if (!best || dist < best.dist) best = { dist, at: acc + k * len };
    acc += len;
  }
  return { ...best, length: acc };
}

const isZone = (c) => Array.isArray(c.path) && c.path.length > 1;
const ZONE_HIT = 0.2; // share of a long zone to cover for it to count

/**
 * Judge one clip over rows of samples: { hit, dist, q, cover, d }.
 * Small clip: closest approach of the judged point. Long zone: share of its
 * length covered while sideways (1 m slices).
 */
function judgeClip(c, rows, r) {
  if (isZone(c)) {
    let length = 0;
    for (let i = 1; i < c.path.length; i++) length += Math.hypot(c.path[i][0] - c.path[i - 1][0], c.path[i][1] - c.path[i - 1][1]);
    const slices = new Uint8Array(Math.max(1, Math.ceil(length)));
    let best = null;
    for (const s of rows) {
      const [px, pz] = judgedPoint(c, s[C.x], s[C.z], s[C.yaw]);
      const a = alongPath(c.path, px, pz);
      if (!best || a.dist < best.dist) best = { dist: a.dist, s };
      if (a.dist <= r && sideways(s)) slices[Math.min(slices.length - 1, Math.floor(a.at))] = 1;
    }
    const cover = slices.reduce((a, v) => a + v, 0) / slices.length;
    const hit = cover >= ZONE_HIT;
    return { hit, dist: best ? r1(best.dist) : null, q: hit ? r1(cover * 100) / 100 : 0, cover: Math.round(cover * 100), d: best ? best.s[C.d] : null };
  }
  let best = null;
  for (const s of rows) {
    const [px, pz] = judgedPoint(c, s[C.x], s[C.z], s[C.yaw]);
    const dist = Math.hypot(px - c.x, pz - c.z);
    if (!best || dist < best.dist) best = { dist, s };
  }
  const hit = Boolean(best && best.dist <= r && sideways(best.s));
  return { hit, dist: best ? r1(best.dist) : null, q: hit ? r1((1 - 0.5 * (best.dist / r)) * 100) / 100 : 0, d: best ? best.s[C.d] : null };
}

/** Rules of a mode for a course: preset + the admins' changes for this track. */
function rulesFor(course, mode = 'normal') {
  const m = MODES[mode] ? mode : 'normal';
  return merge(MODES[m], course && course.rules && course.rules[m]);
}

/** Version of a course + rules for one mode: scores only compare within the same version. */
function courseVersion(course, mode = 'normal') {
  const m = MODES[mode] ? mode : 'normal';
  const c = course || {};
  const body = JSON.stringify([c.section || [0, 1], (c.clips || []).map((k) => [k.kind, r1(k.x), r1(k.z), r1(k.r), ...(Array.isArray(k.path) ? [k.path.length, ...k.path[0], ...k.path[k.path.length - 1]] : [])]), (c.refLine || []).length, Math.round(c.refSpeed || 0), rulesFor(course, m), ...(c.official ? [lineSignature(c.refLine)] : [])]);
  return `${crypto.createHash('sha256').update(body).digest('hex').slice(0, 8)}-${m}`;
}

/** Signed slip angle in the samples (newer laps). */
const hasSlip = (rows) => rows.length > 0 && rows[0].length > C.slip;

/** Turn direction of the path at each sample: +1 / -1 / 0 (straight), from the x/z trajectory. */
function turnSigns(rows, span = 6, minCurv = 1 / 150) {
  const out = new Array(rows.length).fill(0);
  for (let i = span; i < rows.length - span; i++) {
    const a = rows[i - span];
    const b = rows[i];
    const c = rows[i + span];
    const v1 = [b[C.x] - a[C.x], b[C.z] - a[C.z]];
    const v2 = [c[C.x] - b[C.x], c[C.z] - b[C.z]];
    const l1 = Math.hypot(...v1);
    const l2 = Math.hypot(...v2);
    if (l1 < 0.5 || l2 < 0.5) continue;
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const ang = Math.asin(clamp(cross / (l1 * l2), -1, 1));
    const curv = ang / ((l1 + l2) / 2);
    if (Math.abs(curv) >= minCurv) out[i] = Math.sign(curv);
  }
  return out;
}

/** Usual sign of slip × turn while drifting (depends on the game's axes; learnt from runs). */
function slipConvention(rows) {
  if (!hasSlip(rows)) return 0;
  const turns = turnSigns(rows);
  let sum = 0;
  rows.forEach((s, i) => {
    if (turns[i] && s[C.angle] >= 15 && s[C.speed] >= DRIFT_SPEED) sum += Math.sign(s[C.slip]) * turns[i];
  });
  return Math.sign(sum);
}

/** Build a course's reference line from a lap (downsampled x/z), its average speed and slip convention. */
function referenceFrom(samples, section = [0, 1], points = 400) {
  const inSection = samples.filter((s) => s[C.d] >= section[0] && s[C.d] <= section[1]);
  const step = Math.max(1, Math.floor(inSection.length / points));
  const refLine = inSection.filter((_, i) => i % step === 0).map((s) => [r1(s[C.x]), r1(s[C.z])]);
  const speeds = inSection.map((s) => s[C.speed]);
  const refSpeed = speeds.length ? r1(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
  const slipSign = slipConvention(inSection);
  return slipSign ? { refLine, refSpeed, slipSign } : { refLine, refSpeed };
}

function distToLine(x, z, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz;
    const k = len ? clamp(((x - ax) * dx + (z - az) * dz) / len, 0, 1) : 0;
    const d = Math.hypot(x - (ax + dx * k), z - (az + dz * k));
    if (d < best) best = d;
  }
  return best;
}

/** Episodes where cond(i) holds for minMs to maxMs. Returns [{ d, ms }]. */
function episodes(rows, cond, minMs, maxMs = Infinity) {
  const out = [];
  let start = null;
  for (let i = 0; i < rows.length; i++) {
    const on = cond(rows[i], i);
    if (on && start === null) start = i;
    if ((!on || i === rows.length - 1) && start !== null) {
      const end = on ? i : i - 1;
      const ms = rows[end][C.t] - rows[start][C.t];
      if (ms >= minMs && ms <= maxMs) out.push({ d: rows[start][C.d], ms });
      start = null;
    }
  }
  return out;
}

const sideways = (s) => s[C.angle] >= DRIFT_ANGLE && s[C.speed] >= DRIFT_SPEED;

/** Judged part of a run: from initiation to the last moment sideways, inside the section. */
function judgedRows(samples, course) {
  const section = (course && course.section) || [0, 1];
  const rows = samples.filter((s) => s[C.d] >= section[0] && s[C.d] <= section[1]);
  const start = rows.findIndex(sideways);
  if (start < 0) return null;
  let end = rows.length - 1;
  while (end > start && !sideways(rows[end])) end--;
  const judged = rows.slice(start, end + 1);
  return judged.length >= 5 ? { judged, rows: rows.slice(start) } : null;
}

/** Apply the infraction rules: returns { penalty, zeroed, penalties[] }. */
function applyRules(found) {
  const penalties = [];
  let zeroed = null;
  for (const { rule, label, kind, d } of found) {
    if (!rule || rule.action === 'none') continue;
    if (rule.action === 'zero') {
      penalties.push({ kind, label, points: 0, zero: true, d });
      if (!zeroed) zeroed = label;
    } else if (rule.points > 0) penalties.push({ kind, label, points: rule.points, d });
  }
  return { penalty: penalties.reduce((a, p) => a + p.points, 0), zeroed, penalties };
}

/** Infractions shared by solo and tandem judging. */
function infractions(judged, rules, course) {
  const found = [];
  const spin = judged.find((s) => s[C.angle] > 100 || s[C.speed] < 8);
  if (spin) found.push({ rule: rules.spin, kind: 'spin', label: 'Tête-à-queue', d: spin[C.d] });
  episodes(judged, (s) => s[C.angle] < 8 && s[C.speed] >= DRIFT_SPEED, rules.straighten.minMs || 600, 3000)
    .slice(0, 4)
    .forEach((e) => found.push({ rule: rules.straighten, kind: 'straight', label: 'Regrip', d: e.d }));
  if (judged[0].length > C.out) {
    const wheels = clamp(Number(rules.off.wheels) || 3, 1, 4);
    episodes(judged, (s) => s[C.out] >= wheels, 300)
      .slice(0, 3)
      .forEach((e) => found.push({ rule: rules.off, kind: 'off', label: `${wheels} roue${wheels > 1 ? 's' : ''} dehors`, d: e.d }));
  }
  if (hasSlip(judged)) {
    const conv = (course && course.slipSign) || slipConvention(judged);
    if (conv) {
      const turns = turnSigns(judged);
      episodes(judged, (s, i) => turns[i] !== 0 && s[C.angle] >= 15 && Math.sign(s[C.slip]) * turns[i] === -conv, 400)
        .slice(0, 2)
        .forEach((e) => found.push({ rule: rules.reverse, kind: 'reverse', label: 'Drift dans le mauvais sens', d: e.d }));
    }
  }
  return found;
}

function averages(judged) {
  let total = 0;
  let angleSum = 0;
  let speedSum = 0;
  let driftTime = 0;
  let maxAngle = 0;
  for (let i = 1; i < judged.length; i++) {
    const dt = Math.max(0, judged[i][C.t] - judged[i - 1][C.t]);
    const s = judged[i];
    total += dt;
    angleSum += Math.min(s[C.angle], 90) * dt;
    speedSum += s[C.speed] * dt;
    if (sideways(s)) driftTime += dt;
    maxAngle = Math.max(maxAngle, Math.min(s[C.angle], 90));
  }
  return total ? { total, avgAngle: angleSum / total, avgSpeed: speedSum / total, driftTime, maxAngle } : null;
}

const angleQ = (avg, rules) => clamp((avg - rules.angleMin) / (rules.angleTarget - rules.angleMin || 1), 0, 1);

/**
 * Score a solo run in one mode. Returns null when the car never drifted.
 * { score, angle, speed, line, penalty, zeroed, penalties[], clips[], avgAngle, maxAngle, avgSpeed, driftTime, rules, mode }
 */
function scoreDrift(samples, course, mode = 'normal') {
  const rules = rulesFor(course, mode);
  const part = judgedRows(samples, course);
  if (!part) return null;
  const { judged } = part;
  const avg = averages(judged);
  if (!avg) return null;
  const W = rules.weights;

  const angle = W.angle * angleQ(avg.avgAngle, rules);
  const refSpeed = course && course.refSpeed > 0 ? course.refSpeed : 0;
  const [s0, s1] = refSpeed ? rules.speedRef : rules.speedAbs;
  const speed = W.speed * clamp(((refSpeed ? avg.avgSpeed / refSpeed : avg.avgSpeed) - s0) / (s1 - s0 || 1), 0, 1);

  // line: clips + reference line
  const found = [];
  const clips = ((course && course.clips) || []).map((c, i) => {
    const res = judgeClip(c, judged, (c.r || 3) * rules.clipScale);
    const name = c.name || `Clip ${i + 1}`;
    if (!res.hit) found.push({ rule: rules.missedClip, kind: 'clip', label: `${name} raté`, d: res.d });
    return { name, kind: c.kind || 'inner', ...res };
  });
  const clipsQ = clips.length ? clips.reduce((a, c) => a + c.q, 0) / clips.length : null;
  let lineQ = null;
  let lineDist = null;
  const ref = course && course.refLine && course.refLine.length > 1 ? course.refLine : null;
  if (ref) {
    const step = Math.max(1, Math.floor(judged.length / 300));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < judged.length; i += step) {
      sum += distToLine(judged[i][C.x], judged[i][C.z], ref);
      n++;
    }
    lineDist = sum / n;
    lineQ = clamp(1 - (lineDist - rules.lineTol[0]) / (rules.lineTol[1] - rules.lineTol[0] || 1), 0, 1);
  }
  const lineQuality = clipsQ !== null && lineQ !== null ? 0.6 * clipsQ + 0.4 * lineQ : clipsQ !== null ? clipsQ : lineQ;
  const line = lineQuality === null ? null : W.line * lineQuality;

  const { penalty, zeroed, penalties } = applyRules([...infractions(judged, rules, course), ...found]);
  const zones = zoneScores(judged, clips, penalties, { rules, W, ref, refSpeed, s0, s1 });
  // without clips or reference line, angle + speed are scaled to 100
  const raw = line === null ? ((angle + speed) / (W.angle + W.speed || 1)) * 100 : ((angle + speed + line) / (W.angle + W.speed + W.line || 1)) * 100;
  return {
    mode,
    score: zeroed ? 0 : r1(clamp(raw - penalty, 0, 100)),
    angle: r1(angle),
    speed: r1(speed),
    line: line === null ? null : r1(line),
    lineDist: lineDist === null ? null : r1(lineDist),
    penalty,
    zeroed,
    penalties,
    clips,
    zones,
    avgAngle: r1(avg.avgAngle),
    maxAngle: r1(avg.maxAngle),
    avgSpeed: r1(avg.avgSpeed),
    driftTime: r1(avg.driftTime / 1000),
    rules: courseVersion(course, mode),
  };
}

/**
 * Note per zone, as the judges give it: the run is cut around each clip
 * (half way to the previous and the next one). For each part: angle, speed,
 * line and the clip itself, minus the penalties given there, on 100.
 */
function zoneScores(judged, clips, penalties, { rules, W, ref, refSpeed, s0, s1 }) {
  const placed = clips.map((c, i) => ({ c, i, d: c.d })).filter((x) => Number.isFinite(x.d)).sort((a, b) => a.d - b.d);
  if (!placed.length) return [];
  const first = judged[0][C.d];
  const last = judged[judged.length - 1][C.d];
  return placed.map((p, k) => {
    const from = k === 0 ? first : (placed[k - 1].d + p.d) / 2;
    const to = k === placed.length - 1 ? last : (p.d + placed[k + 1].d) / 2;
    const rows = judged.filter((s) => s[C.d] >= from && s[C.d] <= to);
    const avg = rows.length > 2 ? averages(rows) : null;
    if (!avg) return { name: p.c.name, clip: p.c.hit, score: 0, avgAngle: 0, avgSpeed: 0 };
    const angle = W.angle * angleQ(avg.avgAngle, rules);
    const speed = W.speed * clamp(((refSpeed ? avg.avgSpeed / refSpeed : avg.avgSpeed) - s0) / (s1 - s0 || 1), 0, 1);
    let lineQ = null;
    if (ref) {
      let sum = 0;
      for (const s of rows) sum += distToLine(s[C.x], s[C.z], ref);
      lineQ = clamp(1 - (sum / rows.length - rules.lineTol[0]) / (rules.lineTol[1] - rules.lineTol[0] || 1), 0, 1);
    }
    const lineQuality = lineQ === null ? p.c.q : 0.6 * p.c.q + 0.4 * lineQ;
    const pen = penalties.filter((x) => Number.isFinite(x.d) && x.d >= from && x.d <= to);
    const zero = pen.some((x) => x.zero);
    const raw = ((angle + speed + W.line * lineQuality) / (W.angle + W.speed + W.line || 1)) * 100;
    return {
      name: p.c.name,
      clip: p.c.hit,
      ...(p.c.cover !== undefined ? { cover: p.c.cover } : {}),
      score: zero ? 0 : r1(clamp(raw - pen.reduce((a, x) => a + x.points, 0), 0, 100)),
      avgAngle: r1(avg.avgAngle),
      avgSpeed: r1(avg.avgSpeed),
      penalties: pen.map((x) => x.label),
    };
  });
}

/** Judge a solo run in every mode: the normal result + { modes: { debutant, normal, pro } }. */
function scoreAllModes(samples, course) {
  const modes = {};
  for (const m of MODE_IDS) modes[m] = scoreDrift(samples, course, m) || { mode: m, score: 0, rules: courseVersion(course, m), clips: [], penalties: [] };
  return { ...modes.normal, modes };
}

/**
 * Score the chase (follower) of a tandem run. samples = follower rows,
 * lead = rows [x, z, angle, speed, slip] aligned with the follower's.
 * { score, proximity, angleMatch, line, drift, penalty, zeroed, penalties[], avgGap, minGap, angleDiff, lineDist, rules, mode }
 */
function scoreTandem(samples, lead, course, mode = 'normal') {
  const rules = rulesFor(course, mode);
  const T = rules.tandem;
  if (!lead || lead.length !== samples.length) return null;
  const section = (course && course.section) || [0, 1];
  const idx = [];
  samples.forEach((s, i) => {
    if (s[C.d] >= section[0] && s[C.d] <= section[1]) idx.push(i);
  });
  const start = idx.findIndex((i) => sideways(samples[i]) || (lead[i][LC.angle] >= DRIFT_ANGLE && lead[i][LC.speed] >= DRIFT_SPEED));
  if (start < 0) return null;
  const used = idx.slice(start);
  if (used.length < 5) return null;
  const judged = used.map((i) => samples[i]);

  // lead's path (for "following the line")
  const leadLine = [];
  const step = Math.max(1, Math.floor(used.length / 300));
  for (let k = 0; k < used.length; k += step) leadLine.push([lead[used[k]][LC.x], lead[used[k]][LC.z]]);

  let total = 0;
  let prox = 0;
  let angleMatch = 0;
  let angleDiffSum = 0;
  let lineSum = 0;
  let lineN = 0;
  let gapSum = 0;
  let minGap = Infinity;
  const gaps = [];
  const ahead = [];
  for (let k = 0; k < used.length; k++) {
    const i = used[k];
    const f = samples[i];
    const l = lead[i];
    const gap = Math.hypot(f[C.x] - l[LC.x], f[C.z] - l[LC.z]);
    gaps.push(gap);
    // is the chaser in front? (vector lead → chaser along the lead's direction)
    const j = Math.min(i + 1, lead.length - 1);
    const p = Math.max(i - 1, 0);
    const dir = [lead[j][LC.x] - lead[p][LC.x], lead[j][LC.z] - lead[p][LC.z]];
    ahead.push((f[C.x] - l[LC.x]) * dir[0] + (f[C.z] - l[LC.z]) * dir[1] > 0 && gap > 1);
    if (k === 0) continue;
    const dt = Math.max(0, f[C.t] - samples[used[k - 1]][C.t]);
    total += dt;
    gapSum += gap * dt;
    minGap = Math.min(minGap, gap);
    prox += clamp(1 - (gap - T.gap[0]) / (T.gap[1] - T.gap[0] || 1), 0, 1) * dt;
    const diff = Math.abs(Math.min(f[C.angle], 90) - Math.min(l[LC.angle], 90));
    angleDiffSum += diff * dt;
    angleMatch += clamp(1 - diff / 25, 0, 1) * dt;
    if (k % step === 0) {
      lineSum += distToLine(f[C.x], f[C.z], leadLine);
      lineN++;
    }
  }
  if (!total) return null;
  const avg = averages(judged) || { avgAngle: 0, avgSpeed: 0 };
  const lineDist = lineN ? lineSum / lineN : 0;
  const W = T.weights;
  const proximity = W.proximity * (prox / total);
  const angleM = W.angle * (angleMatch / total);
  const line = W.line * clamp(1 - (lineDist - 1) / 5, 0, 1);
  const drift = W.drift * angleQ(avg.avgAngle, rules);

  const found = infractions(judged, rules, course);
  const contacts = episodes(judged, (s) => s.length > C.contact && s[C.contact] > 0, 0).slice(0, 3);
  contacts.forEach((e) => found.push({ rule: T.contact, kind: 'contact', label: 'Contact', d: e.d }));
  const passIdx = ahead.findIndex((a, k) => a && ahead.slice(k, k + 10).every(Boolean));
  if (passIdx >= 0) found.push({ rule: T.pass, kind: 'pass', label: 'Dépassement du leader', d: judged[passIdx][C.d] });
  const lost = episodes(judged, (s, k) => gaps[k] > T.lostGap, 2000).slice(0, 1);
  lost.forEach((e) => found.push({ rule: T.lost, kind: 'lost', label: 'Leader perdu', d: e.d }));
  const { penalty, zeroed, penalties } = applyRules(found);
  const raw = ((proximity + angleM + line + drift) / (W.proximity + W.angle + W.line + W.drift || 1)) * 100;
  return {
    mode,
    score: zeroed ? 0 : r1(clamp(raw - penalty, 0, 100)),
    proximity: r1(proximity),
    angleMatch: r1(angleM),
    line: r1(line),
    drift: r1(drift),
    penalty,
    zeroed,
    penalties,
    avgGap: r1(gapSum / total),
    minGap: r1(minGap),
    angleDiff: r1(angleDiffSum / total),
    lineDist: r1(lineDist),
    avgAngle: r1(avg.avgAngle),
    rules: courseVersion(course, mode),
  };
}

function scoreTandemAll(samples, lead, course) {
  const modes = {};
  for (const m of MODE_IDS) modes[m] = scoreTandem(samples, lead, course, m) || { mode: m, score: 0, rules: courseVersion(course, m), penalties: [] };
  return { ...modes.normal, modes };
}

/** The leader of a tandem run as solo samples (distance axis of the chaser). */
function leadSamplesAsRun(samples, lead) {
  return samples.map((s, i) => [s[C.d], s[C.t], lead[i][LC.speed], 0, 0, 0, 0, 0, lead[i][LC.angle], lead[i][LC.x], lead[i][LC.z], 0, lead[i][LC.slip]]);
}

/**
 * Battle tandem: two runs with the roles swapped. run1: A leads, B chases;
 * run2: B leads, A chases. Each driver gets (lead note + chase note) / 2.
 * Closer than the mode's « one more time » gap: OMT, the battle is replayed.
 */
function judgeBattle(run1, run2, course, mode = 'normal') {
  const rules = rulesFor(course, mode);
  const A = run1.tandem.lead.name;
  const B = run1.driver.name;
  const chase = (run) => {
    const r = scoreTandem(run.samples, run.tandem.leadSamples, course, mode);
    return r ? r.score : 0;
  };
  const lead = (run) => {
    const r = scoreDrift(leadSamplesAsRun(run.samples, run.tandem.leadSamples), course, mode);
    return r ? r.score : 0;
  };
  const a = { name: A, lead: lead(run1), chase: chase(run2) };
  const b = { name: B, chase: chase(run1), lead: lead(run2) };
  for (const d of [a, b]) d.total = r1((d.lead + d.chase) / 2);
  const diff = r1(Math.abs(a.total - b.total));
  const omt = diff < ((rules.battle && rules.battle.omtGap) || 0);
  return { mode, drivers: [a, b], diff, omt, winner: omt ? null : a.total > b.total ? A : B, rules: courseVersion(course, mode) };
}

function judgeBattleAll(run1, run2, course) {
  const modes = {};
  for (const m of MODE_IDS) modes[m] = judgeBattle(run1, run2, course, m);
  return modes;
}

/** Live clip feedback while driving: closest approach per clip so far. */
class LiveClips {
  constructor(course) {
    this.course = course;
    this.reset();
  }

  reset() {
    this.state = ((this.course && this.course.clips) || []).map((c, i) => {
      let slices = null;
      if (isZone(c)) {
        let len = 0;
        for (let k = 1; k < c.path.length; k++) len += Math.hypot(c.path[k][0] - c.path[k - 1][0], c.path[k][1] - c.path[k - 1][1]);
        slices = new Uint8Array(Math.max(1, Math.ceil(len)));
      }
      return { clip: c, name: c.name || `Clip ${i + 1}`, r: c.r || 3, best: null, hit: false, slices };
    });
  }

  feed(x, z, angle, speed, yaw) {
    const drifting = angle >= DRIFT_ANGLE && speed >= DRIFT_SPEED;
    for (const st of this.state) {
      const [px, pz] = judgedPoint(st.clip, x, z, yaw);
      if (st.slices) {
        const a = alongPath(st.clip.path, px, pz);
        if (a.dist > st.r * 4) continue;
        if (st.best === null || a.dist < st.best) st.best = a.dist;
        if (a.dist <= st.r && drifting) {
          st.slices[Math.min(st.slices.length - 1, Math.floor(a.at))] = 1;
          st.hit = st.slices.reduce((s, v) => s + v, 0) / st.slices.length >= ZONE_HIT;
        }
        continue;
      }
      const dist = Math.hypot(px - st.clip.x, pz - st.clip.z);
      if (dist > st.r * 4) continue;
      if (st.best === null || dist < st.best) st.best = dist;
      if (dist <= st.r && drifting) st.hit = true;
    }
  }

  summary() {
    const cover = (st) => (st.slices ? Math.round((st.slices.reduce((s, v) => s + v, 0) / st.slices.length) * 100) : undefined);
    return { total: this.state.length, hit: this.state.filter((c) => c.hit).length, clips: this.state.map((c) => ({ name: c.name, hit: c.hit, dist: c.best === null ? null : r1(c.best), ...(c.slices ? { cover: cover(c) } : {}) })) };
  }
}

/** Result of a lap in a mode (older laps only have the normal result). */
function driftOf(lap, mode = 'normal', kind = 'drift') {
  const d = kind === 'tandem' ? lap.tandem : lap.drift;
  if (!d) return null;
  if (d.modes && d.modes[mode]) return d.modes[mode];
  return mode === 'normal' && kind === 'drift' ? d : null;
}

module.exports = {
  clipDist,
  judgedPoint,
  judgeClip,
  HALF_LENGTH,
  scoreDrift,
  scoreAllModes,
  scoreTandem,
  scoreTandemAll,
  judgeBattle,
  judgeBattleAll,
  leadSamplesAsRun,
  courseVersion,
  rulesFor,
  referenceFrom,
  slipConvention,
  LiveClips,
  distToLine,
  driftOf,
  MODES,
  MODE_IDS,
  MODE_LABELS,
  DRIFT_ANGLE,
  DRIFT_SPEED,
};
