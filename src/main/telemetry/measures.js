'use strict';

/**
 * Exact clip distances measured by the in-game app (apps/lua/LKS/measures):
 * every frame, from the car's real bumper (front for a corde, rear for an
 * outer zone) to each clip. The launcher's own telemetry is sampled less often
 * and only knows the car's centre: when a measure matches a run, the clips are
 * judged from it.
 */

const fs = require('fs');
const path = require('path');

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

function cleanMeasure(m) {
  if (!m || m.v !== 1 || typeof m.track !== 'string' || !Array.isArray(m.clips) || m.clips.length > 60) return null;
  return {
    track: m.track,
    layout: typeof m.layout === 'string' ? m.layout : '',
    car: String(m.car || ''),
    time: Number(m.time) > 1e9 ? Number(m.time) * 1000 : 0,
    lapMs: Number(m.lapMs) || 0,
    frames: Number(m.frames) || 0,
    shape: m.shape && typeof m.shape === 'object' ? { front: num(m.shape.front), rear: num(m.shape.rear), half: num(m.shape.half), source: String(m.shape.source || '') } : null,
    clips: m.clips.map((c) => ({
      x: num(c.x),
      z: num(c.z),
      kind: c.kind === 'outer' ? 'outer' : 'inner',
      min: num(c.min),
      drift: num(c.drift),
      d: num(c.d),
      ...(Array.isArray(c.slices) ? { slices: c.slices.slice(0, 2000).map(num) } : {}),
    })),
  };
}

function readMeasureFiles(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const file = path.join(dir, f);
    try {
      const m = cleanMeasure(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!m) return { file, bad: true };
      if (!m.time) m.time = fs.statSync(file).mtimeMs;
      return { file, measure: m };
    } catch {
      return { file, bad: true };
    }
  });
}

/** Is this measure the one of this run (same track, same time within 0.25 s, finished at the same moment)? */
function measureMatches(m, lap) {
  return m.track === lap.track && m.layout === (lap.layout || '') && Math.abs(m.lapMs - lap.lapMs) <= 250 && Math.abs(Date.parse(lap.date) - m.time) <= 2 * 60 * 1000 && (!m.car || !lap.car || m.car === lap.car);
}

module.exports = { readMeasureFiles, measureMatches, cleanMeasure };
