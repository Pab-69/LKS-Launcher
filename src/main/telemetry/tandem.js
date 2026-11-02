'use strict';

/**
 * Tandem runs written by the in-game app (apps/lua/LKS/runs/*.json): the
 * shared memory of Assetto Corsa only describes your own car, the CSP app
 * sees the car in front. Each run becomes a lap with the leader's trajectory
 * (lap.tandem.leadSamples) and is judged as a chase.
 *
 * Row from the app: [t, d, x, z, speed, slip, gas, brake, gear, wheelsOut,
 *                    leadX, leadZ, leadSlip, leadSpeed, contact]
 */

const fs = require('fs');
const path = require('path');
const { COLUMNS } = require('./recorder');

const fold = (slip) => Math.min(180, Math.abs(slip));

function runToLap(run, driver = {}) {
  if (!run || run.v !== 1 || !Array.isArray(run.rows) || run.rows.length < 20) throw new Error('Run tandem invalide');
  if (typeof run.track !== 'string' || !/^[\w.-]+$/.test(run.track) || typeof run.car !== 'string') throw new Error('Run tandem invalide');
  const rows = run.rows.filter((r) => Array.isArray(r) && r.length >= 15 && r.every((v) => Number.isFinite(Number(v)))).map((r) => r.map(Number));
  if (rows.length < 20) throw new Error('Run tandem trop courte');
  const t0 = rows[0][0];
  const samples = rows.map((r) => [r[1], r[0] - t0, r[4], r[6], r[7], r[8], 0, 0, fold(r[5]), r[2], r[3], r[9], r[5], r[14]]);
  const leadSamples = rows.map((r) => [r[10], r[11], fold(r[12]), r[13], r[12]]);
  const lapMs = Number(run.lapMs) > 0 ? Number(run.lapMs) : samples[samples.length - 1][1];
  return {
    version: 1,
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    driver: { name: String(driver.name || run.driver || 'Pilote').slice(0, 40), steamId: driver.steamId || '' },
    car: run.car,
    track: run.track,
    layout: typeof run.layout === 'string' ? run.layout : '',
    session: 'tandem',
    lapMs,
    valid: true,
    cuts: 0,
    topSpeed: Math.max(...samples.map((s) => s[2])),
    drift: {},
    tandem: { lead: { name: String((run.lead && run.lead.name) || '?').slice(0, 40), car: String((run.lead && run.lead.car) || '') }, leadSamples },
    date: new Date().toISOString(),
    columns: [...COLUMNS, 'contact'],
    samples,
  };
}

/** Read and remove the runs waiting in the app folder. */
function collectRuns(dir, driver) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const laps = [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      laps.push(runToLap(JSON.parse(fs.readFileSync(file, 'utf8')), driver));
    } catch {
      /* bad or partial file: dropped */
    }
    fs.rmSync(file, { force: true });
  }
  return laps;
}

module.exports = { runToLap, collectRuns };
