'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/main/telemetry/layout');
const { TelemetryRecorder } = require('../src/main/telemetry/recorder');
const { LineTracker, crosses, crossesForward, hasGates } = require('../src/main/telemetry/geo');
const { bundledCourse, bundledCourses } = require('../src/main/telemetry/courses');
const { writeCourses } = require('../src/main/telemetry/ingame');
const { isPair, BattleStore } = require('../src/main/telemetry/battles');
const { runToLap } = require('../src/main/telemetry/tandem');
const { writeLibrary, readGhostFiles } = require('../src/main/telemetry/ghosts');
const { scoreDrift } = require('../src/main/telemetry/drift');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-runs-'));

test('course line: progress, distance and gates', () => {
  const t = new LineTracker([[0, 0], [100, 0], [100, 100]]);
  const a = t.locate(50, 3);
  assert.ok(Math.abs(a.d - 0.25) < 1e-6 && Math.abs(a.dist - 3) < 1e-6);
  assert.ok(Math.abs(t.locate(103, 50).d - 0.75) < 1e-6);
  assert.deepStrictEqual(t.direction(0.9).map((v) => Math.round(v)), [0, 1]);
  const gate = [[10, -5], [10, 5]];
  assert.ok(crosses(gate, 9, 0, 11, 0));
  assert.ok(crosses(gate, 9, 6, 11, 6), 'gate is a bit wider than its posts');
  assert.ok(!crosses(gate, 9, 9, 11, 9));
  assert.ok(crossesForward(gate, t, 0.05, 9, 0, 11, 0));
  assert.ok(!crossesForward(gate, t, 0.05, 11, 0, 9, 0), 'backwards does not count');
  assert.ok(hasGates({ start: gate, finish: gate, refLine: [[0, 0], [1, 1]] }));
  assert.ok(!hasGates({ clips: [] }));
});

test('official courses: every track of the group with gates, line and clips on the road', () => {
  const all = bundledCourses();
  for (const key of ['cfd_calmont_2023|Calmont', 'vdc_bikernieki_2022|drift_vdc', 'kart_volan_championship|', 'poland_pge_narodowy_v3|', 'englishtown_gambler_esda|']) {
    const c = all[key];
    assert.ok(c, key);
    assert.ok(hasGates(c));
    assert.strictEqual(c.progress, 'line');
    assert.ok(c.clips.length >= 5 && c.clips.every((k) => ['inner', 'outer'].includes(k.kind) && k.r > 0 && Number.isFinite(k.y)));
    const t = new LineTracker(c.refLine);
    // every clip is close to the line (on the road), in course order
    let last = -1;
    for (const k of c.clips) {
      t.hint = -1;
      const w = t.locate(k.x, k.z);
      assert.ok(w.dist < 9, `${key} ${k.name} ${w.dist}`);
      assert.ok(w.d >= last - 0.02, `${key} clips in order`);
      last = w.d;
    }
    // start gate across the beginning of the line, finish across its end
    const s = t.locate((c.start[0][0] + c.start[1][0]) / 2, (c.start[0][1] + c.start[1][1]) / 2);
    const f = t.locate((c.finish[0][0] + c.finish[1][0]) / 2, (c.finish[0][1] + c.finish[1][1]) / 2);
    assert.ok(s.d < 0.02 && s.dist < 6, `${key} start ${JSON.stringify(s)}`);
    assert.ok(f.d > 0.97 && f.dist < 6, `${key} finish ${JSON.stringify(f)}`);
  }
  assert.strictEqual(bundledCourse('cfd_calmont_2023', 'Calmont').official, 'Calmont');
  assert.ok(bundledCourse('cfd_calmont_2023', ''), 'only layout of the track');
  assert.strictEqual(bundledCourse('nope', ''), null);
});

