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

/** Drift courses (clips) for the in-game app: apps/lua/LKS/courses.lua */
function writeCourses(acRoot, courses = {}) {
  const dir = appDir(acRoot);
  if (!fs.existsSync(dir)) return false;
  const lines = ['-- Généré par le launcher LKS : clips de drift par circuit.', 'return {'];
  for (const [key, c] of Object.entries(courses || {})) {
    const clips = (c.clips || []).map((k, i) => `{ name = ${luaStr(k.name || `Clip ${i + 1}`)}, x = ${num(k.x)}, z = ${num(k.z)}, r = ${num(k.r || 3)} }`);
    lines.push(`  [${luaStr(key)}] = { clips = { ${clips.join(', ')} } },`);
  }
  lines.push('}', '');
  fs.writeFileSync(path.join(dir, 'courses.lua'), lines.join('\n'));
  return true;
}

function installIngame(acRoot, courses) {
  const dir = appDir(acRoot);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  writeCourses(acRoot, courses);
  return ingameStatus(acRoot);
}

function removeIngame(acRoot) {
  fs.rmSync(appDir(acRoot), { recursive: true, force: true });
  return ingameStatus(acRoot);
}

module.exports = { ingameStatus, installIngame, removeIngame, appDir, writeCourses };
