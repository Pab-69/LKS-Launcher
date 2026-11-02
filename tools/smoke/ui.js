#!/usr/bin/env node
'use strict';

/**
 * Windows smoke test of the packaged launcher:
 * starts the real .exe, checks that it renders without errors, downloads the
 * association's branding from the live "content" release, and screenshots
 * every page.
 *
 *   node tools/smoke/ui.js "dist/win-unpacked/LKS Launcher.exe" smoke-shots
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

/** Minimal Assetto Corsa install: 1 car, 1 track, weathers. */
function fakeAc(root) {
  write(path.join(root, 'acs.exe'), 'not a real game');
  write(path.join(root, 'content', 'cars', 'smoke_car', 'ui', 'ui_car.json'), JSON.stringify({ name: 'Smoke Car', brand: 'LKS', class: 'drift' }));
  write(path.join(root, 'content', 'cars', 'smoke_car', 'skins', '00_default', 'ui_skin.json'), '{}');
  write(path.join(root, 'content', 'tracks', 'smoke_track', 'ui', 'ui_track.json'), JSON.stringify({ name: 'Smoke Track', pitboxes: '8' }));
  write(path.join(root, 'content', 'weather', '3_clear', 'weather.ini'), '[LAUNCHER]\nNAME=Clear\n');
  return root;
}

async function run(exe, outDir, label, settings) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lks-smoke-'));
  if (settings) write(path.join(userData, 'settings.json'), JSON.stringify(settings));
  const errors = [];
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, LKS_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.waitForLoadState('domcontentloaded');
  await wait(3000);
  // a "what's new" dialog may be open on some runs
  await page.keyboard.press('Escape');

  const info = await page.evaluate(() => window.lks.call('app:info'));
  console.log(`[${label}] Version ${info.version} (packagée : ${info.packaged}, ${info.platform})`);
  let branding = null;
  for (let i = 0; i < 40; i++) {
    branding = await page.evaluate(() => window.lks.call('branding:get'));
    if (branding.files.length) break;
    await wait(1000);
  }
  console.log(`[${label}] Identité visuelle : ${branding.files.length} fichier(s), ${branding.showcase.length} voiture(s)`);
  const summary = await page.evaluate(() => window.lks.call('sync:summary'));
  console.log(`[${label}] Manifeste : ${summary.manifestError || 'OK'} (mis à jour ${summary.manifestUpdatedAt})`);
  console.log(`[${label}] Mise à jour : ${JSON.stringify(await page.evaluate(() => window.lks.call('updater:state')))}`);

  for (const route of ['home', 'content', 'solo', 'servers', 'graphics', 'donate', 'shop', 'settings']) {
    try {
      await page.evaluate((r) => window.lksGo(r), route);
    } catch (err) {
      errors.push(`page ${route} : ${err.message.split('\n')[0]}`);
    }
    await wait(route === 'graphics' ? 4000 : 1500);
    await page.screenshot({ path: path.join(outDir, `${label}-${route}.png`) });
  }
  await app.close();
  if (!branding.files.includes('logo.png')) errors.push("l'identité visuelle n'a pas été téléchargée");
  if (summary.manifestError) errors.push(summary.manifestError);
  return errors.map((e) => `[${label}] ${e}`);
}

(async () => {
  const [exe, outDir = 'smoke-shots'] = process.argv.slice(2);
  if (!exe || !fs.existsSync(exe)) throw new Error(`Exécutable introuvable : ${exe}`);
  fs.mkdirSync(outDir, { recursive: true });
  const ac = fakeAc(fs.mkdtempSync(path.join(os.tmpdir(), 'lks-smoke-ac-')));
  const problems = [
    // 1. a member's very first start: game folder not configured yet
    ...(await run(exe, outDir, 'premier-lancement', null)),
    // 2. configured profile with an Assetto Corsa folder
    ...(await run(exe, outDir, 'avec-jeu', { acRoot: ac, driverName: 'Smoke', autoSync: false, lastRunVersion: '0.0.1' })),
  ];
  if (problems.length) {
    console.error(`ÉCHEC :\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Smoke test OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
