#!/usr/bin/env node
'use strict';

/**
 * Publish the visual identity (logo, showcase) from a folder, like the
 * "Publication > Identité visuelle" button of the launcher.
 *
 *   GITHUB_TOKEN=... node tools/publish-branding.js <folder> [owner/repo] [tag]
 */

const { GitHub } = require('../src/main/github');
const { Publisher } = require('../src/main/publisher');
const appConfig = require('../lks.config.json');

(async () => {
  const [dir, repo = appConfig.contentRepo, tag = appConfig.contentTag || 'content'] = process.argv.slice(2);
  if (!dir) throw new Error('Usage : node tools/publish-branding.js <dossier> [owner/repo] [tag]');
  const pub = new Publisher({ gh: new GitHub({ token: process.env.GITHUB_TOKEN, repo }), tag, log: (l) => console.log(l) });
  await pub.open();
  const r = await pub.publishBranding(dir);
  console.log(`Identité visuelle publiée : ${r.files} fichier(s), ${r.showcase} voiture(s) — ${pub.manifestUrl()}`);
})().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
