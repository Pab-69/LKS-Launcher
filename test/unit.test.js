'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ini = require('../src/main/ini');
const { buildSoloRaceIni, buildOnlineRaceIni, buildAssistsIni, sunAngle, summarizeResults } = require('../src/main/launch');
const { resolveTrack } = require('../src/main/servers');
const { parseVdf } = require('../src/main/paths');
const { hashFolder } = require('../src/main/hash');
const { zipFolder, extractZip, safeJoin } = require('../src/main/zip');
const { scanCars, scanTracks, scanWeathers, resolveContentFile } = require('../src/main/acContent');
const { makeFakeAc } = require('./helpers/fakeAc');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-test-'));

test('sun angle matches AC convention', () => {
  assert.strictEqual(sunAngle(13), 0);
  assert.strictEqual(sunAngle(8), -80);
  assert.strictEqual(sunAngle(18), 80);
  assert.strictEqual(sunAngle(14.5), 24);
});

test('solo race.ini: race with AI', () => {
  const text = buildSoloRaceIni({ mode: 'race', car: 'lks_e36', skin: '00_black', track: 'lks_touge', layout: 'gp', laps: 8, aiCount: 5, aiLevel: 95, aiSkins: ['a', 'b'], driverName: 'Pab', nationality: 'FRA', startPosition: 'last', timeOfDay: 16, weather: '3_clear', maxCars: 12 });
  const r = ini.parse(text);
  assert.strictEqual(r.RACE.TRACK, 'lks_touge');
  assert.strictEqual(r.RACE.CONFIG_TRACK, 'gp');
  assert.strictEqual(r.RACE.MODEL, 'lks_e36');
  assert.strictEqual(r.RACE.CARS, '6');
  assert.strictEqual(r.RACE.RACE_LAPS, '8');
  assert.strictEqual(r.SESSION_0.TYPE, '3');
  assert.strictEqual(r.SESSION_0.LAPS, '8');
  assert.strictEqual(r.SESSION_0.STARTING_POSITION, '6');
  assert.strictEqual(r.CAR_0.MODEL, '-');
  assert.strictEqual(r.CAR_0.DRIVER_NAME, 'Pab');
  assert.strictEqual(r.CAR_5.MODEL, 'lks_e36');
  assert.strictEqual(r.CAR_5.AI_LEVEL, '95');
  assert.ok(!r.CAR_6);
  assert.strictEqual(r.LIGHTING.SUN_ANGLE, '48');
  assert.strictEqual(r.REMOTE.ACTIVE, '0');
});

test('solo race.ini: AI count limited by pit boxes, hotlap has no AI', () => {
  const r = ini.parse(buildSoloRaceIni({ mode: 'practice', car: 'c', track: 't', aiCount: 50, maxCars: 10 }));
  assert.strictEqual(r.RACE.CARS, '10');
  assert.strictEqual(r.SESSION_0.TYPE, '1');
  assert.strictEqual(r.SESSION_0.SPAWN_SET, 'PIT');
  const hot = ini.parse(buildSoloRaceIni({ mode: 'hotlap', car: 'c', track: 't', aiCount: 5 }));
  assert.strictEqual(hot.RACE.CARS, '1');
  assert.strictEqual(hot.SESSION_0.TYPE, '4');
  assert.strictEqual(hot.SESSION_0.SPAWN_SET, 'HOTLAP_START');
});

test('online race.ini', () => {
  const r = ini.parse(buildOnlineRaceIni({ ip: '1.2.3.4', tcpPort: 9600, httpPort: 8081, car: 'lks_e36', skin: '01_white', track: 'lks_touge', layout: 'gp', driverName: 'Pab', steamId: '7656', password: 'pw' }));
  assert.strictEqual(r.REMOTE.ACTIVE, '1');
  assert.strictEqual(r.REMOTE.SERVER_IP, '1.2.3.4');
  assert.strictEqual(r.REMOTE.SERVER_PORT, '9600');
  assert.strictEqual(r.REMOTE.REQUESTED_CAR, 'lks_e36');
  assert.strictEqual(r.REMOTE.GUID, '7656');
  assert.strictEqual(r.REMOTE.PASSWORD, 'pw');
  assert.strictEqual(r.CAR_0.SKIN, '01_white');
  assert.strictEqual(r.RACE.MODEL, 'lks_e36');
});

