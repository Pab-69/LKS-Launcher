'use strict';

/**
 * Automatic drift course from a track's AI line (ai/fast_lane.ai, shipped with
 * most Assetto Corsa tracks): the line and, in recent files, the room on each
 * side give the road. A smooth line is computed inside it, corners are found
 * from its curvature; a clip goes on the inside edge where the line comes
 * closest to it, an outer zone on the outside edge at the corner entry.
 * Tracks of the group get an official course instead (courses/), worked out
 * from their geometry.
 *
 * fast_lane.ai (little endian):
 *   int32 version, int32 count, int32 lapTime, int32 sampleCount
 *   count × { float x, y, z, length; int32 id }                      (20 bytes)
 *   int32 extraCount, extraCount × 18 floats: speed, gas, brake, latG, radius,
 *   sideLeft, sideRight, camber, direction, normal xyz, length, forward xyz, tag, grade
 */

const fs = require('fs');
const path = require('path');

const r1 = (v) => Math.round(v * 10) / 10;

function parseAiLine(buf) {
  if (buf.length < 16) throw new Error('Fichier IA trop court');
  const version = buf.readInt32LE(0);
  const count = buf.readInt32LE(4);
  if (count < 10 || count > 200000 || 16 + count * 20 > buf.length) throw new Error('Fichier IA invalide');
  const points = [];
  for (let i = 0; i < count; i++) {
    const o = 16 + i * 20;
    points.push({ x: buf.readFloatLE(o), y: buf.readFloatLE(o + 4), z: buf.readFloatLE(o + 8), length: buf.readFloatLE(o + 12) });
  }
  let o = 16 + count * 20;
  if (o + 4 <= buf.length) {
    const extra = buf.readInt32LE(o);
    o += 4;
    if (extra === count && o + extra * 72 <= buf.length) {
      for (let i = 0; i < extra; i++) {
        const b = o + i * 72;
        points[i].speed = buf.readFloatLE(b);
        points[i].sideLeft = buf.readFloatLE(b + 20);
        points[i].sideRight = buf.readFloatLE(b + 24);
      }
    }
  }
  return { version, points };
}

/** Resample the line every `step` metres (x/z plane). */
function resample(points, step = 2) {
  const out = [{ ...points[0], dist: 0 }];
  let dist = 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(seg > 0)) continue;
    let t = step - acc;
    while (t <= seg) {
      const k = t / seg;
      const lerp = (u, v) => (u === undefined || v === undefined ? undefined : u + (v - u) * k);
      out.push({ x: lerp(a.x, b.x), z: lerp(a.z, b.z), sideLeft: lerp(a.sideLeft, b.sideLeft), sideRight: lerp(a.sideRight, b.sideRight), dist: dist + t });
      t += step;
    }
    acc = (acc + seg) % step;
    dist += seg;
  }
  return { line: out, total: dist };
}

/** Signed curvature (1/m) at each point, over ±span points (x/z plane, positive = towards +n). */
function curvatures(line, span) {
  const n = line.length;
  return line.map((p, i) => {
    const a = line[Math.max(0, i - span)];
    const c = line[Math.min(n - 1, i + span)];
    const v1 = [p.x - a.x, p.z - a.z];
    const v2 = [c.x - p.x, c.z - p.z];
    const l1 = Math.hypot(...v1);
    const l2 = Math.hypot(...v2);
    if (l1 < 0.1 || l2 < 0.1) return 0;
    const cross = (v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2);
    const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    return Math.atan2(cross, dot) / ((l1 + l2) / 2);
  });
}

function smooth(values, sigma) {
  const k = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * k + 1 }, (_, i) => Math.exp(-0.5 * ((i - k) / sigma) ** 2));
  return values.map((_, i) => {
    let s = 0;
    let t = 0;
    for (let j = -k; j <= k; j++) {
      const v = values[Math.min(values.length - 1, Math.max(0, i + j))];
      s += v * w[j + k];
      t += w[j + k];
    }
    return s / t;
  });
}

/** Unit normals n = forward turned by +90° in the x/z plane (the AI file's « right » side). */
function normals(line) {
  return line.map((_, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const fx = b.x - a.x;
    const fz = b.z - a.z;
    const l = Math.hypot(fx, fz) || 1;
    return [-fz / l, fx / l];
  });
}

/**
 * Smooth line inside the road: lateral offsets q (lo ≤ q ≤ hi) that keep the
 * curvature low — wide entry, apex, wide exit. Solved coarse to fine.
 */
