'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const L = require('../src/main/telemetry/layout');
const { TelemetryRecorder, timeAt } = require('../src/main/telemetry/recorder');
const { scoreDrift, scoreAllModes, scoreTandem, courseVersion, referenceFrom, rulesFor, LiveClips } = require('../src/main/telemetry/drift');
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
  // clip where the simulated car is sideways (end of the oval, a = 0) and one it never reaches
  const a = 0;
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
  assert.strictEqual(courseVersion(null), courseVersion(undefined));
  assert.match(courseVersion(null, 'pro'), /-pro$/);

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

test('drift modes and custom rules per track', () => {
  const sim = new Simulator({ lapMs: 20000, seed: 4 });
  const r = new TelemetryRecorder();
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  run(r, sim, 2600);
  const base = laps[0].samples;
  assert.strictEqual(base[0].length, 13, 'signed slip recorded');
  const all = scoreAllModes(base, null);
  assert.ok(all.modes.debutant.score > all.modes.normal.score, 'beginner mode is more forgiving');
  assert.ok(all.modes.normal.score >= all.modes.pro.score);
  assert.notStrictEqual(all.modes.normal.rules, all.modes.pro.rules);

  // 2 wheels off for 0.5 s
  const off = base.map((s, i) => { const c = [...s]; if (i > 500 && i < 540) c[11] = 2; return c; });
  assert.ok(!scoreDrift(off, null, 'normal').penalties.some((p) => p.kind === 'off'), 'normal: 3 wheels needed');
  assert.strictEqual(scoreDrift(off, null, 'pro').score, 0, 'competition: 2 wheels off = 0');
  const custom = { rules: { normal: { off: { wheels: 2, action: 'zero' } } } };
  const res = scoreDrift(off, custom, 'normal');
  assert.strictEqual(res.score, 0);
  assert.match(res.zeroed, /2 roues dehors/);
  assert.notStrictEqual(courseVersion(custom, 'normal'), courseVersion(null, 'normal'), 'rules change the version');
  assert.strictEqual(rulesFor(custom, 'normal').off.wheels, 2);
  assert.strictEqual(rulesFor(custom, 'normal').spin.points, 20, 'other rules kept');

  // regrip (straightening for ~0.8 s in the middle of a corner) can be set to zero
  const mid = base.findIndex((s) => s[0] > 0.4 && s[8] > 40);
  const regrip = base.map((s, i) => { const c = [...s]; if (i >= mid && i < mid + 80) { c[8] = 2; c[12] = 2; } return c; });
  assert.ok(scoreDrift(regrip, null, 'normal').penalties.some((p) => p.kind === 'straight'));
  assert.ok(!scoreDrift(base, null, 'normal').penalties.some((p) => p.kind === 'straight'), 'long straights are not a regrip');
  const noRegrip = { rules: { normal: { straighten: { action: 'zero' } } } };
  assert.strictEqual(scoreDrift(regrip, noRegrip, 'normal').score, 0);
  const ignore = { rules: { normal: { straighten: { action: 'none' } } } };
  assert.ok(scoreDrift(regrip, ignore, 'normal').score > scoreDrift(regrip, null, 'normal').score);

  // drifting the wrong way in one corner
  const wrong = base.map((s) => [...s]);
  const conv = Math.sign(base.find((s) => s[8] > 20)[12]);
  let flipped = 0;
  for (let i = 0; i < wrong.length && flipped < 120; i++) if (wrong[i][0] > 0.45 && wrong[i][8] > 20) { wrong[i][12] = -wrong[i][12]; flipped++; }
  assert.ok(conv !== 0);
  const rev = scoreDrift(wrong, { rules: { normal: { reverse: { action: 'zero' } } } }, 'normal');
  assert.strictEqual(rev.score, 0);
  assert.match(rev.zeroed, /mauvais sens/);
});

