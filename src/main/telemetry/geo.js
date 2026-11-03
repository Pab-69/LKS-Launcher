'use strict';

/**
 * Where is the car on a drift course?
 *  - progress along the course's reference line (0 at its start, 1 at its end),
 *    used instead of the game's own track position, which is missing or partial
 *    on many drift tracks (no AI line, or one only made for the cameras);
 *  - start and finish gates: a run starts when the car crosses the start gate
 *    forwards and ends at the finish gate.
 */

/** Course with a start gate, a finish gate and a reference line: judged by runs, not laps. */
function hasGates(course) {
  return Boolean(course && Array.isArray(course.start) && Array.isArray(course.finish) && Array.isArray(course.refLine) && course.refLine.length > 1);
}

class LineTracker {
  constructor(line) {
    this.line = line;
    this.cum = [0];
    for (let i = 1; i < line.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    this.total = this.cum[this.cum.length - 1] || 1;
    this.hint = -1;
  }

  /** Projection on segment i: { d (0..1), dist (m), i }. */
  onSegment(i, x, z) {
    const [ax, az] = this.line[i];
    const [bx, bz] = this.line[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
    const px = ax + vx * k;
    const pz = az + vz * k;
    return { d: (this.cum[i] + k * Math.sqrt(len2)) / this.total, dist: Math.hypot(x - px, z - pz), i };
  }

  /** Nearest point of the line (searched near the last answer first). */
  locate(x, z) {
    const n = this.line.length - 1;
    let best = null;
    const scan = (from, to) => {
      for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
        const r = this.onSegment(i, x, z);
        if (!best || r.dist < best.dist) best = r;
      }
    };
    if (this.hint >= 0) scan(this.hint - 15, this.hint + 25);
    if (!best || best.dist > 12) scan(0, n);
    this.hint = best.i;
    return best;
  }

  /** Forward direction of the line near progress d (unit vector). */
  direction(d) {
    const target = d * this.total;
    let i = this.cum.findIndex((c) => c >= target);
    if (i <= 0) i = 1;
    const [ax, az] = this.line[i - 1];
    const [bx, bz] = this.line[i];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / l, (bz - az) / l];
  }
}

/** Does the move a→b cross the gate [[x, z], [x, z]] (gate made 2 m longer at both ends)? */
function crosses(gate, ax, az, bx, bz) {
  if (!Array.isArray(gate) || gate.length < 2) return false;
  let [[cx, cz], [dx, dz]] = gate;
  const gl = Math.hypot(dx - cx, dz - cz) || 1;
  const ex = ((dx - cx) / gl) * 2;
  const ez = ((dz - cz) / gl) * 2;
  cx -= ex;
  cz -= ez;
  dx += ex;
  dz += ez;
  const cross = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const d1 = cross(dx - cx, dz - cz, ax - cx, az - cz);
  const d2 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  const d3 = cross(bx - ax, bz - az, cx - ax, cz - az);
  const d4 = cross(bx - ax, bz - az, dx - ax, dz - az);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Crossing the gate in the direction of the course (not backwards). */
function crossesForward(gate, tracker, d, ax, az, bx, bz) {
  if (!crosses(gate, ax, az, bx, bz)) return false;
  const [fx, fz] = tracker.direction(d);
  return (bx - ax) * fx + (bz - az) * fz > 0;
}

module.exports = { hasGates, LineTracker, crosses, crossesForward };
