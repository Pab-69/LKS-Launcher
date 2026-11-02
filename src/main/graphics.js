'use strict';

/**
 * Graphics presets ("LKS presets") for Assetto Corsa + Custom Shaders Patch.
 *
 * - AC settings go to  Documents/Assetto Corsa/cfg/video.ini
 * - CSP settings go to Documents/Assetto Corsa/cfg/extension/<module>.ini
 *   (user overrides on top of CSP defaults, same place Content Manager writes them)
 *
 * Only the keys below are touched; everything else the player set is kept.
 * The first time, the original files are backed up so they can be restored.
 */

const fs = require('fs');
const path = require('path');
const ini = require('./ini');

// Settings shared by every preset: CSP on, WeatherFX (dynamic sky/clouds/lighting),
// new car paint & PBR shaders, smart shadows, CSP antialiasing route.
const CSP_BASE = {
  'general.ini': { BASIC: { ENABLED: 1 } },
  'weather_fx.ini': { BASIC: { ENABLED: 1, CONTROLLER: 'sol', IMPLEMENTATION: 'base' }, TWEAKS: { APPLY_AUTOMATIC_WHITE_REF_POINT_FIX: 1 } },
  'graphics_adjustments.ini': {
    BASIC: { ENABLED: 1, FORCE_FXAA: 1 },
    SHADER_REPLACEMENTS: { ALLOW_TAG_NEW_CARPAINT: 1, ALLOW_TAG_NEW_WATER: 1, ALLOW_TAG_PBR: 1 },
    HUMAN_SHADER: { ENABLED: 1 },
    ANTIALIASING_MSAA: { CUSTOM_RESOLVE: 1 },
    ANTIALIASING: { MODE: 'FXAA3', QUALITY: 'HIGH' },
    COLOR_BUFFER: { ACTIVE: 1, FULL_RESOLUTION: 1 },
  },
  'smart_shadows.ini': { BASIC: { ENABLED: 1, AUTOMATIC_SPLITS: 1 }, SMOOTH_CASCADES: { ENABLED: 1 }, CUSTOM_SHADOW_MATRICES: { ENABLED: 1, FOURTH_CASCADE: 1 } },
  'lighting_fx.ini': { BASIC: { ENABLED: 1 } },
  'particles_fx.ini': { BASIC: { ENABLED: 1 }, AC_PARTICLES: { SOFT_PARTICLES: 1 }, SPARKS: { ENABLED: 1 } },
  'reflections_fx.ini': { BASIC: { ENABLED: 1, ENABLED2: 1 }, MAIN_CUBEMAP: { REPROJECT_PARTIAL: 1, RESOLUTION2: 512 } },
  'grass_fx.ini': { BASIC: { ENABLED: 1 } },
};

// AC's own video settings shared by every preset (post-processing + FXAA are
// required by CSP; default PP filter always exists).
const VIDEO_BASE = {
  VIDEO: { VSYNC: 0 },
  POST_PROCESS: { ENABLED: 1, FILTER: 'default', FXAA: 1 },
  EFFECTS: { MOTION_BLUR: 0, RENDER_SMOKE_IN_MIRROR: 0 },
  SATURATION: { LEVEL: 100 },
};