test('assists.ini', () => {
  const r = ini.parse(buildAssistsIni({ abs: 2, tractionControl: 0, autoClutch: true, damage: 50, fuelRate: 1, tyreWear: 0 }));
  assert.strictEqual(r.ASSISTS.ABS, '2');
  assert.strictEqual(r.ASSISTS.TRACTION_CONTROL, '0');
  assert.strictEqual(r.ASSISTS.AUTO_CLUTCH, '1');
  assert.strictEqual(r.ASSISTS.DAMAGE, '50');
  assert.strictEqual(r.ASSISTS.TYRE_WEAR, '0');
});

test('resolveTrack handles layouts and csp prefixes', () => {
  const installed = [
    { id: 'lks-touge', layouts: [{ id: 'uphill' }, { id: 'downhill' }] },
    { id: 'ks_nurburgring', layouts: [{ id: 'layout_gp_a' }] },
  ];
  assert.deepStrictEqual(resolveTrack('lks-touge-downhill', installed), { track: 'lks-touge', layout: 'downhill' });
  assert.deepStrictEqual(resolveTrack('csp/2144/../ks_nurburgring-layout_gp_a', installed), { track: 'ks_nurburgring', layout: 'layout_gp_a' });
  assert.strictEqual(resolveTrack('ks_nurburgring', installed).track, 'ks_nurburgring');
});

test('vdf parser', () => {
  const v = parseVdf('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}');
  assert.strictEqual(v.libraryfolders['0'].path, 'D:\\SteamLibrary');
});

test('results summary', () => {
  const s = summarizeResults({ players: [{ name: 'Pab' }, { name: 'IA 1' }], sessions: [{ name: 'Course', type: 3, lapsCount: 2, laps: [{ car: 0, time: 90000 }, { car: 0, time: 88500 }, { car: 1, time: 87000 }], bestLaps: [{ car: 1, time: 87000 }], raceResult: [1, 0] }] });
  assert.strictEqual(s[0].bestLapPlayer, 88500);
  assert.deepStrictEqual(s[0].raceResult, ['IA 1', 'Pab']);
});

test('content scan reads loose ui json, skins, layouts, weather', () => {
  const root = makeFakeAc(tmp(), { cars: { lks_e36: { name: 'BMW E36 LKS', brand: 'BMW' } }, tracks: { lks_touge: { name: 'Touge' } } });
  const cars = scanCars(root);
  assert.strictEqual(cars[0].name, 'BMW E36 LKS');
  assert.strictEqual(cars[0].brand, 'BMW');
  assert.strictEqual(cars[0].skins.length, 2);
  assert.strictEqual(cars[0].skins[0].name, '00_BLACK');
  const tracks = scanTracks(root);
  assert.strictEqual(tracks[0].layouts.length, 2);
  assert.strictEqual(tracks[0].layouts[0].pitboxes, 12);
  assert.strictEqual(tracks[0].name, 'Touge');
  assert.strictEqual(scanWeathers(root).length, 2);
  assert.ok(resolveContentFile(root, 'car/lks_e36/skins/00_black/preview.jpg'));
  assert.strictEqual(resolveContentFile(root, 'car/../../etc/passwd'), null);
  assert.strictEqual(resolveContentFile(root, 'secret/x'), null);
});

test('folder hash is deterministic and zip roundtrip preserves it', async () => {
  const root = makeFakeAc(tmp(), { cars: { c1: {} } });
  const dir = path.join(root, 'content', 'cars', 'c1');
  const h1 = await hashFolder(dir);
  const zip = path.join(tmp(), 'c1.zip');
  await zipFolder(dir, zip);
  const out = path.join(tmp(), 'extracted');
  await extractZip(zip, out);
  const h2 = await hashFolder(out);
  assert.strictEqual(h1.hash, h2.hash);
  fs.appendFileSync(path.join(out, 'data.acd'), 'x');
  assert.notStrictEqual((await hashFolder(out)).hash, h1.hash);
});

test('zip slip is refused', () => {
  assert.throws(() => safeJoin('/tmp/a', '../evil'));
  assert.throws(() => safeJoin('/tmp/a', '/etc/passwd'));
  assert.throws(() => safeJoin('/tmp/a', 'C:/Windows/x'));
  assert.ok(safeJoin('/tmp/a', 'ok/file.txt').endsWith(path.join('a', 'ok', 'file.txt')));
});
