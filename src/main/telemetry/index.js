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

class TelemetryManager extends EventEmitter {
  constructor({ dataDir, source, getDriver, getBoardConfig, getSettings }) {
    super();
    this.source = source;
    this.store = new LapStore(dataDir);
    this.recorder = new TelemetryRecorder({ getDriver });
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
      const mine = this.store.list({ ...combo, layout: combo.layout || '' }).filter((l) => !l.imported && (l.driver.steamId || '') === (steamId || ''));
      const bestTime = mine.filter((l) => l.valid).sort((a, b) => a.lapMs - b.lapMs)[0];
      const bestDrift = mine.filter((l) => l.drift.score > 0).sort((a, b) => b.drift.score - a.drift.score)[0];
      if (bestTime) await board.submit(this.store.load(bestTime.id), 'time');
      if (bestDrift) await board.submit(this.store.load(bestDrift.id), 'drift');
    } catch {
      this.synced.delete(key); // offline: try again next time
    }
  }

  async onLap(lap) {
    const prevBest = this.store.best({ car: lap.car, track: lap.track, layout: lap.layout, kind: 'time', steamId: lap.driver.steamId });
    const prevDrift = this.store.best({ car: lap.car, track: lap.track, layout: lap.layout, kind: 'drift', steamId: lap.driver.steamId });
    this.store.save(lap);
    const pbTime = lap.valid && (!prevBest || lap.lapMs < prevBest.lapMs);
    const pbDrift = lap.drift.score > 0 && (!prevDrift || lap.drift.score > prevDrift.drift.score);
    if (pbTime) this.recorder.setReference(lap);
    this.emit('lap', { lap: { ...lap, samples: lap.samples.length }, pbTime, pbDrift });
    const board = this.getSettings().shareLaps !== false ? this.board() : null;
    if (!board) return;
    try {
      if (pbTime) await board.submit(lap, 'time');
      if (pbDrift) await board.submit(lap, 'drift');
      if (pbTime || pbDrift) this.emit('submitted', { pbTime, pbDrift });
    } catch (err) {
      this.emit('submitError', err);
    }
  }
}

module.exports = { TelemetryManager };
