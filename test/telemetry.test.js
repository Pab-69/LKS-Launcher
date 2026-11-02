'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const L = require('../src/main/telemetry/layout');
const { TelemetryRecorder, timeAt } = require('../src/main/telemetry/recorder');
const { scoreDrift, courseVersion, referenceFrom, LiveClips } = require('../src/main/telemetry/drift');
const { LapStore } = require('../src/main/telemetry/store');
const { Leaderboard, packSamples, unpackSamples, downsample } = require('../src/main/telemetry/leaderboard');
const { DashServer } = require('../src/main/telemetry/dash-server');
const { Simulator } = require('../src/main/telemetry/simulator');
const { SimulatedSource } = require('../src/main/telemetry/source');
const { TelemetryManager } = require('../src/main/telemetry/index');
const { toolsStatus } = require('../src/main/telemetry/tools');
const { installIngame, ingameStatus, removeIngame } = require('../src/main/telemetry/ingame');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-tel-'));

function run(recorder, sim, frames, mutate) {
  let t = 0;
  for (let i = 0; i < frames; i++) {
    const b = sim.step(16);
    t += 16;
    const f = { physics: L.parsePhysics(b.physics), graphics: L.parseGraphics(b.graphics), static: L.parseStatic(b.static) };
    if (mutate) mutate(f, i);
    recorder.feed(f, t);
  }
}

test('shared memory layout: encode/parse roundtrip and drift angle', () => {
  const buf = L.encode(L.STATIC, L.STATIC_SIZE, { carModel: 'lks_bmw_m2', track: 'lks_touge', trackConfiguration: 'downhill', maxRpm: 8000 });
  const st = L.parseStatic(buf);
  assert.deepStrictEqual([st.carModel, st.track, st.trackConfiguration, st.maxRpm], ['lks_bmw_m2', 'lks_touge', 'downhill', 8000]);
  const v = 100 / 3.6;
  const r = (30 * Math.PI) / 180;
  const p = L.parsePhysics(L.encode(L.PHYSICS, L.PHYSICS_SIZE, { speedKmh: 100, localVelocity: [Math.sin(r) * v, 0, Math.cos(r) * v], gear: 4 }));
  assert.ok(Math.abs(L.driftAngle(p) - 30) < 0.1);
  assert.strictEqual(p.gear, 4);
  // local velocity missing -> world velocity + heading
  const p2 = { speedKmh: 100, localVelocity: [0, 0, 0], velocity: [Math.sin(0.5 + r) * v, 0, Math.cos(0.5 + r) * v], heading: 0.5 };
  assert.ok(Math.abs(L.driftAngle(p2) - 30) < 0.1);
  assert.strictEqual(L.driftAngle({ speedKmh: 2 }), 0);
});

test('recorder: complete laps only, validity, drift score, live delta', () => {
  const sim = new Simulator({ lapMs: 20000, seed: 3 });
  const r = new TelemetryRecorder({ getDriver: () => ({ name: 'Pab', steamId: '7656' }) });
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  // lap 2: wheels out for 1 s (cut) ; lap 3: through the pit lane
  run(r, sim, 5200, (f) => {
    if (f.graphics.completedLaps === 1 && f.graphics.normalizedCarPosition > 0.5 && f.graphics.normalizedCarPosition < 0.55) f.physics.numberOfTyresOut = 4;
    if (f.graphics.completedLaps === 2 && f.graphics.normalizedCarPosition > 0.9) f.graphics.isInPitLane = 1;
  });
  assert.strictEqual(laps.length, 4);
  assert.deepStrictEqual(laps.map((l) => l.valid), [true, false, false, true]);
  assert.ok(laps.every((l) => l.samples.length > 1000 && l.samples[0][0] < 0.01));
  assert.ok(laps[0].drift.score > 0 && laps[0].drift.score <= 100 && laps[0].drift.maxAngle > 40);
  assert.strictEqual(laps[0].drift.line, null, 'no course: no line score');
  assert.strictEqual(laps[0].driver.name, 'Pab');
  assert.strictEqual(laps[0].layout, 'downhill');

  // partial first lap (joined mid-lap) is ignored
  const r2 = new TelemetryRecorder();
  const got = [];
  r2.on('lap', (l) => got.push(l));
  const sim2 = new Simulator({ lapMs: 20000 });
  for (let i = 0; i < 700; i++) sim2.step(16); // start at ~55 % of the lap
  run(r2, sim2, 1300);
  assert.strictEqual(got.length, 0);

  // live delta against a reference lap
  r.setReference(laps[0]);
  run(r, sim, 300);
  assert.strictEqual(typeof r.live.delta, 'number');
  assert.ok(Math.abs(r.live.delta) < 2000);
  assert.strictEqual(r.live.gear, String(L.parsePhysics(sim.step(16).physics).gear - 1));
  assert.strictEqual(timeAt([[0, 0], [0.5, 1000], [1, 3000]], 0.75), 2000);
});