// frames along the Calmont line: stopped before the start, run, then past the finish
function calmontFrames(course, { slip = 30, kmh = 60, teleportAt = null, pitsAt = null, track = 'cfd_calmont_2023', layout = 'Calmont', side = 0 } = {}) {
  const line = course.refLine;
  const pts = [];
  const [a, b] = line;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const f = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  for (let k = 30; k > 0; k--) pts.push([a[0] - f[0] * k, a[1] - f[1] * k]);
  for (let i = 0; i < line.length - 1; i++) {
    const [p, q] = [line[i], line[i + 1]];
    const n = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 1));
    for (let k = 0; k < n; k++) pts.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  const [y, z] = [line[line.length - 2], line[line.length - 1]];
  const lz = Math.hypot(z[0] - y[0], z[1] - y[1]);
  for (let k = 0; k < 20; k++) pts.push([z[0] + ((z[0] - y[0]) / lz) * k, z[1] + ((z[1] - y[1]) / lz) * k]);
  const v = kmh / 3.6;
  const r = (slip * Math.PI) / 180;
  return pts.map(([x, zz], i) => {
    // side: metres to the right of the line (the road is wider than the gates)
    const [nx, nz] = pts[Math.min(i + 1, pts.length - 1)];
    const [ox, oz] = pts[Math.max(i - 1, 0)];
    const dl = Math.hypot(nx - ox, nz - oz) || 1;
    let px = x + ((nz - oz) / dl) * side;
    let pz = zz - ((nx - ox) / dl) * side;
    if (teleportAt !== null && i >= teleportAt) {
      px = 149;
      pz = 285;
    }
    const physics = L.parsePhysics(L.encode(L.PHYSICS, L.PHYSICS_SIZE, { speedKmh: kmh, gear: 3, localVelocity: [Math.sin(r) * v, 0, Math.cos(r) * v] }));
    const graphics = L.parseGraphics(L.encode(L.GRAPHICS, L.GRAPHICS_SIZE, { status: 2, completedLaps: 0, iCurrentTime: 0, normalizedCarPosition: 0, carCoordinates: [px, 0, pz], isInPit: pitsAt !== null && i >= pitsAt ? 1 : 0 }));
    const st = L.parseStatic(L.encode(L.STATIC, L.STATIC_SIZE, { carModel: 'lks_bmw_m2', track, trackConfiguration: layout }));
    return { physics, graphics, static: st };
  });
}

test('runs between gates: Calmont run recorded and judged on the official clips', () => {
  const course = bundledCourse('cfd_calmont_2023', 'Calmont');
  const r = new TelemetryRecorder({ getDriver: () => ({ name: 'Pab', steamId: '1' }), getCourse: () => course });
  const laps = [];
  const resets = [];
  r.on('lap', (l) => laps.push(l));
  r.on('reset', (x) => resets.push(x));
  let t = 0;
  const frames = calmontFrames(course);
  frames.forEach((f, i) => {
    r.feed(f, (t += 60));
    if (i === 10) assert.strictEqual(r.live.run.active, false, 'not started before the gate');
    if (i === 100) assert.ok(r.live.run.active && r.live.lapMs > 0);
  });
  assert.strictEqual(laps.length, 1);
  const run = laps[0];
  assert.strictEqual(run.session, 'run');
  assert.ok(run.samples[0][0] < 0.02 && run.samples[run.samples.length - 1][0] > 0.98);
  assert.ok(run.lapMs > 10000 && run.lapMs < 40000, String(run.lapMs));
  const res = scoreDrift(run.samples, course);
  assert.strictEqual(res.clips.filter((c) => c.hit).length, course.clips.length, 'driving the line goes through every painted clip');
  assert.ok(res.line > 0);
  assert.strictEqual(resets.length, 0);
  assert.strictEqual(r.live.run.active, false);
  assert.ok(r.live.lastMs === run.lapMs);
});

test('Calmont: a run passing the start beside the painted gate still counts (road wider than the gate)', () => {
  const course = bundledCourse('cfd_calmont_2023', 'Calmont');
  for (const side of [7, -7]) {
    const r = new TelemetryRecorder({ getCourse: () => course });
    const laps = [];
    r.on('lap', (l) => laps.push(l));
    let t = 0;
    calmontFrames(course, { side }).forEach((f) => r.feed(f, (t += 60)));
    assert.strictEqual(laps.length, 1, `${side} m beside the line`);
    assert.strictEqual(r.diag.runs, 1);
  }
});

