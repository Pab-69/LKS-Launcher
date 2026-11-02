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

function installIngame(acRoot) {
  const dir = appDir(acRoot);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  return ingameStatus(acRoot);
}

function removeIngame(acRoot) {
  fs.rmSync(appDir(acRoot), { recursive: true, force: true });
  return ingameStatus(acRoot);
}

module.exports = { ingameStatus, installIngame, removeIngame, appDir };