test('drift judging: angle, speed, line, clips and penalties (not the clock)', () => {
  const sim = new Simulator({ lapMs: 20000, seed: 4 });
  const r = new TelemetryRecorder({ getDriver: () => ({ name: 'Pab', steamId: '1' }) });
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  run(r, sim, 2600);
  const lap = laps[0];
  // clip where the simulated car is sideways (a = 45°) and one it never reaches
  const a = Math.PI / 4;
  const onLine = { x: Math.cos(a) * 300 + Math.cos(3 * a) * 40, z: Math.sin(a) * 180 };
  const course = { section: [0, 1], clips: [{ name: 'Mur', kind: 'outer', ...onLine, r: 3 }, { name: 'Loin', kind: 'inner', x: 9999, z: 9999, r: 3 }], ...referenceFrom(lap.samples) };
  const res = scoreDrift(lap.samples, course);
  assert.deepStrictEqual(res.clips.map((c) => c.hit), [true, false]);
  assert.ok(res.clips[0].q > 0.8);
  assert.ok(res.lineDist < 1.5, 'same line as the reference');
  assert.ok(res.angle > 0 && res.speed > 0 && res.line > 0);
  assert.ok(Math.abs(res.score - (res.angle + res.speed + res.line - res.penalty)) < 0.2);
  assert.strictEqual(res.rules, courseVersion(course));

  // 8 m off the reference line: clips missed and a worse line
  const off = lap.samples.map((s) => { const c = [...s]; c[9] += 8; return c; });
  const worse = scoreDrift(off, course);
  assert.ok(worse.line < res.line && worse.score < res.score);
  assert.ok(!worse.clips[0].hit);

  // spin and wheels off: penalties
  const bad = lap.samples.map((s, i) => { const c = [...s]; if (i === 600) c[8] = 150; if (i > 900 && i < 1000) c[11] = 4; return c; });
  const pen = scoreDrift(bad, course);
  assert.deepStrictEqual(pen.penalties.map((p) => p.kind).filter((k) => k !== 'straight').sort(), ['off', 'spin']);
  assert.ok(pen.score < res.score);

  // grip driving: no drift at all
  assert.strictEqual(scoreDrift(lap.samples.map((s) => { const c = [...s]; c[8] = 2; return c; }), course), null);

  // moving a clip changes the rules, so old scores don't mix
  assert.notStrictEqual(courseVersion({ ...course, clips: [{ ...course.clips[0], x: onLine.x + 2 }] }), res.rules);
  assert.strictEqual(courseVersion(null), '');

  // recorder uses the course and gives live clip feedback
  const r2 = new TelemetryRecorder({ getCourse: () => course });
  const got = [];
  r2.on('lap', (l) => got.push(l));
  run(r2, new Simulator({ lapMs: 20000, seed: 4 }), 2600);
  assert.strictEqual(got[0].drift.rules, res.rules);
  assert.ok(got[0].drift.clips[0].hit);
  const live = new LiveClips(course);
  live.feed(onLine.x + 1, onLine.z, 30, 80);
  assert.deepStrictEqual([live.summary().hit, live.summary().total], [1, 2]);
});

