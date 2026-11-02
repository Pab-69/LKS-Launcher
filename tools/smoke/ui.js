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

(async () => {
  const [exe, outDir = 'smoke-shots'] = process.argv.slice(2);
  if (!exe || !fs.existsSync(exe)) throw new Error(`Exécutable introuvable : ${exe}`);
  fs.mkdirSync(outDir, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lks-smoke-'));
  const errors = [];

  const app = await electron.launch({ executablePath: exe, env: { ...process.env, LKS_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.waitForLoadState('domcontentloaded');
  await wait(3000);

  const info = await page.evaluate(() => window.lks.call('app:info'));
  console.log(`Version : ${info.version} (packagée : ${info.packaged}, ${info.platform})`);

  // Branding comes from the live manifest: wait for it.
  let branding = null;
  for (let i = 0; i < 40; i++) {
    branding = await page.evaluate(() => window.lks.call('branding:get'));
    if (branding.files.length) break;
    await wait(1000);
  }
  console.log(`Identité visuelle : ${branding.files.length} fichier(s), ${branding.showcase.length} voiture(s)`);
  const summary = await page.evaluate(() => window.lks.call('sync:summary'));
  console.log(`Manifeste : ${summary.manifestError || 'OK'} (mis à jour ${summary.manifestUpdatedAt})`);
  const updater = await page.evaluate(() => window.lks.call('updater:state'));
  console.log(`Mise à jour : ${JSON.stringify(updater)}`);

  for (const route of ['home', 'content', 'solo', 'servers', 'graphics', 'donate', 'shop', 'settings']) {
    await page.evaluate((r) => window.lksGo(r), route);
    await wait(route === 'graphics' ? 4000 : 1500);
    await page.screenshot({ path: path.join(outDir, `${route}.png`) });
  }
  await app.close();

  const problems = [...errors];
  if (!branding.files.includes('logo.png')) problems.push("l'identité visuelle n'a pas été téléchargée");
  if (summary.manifestError) problems.push(summary.manifestError);
  if (problems.length) {
    console.error(`ÉCHEC :\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Smoke test OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
