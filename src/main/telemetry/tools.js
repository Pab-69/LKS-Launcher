'use strict';

/** Popular companion tools: detection, launch and official download pages. */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TOOLS = {
  simhub: {
    name: 'SimHub',
    description: 'Tableaux de bord, écrans de télémétrie et périphériques (gratuit).',
    url: 'https://www.simhubdash.com/',
    exe: (env) => [path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'SimHub', 'SimHubWPF.exe'), path.join(env.ProgramFiles || 'C:\\Program Files', 'SimHub', 'SimHubWPF.exe')],
  },
  crewchief: {
    name: 'Crew Chief',
    description: 'Ingénieur de course vocal : écarts, pneus, carburant, drapeaux (gratuit).',
    url: 'https://thecrewchief.org/',
    exe: (env) => [path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Britton IT Ltd', 'CrewChiefV4', 'CrewChiefV4.exe'), path.join(env.ProgramFiles || 'C:\\Program Files', 'Britton IT Ltd', 'CrewChiefV4', 'CrewChiefV4.exe')],
  },
};

function findTool(id, { exists = fs.existsSync, env = process.env } = {}) {
  const t = TOOLS[id];
  if (!t) return null;
  return t.exe(env).find((p) => exists(p)) || null;
}

function toolsStatus(opts) {
  return Object.entries(TOOLS).map(([id, t]) => ({ id, name: t.name, description: t.description, url: t.url, installed: Boolean(findTool(id, opts)) }));
}

function launchTool(id, opts) {
  const exe = findTool(id, opts);
  if (!exe) throw new Error(`${TOOLS[id] ? TOOLS[id].name : id} n'est pas installé`);
  const p = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
  p.unref();
  return true;
}

module.exports = { TOOLS, toolsStatus, launchTool, findTool };