test('lap store: bests, leaderboard, export/import, pruning', () => {
  const store = new LapStore(tmp());
  const mk = (id, driver, lapMs, score, valid = true) => ({
    version: 1, id, driver: { name: driver, steamId: driver }, car: 'c', track: 't', layout: 'l', session: 'practice', lapMs, valid,
    topSpeed: 150, drift: { score, maxAngle: 40, avgAngle: 25, driftTime: 10 }, date: new Date(Date.now() - lapMs).toISOString(),
    samples: Array.from({ length: 30 }, (_, i) => [i / 29, i * 100, 100, 1, 0, 4, 5000, 0, 10, i, i]),
  });
  store.save(mk('lap-a1', 'pab', 61000, 300));
  store.save(mk('lap-a2', 'pab', 60500, 200));
  store.save(mk('lap-a3', 'pab', 59000, 900, false)); // invalid: not a time record
  store.save(mk('lap-b1', 'kaze', 60800, 500));
  assert.strictEqual(store.best({ car: 'c', track: 't', layout: 'l' }).id, 'lap-a2');
  assert.strictEqual(store.best({ car: 'c', track: 't', layout: 'l', kind: 'drift' }).id, 'lap-a3');
  assert.deepStrictEqual(store.leaderboard({ track: 't', layout: 'l' }).map((l) => l.id), ['lap-a2', 'lap-b1']);
  assert.deepStrictEqual(store.leaderboard({ track: 't', layout: 'l', kind: 'drift' }).map((l) => l.id), ['lap-a3', 'lap-b1']);

  const other = new LapStore(tmp());
  const imported = other.import(store.export('lap-b1'));
  assert.strictEqual(imported.driver.name, 'kaze');
  assert.strictEqual(other.load('lap-b1').samples.length, 30);
  assert.throws(() => other.import(Buffer.from('nope')), /pas un tour/);

  for (let i = 0; i < 60; i++) store.save(mk(`lap-x${i}`, 'pab', 62000 + i, 10));
  assert.ok(store.list({ car: 'c', track: 't', layout: 'l' }).length <= 42);
  assert.ok(store.list().some((l) => l.id === 'lap-a2'), 'best time kept');
  assert.ok(store.list().some((l) => l.id === 'lap-a3'), 'best drift kept');
});

test('shared leaderboard client (Supabase REST)', async (t) => {
  const calls = [];
  const rows = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, key: req.headers.apikey, auth: req.headers.authorization, body });
      if (req.url === '/rest/v1/rpc/submit_lap') {
        const b = JSON.parse(body);
        rows.push({ id: rows.length + 1, steam_id: b.p_steam_id, driver: b.p_driver, car: b.p_car, track: b.p_track, layout: b.p_layout, kind: b.p_kind, lap_ms: b.p_lap_ms, score: b.p_score, samples: b.p_samples, meta: b.p_meta, created_at: 'now' });
        return res.end(JSON.stringify('nouveau record'));
      }
      if (req.url.startsWith('/rest/v1/lks_laps')) return res.end(JSON.stringify(rows.map(({ samples, ...r }) => (req.url.includes('select=*') ? { ...r, samples } : r))));
      res.statusCode = 404;
      res.end('{"message":"nope"}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const board = new Leaderboard({ url: `http://127.0.0.1:${srv.address().port}`, anonKey: 'anon-key' });
  const lap = { driver: { name: 'Pab', steamId: '7656' }, car: 'c', track: 't', layout: 'l', lapMs: 60500, topSpeed: 150, session: 'practice', date: 'x', drift: { score: 420 }, samples: Array.from({ length: 3000 }, (_, i) => [i / 2999, i, 100, 1, 0, 4, 5000, 0, 10, 0, 0]) };
  await board.submit(lap, 'time');
  const sent = JSON.parse(calls[0].body);
  assert.strictEqual(calls[0].key, 'anon-key');
  assert.strictEqual(calls[0].auth, 'Bearer anon-key');
  assert.deepStrictEqual([sent.p_kind, sent.p_lap_ms, sent.p_score], ['time', 60500, null]);
  assert.strictEqual(unpackSamples(sent.p_samples).length, 1500, 'downsampled before upload');
  await board.list({ track: 't', layout: 'l', kind: 'time' });
  assert.match(calls[1].url, /track=eq\.t&layout=eq\.l&kind=eq\.time&rules=eq\.&order=lap_ms\.asc/);
  await board.list({ track: 't', layout: 'l', kind: 'drift', rules: 'abc' });
  assert.match(calls[2].url, /kind=eq\.drift&rules=eq\.abc&order=score\.desc/);
  const remote = await board.lap(1);
  assert.strictEqual(JSON.parse(calls[0].body).p_rules, '');
  assert.strictEqual(remote.driver.name, 'Pab');
  assert.strictEqual(remote.samples.length, 1500);
  assert.throws(() => new Leaderboard({ url: 'ftp://x', anonKey: 'k' }), /invalide/);
  assert.strictEqual(downsample([1, 2, 3], 10).length, 3);
  assert.strictEqual(unpackSamples(packSamples([[1, 2]]))[0][1], 2);
});