const PRESETS = {
  performance: {
    label: 'Performance',
    tagline: 'PC portable, petite carte graphique',
    description: 'Fluidité avant tout. Ciel et météo dynamiques du CSP, ombres propres, upscaling AMD FSR pour gagner des images par seconde.',
    features: ['Météo dynamique', 'Ombres 2048', 'FSR (upscaling)', 'MSAA 2x'],
    video: {
      VIDEO: { AASAMPLES: 2, ANISOTROPIC: 8, SHADOW_MAP_SIZE: 2048 },
      ASSETTOCORSA: { WORLD_DETAIL: 4 },
      CUBEMAP: { SIZE: 512, FACES_PER_FRAME: 1, FARPLANE: 300 },
      EFFECTS: { SMOKE: 1 },
      POST_PROCESS: { QUALITY: 2, GLARE: 1, DOF: 0, RAYS_OF_GOD: 0, HEAT_SHIMMER: 0 },
      MIRROR: { HQ: 0, SIZE: 512 },
    },
    csp: {
      'extra_fx.ini': { BASIC: { ENABLED: 0 } },
      'graphics_adjustments.ini': { FSR: { ACTIVE: 1, OLD_IMPLEMENTATION: 0, QUALITY2: 0.77, SHARPEN2: 0.5 }, ANTIALIASING: { FFXCAS_PASS: 0 }, LODS: { CARS_DISTANCE_MULT: 1, TRACK_DISTANCE_MULT: 1, TREES_DISTANCE_MULT: 1 } },
      'grass_fx.ini': { BASIC: { QUALITY: 1 }, RENDERING: { CAST_SHADOWS: 0 } },
      'lighting_fx.ini': { PERFORMANCE: { CARS_WITH_LIGHTS: 4, ENABLE_REFLECTION_LIGHT: 0, ENABLE_TREES_LIGHTING: 0, ENABLE_REARVIEWMIRROR_LIGHT: 0 }, SHADOWS: { ENABLED: 0 } },
      'smart_shadows.ini': { BASIC: { AUTOMATIC_SPLITS_DISTANCE: 120 } },
      'weather_fx.ini': { PERFORMANCE: { EXTRA_CLOUDS_FIDELITY: 0, DETAILED_CLOUD_SHADOWS: 0, SLOW_REFLECTIONS_UPDATE: 1 } },
      'reflections_fx.ini': { LOCAL_CUBEMAPS_CARS2: { ENABLED: 1, ALLOW_DYNAMIC: 0 }, LOCAL_CUBEMAPS_TRACKS2: { ENABLED: 1, ALLOW_DYNAMIC: 0 } },
    },
  },
  balanced: {
    label: 'Équilibré',
    tagline: 'La plupart des PC de jeu',
    description: 'Le bon compromis : anticrénelage temporel (TAA), réflexions sur la piste, lumières dynamiques et ombres 4096.',
    features: ['Météo dynamique', 'TAA + netteté AMD', 'Réflexions SSLR', 'Ombres 4096'],
    video: {
      VIDEO: { AASAMPLES: 2, ANISOTROPIC: 16, SHADOW_MAP_SIZE: 4096 },
      ASSETTOCORSA: { WORLD_DETAIL: 5 },
      CUBEMAP: { SIZE: 1024, FACES_PER_FRAME: 2, FARPLANE: 500 },
      EFFECTS: { SMOKE: 2 },
      POST_PROCESS: { QUALITY: 3, GLARE: 3, DOF: 1, RAYS_OF_GOD: 1, HEAT_SHIMMER: 1 },
      MIRROR: { HQ: 1, SIZE: 512 },
    },
    csp: {
      'extra_fx.ini': {
        BASIC: { ENABLED: 1, EXTERIOR_ONLY: 0 },
        TAA: { ENABLED: 1, EXTRA_SHARPEN_PASS: 0 },
        SSLR: { ENABLED: 1, TRACING_QUALITY3: 3, STEPS_SIMPLE: 36, SCALE: 0.75 },
        ASSAO: { ENABLED: 0 },
        SS_LIGHTING: { ENABLED: 1, SCALE: 0.5 },
        VOLUMETRIC_LIGHTS: { ENABLED: 0 },
        FOG_BLUR: { ENABLED: 1 },
        MOTION_BLUR: { ENABLED: 0 },
      },
      'graphics_adjustments.ini': { FSR: { ACTIVE: 0 }, ANTIALIASING: { FFXCAS_PASS: 1, FFXCAS_SHARPNESS: 0.4 }, LODS: { CARS_DISTANCE_MULT: 1, TRACK_DISTANCE_MULT: 1, TREES_DISTANCE_MULT: 1 } },
      'grass_fx.ini': { BASIC: { QUALITY: 2 }, RENDERING: { CAST_SHADOWS: 0 } },
      'lighting_fx.ini': { PERFORMANCE: { CARS_WITH_LIGHTS: 8, ENABLE_REFLECTION_LIGHT: 1, ENABLE_TREES_LIGHTING: 1, ENABLE_REARVIEWMIRROR_LIGHT: 1 }, SHADOWS: { ENABLED: 0 } },
      'smart_shadows.ini': { BASIC: { AUTOMATIC_SPLITS_DISTANCE: 200 } },
      'weather_fx.ini': { PERFORMANCE: { EXTRA_CLOUDS_FIDELITY: 1, DETAILED_CLOUD_SHADOWS: 0, SLOW_REFLECTIONS_UPDATE: 0 } },
      'reflections_fx.ini': { LOCAL_CUBEMAPS_CARS2: { ENABLED: 1, ALLOW_DYNAMIC: 1 }, LOCAL_CUBEMAPS_TRACKS2: { ENABLED: 1, ALLOW_DYNAMIC: 1 } },
    },
  },
  quality: {
    label: 'Qualité',
    tagline: 'Bonne carte graphique (RTX 2070 / 3060 et +)',
    description: 'Le rendu « vidéo YouTube » : occlusion ambiante, rayons de lumière, ombres des phares, herbe détaillée et MSAA 4x.',
    features: ['Tout Équilibré +', 'Occlusion ambiante', 'Rayons volumétriques', 'Ombres des phares'],
    video: {
      VIDEO: { AASAMPLES: 4, ANISOTROPIC: 16, SHADOW_MAP_SIZE: 4096 },
      ASSETTOCORSA: { WORLD_DETAIL: 5 },
      CUBEMAP: { SIZE: 1024, FACES_PER_FRAME: 3, FARPLANE: 600 },
      EFFECTS: { SMOKE: 3 },
      POST_PROCESS: { QUALITY: 4, GLARE: 4, DOF: 2, RAYS_OF_GOD: 1, HEAT_SHIMMER: 1 },
      MIRROR: { HQ: 1, SIZE: 1024 },
    },
    csp: {
      'extra_fx.ini': {
        BASIC: { ENABLED: 1, EXTERIOR_ONLY: 0 },
        TAA: { ENABLED: 1, EXTRA_SHARPEN_PASS: 0 },
        SSLR: { ENABLED: 1, TRACING_QUALITY3: 3, STEPS_SIMPLE: 48, SCALE: 1 },
        ASSAO: { ENABLED: 1, QUALITY: 1, OPACITY: 0.8 },
        SS_LIGHTING: { ENABLED: 1, SCALE: 1 },
        VOLUMETRIC_LIGHTS: { ENABLED: 1, SCALE: 0.2 },
        FOG_BLUR: { ENABLED: 1 },
        MOTION_BLUR: { ENABLED: 0 },
      },
      'graphics_adjustments.ini': { FSR: { ACTIVE: 0 }, ANTIALIASING: { FFXCAS_PASS: 1, FFXCAS_SHARPNESS: 0.4 }, LODS: { CARS_DISTANCE_MULT: 1.25, TRACK_DISTANCE_MULT: 1.25, TREES_DISTANCE_MULT: 1.25 } },
      'grass_fx.ini': { BASIC: { QUALITY: 3 }, RENDERING: { CAST_SHADOWS: 0 } },
      'lighting_fx.ini': { PERFORMANCE: { CARS_WITH_LIGHTS: 12, ENABLE_REFLECTION_LIGHT: 1, ENABLE_TREES_LIGHTING: 1, ENABLE_REARVIEWMIRROR_LIGHT: 1 }, SHADOWS: { ENABLED: 1, CARS_SHADOWS: 2 } },
      'smart_shadows.ini': { BASIC: { AUTOMATIC_SPLITS_DISTANCE: 250 } },
      'weather_fx.ini': { PERFORMANCE: { EXTRA_CLOUDS_FIDELITY: 1, DETAILED_CLOUD_SHADOWS: 0, SLOW_REFLECTIONS_UPDATE: 0 } },
      'reflections_fx.ini': { LOCAL_CUBEMAPS_CARS2: { ENABLED: 1, ALLOW_DYNAMIC: 1 }, LOCAL_CUBEMAPS_TRACKS2: { ENABLED: 1, ALLOW_DYNAMIC: 1 } },
    },
  },
  ultra: {
    label: 'Ultra',
    tagline: 'Très grosse carte graphique (RTX 3080 / 4070 Ti et +)',
    description: 'Tout au maximum : réflexions Hi-Z, occlusion haute qualité, ombres des nuages, herbe avec ombres et détails visibles de très loin.',
    features: ['Tout Qualité +', 'Réflexions Hi-Z', 'Ombres des nuages', 'Détails lointains x1.5'],
    video: {
      VIDEO: { AASAMPLES: 4, ANISOTROPIC: 16, SHADOW_MAP_SIZE: 4096 },
      ASSETTOCORSA: { WORLD_DETAIL: 5 },
      CUBEMAP: { SIZE: 1024, FACES_PER_FRAME: 4, FARPLANE: 1000 },
      EFFECTS: { SMOKE: 3 },
      POST_PROCESS: { QUALITY: 5, GLARE: 4, DOF: 3, RAYS_OF_GOD: 1, HEAT_SHIMMER: 1 },
      MIRROR: { HQ: 1, SIZE: 1024 },
    },
    csp: {
      'extra_fx.ini': {
        BASIC: { ENABLED: 1, EXTERIOR_ONLY: 0 },
        TAA: { ENABLED: 1, EXTRA_SHARPEN_PASS: 0 },
        SSLR: { ENABLED: 1, TRACING_QUALITY3: 4, STEPS_HIZ: 120, SCALE: 1 },
        ASSAO: { ENABLED: 1, QUALITY: 2, OPACITY: 0.8 },
        SS_LIGHTING: { ENABLED: 1, SCALE: 1 },
        VOLUMETRIC_LIGHTS: { ENABLED: 1, SCALE: 0.32 },
        FOG_BLUR: { ENABLED: 1 },
        MOTION_BLUR: { ENABLED: 0 },
      },
      'graphics_adjustments.ini': { FSR: { ACTIVE: 0 }, ANTIALIASING: { FFXCAS_PASS: 1, FFXCAS_SHARPNESS: 0.4 }, LODS: { CARS_DISTANCE_MULT: 1.5, TRACK_DISTANCE_MULT: 1.5, TREES_DISTANCE_MULT: 1.5 } },
      'grass_fx.ini': { BASIC: { QUALITY: 4 }, RENDERING: { CAST_SHADOWS: 1 } },
      'lighting_fx.ini': { PERFORMANCE: { CARS_WITH_LIGHTS: 20, ENABLE_REFLECTION_LIGHT: 1, ENABLE_TREES_LIGHTING: 1, ENABLE_REARVIEWMIRROR_LIGHT: 1 }, SHADOWS: { ENABLED: 1, CARS_SHADOWS: 3 } },
      'smart_shadows.ini': { BASIC: { AUTOMATIC_SPLITS_DISTANCE: 300 } },
      'weather_fx.ini': { PERFORMANCE: { EXTRA_CLOUDS_FIDELITY: 1, DETAILED_CLOUD_SHADOWS: 1, SLOW_REFLECTIONS_UPDATE: 0 } },
      'reflections_fx.ini': { LOCAL_CUBEMAPS_CARS2: { ENABLED: 1, ALLOW_DYNAMIC: 1 }, LOCAL_CUBEMAPS_TRACKS2: { ENABLED: 1, ALLOW_DYNAMIC: 1 } },
    },
  },
};