test('online the game gives the layout in lower case (« calmont »): same course, laps filed under « Calmont »', () => {
  assert.strictEqual(bundledCourse('cfd_calmont_2023', 'calmont'), bundledCourse('cfd_calmont_2023', 'Calmont'));
  const course = bundledCourse('cfd_calmont_2023', 'Calmont');
  const canonical = (c) => (c.layout === 'calmont' ? { ...c, layout: 'Calmont' } : c);
  const r = new TelemetryRecorder({ getCourse: (c) => bundledCourse(c.track, c.layout), canonical });
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  let t = 0;
  calmontFrames(course, { layout: 'calmont' }).forEach((f) => r.feed(f, (t += 60)));
  assert.strictEqual(laps.length, 1);
  assert.strictEqual(laps[0].layout, 'Calmont');
  assert.strictEqual(r.live.layout, 'Calmont');
});

test('runs on the new tracks: one run from the départ line to the finish, every painted clip on the line', () => {
  // PGE Narodowy passes its finish area twice: the run must not end on the first pass
  for (const [track, layout] of [['kart_volan_championship', ''], ['poland_pge_narodowy_v3', ''], ['englishtown_gambler_esda', ''], ['vdc_bikernieki_2022', 'drift_vdc']]) {
    const course = bundledCourse(track, layout);
    const r = new TelemetryRecorder({ getDriver: () => ({ name: 'Pab', steamId: '1' }), getCourse: () => course });
    const laps = [];
    r.on('lap', (l) => laps.push(l));
    let t = 0;
    for (const f of calmontFrames(course, { track, layout })) r.feed(f, (t += 60));
    assert.strictEqual(laps.length, 1, track);
    const run = laps[0];
    assert.ok(run.samples[0][0] < 0.02 && run.samples[run.samples.length - 1][0] > 0.98, track);
    const res = scoreDrift(run.samples, course);
    assert.strictEqual(res.clips.filter((c) => c.hit).length, course.clips.length, `${track}: ${JSON.stringify(res.clips.map((c) => [c.name, c.hit, c.dist]))}`);
  }
});

test('back to pits or a reset cancels the run (and a lap on lap tracks)', () => {
  const course = bundledCourse('cfd_calmont_2023', 'Calmont');
  for (const opts of [{ teleportAt: 200 }, { pitsAt: 200 }]) {
    const r = new TelemetryRecorder({ getCourse: () => course });
    const laps = [];
    const resets = [];
    r.on('lap', (l) => laps.push(l));
    r.on('reset', (x) => resets.push(x));
    let t = 0;
    for (const f of calmontFrames(course, opts)) r.feed(f, (t += 60));
    assert.strictEqual(laps.length, 0, JSON.stringify(opts));
    assert.strictEqual(resets.length, 1);
    assert.strictEqual(resets[0].why, opts.pitsAt ? 'pits' : 'jump');
  }
  // lap tracks: the lap going on is dropped, the next one counts
  const { Simulator } = require('../src/main/telemetry/simulator');
  const sim = new Simulator({ lapMs: 20000, seed: 3 });
  const r = new TelemetryRecorder();
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    const b = sim.step(16);
    const f = { physics: L.parsePhysics(b.physics), graphics: L.parseGraphics(b.graphics), static: L.parseStatic(b.static) };
    if (i >= 1600 && i < 1610) f.graphics.isInPit = 1; // back to pits during lap 2
    r.feed(f, (t += 16));
  }
  // lap 1 complete; lap 2 dropped; lap 3 (from the next line) complete
  assert.strictEqual(laps.length, 2);
  assert.ok(laps.every((l) => l.samples[0][0] < 0.01));
});

