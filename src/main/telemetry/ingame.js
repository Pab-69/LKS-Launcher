'use strict';

/** Installs the LKS in-game app (Custom Shaders Patch Lua app) into assettocorsa/apps/lua/LKS. */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'ingame', 'LKS');

function appDir(acRoot) {
  return path.join(acRoot, 'apps', 'lua', 'LKS');
}

function bundledVersion() {
  const m = fs.readFileSync(path.join(SRC, 'manifest.ini'), 'utf8').match(/^VERSION\s*=\s*(.+)$/m);
  return m ? m[1].trim() : '0';
}

function ingameStatus(acRoot) {
  const dir = appDir(acRoot);
  let installed = null;
  try {
    const m = fs.readFileSync(path.join(dir, 'manifest.ini'), 'utf8').match(/^VERSION\s*=\s*(.+)$/m);
    installed = m ? m[1].trim() : '?';
  } catch {
    installed = null;
  }
  return { installed, available: bundledVersion(), upToDate: installed === bundledVersion() };
}

/** Lua string literal (names come from the admins' manifest). */
const luaStr = (v) => `"${String(v).replace(/[\\"]/g, '\\$&').replace(/[\x00-\x1f]/g, ' ')}"`;
const num = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 100) / 100) : '0');

const pair = (p) => `{ ${num(p[0])}, ${num(p[1])} }`;

/** Course line for the app: at most ~300 points. */
function thinLine(line = []) {
  const step = Math.max(1, Math.ceil(line.length / 300));
  const out = line.filter((_, i) => i % step === 0);
  if (line.length && out[out.length - 1] !== line[line.length - 1]) out.push(line[line.length - 1]);
  return out;
}

/**
 * Drift courses for the in-game app: apps/lua/LKS/courses.lua
 * clips (with their height when known), and for runs between gates: the
 * « ligne de start » (where to stop for the start lights), « ligne de départ »
 * (the run and its judging start there), finish, and the course line.
 */
function writeCourses(acRoot, courses = {}) {
  const dir = appDir(acRoot);
  if (!fs.existsSync(dir)) return false;
  const lines = ['-- Généré par le launcher LKS : parcours de drift par circuit.', 'return {'];
  for (const [key, c] of Object.entries(courses || {})) {
    const clips = (c.clips || []).map((k, i) => `{ name = ${luaStr(k.name || `Clip ${i + 1}`)}, kind = ${luaStr(k.kind === 'outer' ? 'outer' : 'inner')}, x = ${num(k.x)}, z = ${num(k.z)}, r = ${num(k.r || 3)}${Number.isFinite(Number(k.y)) && k.y !== null ? `, y = ${num(k.y)}` : ''}${Array.isArray(k.path) && k.path.length > 1 ? `, path = { ${k.path.slice(0, 60).map(pair).join(', ')} }` : ''} }`);
    const parts = [`clips = { ${clips.join(', ')} }`];
    if (Array.isArray(c.start) && Array.isArray(c.finish) && Array.isArray(c.refLine) && c.refLine.length > 1) {
      parts.push(`start = { ${pair(c.start[0])}, ${pair(c.start[1])} }`, `finish = { ${pair(c.finish[0])}, ${pair(c.finish[1])} }`);
      parts.push(`line = { ${thinLine(c.refLine).map(pair).join(', ')} }`);
      if (Array.isArray(c.staging) && c.staging.length === 2) parts.push(`staging = { ${pair(c.staging[0])}, ${pair(c.staging[1])} }`);
    }
    if (c.official) parts.push(`official = ${luaStr(c.official)}`);
    lines.push(`  [${luaStr(key)}] = { ${parts.join(', ')} },`);
  }
  lines.push('}', '');
  fs.writeFileSync(path.join(dir, 'courses.lua'), lines.join('\n'));
  return true;
}

function installIngame(acRoot, courses) {
  const dir = appDir(acRoot);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true }); // tandem runs written by the app
  fs.mkdirSync(path.join(dir, 'ghosts'), { recursive: true }); // laps recorded for the ghost
  fs.mkdirSync(path.join(dir, 'measures'), { recursive: true }); // exact clip distances of each run (real car shape)
  fs.mkdirSync(path.join(dir, 'library'), { recursive: true }); // ghosts to pick in game
  writeCourses(acRoot, courses);
  return ingameStatus(acRoot);
}

function removeIngame(acRoot) {
  fs.rmSync(appDir(acRoot), { recursive: true, force: true });
  return ingameStatus(acRoot);
}

module.exports = { ingameStatus, installIngame, removeIngame, appDir, writeCourses };
