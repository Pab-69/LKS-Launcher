'use strict';

/**
 * Reference line from the group's best runs: each run is cut into slices
 * along the course (position d), the slices are averaged between runs
 * (better runs weigh more), then smoothed. The admins can publish it as the
 * course's line: it is how the best drivers really drive the track.
 */

const { driftOf } = require('./drift');

const C = { d: 0, x: 9, z: 10 };
const r1 = (v) => Math.round(v * 10) / 10;

function lineFromRuns(laps, course, { slices = 300 } = {}) {
  const section = (course && course.section) || [0, 1];
  const [a, b] = section;
  const width = (b - a) / slices;
  const sum = Array.from({ length: slices }, () => ({ x: 0, z: 0, w: 0 }));
  const used = [];
  for (const lap of laps) {
    const res = driftOf(lap, 'normal', 'drift');
    const weight = res && res.score > 0 ? res.score : 0;
    if (!weight || !Array.isArray(lap.samples)) continue;
    const per = Array.from({ length: slices }, () => ({ x: 0, z: 0, n: 0 }));
    for (const s of lap.samples) {
      if (!(s[C.d] >= a && s[C.d] <= b)) continue;
      const k = Math.min(slices - 1, Math.floor((s[C.d] - a) / width));
      per[k].x += s[C.x];
      per[k].z += s[C.z];
      per[k].n++;
    }
    const filled = per.filter((p) => p.n).length;
    if (filled < slices * 0.6) continue; // run that does not cover the course
    per.forEach((p, k) => {
      if (!p.n) return;
      sum[k].x += (p.x / p.n) * weight;
      sum[k].z += (p.z / p.n) * weight;
      sum[k].w += weight;
    });
    used.push({ driver: lap.driver && lap.driver.name, score: res.score });
  }
  if (!used.length) return null;
  // slices no run went through: in between their neighbours
  const pts = sum.map((s) => (s.w ? [s.x / s.w, s.z / s.w] : null));
  const known = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < pts.length; i++) {
    if (pts[i]) continue;
    const prev = [...known].reverse().find((k) => k < i);
    const next = known.find((k) => k > i);
    if (prev === undefined) pts[i] = pts[next];
    else if (next === undefined) pts[i] = pts[prev];
    else {
      const t = (i - prev) / (next - prev);
      pts[i] = [pts[prev][0] + (pts[next][0] - pts[prev][0]) * t, pts[prev][1] + (pts[next][1] - pts[prev][1]) * t];
    }
  }
  // smooth (moving average over 5 slices, a few passes)
  let line = pts;
  for (let pass = 0; pass < 3; pass++) {
    line = line.map((_, i) => {
      let x = 0;
      let z = 0;
      let n = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(line.length - 1, i + 2); k++) {
        x += line[k][0];
        z += line[k][1];
        n++;
      }
      return [x / n, z / n];
    });
  }
  return { line: line.map(([x, z]) => [r1(x), r1(z)]), runs: used };
}

module.exports = { lineFromRuns };
