'use strict';

/**
 * Telemetry manager: polls the game at 60 Hz, records laps, keeps the best
 * lap as live reference, sends personal bests to the shared leaderboard and
 * feeds the launcher / phone dashboards.
 */

const { EventEmitter } = require('events');
const { parsePhysics, parseGraphics, parseStatic } = require('./layout');
const { TelemetryRecorder } = require('./recorder');
const { LapStore } = require('./store');
const { Leaderboard } = require('./leaderboard');
const { DashServer } = require('./dash-server');
const { courseVersion, scoreAllModes, scoreTandemAll, driftOf, MODE_IDS } = require('./drift');

class TelemetryManager extends EventEmitter {
  constructor({ dataDir, source, getDriver, getBoardConfig, getSettings, getCourse }) {
    super();
    this.source = source;
    this.store = new LapStore(dataDir);
    this.getCourse = getCourse || (() => null);
    this.recorder = new TelemetryRecorder({ getDriver, getCourse: (c) => this.getCourse(c) });
    this.getBoardConfig = getBoardConfig || (() => null);
    this.getSettings = getSettings || (() => ({}));
    this.dash = new DashServer({ getLive: () => this.live() });
    this.timer = null;
    this.lastPacket = null;
    this.stale = 0;
    this.ticks = 0;

    this.synced = new Set(); // combos whose bests were sent this session
    this.recorder.on('combo', (c) => this.loadReference(c));
    this.recorder.on('lap', (lap) => this.onLap(lap));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.liveState = null;
        if (!this.tickError) this.emit('warning', err);
        this.tickError = err;
      }
    }, 16);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.dash.stop();
  }

  tick() {
    if (this.getSettings().enabled === false) return;
    const frame = this.source.read();
    if (!frame) {
      this.liveState = null;
      return;
    }
    const physics = parsePhysics(frame.physics);
    const graphics = parseGraphics(frame.graphics);
    // memory left behind by a closed game: stop after 5 s without updates
    if (physics.packetId === this.lastPacket) {
      if (++this.stale > 300) {
        this.liveState = null;
        return;
      }
    } else this.stale = 0;
    this.lastPacket = physics.packetId;
    this.recorder.feed({ physics, graphics, static: parseStatic(frame.static) });
    this.liveState = this.recorder.live;
    if (this.recorder.combo && ++this.ticks % 300 === 1) this.syncBests(this.recorder.combo);
  }

  live() {
    return this.liveState || null;
  }

  board() {
    const cfg = this.getBoardConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return null;
    try {
      return new Leaderboard(cfg);
    } catch {
      return null;
    }
  }

  /** Does this lap need judging again (course or rules changed, older lap)? */
  outdated(l, course) {
    for (const m of MODE_IDS) {
      const d = driftOf(l, m, 'drift');
      if (!d || d.rules !== courseVersion(course, m)) return true;
      if (l.tandem) {
        const t = driftOf(l, m, 'tandem');
        if (!t || t.rules !== courseVersion(course, m)) return true;
      }
    }
    return false;
  }

  /** Judge a full lap (solo + tandem when there was a leader). */
  judge(lap, course) {
    lap.drift = { maxAngle: lap.drift ? lap.drift.maxAngle || 0 : 0, avgAngle: 0, driftTime: 0, ...scoreAllModes(lap.samples, course) };
    if (lap.tandem && lap.tandem.leadSamples) lap.tandem = { lead: lap.tandem.lead, leadSamples: lap.tandem.leadSamples, ...scoreTandemAll(lap.samples, lap.tandem.leadSamples, course) };
    return lap;
  }

  /**
   * Re-judge local laps whose course or rules changed (admins moved the clips,
   * changed a rule, or laps from an older version). Returns how many were updated.
   */
  rescoreAll() {
    let n = 0;
    for (const l of [...this.store.index]) {
      const course = this.getCourse(l);
      if (!this.outdated(l, course)) continue;
      try {
        this.store.save(this.judge(this.store.load(l.id), course), { imported: Boolean(l.imported) });
        n++;
      } catch {
        /* unreadable lap: leave it */
      }
    }
    if (n) this.synced.clear(); // new bests may need sending
    return n;
  }

  loadReference(combo) {
    const best = this.store.best({ ...combo, kind: 'time' });
    this.recorder.setReference(best ? this.store.load(best.id) : null);
  }

  /**
   * Send this driver's existing bests for a combo (laps made before the
   * leaderboard was set up, or while offline). The server keeps only better ones.
   */
  async syncBests(combo) {
    const board = this.getSettings().shareLaps !== false ? this.board() : null;
    const key = `${combo.car}|${combo.track}|${combo.layout || ''}`;
    if (!board || this.synced.has(key)) return;
    this.synced.add(key);
    const { steamId } = this.recorder.getDriver() || {};
    try {
      const q = { car: combo.car, track: combo.track, layout: combo.layout || '', steamId: steamId || '' };
      const own = (l) => l && !l.imported && (l.driver.steamId || '') === (steamId || '');
      const bestTime = this.store.list(q).filter((l) => own(l) && l.valid).sort((a, b) => a.lapMs - b.lapMs)[0];
      if (bestTime) await board.submit(this.store.load(bestTime.id), 'time');
      const course = this.getCourse(combo);
      for (const kind of ['drift', 'tandem']) {
        for (const mode of MODE_IDS) {
          const best = this.store.best({ ...q, kind, mode, rules: courseVersion(course, mode) });
          if (own(best)) await board.submit(this.store.load(best.id), kind, mode);
        }
      }
    } catch {
      this.synced.delete(key); // offline: try again next time
    }
  }

  /** Modes in which this lap beats the driver's record (drift or tandem). */
  newRecords(lap, kind) {
    const out = [];
    for (const mode of MODE_IDS) {
      const res = driftOf(lap, mode, kind);
      if (!res || !(res.score > 0)) continue;
      const prev = this.store.best({ car: lap.car, track: lap.track, layout: lap.layout || '', kind, mode, steamId: lap.driver.steamId, rules: res.rules });
      if (!prev || res.score > prev.result.score) out.push(mode);
    }
    return out;
  }

  async onLap(lap) {
    const prevBest = this.store.best({ car: lap.car, track: lap.track, layout: lap.layout, kind: 'time', steamId: lap.driver.steamId });
    const pbDrift = this.newRecords(lap, 'drift');
    const pbTandem = lap.tandem ? this.newRecords(lap, 'tandem') : [];
    this.store.save(lap);
    const pbTime = lap.valid && (!prevBest || lap.lapMs < prevBest.lapMs);
    if (pbTime && !lap.tandem) this.recorder.setReference(lap);
    this.emit('lap', { lap: { ...lap, samples: lap.samples.length, tandem: lap.tandem ? { ...lap.tandem, leadSamples: undefined } : undefined }, pbTime, pbDrift, pbTandem });
    const board = this.getSettings().shareLaps !== false ? this.board() : null;
    if (!board) return;
    try {
      if (pbTime) await board.submit(lap, 'time');
      for (const mode of pbDrift) await board.submit(lap, 'drift', mode);
      for (const mode of pbTandem) await board.submit(lap, 'tandem', mode);
      if (pbTime || pbDrift.length || pbTandem.length) this.emit('submitted', { pbTime, pbDrift, pbTandem });
    } catch (err) {
      this.emit('submitError', err);
    }
  }

  /** Tandem run recorded by the in-game app (it sees the other cars). */
  addTandemRun(lap) {
    this.judge(lap, this.getCourse(lap));
    return this.onLap(lap);
  }
}

module.exports = { TelemetryManager };