const PRESET_ORDER = ['performance', 'balanced', 'quality', 'ultra'];

/** Guess a preset from the graphics card name (Chromium's GPU info string). */
function recommendPreset(gpuName) {
  const n = String(gpuName || '').toLowerCase();
  if (!n) return 'balanced';
  const num = (re) => {
    const m = n.match(re);
    return m ? Number(m[1]) : null;
  };
  // NVIDIA RTX
  const rtx = num(/rtx\s*a?(\d{4})/);
  if (rtx) {
    const series = Math.floor(rtx / 1000);
    const tier = rtx % 100; // 4090 -> 90, 3060 -> 60
    if (series >= 3 && tier >= 70) return series >= 4 || tier >= 80 ? 'ultra' : 'quality';
    if (series >= 4 && tier >= 60) return 'quality';
    if (series === 2 && tier >= 70) return 'quality';
    return 'balanced';
  }
  // NVIDIA GTX
  const gtx = num(/gtx\s*(\d{3,4})/);
  if (gtx) {
    if (gtx >= 1070 && gtx < 1600) return 'balanced';
    if (gtx >= 1650) return 'balanced';
    if (gtx >= 1060) return 'balanced';
    return 'performance';
  }
  // AMD Radeon RX
  const rx = num(/rx\s*(\d{3,4})/);
  if (rx) {
    if (rx >= 9000) return 'ultra';
    if (rx >= 6000) {
      const tier = Math.floor((rx % 1000) / 100);
      if (tier >= 8) return 'ultra';
      if (tier >= 7) return 'quality';
      return 'balanced';
    }
    if (rx >= 5600) return 'balanced';
    if (rx >= 570 && rx < 1000) return 'balanced';
    return 'performance';
  }
  if (/arc\s*a7|arc\s*b5/.test(n)) return 'quality';
  if (/arc/.test(n)) return 'balanced';
  if (/intel|uhd|iris|vega|radeon\(tm\) graphics|radeon graphics|mx\s*\d|microsoft basic|swiftshader/.test(n)) return 'performance';
  return 'balanced';
}