test('tandem: chase judged on proximity, angle and line', () => {
  const sim = new Simulator({ lapMs: 20000, seed: 4 });
  const r = new TelemetryRecorder();
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  run(r, sim, 2600);
  const follower = laps[0].samples.map((s) => [...s, 0]);
  // lead 3 m ahead along the same line (sample a few rows further), same angle
  const leadAt = (k, shift = 0) => follower.map((s, i) => { const t = follower[Math.max(0, Math.min(follower.length - 1, i + k))]; return [t[9] + shift, t[10], t[8], t[2], t[12]]; });
  const close = scoreTandem(follower, leadAt(3), null, 'normal');
  const far = scoreTandem(follower, leadAt(30), null, 'normal');
  assert.ok(close.avgGap < 5 && far.avgGap > close.avgGap);
  assert.ok(close.proximity > far.proximity && close.score > far.score);
  assert.ok(close.angleMatch > 20, 'same angle as the lead');
  // contact
  const hit = follower.map((s, i) => { const c = [...s]; if (i > 300 && i < 310) c[13] = 1; return c; });
  assert.ok(scoreTandem(hit, leadAt(3), null, 'normal').penalties.some((p) => p.kind === 'contact'));
  assert.strictEqual(scoreTandem(hit, leadAt(3), null, 'pro').score, 0, 'contact = 0 in competition');
  // chaser in front of the lead
  const passed = scoreTandem(follower, leadAt(-8), null, 'normal');
  assert.ok(passed.penalties.some((p) => p.kind === 'pass'));
  assert.strictEqual(passed.score, 0);
});

test('automatic course from the track AI line', () => {
  const { courseFromAiLine, parseAiLine, encodeAiLine, autoCourse } = require('../src/main/telemetry/ailine');
  // touge: straight, hairpin (r 30, centre 100;30), straight, hairpin the other way, straight.
  // In AI files sideRight is the room on the +n side (forward turned +90° in x/z): an arc
  // turning towards +n has its inside on sideRight (the AI line hugs it: 1 m).
  const pts = [];
  let x = 0;
  let z = 0;
  let hd = 0;
  const push = (towardsN) => pts.push({ x, z, sideLeft: towardsN === undefined ? 4 : towardsN ? 7 : 1, sideRight: towardsN === undefined ? 4 : towardsN ? 1 : 7 });
  const straight = (len) => { for (let i = 0; i < len; i++) { x += Math.cos(hd); z += Math.sin(hd); push(); } };
  const arc = (r, deg, left) => { for (let i = 0; i < Math.round((r * deg * Math.PI) / 180); i++) { hd += (left ? 1 : -1) / r; x += Math.cos(hd); z += Math.sin(hd); push(left); } };
  straight(100); arc(30, 180, true); straight(120); arc(25, 150, false); straight(150);
  const buf = encodeAiLine(pts);
  const parsed = parseAiLine(buf);
  assert.strictEqual(parsed.points.length, pts.length);
  assert.strictEqual(parsed.points[50].sideLeft, 4);
  const course = courseFromAiLine(parsed.points);
  assert.deepStrictEqual(course.clips.map((c) => c.kind), ['outer', 'inner', 'outer', 'inner']);
  const inner = course.clips[1];
  const outer = course.clips[0];
  const fromCentre = (c) => Math.hypot(c.x - 100, c.z - 30);
  assert.ok(fromCentre(inner) > 29 && fromCentre(inner) < 32.5, 'inner clip by the inside edge (29 m from the centre)');
  assert.ok(fromCentre(outer) > 33, 'outer zone towards the outside edge');
  assert.ok(course.clips.every((c) => /^V\d (corde|extérieur)$/.test(c.name)));
  assert.ok(course.refLine.length > 100);
  // installed track folder
  const ac = tmp();
  fs.mkdirSync(path.join(ac, 'content', 'tracks', 'lks_touge', 'downhill', 'ai'), { recursive: true });
  fs.writeFileSync(path.join(ac, 'content', 'tracks', 'lks_touge', 'downhill', 'ai', 'fast_lane.ai'), buf);
  assert.strictEqual(autoCourse(ac, 'lks_touge', 'downhill').clips.length, 4);
  assert.strictEqual(autoCourse(ac, 'other'), null);
  assert.strictEqual(autoCourse(ac, '../x'), null);
  assert.throws(() => parseAiLine(Buffer.alloc(8)), /court/);
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
  // tandem: lead trajectory travels with the samples
  const tl = { ...lap, drift: {}, tandem: { lead: { name: 'Kaze', car: 'c2' }, leadSamples: lap.samples.map(() => [1, 2, 30, 80, -30]), modes: { pro: { score: 61.5, rules: 'abc-pro' } } } };
  await board.submit(tl, 'tandem', 'pro');
  const st = JSON.parse(calls[calls.length - 1].body);
  assert.deepStrictEqual([st.p_kind, st.p_score, st.p_rules, st.p_meta.lead.name], ['tandem', 61.5, 'abc-pro', 'Kaze']);
  assert.strictEqual(unpackSamples(st.p_samples)[0].length, 19);
  rows.splice(0, rows.length - 1); // the mock returns every row
  const remoteT = await board.lap(rows[0].id);
  assert.strictEqual(remoteT.samples[0].length, 14);
  assert.deepStrictEqual(remoteT.tandem.leadSamples[0], [1, 2, 30, 80, -30]);
  assert.strictEqual(remoteT.tandem.modes.pro.score, 61.5);
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
  m2.board = () => ({ submit: async (lap, kind, mode) => sent.push(kind === 'time' ? kind : `${kind}:${mode}`) });
  m2.tick();
  m2.tick();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(sent[0], 'time');
  assert.ok(sent.includes('drift:normal') && sent.includes('drift:debutant'), 'existing bests sent once per mode when driving the combo');
});

