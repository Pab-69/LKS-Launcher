'use strict';

/**
 * Turns the game's live data into laps:
 *  - samples the lap by distance (speed, pedals, gear, rpm, steering, drift angle, x/z)
 *  - detects complete laps, validity (cuts, pit lane) and drift metrics
 *  - computes the live delta against a reference lap
 *
 * Tracks without an AI line (no ai/fast_lane.ai, e.g. some drift tracks) give
 * no lap position: it stays still. The recorder then measures the distance
 * driven since the line and spreads the lap over 0..1 when it ends.
 */

const { EventEmitter } = require('events');
const { slipAngle } = require('./layout');
const { scoreAllModes, LiveClips } = require('./drift');

const STATUS_LIVE = 2;
const SESSION_NAMES = { 0: 'practice', 1: 'qualify', 2: 'race', 3: 'hotlap', 4: 'timeattack', 5: 'drift', 6: 'drag' };

// sample row: [d, tMs, speed, gas, brake, gear, rpm, steer, angle, x, z, wheels out, signed slip]
const COLUMNS = ['d', 't', 'speed', 'gas', 'brake', 'gear', 'rpm', 'steer', 'angle', 'x', 'z', 'out', 'slip'];

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

function gearLabel(g) {
  if (g === 0) return 'R';
  if (g === 1) return 'N';
  return String(g - 1);
}

