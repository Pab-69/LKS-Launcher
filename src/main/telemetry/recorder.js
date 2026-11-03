'use strict';

/**
 * Turns the game's live data into laps:
 *  - samples the lap by distance (speed, pedals, gear, rpm, steering, drift angle, x/z)
 *  - detects complete laps, validity (cuts, pit lane) and drift metrics
 *  - computes the live delta against a reference lap
 *  - on courses with a start and a finish gate (drift runs), a run goes from
 *    one gate to the other and its position is measured along the course line
 *  - « back to pits » or a reset (the car jumps) cancels the lap or run going on
 */

const { EventEmitter } = require('events');
const { slipAngle } = require('./layout');
const { scoreAllModes, LiveClips } = require('./drift');
const { hasGates, LineTracker, crossesForward } = require('./geo');

const STATUS_LIVE = 2;
const SESSION_NAMES = { 0: 'practice', 1: 'qualify', 2: 'race', 3: 'hotlap', 4: 'timeattack', 5: 'drift', 6: 'drag' };

// sample row: [d, tMs, speed, gas, brake, gear, rpm, steer, angle, x, z, wheels out, signed slip]
const COLUMNS = ['d', 't', 'speed', 'gas', 'brake', 'gear', 'rpm', 'steer', 'angle', 'x', 'z', 'out', 'slip'];

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
const TELEPORT_M = 30; // a jump this long in one frame: back to pits, reset or restart
const RUN_MAX_MS = 10 * 60 * 1000;

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
    this.prev = null; // last position { x, z, inPit }
    this.waitLap = null; // after a reset: wait for the next lap to start
    this.course = null; // { course, tracker, at } for the current combo
    this.resetAt = 0;
  }

  /** Course of the current combo (refreshed every 2 s: the admins may publish a new one). */
  courseNow(now) {
    if (!this.combo) return null;
    if (!this.course || now - this.course.at > 2000) {
      const course = this.getCourse(this.combo) || null;
      if (!this.course || this.course.course !== course) this.course = { course, tracker: hasGates(course) ? new LineTracker(course.refLine) : null, at: now };
      else this.course.at = now;
    }
    return this.course;
  }

  /** Cancel the lap / run going on (back to pits, car reset). */
  reset(g, now, why) {
    if (this.lap) this.emit('reset', { why });
    this.lap = null;
    this.waitLap = g ? g.completedLaps : null;
    this.resetAt = now;
  }

  setReference(lap) {
    this.reference = lap && lap.samples && lap.samples.length > 10 ? lap : null;
  }

  comboOf(st) {
    if (!st || !st.carModel || !st.track) return null;
    return { car: st.carModel, track: st.track, layout: st.trackConfiguration || '' };
  }

  newLap(g, now) {
    const course = this.combo ? this.getCourse(this.combo) : null;
    this.lap = { completedLaps: g.completedLaps, samples: [], cutFrames: 0, pit: false, maxAngle: 0, topSpeed: 0, startedAt: now, lastSampleAt: 0, course, clips: new LiveClips(course) };
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
    this.lastFrameAt = now;
    const slip = slipAngle(p);
    const angle = Math.abs(slip);
    const x = g.carCoordinates[0];
    const z = g.carCoordinates[2];
    const inPit = Boolean(g.isInPit);
    const { course, tracker } = this.courseNow(now) || {};
    const prev = this.prev;
    this.prev = { x, z, inPit };
    const jumped = prev && Math.hypot(x - prev.x, z - prev.z) > TELEPORT_M;
    if (jumped || (inPit && prev && !prev.inPit)) this.reset(g, now, inPit ? 'pits' : 'jump');
    const where = tracker ? tracker.locate(x, z) : null;
    const d = where ? where.d : g.normalizedCarPosition;

    if (g.status === STATUS_LIVE) {
      if (tracker) this.feedRun({ p, g, st, course, tracker, where, prev: jumped ? null : prev, x, z, now });
      else {
        if (this.waitLap !== null && g.completedLaps !== this.waitLap) this.waitLap = null;
        if (this.waitLap === null) {
          if (!this.lap) this.newLap(g, now);
          else if (g.completedLaps !== this.lap.completedLaps) {
            this.finishLap(g, st);
            this.newLap(g, now);
          }
        }
      }
      const lap = this.lap;
      if (lap) {
        const last = lap.samples[lap.samples.length - 1];
        const t = lap.gate ? now - lap.startedAt : g.iCurrentTime;
        // sample by distance (or time when stopped), never backwards
        if (!last || (d > last[0] && (d - last[0] >= 0.0005 || now - lap.lastSampleAt >= 100))) {
          lap.samples.push([round(d, 5), t, round(p.speedKmh, 1), round(p.gas, 2), round(p.brake, 2), p.gear, p.rpms, round(p.steerAngle, 3), round(angle, 1), round(x, 1), round(z, 1), p.numberOfTyresOut, round(slip, 1)]);
          lap.lastSampleAt = now;
        }
        if (p.numberOfTyresOut > 2) lap.cutFrames++;
        if (g.isInPitLane || g.isInPit) lap.pit = true;
        lap.topSpeed = Math.max(lap.topSpeed, p.speedKmh);
        if (p.speedKmh > 20) lap.maxAngle = Math.max(lap.maxAngle, Math.min(angle, 90));
        lap.clips.feed(x, z, angle, p.speedKmh);
      }
    }

    // live state for the dashboard
    const ref = this.reference;
    const runMs = this.lap && this.lap.gate ? now - this.lap.startedAt : null;
    const lapNow = runMs !== null ? runMs : tracker ? 0 : g.iCurrentTime;
    const delta = ref && g.status === STATUS_LIVE && lapNow > 0 && (!tracker || this.lap) ? lapNow - timeAt(ref.samples, d) : null;
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
      lapMs: lapNow,
      lastMs: tracker ? this.lastRunMs || 0 : g.iLastTime,
      bestMs: tracker ? (ref ? ref.lapMs : 0) : g.iBestTime,
      run: tracker ? { active: Boolean(this.lap), d: this.lap ? d : null, off: where ? round(where.dist, 1) : null } : null,
      resetAt: this.resetAt,
      delta: delta === null || Number.isNaN(delta) ? null : Math.round(delta),
      refMs: ref ? ref.lapMs : null,
      d,
      x,
      z,
      laps: g.completedLaps,
      position: g.position,
      clips: this.lap ? this.lap.clips.summary() : null,
    };
  }

  /** Drift run between the course's gates. */
  feedRun({ g, st, course, tracker, where, prev, x, z, now }) {
    const lap = this.lap;
    if (lap) {
      // too far from the course for 3 s, or forgotten: cancelled
      if (where.dist > 40) lap.offSince = lap.offSince || now;
      else lap.offSince = 0;
      if ((lap.offSince && now - lap.offSince > 3000) || now - lap.startedAt > RUN_MAX_MS) return this.reset(g, now, 'off');
      if (prev && crossesForward(course.finish, tracker, where.d, prev.x, prev.z, x, z)) {
        this.finishRun(st, now);
        this.lap = null;
      }
      return undefined;
    }
    if (prev && crossesForward(course.start, tracker, where.d, prev.x, prev.z, x, z)) {
      this.newLap(g, now);
      this.lap.gate = true;
      this.lap.course = course;
      this.lap.clips = new LiveClips(course);
    }
    return undefined;
  }

  finishRun(st, now) {
    const lap = this.lap;
    const s = lap.samples;
    const runMs = now - lap.startedAt;
    if (s.length < 20 || s[0][0] > 0.1 || s[s.length - 1][0] < 0.9) return;
    this.lastRunMs = runMs;
    this.emit('lap', this.record(lap, { iLastTime: runMs, session: 6 }, st, 'run'));
  }

  record(lap, g, st, session) {
    const driver = this.getDriver() || {};
    const course = this.getCourse(this.combo); // judged with the course published now
    const s = lap.samples;
    return {
      version: 1,
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      driver: { name: driver.name || st.playerNick || st.playerName || 'Pilote', steamId: driver.steamId || '' },
      car: this.combo.car,
      track: this.combo.track,
      layout: this.combo.layout,
      session: session || SESSION_NAMES[g.session] || 'unknown',
      lapMs: g.iLastTime,
      valid: lap.cutFrames < 30 && !lap.pit,
      cuts: lap.cutFrames,
      topSpeed: round(lap.topSpeed, 1),
      drift: { maxAngle: round(lap.maxAngle, 1), avgAngle: 0, driftTime: 0, ...scoreAllModes(s, course) },
      date: new Date().toISOString(),
      columns: COLUMNS,
      samples: s,
    };
  }

  finishLap(g, st) {
    const lap = this.lap;
    const s = lap.samples;
    // a lap counts only if it was recorded from the line to the line
    if (s.length < 20 || s[0][0] > 0.03 || s[s.length - 1][0] < 0.97 || !(g.iLastTime > 0)) return;
    this.emit('lap', this.record(lap, g, st));
  }
}

module.exports = { TelemetryRecorder, timeAt, gearLabel, COLUMNS };
