'use strict';

/**
 * Official drift courses shipped with the launcher: for each track of the
 * group, the line, clips and start/finish gates worked out from the track
 * itself (its walls, road edges, timing gates and tyre marks).
 * Files: <track>.<layout>.json = { track, layout, name, notes, course }.
 * Priority: course published by the admins > official course > automatic one.
 */

const fs = require('fs');
const path = require('path');

let cache = null;

function load() {
  if (cache) return cache;
  cache = new Map();
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
      if (data && data.track && data.course) cache.set(`${data.track}|${data.layout || ''}`, { ...data.course, official: data.name || data.track });
    } catch (err) {
      console.warn('[courses]', f, err.message);
    }
  }
  return cache;
}

/** Official course of a track/layout (layout '' also matches a track's only course). */
function bundledCourse(track, layout = '') {
  const all = load();
  const exact = all.get(`${track}|${layout || ''}`);
  if (exact) return exact;
  // online, the game gives the layout in lower case (« calmont » for « Calmont »)
  const want = `${track}|${layout || ''}`.toLowerCase();
  const same = [...all.entries()].find(([k]) => k.toLowerCase() === want);
  if (same) return same[1];
  if (!layout) {
    const same = [...all.entries()].filter(([k]) => k.startsWith(`${track}|`));
    if (same.length === 1) return same[0][1];
  }
  return null;
}

function bundledCourses() {
  return Object.fromEntries(load());
}

module.exports = { bundledCourse, bundledCourses };
