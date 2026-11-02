'use strict';

/**
 * Turns the game's live data into laps:
 *  - samples the lap by distance (speed, pedals, gear, rpm, steering, drift angle, x/z)
 *  - detects complete laps, validity (cuts, pit lane) and drift metrics
 *  - computes the live delta against a reference lap
 */

const { EventEmitter } = require('events');
const { driftAngle } = require('./layout');

const STATUS_LIVE = 2;
const SESSION_NAMES = { 0: 'practice', 1: 'qualify', 2: 'race', 3: 'hotlap', 4: 'timeattack', 5: 'drift', 6: 'drag' };

// sample row: [d, tMs, speed, gas, brake, gear, rpm, steer, angle, x, z]
const COLUMNS = ['d', 't', 'speed', 'gas', 'brake', 'gear', 'rpm', 'steer', 'angle', 'x', 'z'];

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

/** Homemade drift score: angle x speed while really drifting. */
function driftPoints(angle, speed, dt) {
  if (angle < 15 || angle > 75 || speed < 30) return 0;
  return (angle * speed * dt) / 100;
}

class TelemetryRecorder extends EventEmitter {
  constructor({ getDriver } = {}) {
    super();
    this.getDriver = getDriver || (() => ({ name: 'Pilote', steamId: '' }));
    this.lap = null;
    this.combo = null;
    this.reference = null; // { lapMs, samples }
    this.live = null;
    this.lastFrameAt = 0;
  }

  setReference(lap) {
    this.reference = lap && lap.samples && lap.samples.length > 10 ? lap : null;
  }

  comboOf(st) {
    if (!st || !st.carModel || !st.track) return null;
    return { car: st.carModel, track: st.track, layout: st.trackConfiguration || '' };
  }

  newLap(g, now) {
    this.lap = { completedLaps: g.completedLaps, samples: [], cutFrames: 0, pit: false, score: 0, maxAngle: 0, angleSum: 0, angleFrames: 0, driftTime: 0, topSpeed: 0, startedAt: now, lastSampleAt: 0 };
  }

  /** frame = { physics, graphics, static } (parsed), now = ms timestamp */
  feed({ physics: p, graphics: g, static: st }, now = Date.now()) {
    const combo = this.comboOf(st);
    if (!combo || !g) return;
    const comboKey = `${combo.car}|${combo.track}|${combo.layout}`;
    if (!this.combo || this.combo.key !== comboKey) {
      this.combo = { ...combo, key: comboKey };
      this.lap = null;
      this.emit('combo', combo);
    }
    const dt = this.lastFrameAt ? Math.min(0.2, (now - this.lastFrameAt) / 1000) : 0;
    this.lastFrameAt = now;
    const angle = driftAngle(p);
    const d = g.normalizedCarPosition;

    if (g.status === STATUS_LIVE) {
      if (!this.lap) this.newLap(g, now);
      else if (g.completedLaps !== this.lap.completedLaps) {
        this.finishLap(g, st);
        this.newLap(g, now);
      }
      const lap = this.lap;
      const last = lap.samples[lap.samples.length - 1];
      // sample by distance (or time when stopped), never backwards
      if (!last || (d > last[0] && (d - last[0] >= 0.0005 || now - lap.lastSampleAt >= 100))) {
        lap.samples.push([round(d, 5), g.iCurrentTime, round(p.speedKmh, 1), round(p.gas, 2), round(p.brake, 2), p.gear, p.rpms, round(p.steerAngle, 3), round(angle, 1), round(g.carCoordinates[0], 1), round(g.carCoordinates[2], 1)]);
        lap.lastSampleAt = now;
      }
      if (p.numberOfTyresOut > 2) lap.cutFrames++;
      if (g.isInPitLane || g.isInPit) lap.pit = true;
      lap.topSpeed = Math.max(lap.topSpeed, p.speedKmh);
      if (p.speedKmh > 20) {
        lap.maxAngle = Math.max(lap.maxAngle, angle);
        if (angle > 15) {
          lap.angleSum += angle;
          lap.angleFrames++;
          lap.driftTime += dt;
        }
        lap.score += driftPoints(angle, p.speedKmh, dt);
      }
    }

    // live state for the dashboard
    const ref = this.reference;
    const delta = ref && g.status === STATUS_LIVE && g.iCurrentTime > 0 ? g.iCurrentTime - timeAt(ref.samples, d) : null;
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
      x: g.carCoordinates[0],
      z: g.carCoordinates[2],
      laps: g.completedLaps,
      position: g.position,
      lapScore: this.lap ? Math.round(this.lap.score) : 0,
    };
  }

  finishLap(g, st) {
    const lap = this.lap;
    const s = lap.samples;
    // a lap counts only if it was recorded from the line to the line
    if (s.length < 20 || s[0][0] > 0.03 || s[s.length - 1][0] < 0.97 || !(g.iLastTime > 0)) return;
    const driver = this.getDriver() || {};
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
      drift: {
        score: Math.round(lap.score),
        maxAngle: round(lap.maxAngle, 1),
        avgAngle: lap.angleFrames ? round(lap.angleSum / lap.angleFrames, 1) : 0,
        driftTime: round(lap.driftTime, 1),
      },
      date: new Date().toISOString(),
      columns: COLUMNS,
      samples: s,
    };
    this.emit('lap', record);
  }
}

module.exports = { TelemetryRecorder, timeAt, driftPoints, gearLabel, COLUMNS };
