'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const ini = require('./ini');

const SESSION = { practice: 1, qualify: 2, race: 3, hotlap: 4, timeattack: 5, drift: 6, drag: 7 };

const GRIP_PRESETS = {
  green: { SESSION_START: 86, RANDOMNESS: 1, LAP_GAIN: 30, SESSION_TRANSFER: 50 },
  fast: { SESSION_START: 90, RANDOMNESS: 2, LAP_GAIN: 15, SESSION_TRANSFER: 80 },
  optimum: { SESSION_START: 100, RANDOMNESS: 0, LAP_GAIN: 1, SESSION_TRANSFER: 100 },
};

/** Time of day (decimal hours, 8..18) <-> AC sun angle (-80..80). */
function sunAngle(hours) {
  return Math.max(-80, Math.min(80, Math.round((hours - 13) * 16)));
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function baseSections(o) {
  const grip = GRIP_PRESETS[o.trackGrip] || GRIP_PRESETS.optimum;
  return {
    HEADER: { VERSION: 2 },
    BENCHMARK: { ACTIVE: 0 },
    REPLAY: { ACTIVE: 0 },
    RESTART: { ACTIVE: 0 },
    REMOTE: { ACTIVE: 0 },
    LAP_INVALIDATOR: { ALLOWED_TYRES_OUT: -1 },
    OPTIONS: { USE_MPH: 0 },
    GHOST_CAR: { RECORDING: 1, PLAYING: 0, SECONDS_ADVANTAGE: 0, LOAD: 1, FILE: '', ENABLED: 0 },
    LIGHTING: { SUN_ANGLE: sunAngle(o.timeOfDay ?? 14), TIME_MULT: o.timeMult ?? 1, CLOUD_SPEED: 0.2 },
    GROOVE: { VIRTUAL_LAPS: 10, MAX_LAPS: 30, STARTING_LAPS: 0 },
    DYNAMIC_TRACK: grip,
    TEMPERATURE: { AMBIENT: clampInt(o.ambient, -10, 50, 22), ROAD: clampInt(o.road, -10, 70, 28) },
    WEATHER: { NAME: o.weather || '3_clear' },
    WIND: { SPEED_KMH_MIN: 0, SPEED_KMH_MAX: 0, DIRECTION_DEG: 0 },
  };
}

/**
 * Build race.ini for a solo session.
 * o = { mode, car, skin, track, layout, driverName, nationality, durationMinutes, laps,
 *       aiCount, aiLevel, aiAggression, aiSkins[], startPosition, timeOfDay, weather, ... }
 */
function buildSoloRaceIni(o) {
  const mode = SESSION[o.mode] ? o.mode : 'practice';
  const aiCount = mode === 'hotlap' ? 0 : clampInt(o.aiCount, 0, Math.max(0, (o.maxCars || 24) - 1), 0);
  const cars = aiCount + 1;
  const laps = clampInt(o.laps, 1, 999, 5);
  const s = baseSections(o);

  s.RACE = {
    TRACK: o.track,
    CONFIG_TRACK: o.layout || '',
    MODEL: o.car,
    MODEL_CONFIG: '',
    CARS: cars,
    AI_LEVEL: clampInt(o.aiLevel, 50, 100, 90),
    FIXED_SETUP: o.fixedSetup ? 1 : 0,
    PENALTIES: o.penalties === false ? 0 : 1,
    JUMP_START_PENALTY: 0,
    RACE_LAPS: mode === 'race' ? laps : 0,
  };

  // Player starting grid position for races (1-based), AI fill the rest.
  let playerPos = 1;
  if (mode === 'race') {
    if (o.startPosition === 'last') playerPos = cars;
    else if (o.startPosition === 'random') playerPos = 1 + Math.floor(Math.random() * cars);
    else playerPos = clampInt(o.startPosition, 1, cars, cars);
  }

  s.CAR_0 = {
    SETUP: '',
    SKIN: o.skin || '',
    MODEL: '-',
    MODEL_CONFIG: '',
    BALLAST: 0,
    RESTRICTOR: 0,
    DRIVER_NAME: o.driverName || 'Pilote LKS',
    NATIONALITY: o.nationality || 'FRA',
    NATION_CODE: o.nationality || 'FRA',
  };

  const skins = Array.isArray(o.aiSkins) && o.aiSkins.length ? o.aiSkins : [o.skin || ''];
  const names = o.aiNames && o.aiNames.length ? o.aiNames : null;
  for (let i = 1; i <= aiCount; i++) {
    s[`CAR_${i}`] = {
      MODEL: o.car,
      MODEL_CONFIG: '',
      SKIN: skins[i % skins.length],
      SETUP: '',
      BALLAST: 0,
      RESTRICTOR: 0,
      DRIVER_NAME: names ? names[(i - 1) % names.length] : `IA ${i}`,
      NATIONALITY: '',
      NATION_CODE: '',
      AI_LEVEL: clampInt(o.aiLevel, 50, 100, 90),
      AI_AGGRESSION: clampInt(o.aiAggression, 0, 100, 20),
    };
  }

  if (mode === 'race') {
    s.SESSION_0 = { NAME: 'Course', TYPE: SESSION.race, LAPS: laps, DURATION_MINUTES: 0, SPAWN_SET: 'START', STARTING_POSITION: playerPos };
  } else if (mode === 'hotlap') {
    s.SESSION_0 = { NAME: 'Hotlap', TYPE: SESSION.hotlap, DURATION_MINUTES: 0, SPAWN_SET: 'HOTLAP_START' };
  } else {
    s.SESSION_0 = { NAME: 'Entraînement', TYPE: SESSION.practice, DURATION_MINUTES: clampInt(o.durationMinutes, 0, 1440, 30), SPAWN_SET: 'PIT' };
  }
  return ini.stringify(s);
}

/** Build race.ini to join an online server. */
function buildOnlineRaceIni(o) {
  const s = baseSections(o);
  s.REMOTE = {
    ACTIVE: 1,
    SERVER_IP: o.ip,
    SERVER_PORT: o.tcpPort,
    SERVER_HTTP_PORT: o.httpPort,
    SERVER_NAME: o.serverName || '',
    NAME: o.driverName || 'Pilote LKS',
    TEAM: o.team || '',
    GUID: o.steamId || '',
    REQUESTED_CAR: o.car,
    PASSWORD: o.password || '',
  };
  s.RACE = {
    TRACK: o.track || '',
    CONFIG_TRACK: o.layout || '',
    MODEL: o.car,
    MODEL_CONFIG: '',
    CARS: 1,
    AI_LEVEL: 100,
    FIXED_SETUP: 0,
    PENALTIES: 1,
    JUMP_START_PENALTY: 0,
  };
  s.CAR_0 = {
    SETUP: '',
    SKIN: o.skin || '',
    MODEL: '-',
    MODEL_CONFIG: '',
    BALLAST: 0,
    RESTRICTOR: 0,
    DRIVER_NAME: o.driverName || 'Pilote LKS',
    NATIONALITY: o.nationality || 'FRA',
    NATION_CODE: o.nationality || 'FRA',
  };
  s.SESSION_0 = { NAME: 'Online', TYPE: SESSION.practice, DURATION_MINUTES: 0, SPAWN_SET: 'PIT' };
  return ini.stringify(s);
}

function buildAssistsIni(a) {
  return ini.stringify({
    ASSISTS: {
      IDEAL_LINE: a.idealLine ? 1 : 0,
      AUTO_BLIP: a.autoBlip ? 1 : 0,
      STABILITY_CONTROL: clampInt(a.stabilityControl, 0, 100, 0),
      AUTO_BRAKE: a.autoBrake ? 1 : 0,
      AUTO_SHIFTER: a.autoShifter ? 1 : 0,
      ABS: clampInt(a.abs, 0, 2, 1),
      TRACTION_CONTROL: clampInt(a.tractionControl, 0, 2, 1),
      AUTO_CLUTCH: a.autoClutch ? 1 : 0,
      VISUALDAMAGE: a.visualDamage ? 1 : 0,
      DAMAGE: clampInt(a.damage, 0, 100, 100),
      FUEL_RATE: Number(a.fuelRate) || 0,
      TYRE_WEAR: Number(a.tyreWear) || 0,
      TYRE_BLANKETS: a.tyreBlankets ? 1 : 0,
      SLIPSTREAM: Number(a.slipstream) || 1,
    },
  });
}

/** Runs acs.exe and reports when the game closes (with the session results). */
class GameLauncher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
  }

  get running() {
    return Boolean(this.proc);
  }

  writeConfig(docsDir, raceIni, assistsIni) {
    const cfg = path.join(docsDir, 'cfg');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'race.ini'), raceIni);
    if (assistsIni) fs.writeFileSync(path.join(cfg, 'assists.ini'), assistsIni);
  }

  launch(acRoot, docsDir) {
    if (this.proc) throw new Error('Assetto Corsa est déjà lancé');
    const exe = path.join(acRoot, 'acs.exe');
    if (!fs.existsSync(exe)) throw new Error(`acs.exe introuvable dans ${acRoot}`);
    // Lets acs.exe start outside of the Steam UI (Steam itself must be running).
    const appid = path.join(acRoot, 'steam_appid.txt');
    if (!fs.existsSync(appid)) {
      try {
        fs.writeFileSync(appid, '244210');
      } catch {
        /* read-only install: Steam usually handles it */
      }
    }
    const outFile = path.join(docsDir, 'out', 'race_out.json');
    const startedAt = Date.now();
    this.proc = spawn(exe, [], { cwd: acRoot, detached: false, windowsHide: false, stdio: 'ignore' });
    this.emit('started');
    this.proc.on('error', (err) => {
      this.proc = null;
      this.emit('exited', { error: `Impossible de démarrer acs.exe (${err.code || err.message}). Vérifiez que Steam est lancé et que le dossier du jeu est correct.` });
    });
    this.proc.on('exit', (code) => {
      this.proc = null;
      let results = null;
      try {
        if (fs.statSync(outFile).mtimeMs >= startedAt) results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      } catch {
        results = null;
      }
      this.emit('exited', { code, results: summarizeResults(results), durationMs: Date.now() - startedAt });
    });
  }
}

/** Extract a compact summary from Documents/Assetto Corsa/out/race_out.json */
function summarizeResults(r) {
  if (!r || !Array.isArray(r.sessions)) return null;
  const players = Array.isArray(r.players) ? r.players : [];
  return r.sessions.map((s) => {
    const best = Array.isArray(s.bestLaps) ? s.bestLaps : [];
    const laps = Array.isArray(s.laps) ? s.laps : [];
    const playerLaps = laps.filter((l) => l.car === 0).map((l) => l.time).filter((t) => t > 0);
    return {
      name: s.name,
      type: s.type,
      lapsCount: s.lapsCount,
      bestLapPlayer: playerLaps.length ? Math.min(...playerLaps) : null,
      playerLaps,
      raceResult: Array.isArray(s.raceResult) ? s.raceResult.map((idx) => (players[idx] ? players[idx].name : `#${idx}`)) : [],
      bestLaps: best.map((b) => ({ driver: players[b.car] ? players[b.car].name : `#${b.car}`, time: b.time })),
    };
  });
}

module.exports = { buildSoloRaceIni, buildOnlineRaceIni, buildAssistsIni, GameLauncher, sunAngle, summarizeResults, SESSION };
