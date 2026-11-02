'use strict';

/**
 * Small log of the launcher itself (userData/logs/launcher.log): crashes of
 * its window or graphics process, unexpected errors. Kept under 256 KB.
 * Used in the crash report and to switch to software rendering after
 * repeated graphics crashes (graphics-safe flag file).
 */

const fs = require('fs');
const path = require('path');

let file = null;

function init(userData) {
  file = path.join(userData, 'logs', 'launcher.log');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.renameSync(file, `${file}.old`);
  } catch {
    /* ignore */
  }
}

function log(...parts) {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
  } catch {
    /* ignore */
  }
}

function tail(n = 30) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

// software rendering for the launcher window (its graphics process kept crashing)
const flagFile = (userData) => path.join(userData, 'gpu-safe');
const graphicsSafe = (userData) => fs.existsSync(flagFile(userData));
function setGraphicsSafe(userData, on) {
  if (on) fs.writeFileSync(flagFile(userData), new Date().toISOString());
  else fs.rmSync(flagFile(userData), { force: true });
}

module.exports = { init, log, tail, graphicsSafe, setGraphicsSafe };