function readIni(file) {
  try {
    return ini.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function merge(target, patch) {
  for (const [section, values] of Object.entries(patch)) {
    target[section] = { ...(target[section] || {}), ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])) };
  }
  return target;
}

function deepMergePatch(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [file, sections] of Object.entries(b || {})) {
    out[file] = out[file] || {};
    for (const [section, values] of Object.entries(sections)) out[file][section] = { ...(out[file][section] || {}), ...values };
  }
  return out;
}

// Real screen modes: Windows scaling (125 %, 150 %…) can turn 2560 into 2561
// once multiplied back, and the game crashes on a fullscreen mode that does not exist.
const RESOLUTIONS = [
  [1280, 720], [1280, 800], [1280, 1024], [1360, 768], [1366, 768], [1440, 900], [1600, 900], [1680, 1050],
  [1920, 1080], [1920, 1200], [2048, 1152], [2560, 1080], [2560, 1440], [2560, 1600], [2880, 1800], [3200, 1800],
  [3440, 1440], [3840, 1080], [3840, 1600], [3840, 2160], [5120, 1440], [5120, 2160], [7680, 4320],
];
const REFRESH_RATES = [50, 59, 60, 75, 85, 90, 100, 120, 144, 160, 165, 170, 175, 180, 200, 240, 280, 300, 360];