function minCurvature(base, nrm, lo, hi, { steps = [8, 4, 2, 1], iters = 4000, alpha = 0.05 } = {}) {
  const n = base.length;
  let q = null;
  for (const st of steps) {
    const idx = [];
    for (let i = 0; i < n; i += st) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const m = idx.length;
    let qc = idx.map((i) => (q ? q[i] : (lo[i] + hi[i]) / 2));
    const P = idx.map((i) => base[i]);
    const N = idx.map((i) => nrm[i]);
    const L = Array.from({ length: m }, () => [0, 0]);
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < m; j++) {
        L[j][0] = P[j].x + N[j][0] * qc[j];
        L[j][1] = P[j].z + N[j][1] * qc[j];
      }
      for (let j = 2; j < m - 2; j++) {
        const dx = L[j - 2][0] - 4 * L[j - 1][0] + 6 * L[j][0] - 4 * L[j + 1][0] + L[j + 2][0];
        const dz = L[j - 2][1] - 4 * L[j - 1][1] + 6 * L[j][1] - 4 * L[j + 1][1] + L[j + 2][1];
        const i = idx[j];
        qc[j] = Math.min(hi[i], Math.max(lo[i], qc[j] - alpha * (dx * N[j][0] + dz * N[j][1])));
      }
    }
    // back to every point
    const full = new Array(n);
    for (let j = 0; j < m - 1; j++) {
      for (let i = idx[j]; i <= idx[j + 1]; i++) {
        const k = (i - idx[j]) / (idx[j + 1] - idx[j] || 1);
        full[i] = qc[j] + (qc[j + 1] - qc[j]) * k;
      }
    }
    q = full;
    qc = null;
  }
  return q.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
}

/** Corners: runs of the same turn direction tighter than maxRadius, turning at least minTurn degrees. */
function findCorners(k, step, { maxRadius = 70, minTurn = 30, merge = 10 } = {}) {
  const runs = [];
  let cur = null;
  k.forEach((c, i) => {
    const sign = Math.abs(c) >= 1 / maxRadius ? Math.sign(c) : 0;
    if (cur && (sign !== cur.sign || i === k.length - 1)) {
      cur.end = i - 1;
      runs.push(cur);
      cur = null;
    }
    if (sign && !cur) cur = { sign, start: i };
  });
  const merged = [];
  for (const c of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.sign === c.sign && (c.start - prev.end) * step < merge) prev.end = c.end;
    else merged.push({ ...c });
  }
  const out = [];
  for (const c of merged) {
    let turn = 0;
    let apex = c.start;
    for (let i = c.start; i <= c.end; i++) {
      turn += k[i] * step;
      if (Math.abs(k[i]) > Math.abs(k[apex])) apex = i;
    }
    const deg = Math.abs((turn * 180) / Math.PI);
    if (deg >= minTurn) out.push({ ...c, apex, deg });
  }
  return out;
}

/**
 * Build a drift course from the AI line points. The AI file gives the room on
 * each side of its line (sideRight on the +n side, sideLeft on the other):
 * the drift line is a smooth line inside that road, and the clips go where it
 * comes closest to the edges — the inside at the apex (corde), the outside on
 * the entry (extérieur).
 */
