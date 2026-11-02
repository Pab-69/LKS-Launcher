'use strict';

/**
 * Drift judging, like a competition run (not the clock):
 *   Angle     35 pts  average angle over the judged section (straightening costs points)
 *   Vitesse   30 pts  average speed while judged (vs the reference run when there is one)
 *   Ligne     35 pts  clipping points hit while sideways + distance to the reference line
 *   Pénalités         spin, straightening, wheels off track
 *
 * The course (clips, reference line, judged section) is set by the admins per
 * track/layout and published in the manifest:
 *   { version, section: [dStart, dEnd], clips: [{ name, kind: 'inner'|'outer', x, z, r }],
 *     refLine: [[x, z], …], refSpeed }
 */

const crypto = require('crypto');

// sample columns (see recorder COLUMNS)
const C = { d: 0, t: 1, speed: 2, angle: 8, x: 9, z: 10, out: 11 };

const DRIFT_ANGLE = 12; // ° minimum to count as sideways
const DRIFT_SPEED = 25; // km/h
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;

/** Stable version id of a course: changes when the rules change, so old scores don't mix. */
function courseVersion(course) {
  if (!course) return '';
  const { section = [0, 1], clips = [], refLine = [], refSpeed = 0 } = course;
  const body = JSON.stringify([section, clips.map((c) => [c.kind, r1(c.x), r1(c.z), r1(c.r)]), refLine.length, Math.round(refSpeed)]);
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 8);
}

/** Build a course's reference line from a lap (downsampled x/z) and its average drift speed. */
function referenceFrom(samples, section = [0, 1], points = 400) {
  const inSection = samples.filter((s) => s[C.d] >= section[0] && s[C.d] <= section[1]);
  const step = Math.max(1, Math.floor(inSection.length / points));
  const refLine = inSection.filter((_, i) => i % step === 0).map((s) => [r1(s[C.x]), r1(s[C.z])]);
  const speeds = inSection.map((s) => s[C.speed]);
  const refSpeed = speeds.length ? r1(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
  return { refLine, refSpeed };
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

/** Episodes where cond(sample) holds for minMs to maxMs. Returns [{ d, ms }]. */
function episodes(rows, cond, minMs, maxMs = Infinity) {
  const out = [];
  let start = null;
  for (let i = 0; i < rows.length; i++) {
    const on = cond(rows[i]);
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

/**
 * Score a run. Returns null when the car never drifted.
 * { score, angle, speed, line, penalty, penalties[], clips[], avgAngle, maxAngle, avgSpeed, driftTime, rules }
 */
function scoreDrift(samples, course) {
  const section = (course && course.section) || [0, 1];
  const rows = samples.filter((s) => s[C.d] >= section[0] && s[C.d] <= section[1]);
  const sideways = (s) => s[C.angle] >= DRIFT_ANGLE && s[C.speed] >= DRIFT_SPEED;
  const start = rows.findIndex(sideways); // initiation
  if (start < 0) return null;
  const judged = rows.slice(start);
  if (judged.length < 5) return null;

  // time-weighted averages
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
  if (!total) return null;
  const avgAngle = angleSum / total;
  const avgSpeed = speedSum / total;

  const angle = 35 * clamp((avgAngle - 10) / 30, 0, 1); // full marks from 40° average
  const refSpeed = course && course.refSpeed > 0 ? course.refSpeed : 0;
  const speed = 30 * (refSpeed ? clamp((avgSpeed / refSpeed - 0.5) / 0.5, 0, 1) : clamp((avgSpeed - 30) / 60, 0, 1));

  // line: clips + reference line
  const clips = ((course && course.clips) || []).map((c, i) => {
    let best = null;
    for (const s of judged) {
      const dist = Math.hypot(s[C.x] - c.x, s[C.z] - c.z);
      if (!best || dist < best.dist) best = { dist, s };
    }
    const r = c.r || 3;
    const hit = best && best.dist <= r && sideways(best.s);
    return { name: c.name || `Clip ${i + 1}`, kind: c.kind || 'inner', hit: Boolean(hit), dist: best ? r1(best.dist) : null, q: hit ? r1((1 - 0.5 * (best.dist / r)) * 100) / 100 : 0, d: best ? best.s[C.d] : null };
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
    lineQ = clamp(1 - (lineDist - 1.5) / 6, 0, 1); // within 1.5 m = perfect, 7.5 m = zero
  }
  const lineQuality = clipsQ !== null && lineQ !== null ? 0.6 * clipsQ + 0.4 * lineQ : clipsQ !== null ? clipsQ : lineQ;
  const line = lineQuality === null ? null : 35 * lineQuality;

  // penalties
  const penalties = [];
  const spin = judged.find((s) => s[C.angle] > 100 || s[C.speed] < 8);
  if (spin) penalties.push({ kind: 'spin', label: 'Tête-à-queue', points: 20, d: spin[C.d] });
  // straightening in the middle of a drift (a long straight is just low angle)
  episodes(judged, (s) => s[C.angle] < 8 && s[C.speed] >= DRIFT_SPEED, 600, 3000).slice(0, 4).forEach((e) => penalties.push({ kind: 'straight', label: 'Redressement', points: 3, d: e.d }));
  if (judged[0].length > C.out) episodes(judged, (s) => s[C.out] > 2, 300).slice(0, 3).forEach((e) => penalties.push({ kind: 'off', label: 'Sortie de piste', points: 5, d: e.d }));
  const penalty = penalties.reduce((a, p) => a + p.points, 0);

  // without clips or reference line, angle + speed are scaled to 100
  const raw = line === null ? ((angle + speed) / 65) * 100 : angle + speed + line;
  return {
    score: r1(clamp(raw - penalty, 0, 100)),
    angle: r1(angle),
    speed: r1(speed),
    line: line === null ? null : r1(line),
    lineDist: lineDist === null ? null : r1(lineDist),
    penalty,
    penalties,
    clips,
    avgAngle: r1(avgAngle),
    maxAngle: r1(maxAngle),
    avgSpeed: r1(avgSpeed),
    driftTime: r1(driftTime / 1000),
    rules: courseVersion(course),
  };
}

/** Live clip feedback while driving: closest approach per clip so far. */
class LiveClips {
  constructor(course) {
    this.course = course;
    this.reset();
  }

  reset() {
    this.state = ((this.course && this.course.clips) || []).map((c, i) => ({ name: c.name || `Clip ${i + 1}`, r: c.r || 3, x: c.x, z: c.z, best: null, hit: false }));
  }

  feed(x, z, angle, speed) {
    for (const c of this.state) {
      const dist = Math.hypot(x - c.x, z - c.z);
      if (dist > c.r * 4) continue;
      if (c.best === null || dist < c.best) c.best = dist;
      if (dist <= c.r && angle >= DRIFT_ANGLE && speed >= DRIFT_SPEED) c.hit = true;
    }
  }

  summary() {
    return { total: this.state.length, hit: this.state.filter((c) => c.hit).length, clips: this.state.map((c) => ({ name: c.name, hit: c.hit, dist: c.best === null ? null : r1(c.best) })) };
  }
}

module.exports = { scoreDrift, courseVersion, referenceFrom, LiveClips, distToLine, DRIFT_ANGLE, DRIFT_SPEED };