/** Closest real screen mode (± 8 px), else the size rounded to an even number. */
function snapResolution(width, height) {
  const dist = ([w, h]) => Math.abs(w - width) + Math.abs(h - height);
  const hit = RESOLUTIONS.filter(([w, h]) => Math.abs(w - width) <= 8 && Math.abs(h - height) <= 8).sort((a, b) => dist(a) - dist(b))[0];
  if (hit) return { width: hit[0], height: hit[1] };
  return { width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 };
}

function snapRefresh(hz) {
  const n = Number(hz) || 60;
  return REFRESH_RATES.reduce((best, r) => (Math.abs(r - n) < Math.abs(best - n) ? r : best), 60);
}

/** Files written by a preset, relative to Documents/Assetto Corsa/cfg */
function presetFiles(presetId, display) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`Préréglage inconnu : ${presetId}`);
  const video = deepMergePatch({ v: VIDEO_BASE }, { v: preset.video }).v;
  if (display && display.width && display.height) {
    const { width, height } = snapResolution(display.width, display.height);
    video.VIDEO = { ...video.VIDEO, WIDTH: width, HEIGHT: height, FULLSCREEN: 1, REFRESH: snapRefresh(display.refresh) };
  }
  const csp = deepMergePatch(CSP_BASE, preset.csp);
  const files = { 'video.ini': video };
  for (const [name, sections] of Object.entries(csp)) files[`extension/${name}`] = sections;
  return files;
}

