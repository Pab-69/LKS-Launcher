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
const { BattleStore, findPartnerRun } = require('./battles');
const { readGhostFiles, matchLap } = require('./ghosts');
const { readMeasureFiles, measureMatches } = require('./measures');
const { History } = require('./history');
const fs = require('fs');
const { courseVersion, scoreAllModes, scoreTandemAll, driftOf, applyBattleParts, MODE_IDS } = require('./drift');

class TelemetryManager extends EventEmitter {
  constructor({ dataDir, source, getDriver, getBoardConfig, getPlayer, getSettings, getCourse, getRounds, getObs, getExchange, exchangeWaitMs, canonical, getMeasureDir, measureWaitMs }) {
    super();
    this.source = source;
    this.store = new LapStore(dataDir);
    this.history = new History(dataDir); // progress of this PC's driver, kept after the session purge
    this.battles = new BattleStore(dataDir);
    // championship rounds open now for a track: [{ id, kind, mode, start, end }]
    this.getRounds = getRounds || (() => []);
    this.getCourse = getCourse || (() => null);
    this.recorder = new TelemetryRecorder({ getDriver, getCourse: (c) => this.getCourse(c), canonical });
    this.getBoardConfig = getBoardConfig || (() => null);
    this.getPlayer = getPlayer || (() => '');
    // battles launched in game: each driver's own notes, exchanged through the group's server
    this.getExchange = getExchange || (() => null);
    this.exchangeWaitMs = exchangeWaitMs === undefined ? 90000 : exchangeWaitMs;
    this.battleJobs = Promise.resolve();
    // exact clip distances from the in-game app (apps/lua/LKS/measures)
    this.getMeasureDir = getMeasureDir || (() => null);
    this.measureWaitMs = measureWaitMs === undefined ? 2500 : measureWaitMs;
    this.getSettings = getSettings || (() => ({}));
    this.dash = new DashServer({ getLive: () => this.live(), getObs: () => (getObs ? getObs() : null) });
    this.timer = null;
    this.lastPacket = null;
    this.stale = 0;
    this.ticks = 0;

    this.synced = new Set(); // combos whose bests were sent this session
    this.recorder.on('combo', (c) => {
      this.loadReference(c);
      this.emit('combo', c);
    });
    this.recorder.on('lap', (lap) => {
      const course = this.getMeasureDir() ? this.getCourse(lap) : null;
      if (!course || !(course.clips || []).length) return this.onLap(lap); // no in-game app or no clips: right away
      this.withMeasure(lap)
        .then((l) => this.onLap(l))
        .catch((err) => this.emit('submitError', err));
    });
    this.recorder.on('reset', (r) => this.emit('reset', r));
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
      return new Leaderboard({ ...cfg, player: this.getPlayer() });
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
    lap.drift = { maxAngle: lap.drift ? lap.drift.maxAngle || 0 : 0, avgAngle: 0, driftTime: 0, ...scoreAllModes(lap.samples, course, lap.measure || null) };
    // the battle tag (battles launched in game) stays with the run
    if (lap.tandem && lap.tandem.leadSamples) lap.tandem = { lead: lap.tandem.lead, leadSamples: lap.tandem.leadSamples, ...(lap.tandem.battle ? { battle: lap.tandem.battle } : {}), ...scoreTandemAll(lap.samples, lap.tandem.leadSamples, course) };
    return lap;
  }

  /**
   * Re-judge local laps whose course or rules changed (admins moved the clips,
   * changed a rule, or laps from an older version). Returns how many were updated.
   */
  /** Progress of this PC's driver (history filled from the passages on first use). */
  progress(opts) {
    const mine = (this.recorder.getDriver() || {}).steamId || '';
    if (!this.history.items) this.history.seed(this.store.list({}).filter((l) => !l.imported && (l.driver.steamId || '') === mine).map((l) => this.store.load(l.id)));
    return this.history.progress(opts);
  }

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
    n += this.battles.rejudge((b) => this.getCourse(b), (id) => this.store.load(id), courseVersion);
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