function courseFromAiLine(points, { maxRadius = 90, minTurn = 30, maxClips = 24 } = {}) {
  const STEP = 2;
  const { line, total } = resample(points, STEP);
  if (line.length < 20 || total < 100) throw new Error('Ligne IA trop courte');
  const nrm = normals(line);
  const hasSides = line.some((p) => p.sideLeft > 0 || p.sideRight > 0);
  const cap = (v, dflt) => Math.min(12, v > 0 ? v : dflt);
  const right = smooth(line.map((p) => cap(hasSides ? p.sideRight : 0, 5)), 2);
  const left = smooth(line.map((p) => cap(hasSides ? p.sideLeft : 0, 5)), 2);
  const hi = right.map((v) => Math.max(0, v - 1.2));
  const lo = left.map((v) => -Math.max(0, v - 1.2));
  const q = minCurvature(line, nrm, lo, hi);
  const drift = line.map((p, i) => ({ x: p.x + nrm[i][0] * q[i], z: p.z + nrm[i][1] * q[i], dist: p.dist }));
  const k = smooth(curvatures(drift, 3), 1.5);
  const corners = findCorners(k, STEP, { maxRadius, minTurn });
  const at = (i, off) => ({ x: r1(line[i].x + nrm[i][0] * off), z: r1(line[i].z + nrm[i][1] * off) });

  const picked = corners.sort((a, b) => b.deg - a.deg).slice(0, Math.ceil(maxClips / 2)).sort((a, b) => a.start - b.start);
  const clips = [];
  picked.forEach((c, n) => {
    const insidePlus = c.sign > 0; // turning towards +n: the inside is the right side
    // corde: where the line comes closest to the inside edge
    let best = c.start;
    for (let i = c.start; i <= c.end; i++) {
      const gap = insidePlus ? right[i] - q[i] : q[i] + left[i];
      const g0 = insidePlus ? right[best] - q[best] : q[best] + left[best];
      if (gap < g0) best = i;
    }
    clips.push({ name: `V${n + 1} corde`, kind: 'inner', ...at(best, insidePlus ? right[best] - 2.2 : -left[best] + 2.2), r: 2.5, i: best });
    // extérieur: on the entry (25 m before the corner to its apex), closest to the outside edge
    let out = -1;
    for (let i = Math.max(0, c.start - Math.round(25 / STEP)); i <= c.apex; i++) {
      const gap = insidePlus ? q[i] + left[i] : right[i] - q[i];
      const g0 = out < 0 ? Infinity : insidePlus ? q[out] + left[out] : right[out] - q[out];
      if (gap < g0) out = i;
    }
    if (out >= 0) {
      const p = at(out, insidePlus ? -left[out] + 2.6 : right[out] - 2.6);
      const near = clips.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 12);
      if (!near) clips.push({ name: `V${n + 1} extérieur`, kind: 'outer', ...p, r: 3.5, i: out });
    }
  });
  clips.sort((a, b) => a.i - b.i);
  clips.forEach((c) => delete c.i);

  const step = Math.max(1, Math.floor(drift.length / 400));
  return {
    auto: true,
    section: [0, 1],
    clips,
    refLine: drift.filter((_, i) => i % step === 0).map((p) => [r1(p.x), r1(p.z)]),
    refSpeed: 0, // the AI drives on grip: its speed is no reference for drifting
    // a computed line, not a driver's: judge it a bit more loosely
    rules: { debutant: { lineTol: [4, 14] }, normal: { lineTol: [3, 9] }, pro: { lineTol: [2, 6] } },
  };
}

/** AI line file of an installed track/layout. */
function aiLineFile(acRoot, track, layout = '') {
  const base = path.join(acRoot, 'content', 'tracks', track);
  const candidates = layout ? [path.join(base, layout, 'ai', 'fast_lane.ai'), path.join(base, 'ai', 'fast_lane.ai')] : [path.join(base, 'ai', 'fast_lane.ai')];
  return candidates.find((f) => fs.existsSync(f)) || null;
}

/** Course generated from an installed track, or null when it has no AI line. */
function autoCourse(acRoot, track, layout = '') {
  if (!acRoot || !/^[\w.-]+$/.test(track) || (layout && !/^[\w.-]+$/.test(layout))) return null;
  const file = aiLineFile(acRoot, track, layout);
  if (!file) return null;
  return courseFromAiLine(parseAiLine(fs.readFileSync(file)).points);
}

/** Writer used by the tests and the demo (inverse of parseAiLine). */
function encodeAiLine(points) {
  const buf = Buffer.alloc(16 + points.length * 20 + 4 + points.length * 72);
  buf.writeInt32LE(7, 0);
  buf.writeInt32LE(points.length, 4);
  buf.writeInt32LE(0, 8);
  buf.writeInt32LE(points.length, 12);
  let len = 0;
  points.forEach((p, i) => {
    if (i) len += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const o = 16 + i * 20;
    buf.writeFloatLE(p.x, o);
    buf.writeFloatLE(p.y || 0, o + 4);
    buf.writeFloatLE(p.z, o + 8);
    buf.writeFloatLE(len, o + 12);
    buf.writeInt32LE(i, o + 16);
  });
  let o = 16 + points.length * 20;
  buf.writeInt32LE(points.length, o);
  o += 4;
  points.forEach((p, i) => {
    const b = o + i * 72;
    buf.writeFloatLE(p.speed || 20, b);
    buf.writeFloatLE(p.sideLeft || 0, b + 20);
    buf.writeFloatLE(p.sideRight || 0, b + 24);
  });
  return buf;
}

module.exports = { parseAiLine, courseFromAiLine, autoCourse, aiLineFile, encodeAiLine, minCurvature, findCorners };