test('tandem runs from the in-game app are imported and judged', async () => {
  const { runToLap, collectRuns } = require('../src/main/telemetry/tandem');
  // follower 4 m behind the lead along a curve, both sideways
  const rows = [];
  for (let k = 0; k < 400; k++) {
    const a = k / 60;
    const x = Math.cos(a) * 40;
    const z = Math.sin(a) * 40;
    const la = a + 0.1;
    rows.push([k * 50, k / 400, x, z, 70, 32, 1, 0, 4, 0, Math.cos(la) * 40, Math.sin(la) * 40, 30, 72, k === 200 ? 1 : 0]);
  }
  const run = { v: 1, track: 'lks_touge', layout: 'downhill', car: 'lks_bmw_m2', driver: 'Pab', lead: { name: 'Kaze', car: 'lks_s15' }, lapMs: 20000, rows };
  const lap = runToLap(run, { name: 'Pab', steamId: '7656' });
  assert.strictEqual(lap.samples[0].length, 14);
  assert.strictEqual(lap.tandem.leadSamples.length, 400);
  assert.throws(() => runToLap({ v: 1, track: '../x', car: 'c', rows }), /invalide/);

  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(run));
  fs.writeFileSync(path.join(dir, 'b.json'), '{oops');
  assert.strictEqual(collectRuns(dir, {}).length, 1);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'files removed after import');

  const m = new TelemetryManager({ dataDir: tmp(), source: new SimulatedSource(new Simulator()), getDriver: () => ({ name: 'Pab', steamId: '7656' }), getSettings: () => ({}) });
  const sent = [];
  m.board = () => ({ submit: async (l, kind, mode) => sent.push(`${kind}:${mode}`) });
  const events = [];
  m.on('lap', (e) => events.push(e));
  await m.addTandemRun(lap);
  const t = m.store.load(lap.id).tandem;
  assert.ok(t.modes.normal.score > 0 && t.modes.normal.avgGap < 6);
  assert.ok(t.modes.normal.penalties.some((p) => p.kind === 'contact'));
  assert.strictEqual(t.modes.pro.score, 0, 'contact = 0 in competition');
  assert.ok(events[0].pbTandem.includes('normal'));
  assert.ok(sent.includes('tandem:normal') && !sent.includes('tandem:pro'));
  assert.strictEqual(m.store.leaderboard({ track: 'lks_touge', layout: 'downhill', kind: 'tandem' })[0].result.score, t.modes.normal.score);
  assert.ok(!m.store.list()[0].tandem.leadSamples, 'index keeps no samples');
});