  /**
   * After the admins changed a course: the bests of this PC's driver, judged
   * again, are sent for every car and track at once (not only when driving
   * there), so the shared ranking never loses them.
   */
  async syncAllBests() {
    const { steamId } = this.recorder.getDriver() || {};
    const combos = new Map();
    for (const l of this.store.index) {
      if (l.imported || (l.driver.steamId || '') !== (steamId || '')) continue;
      combos.set(`${l.car}|${l.track}|${l.layout || ''}`, { car: l.car, track: l.track, layout: l.layout || '' });
    }
    for (const combo of combos.values()) await this.syncBests(combo);
    return combos.size;
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
    const mine = (this.recorder.getDriver() || {}).steamId || '';
    if ((lap.driver.steamId || '') === mine) {
      try {
        this.history.add(lap);
      } catch (err) {
        this.emit('submitError', err);
      }
    }
    const prevBest = this.store.best({ car: lap.car, track: lap.track, layout: lap.layout, kind: 'time', steamId: lap.driver.steamId });
    const pbDrift = this.newRecords(lap, 'drift');
    const pbTandem = lap.tandem ? this.newRecords(lap, 'tandem') : [];
    this.store.save(lap);
    const pbTime = lap.valid && (!prevBest || lap.lapMs < prevBest.lapMs);
    if (pbTime && !lap.tandem) this.recorder.setReference(lap);
    this.emit('lap', { lap: { ...lap, samples: lap.samples.length, tandem: lap.tandem ? { ...lap.tandem, leadSamples: undefined } : undefined }, pbTime, pbDrift, pbTandem });
    // only this PC's driver sends records (a run you led holds the other driver's chase)
    const me = (this.recorder.getDriver() || {}).steamId || '';
    const board = this.getSettings().shareLaps !== false && (lap.driver.steamId || '') === me ? this.board() : null;
    if (!board) return;
    try {
      for (const mode of pbDrift) await board.submit(lap, 'drift', mode);
      for (const mode of pbTandem) await board.submit(lap, 'tandem', mode);
      for (const r of this.roundRecords(lap)) await board.submit(lap, r.kind, r.mode, r.rules);
      if (pbTime || pbDrift.length || pbTandem.length) this.emit('submitted', { pbTime, pbDrift, pbTandem });
    } catch (err) {
      this.emit('submitError', err);
    }
  }

  /**
   * Championship rounds open now on this track: is this lap the driver's best
   * of the round? Returns [{ kind, mode, rules }] to send with the round's rules.
   */
  roundRecords(lap) {
    const out = [];
    const own = lap.driver.steamId;
    if (!own) return out;
    const time = Date.parse(lap.date);
    for (const round of this.getRounds({ track: lap.track, layout: lap.layout || '' }) || []) {
      const kind = round.kind === 'battle' ? 'drift' : round.kind; // battle rounds: qualifying in solo
      if (kind !== 'drift' && kind !== 'tandem') continue;
      if (!(time >= Date.parse(round.start) && time <= Date.parse(round.end))) continue;
      const res = driftOf(lap, round.mode, kind);
      if (!res || !(res.score > 0)) continue;
      const others = this.store.list({ track: lap.track, layout: lap.layout || '' }).filter((l) => l.id !== lap.id && l.driver.steamId === own && Date.parse(l.date) >= Date.parse(round.start) && Date.parse(l.date) <= Date.parse(round.end));
      const better = others.every((l) => {
        const o = driftOf(l, round.mode, kind);
        return !o || o.rules !== res.rules || o.score < res.score;
      });
      if (better) out.push({ kind, mode: round.mode, rules: `${res.rules}@${round.id}` });
    }
    return out;
  }

  /** Tandem run recorded by the in-game app (it sees the other cars). */
  async addTandemRun(lap) {
    this.judge(lap, this.getCourse(lap));
    await this.onLap(lap);
    return this.detectBattle(lap);
  }

  /** The app's measure of this run, if it wrote one (it finishes the run at the same moment). */
  takeMeasure(lap) {
    const dir = this.getMeasureDir();
    if (!dir) return null;
    const found = readMeasureFiles(dir).find((f) => f.measure && measureMatches(f.measure, lap));
    if (!found) return null;
    fs.rmSync(found.file, { force: true });
    return found.measure;
  }

