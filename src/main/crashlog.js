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
// lines that look like errors but say nothing (the crash handler failing to read symbols)
const NOISE = /SymGetLineFromAddr64|filename not available|RtlUserThreadStart|BaseThreadInitThunk/i;

// Where the game was when it crashed (its own call stack, written after « CRASH in: »)
const STACK_HINTS = [
  [/surfacesmanager|loadsurfacedefinitions/i, 'track-surfaces', 'Le circuit n’a pas pu charger ses surfaces (data/surfaces.ini manquant ou abîmé). Souvent le mauvais tracé : choisis un autre tracé du circuit, sinon réinstalle-le.'],
  [/sim::loadtrack|trackavatar|track(?:manager|loader)/i, 'track', 'Le jeu a planté en chargeant le circuit. Choisis un autre tracé, ou vérifie / réinstalle le circuit.'],
  [/caravatar|loadcar|carphysics|suspension|tyres?model|drivetrain/i, 'car', 'Le jeu a planté en chargeant la voiture. Vérifie le contenu (Contenu → Vérifier) ou essaie une autre voiture.'],
  [/d3d|dxgi|swapchain|graphicsmanager|rendertarget/i, 'display', 'L’affichage n’a pas pu démarrer. Va dans Graphismes → « Revenir aux réglages d’origine », puis relance.'],
];

const HINTS = [
  [/track not found/i, 'track-missing', 'Le jeu ne trouve pas ce circuit ou ce tracé. Choisis un autre tracé dans Solo ; si ça continue, vérifie le contenu (Contenu → Vérifier).'],
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
  // the CSP log is only about this session if it was written since the launch (CSP can be off)
  const cspFile = path.join(logs, 'custom_shaders_patch.log');
  let cspFresh = true;
  try {
    const started = Date.now() - (Number(ctx.durationMs) || 0) - 10000;
    cspFresh = fs.statSync(cspFile).mtimeMs >= started;
  } catch {
    cspFresh = false;
  }
  const cspLog = cspFresh ? tail(cspFile) : [];
  // the log repeats race.ini: never read hints from it, only from errors and the crash stack
  const crashAt = acLog.map((l) => /CRASH in/i.test(l)).lastIndexOf(true);
  const stack = crashAt >= 0 ? acLog.slice(crashAt).filter((l) => !NOISE.test(l)) : [];
  // game errors first; from the CSP log only real errors (not its many texture/mesh warnings)
  const acErrors = acLog.filter((l) => ERROR_LINE.test(l) && !NOISE.test(l) && !/CrashGuard/i.test(l)).slice(-10);
  const cspErrors = cspLog.filter((l) => /\berror\b|exception|❌|failed to (?:load|create|init)/i.test(l) && !/TextureLoader|⚠️|🔹/.test(l)).slice(-5);
  const errors = [...acErrors, ...cspErrors];
  const hints = [];
  const add = (id, text) => {
    const family = id.split('-')[0];
    if (!hints.some((h) => h.id.split('-')[0] === family)) hints.push({ id, text });
  };
  for (const [re, id, text] of STACK_HINTS) if (re.test(stack.join('\n'))) add(id, text);
  const haystack = errors.join('\n');
  for (const [re, id, text] of HINTS) if (re.test(haystack)) add(id, text);
  // recent mod tracks only load with the CSP: « TRACK NOT FOUND » while it is off
  const missing = hints.findIndex((h) => h.id === 'track-missing');
  if (missing >= 0 && ctx.cspEnabled === false) hints[missing] = { id: 'track-missing-csp', text: 'Ce circuit a sûrement besoin du Custom Shaders Patch, qui est désactivé. Réactive-le dans Graphismes, puis relance.' };
  if (!hints.length && ctx.cspEnabled) hints.push({ id: 'csp-test', text: 'Pour savoir si ça vient du Custom Shaders Patch : dans Graphismes, choisis le préréglage « Performance », relance ; si ça plante encore, désactive le CSP pour tester.' });
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
    cspFresh ? '--- custom_shaders_patch.log (fin)' : '--- custom_shaders_patch.log : pas écrit pendant cette session (CSP désactivé ?)',
    ...cspLog.slice(-30),
    '',
    `--- launcher (CSP ${ctx.cspEnabled ? 'activé' : 'désactivé'})`,
    ...(ctx.launcherLog || []),
    '',
    '--- race.ini',
    read(path.join(ctx.docsDir, 'cfg', 'race.ini')).slice(0, 4000),
  ].join('\n');
  return { hints, errors: [...errors, ...stack.filter((l) => /\.cpp \(\d+\)/.test(l)).slice(0, 6)], report };
}

/**
 * Text sent to the admins (Discord): without what identifies the member —
 * Steam IDs, Windows account name in paths, IP addresses, e-mail addresses.
 */
function scrub(text) {
  return String(text || '')
    .replace(/\b7656119\d{10}\b/g, '[steam-id]')
    .replace(/([A-Za-z]:[\\/](?:Users|Utilisateurs|Documents and Settings)[\\/])[^\\/\r\n]+/gi, '$1[nom]')
    .replace(/(\/home\/|\/Users\/)[^/\s]+/g, '$1[nom]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]');
}

module.exports = { diagnose, looksLikeCrash, tail, scrub };