test('battle tandem: two runs with the roles swapped', async () => {
  const { runToLap } = require('../src/main/telemetry/tandem');
  // chaser `gap` rows behind the leader on a circle, both sideways at `angle`
  const makeRun = (role, chaserName, leadName, gapRows, angle, time) => {
    const rows = [];
    for (let k = 0; k < 400; k++) {
      const a = k / 60;
      const la = (k + gapRows) / 60;
      rows.push([k * 50, k / 400, Math.cos(a) * 40, Math.sin(a) * 40, 70, angle, 1, 0, 4, 0, Math.cos(la) * 40, Math.sin(la) * 40, 35, 72, 0]);
    }
    return { v: 1, role, track: 'lks_touge', layout: 'downhill', car: 'lks_bmw_m2', driver: chaserName, lead: { name: leadName, car: 'lks_s15' }, time, lapMs: 20000, rows };
  };
  const me = { name: 'Pab', steamId: '7656' };
  const m = new TelemetryManager({ dataDir: tmp(), source: new SimulatedSource(new Simulator()), getDriver: () => me, getSettings: () => ({}) });
  const sentBattles = [];
  const sentLaps = [];
  m.board = () => ({ submit: async (l) => sentLaps.push(l.driver.name), submitBattle: async (b, mode, rules) => sentBattles.push([mode, rules || '']) });
  const battles = [];
  m.on('battle', (b) => battles.push(b));
  const t0 = Math.floor(Date.now() / 1000);
  // run 1: Kaze leads, Pab chases very close ; run 2: Pab leads, Kaze chases far behind
  assert.strictEqual(await m.addTandemRun(runToLap(makeRun('chase', 'Pab', 'Kaze', 4, 34, t0), me)), null, 'one run is not a battle');
  const battle = await m.addTandemRun(runToLap(makeRun('lead', 'Kaze', 'Pab', 30, 20, t0 + 120), me));
  assert.ok(battle && battles.length === 1);
  const res = battle.modes.normal;
  assert.deepStrictEqual(res.drivers.map((d) => d.name), ['Kaze', 'Pab']);
  const pab = res.drivers.find((d) => d.name === 'Pab');
  const kaze = res.drivers.find((d) => d.name === 'Kaze');
  assert.ok(pab.chase > kaze.chase, 'close chase beats a far one');
  assert.strictEqual(res.winner, 'Pab');
  assert.ok(!res.omt && res.diff >= 2);
  assert.strictEqual(sentBattles.length, 3, 'one per mode');
  assert.ok(sentLaps.length > 0 && sentLaps.every((n) => n === 'Pab'), 'the other driver\'s chase is not sent from this PC');
  assert.ok(m.store.list().every((l) => l.battleId === battle.id), 'runs kept with the battle');
  // a third run does not make another battle with already used runs
  assert.strictEqual(await m.addTandemRun(runToLap(makeRun('chase', 'Pab', 'Kaze', 4, 34, t0 + 200), me)), null);

  // one more time when the totals are too close
  const { judgeBattle } = require('../src/main/telemetry/drift');
  const r1 = runToLap(makeRun('chase', 'Pab', 'Kaze', 5, 30, t0), me);
  const r2 = runToLap(makeRun('lead', 'Kaze', 'Pab', 5, 30, t0 + 60), me);
  const close = judgeBattle(r1, r2, null, 'normal');
  assert.ok(close.omt && close.winner === null);
});

