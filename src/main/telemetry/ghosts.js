'use strict';

/**
 * Ghost car: the in-game app records each complete lap with the car's full
 * position and orientation (apps/lua/LKS/ghosts/*.json). The launcher attaches
 * it to the matching lap (lap.ghost), shares it with the lap, and writes the
 * chosen one to apps/lua/LKS/ghost.json for the app to replay.
 *
 * Ghost row: [tMs, x, y, z, lookX, lookY, lookZ, upX, upY, upZ, speed]
 */

const fs = require('fs');
const path = require('path');

const MAX_ROWS = 6000; // 20 per second: 5 minutes

function cleanRows(rows) {
  if (!Array.isArray(rows)) return null;
  const out = rows.filter((r) => Array.isArray(r) && r.length >= 11 && r.slice(0, 11).every((v) => Number.isFinite(Number(v)))).map((r) => r.slice(0, 11).map(Number));
  if (out.length < 20) return null;
  if (out.length <= MAX_ROWS) return out;
  const step = out.length / MAX_ROWS;
  return Array.from({ length: MAX_ROWS }, (_, i) => out[Math.floor(i * step)]);
}

/** Ghost files waiting in the app folder. Files younger than `keepMs` that match no lap stay for the next try. */
function readGhostFiles(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const file = path.join(dir, f);
    try {
      const g = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = cleanRows(g.rows);
      if (g.v !== 1 || !rows || typeof g.track !== 'string') return { file, bad: true };
      return { file, ghost: { track: g.track, layout: typeof g.layout === 'string' ? g.layout : '', car: String(g.car || ''), driver: String(g.driver || ''), time: Number(g.time) > 1e9 ? Number(g.time) * 1000 : fs.statSync(file).mtimeMs, lapMs: Number(g.lapMs) || 0, rows } };
    } catch {
      return { file, bad: true };
    }
  });
}

/** The lap of this ghost among the laps (summaries) of this PC's driver. */
function matchLap(ghost, laps, steamId) {
  return laps
    .filter((l) => !l.tandem && !l.ghost && l.track === ghost.track && (l.layout || '') === ghost.layout && (l.driver.steamId || '') === (steamId || '') && Math.abs(l.lapMs - ghost.lapMs) <= 30 && Math.abs(Date.parse(l.date) - ghost.time) <= 10 * 60 * 1000)
    .sort((a, b) => Math.abs(Date.parse(a.date) - ghost.time) - Math.abs(Date.parse(b.date) - ghost.time))[0] || null;
}

/** Ghost of a lap → what the app reads (ghost.json). */
function ghostFile(lap) {
  if (!lap || !lap.ghost || !Array.isArray(lap.ghost.rows)) throw new Error('Ce tour n’a pas de fantôme : il faut l’appli en jeu 1.4 pendant le tour.');
  return { v: 1, track: lap.track, layout: lap.layout || '', car: lap.car, driver: lap.driver.name, lapMs: lap.lapMs, rows: lap.ghost.rows };
}

function writeGhost(appDir, lap) {
  const data = ghostFile(lap);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'ghost.json.tmp'), JSON.stringify(data));
  fs.renameSync(path.join(appDir, 'ghost.json.tmp'), path.join(appDir, 'ghost.json'));
  return { driver: data.driver, track: data.track, layout: data.layout, car: data.car, lapMs: data.lapMs };
}

function currentGhost(appDir) {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(appDir, 'ghost.json'), 'utf8'));
    return { driver: g.driver, track: g.track, layout: g.layout || '', car: g.car, lapMs: g.lapMs };
  } catch {
    return null;
  }
}

function clearGhost(appDir) {
  fs.rmSync(path.join(appDir, 'ghost.json'), { force: true });
}

module.exports = { readGhostFiles, matchLap, ghostFile, writeGhost, currentGhost, clearGhost, cleanRows };
