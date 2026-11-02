'use strict';

const fs = require('fs');
const path = require('path');

/**
 * AC ui_*.json files are often invalid (BOM, raw tabs/newlines, trailing
 * commas, comments, unescaped quotes). Last resort: pick the simple fields.
 */
function readLooseJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    /* try harder */
  }
  try {
    const cleaned = text
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  } catch {
    /* fields one by one */
  }
  const out = {};
  for (const key of ['name', 'country', 'length', 'pitboxes', 'description', 'brand', 'class']) {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*("((?:[^"\\\\]|\\\\.)*)"|-?\\d+(?:\\.\\d+)?)`, 'i'));
    if (m) out[key] = m[2] !== undefined ? m[2] : m[1];
  }
  return Object.keys(out).length ? out : null;
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function contentDir(acRoot, kind) {
  return path.join(acRoot, 'content', kind === 'car' ? 'cars' : 'tracks');
}

function stripHtml(s) {
  return typeof s === 'string' ? s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim() : '';
}

function readCar(acRoot, id) {
  const dir = path.join(contentDir(acRoot, 'car'), id);
  const ui = readLooseJson(path.join(dir, 'ui', 'ui_car.json')) || {};
  const skins = listDirs(path.join(dir, 'skins')).map((skin) => {
    const skinUi = readLooseJson(path.join(dir, 'skins', skin, 'ui_skin.json')) || {};
    return {
      id: skin,
      name: skinUi.skinname || skin.replace(/^\d+_/, '').replace(/_/g, ' '),
      preview: fileExists(path.join(dir, 'skins', skin, 'preview.jpg')) ? `car/${id}/skins/${skin}/preview.jpg` : '',
      livery: fileExists(path.join(dir, 'skins', skin, 'livery.png')) ? `car/${id}/skins/${skin}/livery.png` : '',
    };
  });
  return {
    kind: 'car',
    id,
    name: ui.name || id,
    brand: ui.brand || '',
    carClass: ui.class || '',
    tags: Array.isArray(ui.tags) ? ui.tags : [],
    description: stripHtml(ui.description),
    specs: ui.specs || {},
    badge: fileExists(path.join(dir, 'ui', 'badge.png')) ? `car/${id}/ui/badge.png` : '',
    skins,
  };
}

/**
 * Does the game have what it needs to load this layout? AC reads
 * <track>/data/surfaces.ini (single layout) or <track>/<layout>/data/surfaces.ini,
 * and crashes while loading when it is missing.
 */
function layoutHasPhysics(trackDir, layoutId) {
  return fileExists(path.join(trackDir, ...(layoutId ? [layoutId] : []), 'data', 'surfaces.ini'));
}

function readTrack(acRoot, id) {
  const dir = path.join(contentDir(acRoot, 'track'), id);
  const uiOf = (sub) => readLooseJson(path.join(dir, 'ui', ...(sub ? [sub] : []), 'ui_track.json'));
  const uiDirOf = (sub) => path.join(dir, 'ui', ...(sub ? [sub] : []));
  // layouts the game can really load (physics files present)
  const physical = listDirs(dir).filter((sub) => sub !== 'ui' && layoutHasPhysics(dir, sub));
  const rootPhysical = layoutHasPhysics(dir, '');
  const layouts = [];
  if (physical.length || rootPhysical) {
    const uiOrder = listDirs(path.join(dir, 'ui'));
    const ordered = [...uiOrder.filter((s) => physical.includes(s)), ...physical.filter((s) => !uiOrder.includes(s))];
    for (const sub of ordered) layouts.push(layoutInfo(id, sub, uiOf(sub) || {}, uiDirOf(sub)));
    if (rootPhysical) layouts.push(layoutInfo(id, '', uiOf('') || {}, uiDirOf('')));
  } else {
    // unusual layout of files: trust the ui folders as before
    for (const sub of listDirs(path.join(dir, 'ui'))) {
      const ui = uiOf(sub);
      if (ui) layouts.push(layoutInfo(id, sub, ui, uiDirOf(sub)));
    }
    const rootUi = uiOf('');
    if (rootUi && layouts.length === 0) layouts.push(layoutInfo(id, '', rootUi, uiDirOf('')));
  }
  if (layouts.length === 0) layouts.push({ id: '', name: id, preview: '', outline: '', pitboxes: 0, length: '', country: '' });
  return {
    kind: 'track',
    id,
    name: commonTrackName(layouts) || id,
    country: layouts[0].country,
    layouts,
    preview: layouts[0].preview,
  };
}

function layoutInfo(trackId, layoutId, ui, uiDir) {
  const rel = layoutId ? `track/${trackId}/ui/${layoutId}` : `track/${trackId}/ui`;
  return {
    id: layoutId,
    name: String(ui.name || layoutId || trackId),
    country: ui.country || '',
    length: ui.length || '',
    pitboxes: parseInt(ui.pitboxes, 10) || 0,
    description: stripHtml(ui.description),
    preview: fileExists(path.join(uiDir, 'preview.png')) ? `${rel}/preview.png` : '',
    outline: fileExists(path.join(uiDir, 'outline.png')) ? `${rel}/outline.png` : '',
  };
}

function commonTrackName(layouts) {
  if (layouts.length === 1) return layouts[0].name;
  const names = layouts.map((l) => l.name);
  let prefix = names[0] || '';
  for (const n of names) while (prefix && !n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix.replace(/[\s\-–(]+$/, '').trim();
}

function scanCars(acRoot) {
  return listDirs(contentDir(acRoot, 'car'))
    .map((id) => readCar(acRoot, id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanTracks(acRoot) {
  return listDirs(contentDir(acRoot, 'track'))
    .filter((id) => fs.existsSync(path.join(contentDir(acRoot, 'track'), id, 'ui')) || fs.existsSync(path.join(contentDir(acRoot, 'track'), id, 'models.ini')))
    .map((id) => readTrack(acRoot, id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanWeathers(acRoot) {
  const dir = path.join(acRoot, 'content', 'weather');
  const list = listDirs(dir).map((id) => {
    let name = id.replace(/^\d+_/, '').replace(/_/g, ' ');
    name = name.charAt(0).toUpperCase() + name.slice(1);
    try {
      const ini = fs.readFileSync(path.join(dir, id, 'weather.ini'), 'utf8');
      const m = ini.match(/^NAME=(.+)$/m);
      if (m) name = m[1].trim();
    } catch {
      /* default name */
    }
    return { id, name };
  });
  return list.length ? list : [{ id: '3_clear', name: 'Clear' }];
}

/** Find the local file behind a "car/<id>/..." or "track/<id>/..." image path. */
function resolveContentFile(acRoot, rel) {
  const parts = rel.split('/').filter(Boolean);
  const kind = parts.shift();
  if ((kind !== 'car' && kind !== 'track') || parts.some((p) => p === '..' || p.includes('\\'))) return null;
  const base = contentDir(acRoot, kind);
  const file = path.resolve(base, ...parts);
  if (!file.startsWith(path.resolve(base) + path.sep)) return null;
  return file;
}

module.exports = { readLooseJson, readCar, readTrack, scanCars, scanTracks, scanWeathers, contentDir, resolveContentFile, listDirs, layoutHasPhysics };