/**
 * Apply a preset. Existing values the preset does not manage are preserved
 * (camera mode for VR/triple screens, FPS cap, controls…).
 */
function applyPreset(docsDir, presetId, { display, withCsp = true } = {}) {
  const cfg = path.join(docsDir, 'cfg');
  const files = presetFiles(presetId, display);
  backupOnce(cfg, Object.keys(files));
  const written = [];
  for (const [rel, sections] of Object.entries(files)) {
    if (!withCsp && rel.startsWith('extension/')) continue;
    const file = path.join(cfg, ...rel.split('/'));
    const current = readIni(file);
    if (rel === 'video.ini') {
      if (!(current.CAMERA && current.CAMERA.MODE)) sections.CAMERA = { MODE: 'DEFAULT' };
      // never change a screen mode the game already uses: only fill it in when missing
      const v = current.VIDEO || {};
      const w = Number(v.WIDTH);
      const h = Number(v.HEIGHT);
      const snapped = snapResolution(w, h);
      if (w > 0 && h > 0 && snapped.width === w && snapped.height === h && sections.VIDEO) {
        for (const k of ['WIDTH', 'HEIGHT', 'FULLSCREEN', 'REFRESH']) delete sections.VIDEO[k];
      }
      delete current.REFRESH; // bad section written by older versions
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ini.stringify(merge(current, sections)));
    written.push(rel);
  }
  return written;
}

/**
 * Before each launch: fix a screen mode that cannot exist (written by an older
 * launcher version, or by hand): 2561×1440 → 2560×1440. Returns true if changed.
 */
function repairVideoIni(docsDir) {
  const file = path.join(docsDir, 'cfg', 'video.ini');
  if (!fs.existsSync(file)) return false;
  const current = readIni(file);
  const v = current.VIDEO || {};
  const w = Number(v.WIDTH);
  const h = Number(v.HEIGHT);
  let changed = false;
  if (w > 0 && h > 0) {
    const snapped = snapResolution(w, h);
    if (snapped.width !== w || snapped.height !== h) {
      current.VIDEO = { ...v, WIDTH: String(snapped.width), HEIGHT: String(snapped.height) };
      changed = true;
    }
  }
  if (current.REFRESH) {
    delete current.REFRESH;
    changed = true;
  }
  if (changed) fs.writeFileSync(file, ini.stringify(current));
  return changed;
}

const BACKUP_DIR = '.lks-backup-original';

/** Keep a copy of the player's original files (only the first time). */
function backupOnce(cfg, rels) {
  const dir = path.join(cfg, BACKUP_DIR);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { createdAt: new Date().toISOString(), files: {} };
  for (const rel of rels) {
    const src = path.join(cfg, ...rel.split('/'));
    const existed = fs.existsSync(src);
    manifest.files[rel] = existed;
    if (existed) {
      const dst = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(manifest, null, 2));
  return true;
}

function hasBackup(docsDir) {
  return fs.existsSync(path.join(docsDir, 'cfg', BACKUP_DIR, 'backup.json'));
}

/** Restore the files exactly as they were before the first preset. */
function restoreBackup(docsDir) {
  const cfg = path.join(docsDir, 'cfg');
  const dir = path.join(cfg, BACKUP_DIR);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8'));
  for (const [rel, existed] of Object.entries(manifest.files)) {
    const target = path.join(cfg, ...rel.split('/'));
    if (existed) fs.copyFileSync(path.join(dir, ...rel.split('/')), target);
    else fs.rmSync(target, { force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return Object.keys(manifest.files).length;
}

function presetList() {
  return PRESET_ORDER.map((id) => ({ id, label: PRESETS[id].label, tagline: PRESETS[id].tagline, description: PRESETS[id].description, features: PRESETS[id].features }));
}

module.exports = { PRESETS, PRESET_ORDER, presetList, presetFiles, applyPreset, restoreBackup, hasBackup, recommendPreset, snapResolution, snapRefresh, repairVideoIni };