test('championship: rounds, bracket and standings', () => {
  const C = require('../src/main/telemetry/championship');
  assert.deepStrictEqual(C.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const now = Date.parse('2026-06-15T12:00:00Z');
  const done = { id: 'r1', name: 'Haruna', track: 't', layout: '', kind: 'drift', mode: 'normal', start: '2026-06-01T00:00:00Z', end: '2026-06-07T00:00:00Z' };
  const solo = C.roundResults(done, { entries: [{ name: 'Kaze', score: 70 }, { name: 'Pab', score: 82 }, { name: 'Riku', score: 60 }], now });
  assert.strictEqual(solo.status, 'done');
  assert.deepStrictEqual(solo.results.map((r) => [r.name, r.points]), [['Pab', 25], ['Kaze', 18], ['Riku', 15]]);

  const battleRound = { id: 'r2', name: 'Battle Ebisu', track: 'e', layout: '', kind: 'battle', mode: 'pro', bracket: 4, start: '2026-06-10T00:00:00Z', end: '2026-06-20T00:00:00Z' };
  const quali = [{ name: 'Pab', score: 80 }, { name: 'Kaze', score: 78 }, { name: 'Riku', score: 70 }, { name: 'Mako', score: 65 }, { name: 'Shin', score: 50 }];
  const b = (w, l, date, omt = false) => ({ drivers: [{ name: w }, { name: l }], winner: omt ? null : w, omt, date });
  // semis: 1 Pab vs 4 Mako, 2 Kaze vs 3 Riku
  let live = C.roundResults(battleRound, { entries: quali, battles: [b('Pab', 'Mako', '2026-06-11'), b('Kaze', 'Riku', '2026-06-11', true)], now });
  assert.strictEqual(live.status, 'live');
  assert.deepStrictEqual(live.draw.rounds[0].map((x) => [x.a, x.b, x.winner, x.omt]), [['Pab', 'Mako', 'Pab', false], ['Kaze', 'Riku', null, true]]);
  assert.deepStrictEqual(live.results, [], 'no final placing yet');
  live = C.roundResults(battleRound, { entries: quali, battles: [b('Pab', 'Mako', '2026-06-11'), b('Kaze', 'Riku', '2026-06-11', true), b('Riku', 'Kaze', '2026-06-12'), b('Riku', 'Pab', '2026-06-13')], now });
  assert.deepStrictEqual(live.results.map((r) => [r.position, r.name]), [[1, 'Riku'], [2, 'Pab'], [3, 'Kaze'], [4, 'Mako']]);
  assert.ok(!live.results.some((r) => r.name === 'Shin'), 'only the top 4 enter the bracket');

  const table = C.standings({}, [solo, live]);
  assert.deepStrictEqual(table.map((r) => [r.name, r.points]), [['Pab', 43], ['Riku', 40], ['Kaze', 33], ['Mako', 12]]);
  assert.strictEqual(table[1].wins, 1);

  assert.strictEqual(C.openRounds([{ rounds: [done, battleRound] }], { track: 'e', layout: '' }, now).length, 1);
  const clean = C.cleanChampionships([{ name: 'Saison 1', rounds: [{ name: 'x', track: '../t', kind: 'nope', mode: 'pro', start: '2026-01-01', end: '2026-01-02', bracket: 5 }] }]);
  assert.deepStrictEqual([clean[0].rounds[0].track, clean[0].rounds[0].kind, clean[0].rounds[0].bracket, clean[0].points[0]], ['..t', 'drift', 8, 25]);
});

test('championship round: results sent with the round rules', async () => {
  const sim = new Simulator({ lapMs: 20000, seed: 4 });
  const start = new Date(Date.now() - 3600e3).toISOString();
  const end = new Date(Date.now() + 3600e3).toISOString();
  const m = new TelemetryManager({ dataDir: tmp(), source: new SimulatedSource(sim), getDriver: () => ({ name: 'Pab', steamId: '7656' }), getSettings: () => ({}), getRounds: () => [{ id: 'abc123', kind: 'drift', mode: 'pro', start, end }] });
  const sent = [];
  m.board = () => ({ submit: async (lap, kind, mode, rules) => sent.push([kind, mode, rules || '']) });
  for (let i = 0; i < 1400; i++) m.tick();
  await new Promise((r) => setImmediate(r));
  const round = sent.filter((x) => x[2].endsWith('@abc123'));
  assert.ok(round.length === 1 && round[0][0] === 'drift' && round[0][1] === 'pro');
});

test('ghost: recorded lap attached, shared and written for the in-game app', async () => {
  const G = require('../src/main/telemetry/ghosts');
  const { packSamples, unpackLap } = require('../src/main/telemetry/leaderboard');
  const sim = new Simulator({ lapMs: 20000, seed: 4 });
  const m = new TelemetryManager({ dataDir: tmp(), source: new SimulatedSource(sim), getDriver: () => ({ name: 'Pab', steamId: '7656' }), getSettings: () => ({}) });
  const laps = [];
  m.on('lap', (e) => laps.push(e.lap));
  for (let i = 0; i < 1400; i++) m.tick();
  const lap = m.store.list()[0];
  const rows = Array.from({ length: 400 }, (_, i) => [i * 50, i, 5, 0, 1, 0, 0, 0, 1, 0, 80]);
  const dir = tmp();
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  write('a.json', { v: 1, track: lap.track, layout: lap.layout, car: lap.car, driver: 'Pab', time: Math.floor(Date.parse(lap.date) / 1000), lapMs: lap.lapMs, rows });
  write('b.json', { v: 1, track: lap.track, layout: lap.layout, car: lap.car, driver: 'Pab', time: Math.floor(Date.now() / 1000), lapMs: 99999, rows }); // its lap is not saved yet
  write('c.json', { v: 1, track: lap.track, rows: [[1]] });
  m.synced.add(`${lap.car}|${lap.track}|${lap.layout}`);
  assert.strictEqual(m.attachGhosts(dir), 1);
  assert.deepStrictEqual(fs.readdirSync(dir), ['b.json'], 'unmatched recent ghost kept for later, bad file removed');
  assert.ok(!m.synced.has(`${lap.car}|${lap.track}|${lap.layout}`), 'bests resent with the ghost');
  assert.strictEqual(m.store.list()[0].ghost, true, 'index only flags it');
  const full = m.store.load(lap.id);
  assert.strictEqual(full.ghost.rows.length, 400);
  assert.strictEqual(m.attachGhosts(dir, Date.now() + 120000), 0);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'old unmatched ghost dropped');

  // shared with the lap
  const packed = unpackLap(packSamples(full.samples, full.ghost.rows));
  assert.strictEqual(packed.ghost.length, 400);
  assert.ok(packed.samples.length > 100);
  assert.strictEqual(unpackLap(packSamples(full.samples)).ghost, null, 'older format still read');

  // file for the app
  const app = tmp();
  assert.strictEqual(G.currentGhost(app), null);
  const info = G.writeGhost(app, full);
  assert.deepStrictEqual([info.driver, info.track], ['Pab', full.track]);
  const written = JSON.parse(fs.readFileSync(path.join(app, 'ghost.json'), 'utf8'));
  assert.strictEqual(written.rows.length, 400);
  assert.strictEqual(G.currentGhost(app).driver, 'Pab');
  G.clearGhost(app);
  assert.strictEqual(G.currentGhost(app), null);
  assert.throws(() => G.writeGhost(app, { ...full, ghost: undefined }), /fantôme/);
  assert.strictEqual(G.cleanRows(Array.from({ length: 9000 }, (_, i) => [i, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0])).length, 6000);
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
  assert.ok(fs.existsSync(path.join(ac, 'apps', 'lua', 'LKS', 'ghosts')));
  assert.strictEqual(removeIngame(ac).installed, null);
});

test('shared memory: copied into our own buffer, never viewed (Electron kills the process)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'telemetry', 'source.js'), 'utf8');
  assert.ok(!/\.view\(/.test(src), 'no koffi.view: Electron forbids external buffers and aborts');
  const { SharedMemorySource } = require('../src/main/telemetry/source');
  const s = new SharedMemorySource();
  const game = Buffer.from('ACPMF'.padEnd(32, '-'));
  s.api = { copy: (dst, ptr, len) => ptr.copy(dst, 0, 0, len) }; // stands in for RtlMoveMemory
  const out = s.copy({ ptr: game, size: 16 });
  assert.strictEqual(out.length, 16);
  assert.strictEqual(out.toString(), 'ACPMF-----------');
  game[0] = 0x5a;
  assert.strictEqual(out[0], 0x41, 'a copy, not a view');
});