test('phone dashboard streams live data', async () => {
  const dash = new DashServer({ getLive: () => ({ status: 2, speed: 123, gear: '4' }) });
  const port = await dash.start(0, '127.0.0.1');
  const page = await new Promise((resolve) => http.get(`http://127.0.0.1:${port}/`, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b)); }));
  assert.match(page, /EventSource\('live'\)/);
  const first = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/live`, (r) => r.once('data', (c) => { resolve(String(c)); r.destroy(); }));
  });
  assert.match(first, /"speed":123/);
  dash.stop();
});

test('manager: records laps from the game, keeps PBs and sends them to the leaderboard', async () => {
  const sim = new Simulator({ lapMs: 20000, seed: 5 });
  const submitted = [];
  const m = new TelemetryManager({ dataDir: tmp(), source: new SimulatedSource(sim), getDriver: () => ({ name: 'Pab', steamId: '7656' }), getSettings: () => ({}) });
  m.board = () => ({ submit: async (lap, kind) => submitted.push([kind, lap.lapMs]) });
  const events = [];
  m.on('lap', (e) => events.push(e));
  for (let i = 0; i < 3900; i++) m.tick();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(events.length, 3);
  assert.ok(events[0].pbTime && events[0].pbDrift);
  assert.ok(submitted.length >= 2);
  assert.strictEqual(m.live().car, 'lks_bmw_m2');
  assert.ok(m.recorder.reference, 'best lap used as live reference');
});

test('manager: sends bests made before the leaderboard existed', async () => {
  const dir = tmp();
  const sim = new Simulator({ lapMs: 20000, seed: 9 });
  const m1 = new TelemetryManager({ dataDir: dir, source: new SimulatedSource(sim), getDriver: () => ({ name: 'Pab', steamId: '7656' }), getSettings: () => ({}) });
  for (let i = 0; i < 2700; i++) m1.tick(); // 2 laps, no leaderboard
  const sent = [];
  const m2 = new TelemetryManager({ dataDir: dir, source: new SimulatedSource(new Simulator({ lapMs: 20000, seed: 10 })), getDriver: () => ({ name: 'Pab', steamId: '7656' }), getSettings: () => ({}) });
  m2.board = () => ({ submit: async (lap, kind) => sent.push(kind) });
  m2.tick();
  m2.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(sent, ['time', 'drift'], 'existing bests sent once when driving the combo');
});

test('companion tools and in-game app', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF' };
  const status = toolsStatus({ env, exists: (p) => p.includes('SimHub') });
  assert.deepStrictEqual(status.map((t) => [t.id, t.installed]), [['simhub', true], ['crewchief', false]]);
  const ac = tmp();
  assert.strictEqual(ingameStatus(ac).installed, null);
  const st = installIngame(ac);
  assert.ok(st.upToDate);
  assert.ok(fs.existsSync(path.join(ac, 'apps', 'lua', 'LKS', 'LKS.lua')));
  assert.ok(fs.existsSync(path.join(ac, 'apps', 'lua', 'LKS', 'manifest.ini')));
  assert.strictEqual(removeIngame(ac).installed, null);
});
