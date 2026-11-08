'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, checkPassword, cleanEvent, publicView } = require('../server/admin/server');
const champ = require('../src/main/telemetry/championship');
const rounds = require('../src/main/telemetry/rounds');

const manifest = {
  cars: [{ id: 'lks_bmw_m2', name: 'BMW M2' }],
  tracks: [{ id: 'cfd_calmont_2023', name: 'Calmont', layouts: [{ id: 'Calmont', name: 'Calmont' }] }],
  servers: [{ name: 'LKS 1', ip: '1.2.3.4', httpPort: 8081 }],
  discord: { webhook: 'https://discord.com/api/webhooks/123456/secret-token-of-the-webhook', inviteUrl: 'https://discord.gg/x' },
  leaderboard: { url: 'https://lks.example', anonKey: 'k' },
  events: [{ id: 'old', title: 'Vieille', date: '2020-01-01T20:00:00Z' }],
};

test('site admin: passwords kept as scrypt fingerprints only', () => {
  const h = hashPassword('motdepasse-1');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!h.includes('motdepasse'));
  assert.ok(checkPassword(h, 'motdepasse-1'));
  assert.ok(!checkPassword(h, 'motdepasse-2'));
});

test('site admin: events checked against the group content, public data without secrets', () => {
  const ev = cleanEvent('e1', { title: ' Soirée ', date: '2026-12-01T20:00:00Z', track: 'cfd_calmont_2023', layout: 'Calmont', cars: ['lks_bmw_m2', 'x'], server: '1.2.3.4:8081', battle: { size: 8, mode: 'pro' } }, manifest);
  assert.deepStrictEqual([ev.title, ev.cars, ev.server, ev.battle], ['Soirée', ['lks_bmw_m2'], '1.2.3.4:8081', { size: 8, mode: 'pro' }]);
  assert.throws(() => cleanEvent('e2', { title: 'X', date: 'nope' }, manifest), /Date/);
  assert.throws(() => cleanEvent('e2', { title: 'X', date: '2026-12-01T20:00:00Z', track: 'autre' }, manifest), /Circuit inconnu/);
  assert.strictEqual(cleanEvent('e3', { title: 'X', date: '2026-12-01T20:00:00Z', battle: { size: 8 } }, manifest).battle, null, 'no battle without a track');
  const pub = publicView(manifest);
  assert.ok(!JSON.stringify(pub).includes('secret-token'), 'Discord webhook stays on the server');
  assert.strictEqual(pub.events.length, 0, 'old events left out');
  assert.deepStrictEqual(pub.servers, [{ name: 'LKS 1', value: '1.2.3.4:8081' }]);
});

test('soirées with a battle: same « Soirées LKS » rounds for the launcher and the site', () => {
  const events = [{ id: 'emw1zwidw', title: 'Soirée', date: new Date(Date.now() + 86400000).toISOString(), track: 'cfd_calmont_2023', layout: 'Calmont', battle: { size: 8, mode: 'normal' } }];
  const champs = champ.syncSoirees([], events);
  assert.strictEqual(champs[0].id, 'soiree');
  assert.deepStrictEqual(champs[0].rounds.map((r) => [r.id, r.kind, r.bracket]), [['1zwidw', 'battle', 8]]);
  assert.strictEqual(champ.syncSoirees(champs, [])[0].rounds.length, 0, 'future round removed with its event');
  assert.strictEqual(champ.syncSoirees([], []), null);
});