  /** A run from the shared memory: wait a moment for the app's exact clip measure, then judge with it. */
  async withMeasure(lap) {
    const course = this.getCourse(lap);
    if (!this.getMeasureDir() || !course || !(course.clips || []).length) return lap;
    const until = Date.now() + this.measureWaitMs;
    for (;;) {
      const m = this.takeMeasure(lap);
      if (m) {
        lap.measure = m;
        return this.judge(lap, course);
      }
      if (Date.now() >= until) return lap;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /**
   * Measures that came late (or of tandem runs imported from the app): judge
   * the matching lap again with them. Measures older than 10 min are dropped.
   */
  attachMeasures(dir, now = Date.now()) {
    const { steamId } = this.recorder.getDriver() || {};
    let n = 0;
    for (const { file, measure, bad } of readMeasureFiles(dir)) {
      if (bad) {
        fs.rmSync(file, { force: true });
        continue;
      }
      const match = this.store.list({ track: measure.track, layout: measure.layout }).filter((l) => !l.measured && (l.driver.steamId || '') === (steamId || '') && measureMatches(measure, l))[0];
      if (match) {
        try {
          const lap = this.store.load(match.id);
          lap.measure = measure;
          this.store.save(this.judge(lap, this.getCourse(lap)), { imported: Boolean(match.imported) });
          n++;
        } catch {
          /* lap gone */
        }
      } else if (now - measure.time < 10 * 60 * 1000) continue; // its lap may not be saved yet
      fs.rmSync(file, { force: true });
    }
    return n;
  }

  /**
   * Ghost laps recorded by the in-game app: attach each one to the matching
   * lap of this PC's driver. Returns how many were attached.
   */
  attachGhosts(dir, now = Date.now()) {
    const { steamId } = this.recorder.getDriver() || {};
    let n = 0;
    for (const { file, ghost, bad } of readGhostFiles(dir)) {
      if (bad) {
        fs.rmSync(file, { force: true });
        continue;
      }
      const match = matchLap(ghost, this.store.list({ track: ghost.track, layout: ghost.layout }), steamId);
      if (match) {
        try {
          const lap = this.store.load(match.id);
          lap.ghost = { rows: ghost.rows, ...(Number.isFinite(ghost.green) ? { green: ghost.green } : {}) };
          this.store.save(lap, { imported: Boolean(match.imported) });
          this.synced.delete(`${lap.car}|${lap.track}|${lap.layout || ''}`); // resend the bests, now with their ghost
          n++;
        } catch {
          /* lap gone */
        }
      } else if (now - ghost.time < 60000) continue; // its lap may not be saved yet
      fs.rmSync(file, { force: true });
    }
    return n;
  }

  /**
   * End of a game session: once the in-game runs are imported and the battles
   * judged, only the best passages stay on this PC (see LapStore.purge).
   */
  async purgeSession() {
    await this.battleJobs;
    return this.store.purge(new Set(this.pendingLaps || []));
  }

  /** Two runs with the roles swapped = a battle. */
  async detectBattle(lap) {
    const candidates = this.store.list({ track: lap.track, layout: lap.layout || '' }).filter((l) => l.tandem);
    this.pendingLaps = this.pendingLaps || new Set(); // runs of a battle still waiting for the other driver's notes
    const used = new Set([...this.battles.usedLaps(), ...this.pendingLaps]);
    const other = findPartnerRun(lap, candidates, used);
    if (!other) return null;
    const full = this.store.load(other.id);
    const course = this.getCourse(lap);
    const battle = BattleStore.make(lap, full, course);
    if (battle.tag) battle.id = `t${String(battle.tag).replace(/[^\w-]/g, '').slice(0, 24)}`; // same id on both PCs: one result on the server
    for (const run of [lap, full]) {
      run.battleId = battle.id; // kept when old laps are cleaned up
      this.store.save(run, { imported: Boolean(this.store.index.find((l) => l.id === run.id && l.imported)) });
    }
    const exchange = battle.tag ? this.getExchange() : null;
    if (!exchange) {
      await this.finishBattle(battle);
      return battle;
    }
    // the other driver's notes come from his own PC (up to 90 s): in the background
    for (const run of [lap, full]) this.pendingLaps.add(run.id);
    const job = this.shareBattleParts(battle, course, exchange)
      .catch((err) => this.emit('submitError', err))
      .then(() => this.finishBattle(battle))
      .finally(() => {
        for (const run of [lap, full]) this.pendingLaps.delete(run.id);
      });
    this.battleJobs = this.battleJobs.then(() => job);
    return battle;
  }

  /** Send this PC's driver notes, wait for the other driver's ones, and judge with both. */
  async shareBattleParts(battle, course, exchange) {
    const me = String((this.recorder.getDriver() || {}).name || '').trim().toLowerCase();
    const res = battle.modes.normal;
    const mine = res && res.drivers.find((d) => String(d.name).trim().toLowerCase() === me);
    const other = res && res.drivers.find((d) => String(d.name).trim().toLowerCase() !== me);
    if (!mine || !other) return;
    const parts = {};
    for (const [mode, r] of Object.entries(battle.modes)) {
      const d = r.drivers.find((x) => String(x.name).trim().toLowerCase() === me);
      parts[mode] = { lead: d.lead, chase: d.chase };
    }
    await exchange.addBattlePart({ tag: String(battle.tag), driver: mine.name, opponent: other.name, parts });
    const until = Date.now() + this.exchangeWaitMs;
    for (;;) {
      const rows = await exchange.battleParts(String(battle.tag)).catch(() => []);
      const theirs = rows.find((r) => String(r.driver).trim().toLowerCase() === String(other.name).trim().toLowerCase() && String(r.opponent || '').trim().toLowerCase() === me);
      if (theirs) {
        battle.modes = applyBattleParts(battle.modes, { [me]: parts, [String(other.name).trim().toLowerCase()]: theirs.parts }, course);
        battle.fair = true;
        return;
      }
      if (Date.now() >= until) {
        battle.estimated = true; // the other launcher did not answer: judged on this PC only
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(50, until - Date.now()))));
    }
  }

  async finishBattle(battle) {
    this.battles.add(battle);
    this.emit('battle', battle);
    const board = this.getSettings().shareLaps !== false ? this.board() : null;
    if (board) {
      try {
        const rounds = (this.getRounds({ track: battle.track, layout: battle.layout }) || []).filter((r) => r.kind === 'battle' && Date.parse(battle.date) >= Date.parse(r.start) && Date.parse(battle.date) <= Date.parse(r.end));
        for (const mode of MODE_IDS) {
          await board.submitBattle(battle, mode);
          for (const r of rounds.filter((x) => x.mode === mode)) await board.submitBattle(battle, mode, `${battle.modes[mode].rules}@${r.id}`);
        }
      } catch (err) {
        this.emit('submitError', err);
      }
    }
    return battle;
  }
}

module.exports = { TelemetryManager };
