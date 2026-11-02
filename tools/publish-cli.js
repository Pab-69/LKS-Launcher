#!/usr/bin/env node
'use strict';

/**
 * Publish cars/tracks from the command line (same logic as the "Publication" tab).
 *
 *   GITHUB_TOKEN=github_pat_xxx node tools/publish-cli.js \
 *     --ac "C:\Program Files (x86)\Steam\steamapps\common\assettocorsa" \
 *     --repo Pab-69/LKS-Launcher car:lks_bmw_e36 track:lks_touge
 *
 * Options: --tag content  --force  --notes "texte"  --remove (retire au lieu de publier)
 */

const { GitHub } = require('../src/main/github');
const { Publisher } = require('../src/main/publisher');
const appConfig = require('../lks.config.json');

function parseArgs(argv) {
  const out = { items: [], tag: appConfig.contentTag || 'content', repo: appConfig.contentRepo, force: false, remove: false, notes: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ac') out.ac = argv[++i];
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--tag') out.tag = argv[++i];
    else if (a === '--notes') out.notes = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--remove') out.remove = true;
    else if (/^(car|track):/.test(a)) {
      const [kind, ...id] = a.split(':');
      out.items.push({ kind, id: id.join(':') });
    } else throw new Error(`Argument inconnu : ${a}`);
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.items.length) throw new Error('Rien à publier. Exemple : car:lks_bmw_e36 track:lks_touge');
  if (!args.remove && !args.ac) throw new Error("--ac <dossier assettocorsa> est requis");
  const gh = new GitHub({ token: process.env.GITHUB_TOKEN, repo: args.repo });
  let last = '';
  const pub = new Publisher({
    gh,
    tag: args.tag,
    log: (line) => console.log(line),
    progress: (p) => {
      const pct = p.total ? Math.floor((p.done / p.total) * 100) : 0;
      const line = `  ${p.step} ${pct}%`;
      if (line !== last) process.stdout.write(`${line}\r`);
      last = line;
    },
  });
  await pub.open();
  if (args.remove) await pub.removeItems(args.items);
  else await pub.publishItems(args.ac, args.items, { force: args.force, notes: args.notes });
  console.log(`\nManifeste : ${pub.manifestUrl()}`);
})().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
