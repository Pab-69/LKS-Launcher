'use strict';

/**
 * When Assetto Corsa closes right after starting (or with an error code), read
 * the end of its logs and turn them into simple advice + a report to copy.
 *   Documents/Assetto Corsa/logs/log.txt                    (the game)
 *   Documents/Assetto Corsa/logs/custom_shaders_patch.log   (CSP)
 */

const fs = require('fs');
const path = require('path');

function tail(file, maxBytes = 96 * 1024) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
  } catch {
    return [];
  }
}

const ERROR_LINE = /error|exception|crash|could not|cannot|can't|failed|not found|missing|access violation|unhandled/i;

const HINTS = [
  [/dxgi|d3d11|swap ?chain|display mode|resolution|fullscreen|device removed|graphics card/i, 'display', 'L’affichage n’a pas pu démarrer. Va dans Graphismes → « Revenir aux réglages d’origine », puis relance.'],
  [/apps[\\/]lua[\\/]lks|lks\.lua/i, 'app', 'Souci avec l’appli en jeu LKS. Retire-la (Télémétrie → Outils) et relance pour vérifier.'],
  [/content[\\/]cars[\\/][^\\/\s]+[\\/]skins|skin/i, 'skin', 'Une livrée de la voiture pose problème. Choisis une autre livrée, ou vérifie le contenu (Contenu → Vérifier).'],
  [/content[\\/]cars|data\.acd|car.*not found/i, 'car', 'Fichier de voiture manquant ou abîmé. Va dans Contenu → Vérifier, puis relance.'],
  [/content[\\/]tracks|\.kn5|track.*not found|surfaces\.ini/i, 'track', 'Fichier de circuit manquant ou abîmé. Va dans Contenu → Vérifier, puis relance.'],
  [/steam/i, 'steam', 'Steam doit être ouvert et connecté avant de lancer le jeu.'],
  [/out of memory|bad_alloc|not enough memory/i, 'memory', 'Plus assez de mémoire : ferme les autres programmes ou choisis un réglage graphique plus léger.'],
  [/custom shaders patch|extension[\\/]|dwrite/i, 'csp', 'Souci avec le Custom Shaders Patch. Dans Graphismes, désactive-le pour tester, ou réinstalle-le.'],
];

/** Did the game crash? Exit code ≠ 0, or closed after only a few seconds. */
function looksLikeCrash({ code, durationMs }) {
  return (code !== 0 && code !== null && code !== undefined) || (Number(durationMs) > 0 && durationMs < 15000);
}

/**
 * Build the diagnosis. ctx = { code, durationMs, launch: { kind, car, track, layout, mode }, version, docsDir }
 * Returns { hints: [{ id, text }], errors: [lines], report: string }.
 */
function diagnose(ctx) {
  const logs = path.join(ctx.docsDir, 'logs');
  const acLog = tail(path.join(logs, 'log.txt'));
  const cspLog = tail(path.join(logs, 'custom_shaders_patch.log'));
  const errors = [...acLog, ...cspLog].filter((l) => ERROR_LINE.test(l)).slice(-15);
  const haystack = [...errors, ...acLog.slice(-20)].join('\n');
  const hints = [];
  for (const [re, id, text] of HINTS) if (re.test(haystack) && !hints.some((h) => h.id === id)) hints.push({ id, text });
  if (!hints.length) hints.push({ id: 'unknown', text: 'Cause pas claire dans les journaux du jeu. Copie le rapport et envoie-le sur le Discord.' });

  const read = (f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return '(absent)';
    }
  };
  const videoIni = read(path.join(ctx.docsDir, 'cfg', 'video.ini'));
  const videoSection = (videoIni.match(/\[VIDEO\][^[]*/) || ['(absent)'])[0].trim();
  const l = ctx.launch || {};
  const code = ctx.code === null || ctx.code === undefined ? '—' : `${ctx.code}${ctx.code > 255 ? ` (0x${(ctx.code >>> 0).toString(16).toUpperCase()})` : ''}`;
  const report = [
    `LKS Launcher ${ctx.version || ''} — rapport de plantage`,
    `Date : ${new Date().toISOString()}`,
    `Session : ${l.kind || '?'} ${l.mode || ''} · voiture ${l.car || '?'} · circuit ${l.track || '?'}${l.layout ? ` (${l.layout})` : ''}`,
    `Code de sortie : ${code} · durée : ${Math.round((ctx.durationMs || 0) / 1000)} s`,
    '',
    'Pistes :',
    ...hints.map((h) => `- ${h.text}`),
    '',
    '--- video.ini [VIDEO]',
    videoSection,
    '',
    '--- log.txt (fin)',
    ...acLog.slice(-60),
    '',
    '--- custom_shaders_patch.log (fin)',
    ...cspLog.slice(-30),
    '',
    '--- race.ini',
    read(path.join(ctx.docsDir, 'cfg', 'race.ini')).slice(0, 4000),
  ].join('\n');
  return { hints, errors, report };
}

module.exports = { diagnose, looksLikeCrash, tail };