test('rounds from the server rows: latest course version, best line per driver', () => {
  const round = { id: 'r1', name: 'M1', track: 't', layout: '', kind: 'drift', mode: 'normal', start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' };
  const rows = [
    { driver: 'Pab', score: 80, rules: 'v2-normal@r1', created_at: '2026-01-01T12:00:00Z' },
    { driver: 'pab', score: 70, rules: 'v2-normal@r1', created_at: '2026-01-01T11:00:00Z' },
    { driver: 'Kaze', score: 90, rules: 'v1-normal@r1', created_at: '2026-01-01T01:00:00Z' },
    { driver: 'Kaze', score: 75, rules: 'v2-normal@r1', created_at: '2026-01-01T10:00:00Z' },
  ];
  const r = rounds.roundFromRows(round, { entryRows: rows, points: [10, 5] });
  assert.deepStrictEqual(r.results.map((x) => [x.name, x.score, x.points]), [['Pab', 80, 10], ['Kaze', 75, 5]]);
});

test('championships from the site: season kept, rounds checked with clear messages, « Soirées LKS » rounds untouched', () => {
  const { cleanChampionship } = require('../server/admin/server');
  const r = (o) => ({ name: 'M', track: 'cfd_calmont_2023', layout: 'Calmont', kind: 'drift', mode: 'normal', start: '2026-12-01T20:00:00Z', end: '2026-12-08T20:00:00Z', ...o });
  const c = cleanChampionship('abc123', { name: 'Coupe', season: ' Saison  2026 ', points: '25, 18, 15', rounds: [r({ id: 'r1' }), r({ id: 'r1', kind: 'battle', bracket: 16 }), r({ id: '', mode: 'pro' })] }, manifest, null);
  assert.strictEqual(c.season, 'Saison 2026');
  assert.deepStrictEqual(c.points, [25, 18, 15]);
  assert.strictEqual(new Set(c.rounds.map((x) => x.id)).size, 3, 'round ids unique (results are kept by round id)');
  assert.strictEqual(c.rounds[1].bracket, 16);
  assert.throws(() => cleanChampionship('abc123', { name: 'C', points: [1], rounds: [r({ track: 'autre' })] }, manifest), /Manche 1 : choisis un circuit/);
  assert.throws(() => cleanChampionship('abc123', { name: 'C', points: [1], rounds: [r({ end: '2026-11-01T00:00:00Z' })] }, manifest), /Manche 1 : la fin/);
  assert.throws(() => cleanChampionship('abc123', { name: 'C', points: [] }, manifest), /points/);
  const soiree = { id: 'soiree', name: 'Soirées LKS', points: [10], rounds: [{ id: 'x1', name: 'S', track: 'cfd_calmont_2023', layout: '', kind: 'battle', mode: 'normal', start: '2026-12-01T20:00:00Z', end: '2026-12-01T22:00:00Z', bracket: 8 }] };
  const s = cleanChampionship('soiree', { name: 'Soirées', season: 'Saison 2026', points: [12], rounds: [] }, manifest, soiree);
  assert.deepStrictEqual([s.name, s.season, s.points, s.rounds.map((x) => x.id)], ['Soirées', 'Saison 2026', [12], ['x1']]);
  assert.strictEqual(champ.cleanChampionships([{ id: 'a', name: 'A', season: 'S1', rounds: [] }])[0].season, 'S1', 'the launcher keeps the season too');
});

test('live manifest: cars, tracks, branding and setups stay on GitHub, everything else is the group data', () => {
  const { splitManifest, mergeManifest, PATCH_KEYS, OWNED } = require('../server/admin/server');
  const m = { schema: 1, name: 'LKS', cars: [{ id: 'a' }], tracks: [{ id: 't' }], branding: { version: 'v' }, setups: [], news: [{ title: 'x' }], events: [], leaderboard: { url: 'u' } };
  const { meta, owned } = splitManifest(m);
  assert.deepStrictEqual(Object.keys(owned).sort(), ['branding', 'cars', 'setups', 'tracks']);
  assert.deepStrictEqual(Object.keys(meta).sort(), ['events', 'leaderboard', 'name', 'news', 'schema']);
  assert.deepStrictEqual(mergeManifest(meta, owned), m);
  for (const k of PATCH_KEYS) assert.ok(!OWNED.has(k), `${k} cannot be both published from the launcher and written to the database`);
});

test('live manifest: the keys the launcher may write to the server are exactly the ones it writes to GitHub', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/publisher.js'), 'utf8');
  const keys = JSON.parse(src.match(/const META_KEYS = (\[.*?\]);/)[1].replace(/'/g, '"'));
  const { PATCH_KEYS } = require('../server/admin/server');
  assert.deepStrictEqual([...PATCH_KEYS].sort(), [...keys].sort());
});
