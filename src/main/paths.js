'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

/** Parse Valve's text KeyValues format (libraryfolders.vdf, loginusers.vdf). */
function parseVdf(text) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m;
  while ((m = re.exec(text))) tokens.push(m[2] ? { brace: m[2] } : { str: m[1].replace(/\\\\/g, '\\') });
  let i = 0;
  function obj() {
    const result = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t.brace === '}') return result;
      if (t.str === undefined) continue;
      const next = tokens[i++];
      if (!next) break;
      if (next.brace === '{') result[t.str] = obj();
      else result[t.str] = next.str;
    }
    return result;
  }
  return obj();
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve('');
      const m = stdout.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
      resolve(m ? m[1].trim() : '');
    });
  });
}

async function findSteamPath() {
  const candidates = [
    await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(os.homedir(), '.steam', 'steam'),
    path.join(os.homedir(), '.local', 'share', 'Steam'),
  ].filter(Boolean);
  for (const c of candidates) {
    const p = path.normalize(c);
    if (exists(path.join(p, 'steamapps'))) return p;
  }
  return '';
}

function isAcRoot(dir) {
  return Boolean(dir) && exists(path.join(dir, 'content', 'cars')) && (exists(path.join(dir, 'acs.exe')) || exists(path.join(dir, 'AssettoCorsa.exe')));
}

async function detectAcRoot() {
  const steam = await findSteamPath();
  const libraries = [];
  if (steam) {
    libraries.push(steam);
    try {
      const vdf = parseVdf(fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
      const folders = vdf.libraryfolders || vdf.LibraryFolders || {};
      for (const value of Object.values(folders)) {
        if (typeof value === 'string' && exists(value)) libraries.push(value);
        else if (value && value.path) libraries.push(value.path);
      }
    } catch {
      /* no library file */
    }
  }
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    libraries.push(`${drive}:\\SteamLibrary`, `${drive}:\\Steam`, `${drive}:\\Program Files (x86)\\Steam`);
  }
  for (const lib of libraries) {
    const candidate = path.join(lib, 'steamapps', 'common', 'assettocorsa');
    if (isAcRoot(candidate)) return candidate;
  }
  return '';
}

/** Most recent Steam account: { steamId, personaName } */
async function detectSteamUser() {
  const steam = await findSteamPath();
  if (!steam) return { steamId: '', personaName: '' };
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(steam, 'config', 'loginusers.vdf'), 'utf8'));
    const users = vdf.users || {};
    let best = null;
    for (const [id, info] of Object.entries(users)) {
      const recent = info.MostRecent === '1' || info.mostrecent === '1';
      if (!best || recent) best = { steamId: id, personaName: info.PersonaName || '' };
      if (recent) break;
    }
    return best || { steamId: '', personaName: '' };
  } catch {
    return { steamId: '', personaName: '' };
  }
}

/** "Documents/Assetto Corsa" (holds cfg/race.ini, out/race_out.json...) */
function acDocumentsDir(settings, documentsPath) {
  if (settings.documentsDir) return settings.documentsDir;
  return path.join(documentsPath, 'Assetto Corsa');
}

module.exports = { parseVdf, detectAcRoot, detectSteamUser, isAcRoot, acDocumentsDir, findSteamPath };