/** Time (ms) at normalized distance d on a lap, by linear interpolation. */
function timeAt(samples, d) {
  if (!samples || samples.length < 2) return null;
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
  const k = b[0] === a[0] ? 0 : (d - a[0]) / (b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * k;
}

class TelemetryRecorder extends EventEmitter {
  constructor({ getDriver, getCourse } = {}) {
    super();
    this.getDriver = getDriver || (() => ({ name: 'Pilote', steamId: '' }));
    this.getCourse = getCourse || (() => null); // drift course (clips, line) for a car/track
    this.lap = null;
    this.combo = null;
    this.reference = null; // { lapMs, samples }
    this.live = null;
    this.lastFrameAt = 0;
    this.noSpline = false; // the track has no AI line: lap position from the distance driven
    this.lapLength = 0; // metres of the last lap, in that case
    this.stuckSince = 0;
    this.prevD = null;
  }

  setReference(lap) {
    this.reference = lap && lap.samples && lap.samples.length > 10 ? lap : null;
  }

  comboOf(st) {
    if (!st || !st.carModel || !st.track) return null;
    return { car: st.carModel, track: st.track, layout: st.trackConfiguration || '' };
  }

  newLap(g, now, fromLine = false) {
    const course = this.combo ? this.getCourse(this.combo) : null;
    this.lap = { completedLaps: g.completedLaps, fromLine, meters: 0, marks: [], lastXZ: null, samples: [], cutFrames: 0, pit: false, maxAngle: 0, topSpeed: 0, startedAt: now, lastSampleAt: 0, course, clips: new LiveClips(course) };
  }

  /** frame = { physics, graphics, static } (parsed), now = ms timestamp */
  feed({ physics: p, graphics: g, static: st }, now = Date.now()) {
    const combo = this.comboOf(st);
    if (!combo || !g) return;
    const comboKey = `${combo.car}|${combo.track}|${combo.layout}`;
    if (!this.combo || this.combo.key !== comboKey) {
      this.combo = { ...combo, key: comboKey };
      this.lap = null;
      this.noSpline = false;
      this.lapLength = 0;
      this.stuckSince = 0;
      this.prevD = null;
      this.emit('combo', combo);
    }
    this.lastFrameAt = now;
    const slip = slipAngle(p);
    const angle = Math.abs(slip);
    let d = g.normalizedCarPosition;

    if (g.status === STATUS_LIVE) {
      if (!this.lap) this.newLap(g, now);
      else if (g.completedLaps !== this.lap.completedLaps) {
        this.finishLap(g, st);
        this.newLap(g, now, true);
      }
      const lap = this.lap;
      const x = g.carCoordinates[0];
      const z = g.carCoordinates[2];
      if (lap.lastXZ) {
        const step = Math.hypot(x - lap.lastXZ[0], z - lap.lastXZ[1]);
        if (step < 30) lap.meters += step; // a bigger jump is a teleport (back to the pits)
      }
      lap.lastXZ = [x, z];
      // lap position frozen while driving: no AI line on this track
      if (!this.noSpline && p.speedKmh > 30) {
        if (d !== this.prevD) this.stuckSince = now;
        else if (now - this.stuckSince > 2000) {
          this.noSpline = true;
          this.emit('noSpline', combo);
        }
      }
      this.prevD = d;
      // no AI line: rows keep the metres driven until the lap ends (spread over 0..1 then)
      if (this.noSpline) d = this.lapLength ? Math.min(1, lap.meters / this.lapLength) : null;
      const last = lap.samples[lap.samples.length - 1];
      const lastMark = lap.marks[lap.marks.length - 1];
      // sample by distance (or time when stopped), never backwards
      const ahead = last && (this.noSpline
        ? lap.meters > lastMark && (lap.meters - lastMark >= 0.5 || now - lap.lastSampleAt >= 100)
        : d > last[0] && (d - last[0] >= 0.0005 || now - lap.lastSampleAt >= 100));
      if (!last || ahead) {
        lap.marks.push(lap.meters);
        lap.samples.push([this.noSpline ? round(lap.meters / 100000, 6) : round(d, 5), g.iCurrentTime, round(p.speedKmh, 1), round(p.gas, 2), round(p.brake, 2), p.gear, p.rpms, round(p.steerAngle, 3), round(angle, 1), round(g.carCoordinates[0], 1), round(g.carCoordinates[2], 1), p.numberOfTyresOut, round(slip, 1)]);
        lap.lastSampleAt = now;
      }
      if (p.numberOfTyresOut > 2) lap.cutFrames++;
      if (g.isInPitLane || g.isInPit) lap.pit = true;
      lap.topSpeed = Math.max(lap.topSpeed, p.speedKmh);
      if (p.speedKmh > 20) lap.maxAngle = Math.max(lap.maxAngle, Math.min(angle, 90));
      lap.clips.feed(g.carCoordinates[0], g.carCoordinates[2], angle, p.speedKmh);
    }

    // live state for the dashboard
    const ref = this.reference;
    const delta = ref && g.status === STATUS_LIVE && g.iCurrentTime > 0 && d !== null ? g.iCurrentTime - timeAt(ref.samples, d) : null;
    this.live = {
      status: g.status,
      session: SESSION_NAMES[g.session] || 'unknown',
      car: combo.car,
      track: combo.track,
      layout: combo.layout,
      speed: p.speedKmh,
      gear: gearLabel(p.gear),
      rpm: p.rpms,
      maxRpm: st.maxRpm || 0,
      gas: p.gas,
      brake: p.brake,
      clutch: p.clutch,
      steer: p.steerAngle,
      angle,
      tyreTemps: p.tyreCoreTemperature,
      pressures: p.wheelsPressure,
      fuel: p.fuel,
      lapMs: g.iCurrentTime,
      lastMs: g.iLastTime,
      bestMs: g.iBestTime,
      delta: delta === null || Number.isNaN(delta) ? null : Math.round(delta),
      refMs: ref ? ref.lapMs : null,
      d,
      noSpline: this.noSpline,
      x: g.carCoordinates[0],
      z: g.carCoordinates[2],
      laps: g.completedLaps,
      position: g.position,
      clips: this.lap ? this.lap.clips.summary() : null,
    };
  }

  finishLap(g, st) {
    const lap = this.lap;
    const s = lap.samples;
    if (this.noSpline) {
      // from the line to the line, spread over 0..1 by the distance driven
      if (!lap.fromLine || lap.meters < 100 || s.length < 20 || !(g.iLastTime > 0)) return;
      s.forEach((row, i) => { row[0] = round(lap.marks[i] / lap.meters, 5); });
      s[s.length - 1][0] = 1;
      this.lapLength = lap.meters;
    }
    // a lap counts only if it was recorded from the line to the line
    if (s.length < 20 || s[0][0] > 0.03 || s[s.length - 1][0] < 0.97 || !(g.iLastTime > 0)) return;
    const driver = this.getDriver() || {};
    const course = this.getCourse(this.combo); // judged with the course published now
    const valid = lap.cutFrames < 30 && !lap.pit;
    const record = {
      version: 1,
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      driver: { name: driver.name || st.playerNick || st.playerName || 'Pilote', steamId: driver.steamId || '' },
      car: this.combo.car,
      track: this.combo.track,
      layout: this.combo.layout,
      session: SESSION_NAMES[g.session] || 'unknown',
      lapMs: g.iLastTime,
      valid,
      cuts: lap.cutFrames,
      topSpeed: round(lap.topSpeed, 1),
      drift: { maxAngle: round(lap.maxAngle, 1), avgAngle: 0, driftTime: 0, ...scoreAllModes(s, course) },
      date: new Date().toISOString(),
      columns: COLUMNS,
      samples: s,
    };
    this.emit('lap', record);
  }
}

module.exports = { TelemetryRecorder, timeAt, gearLabel, COLUMNS };
