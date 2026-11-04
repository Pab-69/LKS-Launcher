#!/usr/bin/env node
'use strict';

/**
 * Builds the showcase website (GitHub Pages) into a folder.
 * The association's logo, photos and news are fetched from the live
 * "content" release at build time: they are never committed to the repo.
 *
 *   node tools/build-site.js _site
 */

const fs = require('fs');
const path = require('path');
const appConfig = require('../lks.config.json');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || '_site');
const repo = appConfig.contentRepo;
const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeHttps = (u) => (/^https:\/\//.test(u || '') ? u : null);

async function getJson(url, extra = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'LKS-site', ...extra } });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': 'LKS-site' } });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'brand'), { recursive: true });
  fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
  for (const f of ['grenze-gotisch-latin-600-normal.woff2', 'barlow-condensed-latin-700-normal.woff2', 'barlow-latin-400-normal.woff2', 'barlow-latin-600-normal.woff2']) {
    fs.copyFileSync(path.join(root, 'src', 'renderer', 'fonts', f), path.join(out, 'fonts', f));
  }
  for (const f of ['style.css', 'site.js', 'classement.js', 'admin.js']) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));
  // the championship code of the launcher, for the site's standings (same results everywhere)
  const mods = { './championship': 'championship.js', './judging': 'judging.js', './rounds': 'rounds.js' };
  const bundle = Object.entries(mods).map(([name, file]) => `defs[${JSON.stringify(name)}] = function (module, exports, require) {\n${fs.readFileSync(path.join(root, 'src', 'main', 'telemetry', file), 'utf8')}\n};`).join('\n');
  fs.writeFileSync(path.join(out, 'lks-shared.js'), `/* Code des championnats du launcher LKS (GPL-3.0) */\n(function () {\nvar defs = {}, cache = {};\nfunction req(n) { if (!cache[n]) { var m = { exports: {} }; cache[n] = m; defs[n](m, m.exports, req); } return cache[n].exports; }\n${bundle}\nwindow.LKSChamp = req('./championship');\nwindow.LKSRounds = req('./rounds');\n})();\n`);

  let manifest = {};
  try {
    manifest = await getJson(appConfig.manifestUrl);
  } catch (err) {
    console.warn(`Manifeste indisponible (${err.message}) : site sans identité visuelle`);
  }
  let version = '';
  try {
    version = (await getJson(`https://api.github.com/repos/${repo}/releases/latest`, headers)).tag_name.replace(/^v/, '');
  } catch (err) {
    console.warn(`Version inconnue (${err.message})`);
  }

  // brand files (logo, photos) -> _site/brand
  const brand = {};
  for (const f of (manifest.branding && manifest.branding.files) || []) {
    if (!/^[\w.-]+\.(png|jpe?g|webp)$/i.test(f.name) || !safeHttps(f.url)) continue;
    try {
      await download(f.url, path.join(out, 'brand', f.name));
      brand[f.name] = `brand/${f.name}`;
    } catch (err) {
      console.warn(`${f.name} : ${err.message}`);
    }
  }
  const showcase = ((manifest.branding && manifest.branding.showcase) || []).filter((s) => brand[s.image]);
  const discordUrl = manifest.discord && safeHttps(manifest.discord.inviteUrl);
  const donateLinks = ((manifest.donate && manifest.donate.links) || []).filter((l) => safeHttps(l.url));
  const shop = manifest.shop && manifest.shop.open && safeHttps(manifest.shop.url);
  const news = (manifest.news || []).slice(0, 3);
  // the group's server: live soirées, news, rankings and the admin page
  const local = /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(process.env.LKS_SERVER_URL || '') ? process.env.LKS_SERVER_URL : null; // tests on one PC
  const server = safeHttps(process.env.LKS_SERVER_URL) || local || (manifest.leaderboard && safeHttps(manifest.leaderboard.url)) || '';
  fs.writeFileSync(path.join(out, 'config.js'), `window.LKS_SERVER = ${JSON.stringify(server.replace(/\/$/, ''))};\n`);

  const vars = {
    REPO: repo,
    YEAR: String(new Date().getFullYear()),
    VERSION: esc(version || 'dernière'),
    DOWNLOAD_URL: `https://github.com/${repo}/releases/latest/download/LKS-Launcher-Setup.exe`,
    OG_IMAGE: showcase[0] ? `<meta property="og:image" content="${esc(brand[showcase[0].image])}" />` : '',
    FAVICON: brand['icon.png'] ? '<link rel="icon" href="brand/icon.png" />' : '',
    HERO_BG: showcase[0] ? `<img class="hero-bg" src="${esc(brand[showcase[0].image])}" alt="" />` : '',
    LOGO_WIDE: brand['logo-wide.png'] ? '<img src="brand/logo-wide.png" alt="Lowkey Syndicate" />' : '<strong>Lowkey Syndicate</strong>',
    LOGO: brand['logo.png'] ? '<img class="logo" src="brand/logo.png" alt="Lowkey Syndicate" />' : '',
    NAV_LINKS: [showcase.length ? '<a href="#garage">Garage</a>' : '', '<a href="#soirees" data-live hidden>Soirées</a>', news.length ? '<a href="#actus">Actus</a>' : '<a href="#actus" data-live hidden>Actus</a>', server ? '<a href="classement.html">Classements</a>' : '', discordUrl ? `<a href="${esc(discordUrl)}">Discord</a>` : ''].join(''),
    ADMIN_LINK: server ? ' · <a href="admin.html">admin</a>' : '',
    DISCORD_BUTTON: discordUrl ? `<a class="btn" href="${esc(discordUrl)}">Rejoindre le Discord</a>` : '',
    GARAGE: showcase.length
      ? `<section id="garage"><h2>Le Garage</h2><div class="garage">${showcase.map((s) => `<div class="car"><img src="${esc(brand[s.image])}" alt="${esc(s.title)}" style="object-position:${esc(s.position || 'center')}" loading="lazy" /><div><strong>${esc(s.title)}</strong><span>${esc(s.subtitle)}</span></div></div>`).join('')}</div></section>`
      : '',
    NEWS: news.length
      ? `<section id="actus" class="news" data-news><h2>Actus</h2>${news.map((n) => `<article><time>${esc(new Date(n.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</time><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join('')}</section>`
      : '<section id="actus" class="news" data-news hidden><h2>Actus</h2></section>',
    SUPPORT: donateLinks.length || shop || discordUrl
      ? `<section><h2>Soutenir</h2><div class="support">${donateLinks.map((l) => `<a class="btn" href="${esc(l.url)}">${esc(l.label || 'Faire un don')}</a>`).join('')}${shop ? `<a class="btn" href="${esc(shop)}">Boutique</a>` : ''}${discordUrl ? `<a class="btn" href="${esc(discordUrl)}">Discord</a>` : ''}</div></section>`
      : '',
  };
  for (const page of ['index.html', 'classement.html', 'admin.html']) {
    let html = fs.readFileSync(path.join(root, 'site', page), 'utf8');
    html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
    fs.writeFileSync(path.join(out, page), html);
  }
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  console.log(`Site généré dans ${out} : version ${version || '?'}, ${Object.keys(brand).length} visuel(s), ${showcase.length} voiture(s), ${news.length} actu(s)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
