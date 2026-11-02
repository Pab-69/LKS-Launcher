'use strict';

/**
 * Automatic drift course from a track's AI line (ai/fast_lane.ai, shipped with
 * every Assetto Corsa track): the line gives the trajectory and, in recent
 * files, the distance to the track edges. Corners are found from the
 * curvature; an inner clip goes on the inside edge at the apex and an outer
 * zone on the outside edge at the entry.
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

/** Signed curvature (1/m) at each point, over ±span points. */
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

/**
 * Build a drift course from the AI line points.
 * Options: maxRadius (m) of a corner, minTurn (°) of a corner worth clipping.
 */
function courseFromAiLine(points, { maxRadius = 120, minTurn = 35, maxClips = 24 } = {}) {
  const { line, total } = resample(points, 2);
  if (line.length < 20 || total < 100) throw new Error('Ligne IA trop courte');
  const curv = curvatures(line, 5); // ±10 m
  // smooth
  const sm = curv.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -3; k <= 3; k++) {
      const v = curv[i + k];
      if (v !== undefined) {
        s += v;
        n++;
      }
    }
    return s / n;
  });

  // corners: runs of the same turn direction tighter than maxRadius
  const corners = [];
  let cur = null;
  sm.forEach((c, i) => {
    const sign = Math.abs(c) >= 1 / maxRadius ? Math.sign(c) : 0;
    if (cur && (sign !== cur.sign || i === sm.length - 1)) {
      cur.end = i - 1;
      corners.push(cur);
      cur = null;
    }
    if (sign && !cur) cur = { sign, start: i };
  });
  // merge pieces of the same corner split by a short wobble (< 12 m)
  const merged = [];
  for (const c of corners) {
    const prev = merged[merged.length - 1];
    if (prev && prev.sign === c.sign && (line[c.start].dist - line[prev.end].dist) < 12) prev.end = c.end;
    else merged.push({ ...c });
  }

  // which side field (left/right) is the inside of a left turn? The AI line hugs
  // the apex, so the inside distance at apexes is the smaller one on average.
  const hasSides = line.some((p) => p.sideLeft > 0 || p.sideRight > 0);
  let leftIsPositive = 0;
  const turning = [];
  for (const c of merged) {
    let apex = c.start;
    for (let i = c.start; i <= c.end; i++) if (Math.abs(sm[i]) > Math.abs(sm[apex])) apex = i;
    let turn = 0;
    for (let i = c.start; i <= c.end; i++) turn += sm[i] * 2; // radians (2 m steps)
    const deg = Math.abs((turn * 180) / Math.PI);
    if (deg < minTurn) continue;
    turning.push({ ...c, apex, deg });
    if (hasSides) leftIsPositive += (line[apex].sideRight - line[apex].sideLeft) * c.sign;
  }
  // inside side of a corner with this sign: 'left' or 'right'
  const insideSide = (sign) => ((sign > 0) === (leftIsPositive >= 0) ? 'sideLeft' : 'sideRight');

  const clips = [];
  const normalAt = (i, sign) => {
    // unit vector towards the inside of the corner (towards the centre of curvature)
    const a = line[Math.max(0, i - 3)];
    const b = line[Math.min(line.length - 1, i + 3)];
    const f = [b.x - a.x, b.z - a.z];
    const l = Math.hypot(...f) || 1;
    // rotate the forward vector by +90° (towards positive curvature)
    return [(-f[1] / l) * sign, (f[0] / l) * sign];
  };
  turning.sort((a, b) => b.deg - a.deg);
  const kept = turning.slice(0, Math.ceil(maxClips / 2)).sort((a, b) => a.start - b.start);
  kept.forEach((c, n) => {
    const p = line[c.apex];
    const inward = normalAt(c.apex, c.sign);
    const inside = hasSides ? Math.max(0.5, (p[insideSide(c.sign)] || 0) - 0.8) : 2.5;
    clips.push({ name: `Corde ${n + 1}`, kind: 'inner', x: r1(p.x + inward[0] * inside), z: r1(p.z + inward[1] * inside), r: 2.5, d: p.dist / total });
    // outer zone: on the outside edge, a third of the way into the corner
    const e = Math.round(c.start + (c.apex - c.start) / 3);
    const q = line[e];
    const outward = normalAt(e, -c.sign);
    const outSide = insideSide(c.sign) === 'sideLeft' ? 'sideRight' : 'sideLeft';
    const outside = hasSides ? Math.max(1, (q[outSide] || 0) - 1) : 3;
    clips.push({ name: `Mur ${n + 1}`, kind: 'outer', x: r1(q.x + outward[0] * outside), z: r1(q.z + outward[1] * outside), r: 4, d: q.dist / total });
  });
  clips.sort((a, b) => a.d - b.d);
  clips.forEach((c) => delete c.d);

  const step = Math.max(1, Math.floor(line.length / 400));
  return {
    auto: true,
    section: [0, 1],
    clips,
    refLine: line.filter((_, i) => i % step === 0).map((p) => [r1(p.x), r1(p.z)]),
    refSpeed: 0, // the AI drives on grip: its speed is no reference for drifting
    // the AI's grip line is not a drift line: judge the line more loosely
    rules: { debutant: { lineTol: [4, 15] }, normal: { lineTol: [3, 10] }, pro: { lineTol: [2, 7] } },
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

module.exports = { parseAiLine, courseFromAiLine, autoCourse, aiLineFile, encodeAiLine };