test('in-game app files: courses with gates, battle runs, ghost library', () => {
  const ac = tmp();
  const dir = path.join(ac, 'apps', 'lua', 'LKS');
  fs.mkdirSync(dir, { recursive: true });
  writeCourses(ac, { 'cfd_calmont_2023|Calmont': bundledCourse('cfd_calmont_2023', 'Calmont'), 'x|': { clips: [{ name: 'A"b', x: 1, z: 2, r: 3 }] } });
  const lua = fs.readFileSync(path.join(dir, 'courses.lua'), 'utf8');
  assert.match(lua, /start = \{ \{ -67\.6, -11 \}/);
  assert.match(lua, /path = \{ \{ -?\d/, "long painted zones keep their path");
  assert.match(lua, /line = \{ \{/);
  assert.match(lua, /staging = \{ \{ -56\.6, 115\.2 \}/);
  assert.match(lua, /kind = "outer"/);
  assert.match(lua, /name = "A\\"b"/);
  assert.ok(!/\["x\|"\] = \{[^\n]*start =/.test(lua), 'no gates without a course line');

  // battle runs launched in game carry a tag: paired by it
  const rows = Array.from({ length: 50 }, (_, i) => [i * 50, i / 50, i, 0, 60, 30, 1, 0, 3, 0, i + 8, 0, 25, 60, 0]);
  const run1 = runToLap({ v: 1, role: 'lead', track: 't', layout: '', car: 'c', driver: 'Kaze', lead: { name: 'Pab', car: 'c' }, rows, battle: '123', run: 1 }, { name: 'Pab', steamId: '1' });
  const run2 = runToLap({ v: 1, role: 'chase', track: 't', layout: '', car: 'c', driver: 'Pab', lead: { name: 'Kaze', car: 'c' }, rows, battle: '123', run: 2 }, { name: 'Pab', steamId: '1' });
  const other = runToLap({ v: 1, role: 'chase', track: 't', layout: '', car: 'c', driver: 'Pab', lead: { name: 'Kaze', car: 'c' }, rows, battle: '999', run: 2 }, { name: 'Pab', steamId: '1' });
  assert.deepStrictEqual(run1.tandem.battle, { tag: '123', run: 1 });
  assert.ok(isPair(run1, run2));
  assert.ok(!isPair(run1, other), 'another battle');
  const free = runToLap({ v: 1, role: 'chase', track: 't', layout: '', car: 'c', driver: 'Pab', lead: { name: 'Kaze', car: 'c' }, rows }, { name: 'Pab' });
  assert.ok(!isPair(run1, free), 'a free tandem is not half of an in-game battle');
  const b = BattleStore.make(run2, run1, null);
  assert.strictEqual(b.tag, '123');
  assert.strictEqual(b.runs[0].lapId, run1.id, 'run 1 first, whatever the dates');

  // ghost library
  const ghostRows = Array.from({ length: 30 }, (_, i) => [i * 50 - 500, i, 0, 0, 0, 0, 1, 0, 1, 0, 50]);
  const lap = { track: 't', layout: '', car: 'c', driver: { name: 'Pab' }, lapMs: 1000, ghost: { rows: ghostRows, green: -400 } };
  assert.strictEqual(writeLibrary(dir, [{ id: 'abc', lap, score: 81.5 }, { id: 'nog', lap: { ...lap, ghost: null } }]), 1);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'library', 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.items.map((i) => [i.file, i.driver, i.score]), [['abc.json', 'Pab', 81.5]]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'library', 'abc.json'), 'utf8')).green, -400);
  writeLibrary(dir, []);
  assert.ok(!fs.existsSync(path.join(dir, 'library', 'abc.json')), 'old ghosts removed');

  // ghost recorded with a standing start (lights): green kept
  fs.mkdirSync(path.join(dir, 'ghosts'));
  fs.writeFileSync(path.join(dir, 'ghosts', 'g.json'), JSON.stringify({ v: 1, track: 't', layout: '', car: 'c', driver: 'Pab', time: 1, lapMs: 900, green: -1900, rows: ghostRows }));
  const [g] = readGhostFiles(path.join(dir, 'ghosts'));
  assert.strictEqual(g.ghost.green, -1900);
});

test('heading learnt from the game, clips judged with the front or the rear of the car', () => {
  const { YawFit, slipAngle } = require('../src/main/telemetry/layout');
  const { judgeClip, judgedPoint, LiveClips } = require('../src/main/telemetry/drift');
  // a game whose heading reads mirrored: forward = (-sin h, cos h)
  const fit = new YawFit();
  for (let i = 0; i < 200; i++) {
    const h = (i / 200) * 6;
    const fwd = [-Math.sin(h), Math.cos(h)];
    const slip = (20 * Math.PI) / 180;
    const v = 20;
    const vel = [fwd[0] * Math.cos(slip) - fwd[1] * Math.sin(slip), fwd[0] * Math.sin(slip) + fwd[1] * Math.cos(slip)];
    const p = { speedKmh: v * 3.6, heading: h, velocity: [vel[0] * v, 0, vel[1] * v], localVelocity: [Math.sin(slip) * v, 0, Math.cos(slip) * v] };
    assert.ok(Math.abs(Math.abs(slipAngle(p)) - 20) < 0.5);
    fit.feed(p);
  }
  assert.ok(fit.ready);
  const yaw = fit.yaw({ heading: 1 });
  assert.ok(Math.abs(Math.sin(yaw) - -Math.sin(1)) < 1e-6 && Math.abs(Math.cos(yaw) - Math.cos(1)) < 1e-6);

  // car at the origin heading +z: front at z = +2, rear at z = -2
  const inner = { name: 'Corde', kind: 'inner', x: 0, z: 2, r: 1 };
  const outer = { name: 'Mur', kind: 'outer', x: 0, z: -2, r: 1 };
  assert.deepStrictEqual(judgedPoint(inner, 0, 0, 0), [0, 2]);
  assert.deepStrictEqual(judgedPoint(outer, 0, 0, 0).map((v) => Math.round(v * 10) / 10), [0, -2]);
  const row = (x, z, yaw) => [0.5, 0, 60, 0, 0, 3, 0, 0, 30, x, z, 0, 30, 0, ...(yaw === undefined ? [] : [yaw])];
  assert.ok(judgeClip(inner, [row(0, 0, 0)], 1).hit, 'the nose touches the corde');
  assert.ok(judgeClip(outer, [row(0, 0, 0)], 1).hit, 'the rear is in the outer zone');
  assert.ok(!judgeClip(inner, [row(0, 0, Math.PI)], 1).hit, 'backwards: the nose is elsewhere');
  assert.ok(!judgeClip(inner, [row(0, 0)], 1).hit, 'older laps (no heading): the centre is judged');

  // long zone: share covered while sideways
  const zone = { name: 'Zone', kind: 'outer', x: 0, z: 50, r: 1.5, path: [[0, 0], [0, 100]] };
  const along = (from, to) => Array.from({ length: (to - from) * 2 }, (_, i) => row(0, from + i / 2 + 2, 0));
  const full = judgeClip(zone, along(0, 100), 1.5);
  assert.ok(full.hit && full.cover >= 95, JSON.stringify(full));
  const half = judgeClip(zone, along(0, 50), 1.5);
  assert.ok(half.hit && half.cover > 45 && half.cover < 56, JSON.stringify(half));
  assert.ok(!judgeClip(zone, along(0, 10), 1.5).hit, 'just touching a long zone is not enough');
  const live = new LiveClips({ clips: [zone] });
  for (let z = 2; z < 60; z += 0.5) live.feed(0, z, 30, 60, 0);
  const sum = live.summary();
  assert.ok(sum.hit === 1 && sum.clips[0].cover > 50 && sum.clips[0].cover < 62, JSON.stringify(sum));
});

test('note per zone and reference line from the best runs', () => {
  const course = bundledCourse('cfd_calmont_2023', 'Calmont');
  const r = new TelemetryRecorder({ getCourse: () => course });
  const laps = [];
  r.on('lap', (l) => laps.push(l));
  let t = 0;
  for (const f of calmontFrames(course)) r.feed(f, (t += 60));
  const res = scoreDrift(laps[0].samples, course);
  assert.strictEqual(res.zones.length, course.clips.length);
  assert.ok(res.zones.every((z) => z.score > 0 && z.score <= 100 && z.clip === true));
  assert.ok(res.clips.filter((c) => c.cover !== undefined).every((c) => c.cover > 50), 'long zones mostly covered on the line');

  const { lineFromRuns } = require('../src/main/telemetry/reference');
  const shift = (lap, dx, score) => ({ ...lap, driver: { name: `P${dx}` }, drift: { score, modes: { normal: { score } } }, samples: lap.samples.map((s) => { const c = [...s]; c[9] += dx; return c; }) });
  const out = lineFromRuns([shift(laps[0], 1, 80), shift(laps[0], -1, 80), shift(laps[0], 5, 0)], course);
  assert.strictEqual(out.runs.length, 2, 'runs without a note are left out');
  const t2 = new LineTracker(course.refLine);
  const offs = out.line.slice(10, -10).map(([x, z]) => t2.locate(x, z).dist);
  assert.ok(Math.max(...offs) < 1.2, 'average of the two runs: back on their middle');
  assert.strictEqual(lineFromRuns([], course), null);
});
