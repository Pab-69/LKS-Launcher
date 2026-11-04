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
