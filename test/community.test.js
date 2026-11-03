'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Community, decisionOf, MAX_UPLOAD } = require('../src/main/community');
const { Webhooks } = require('../src/main/webhook');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    let body = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body) body = init.body;
    calls.push({ url, init, body });
    const { status = 200, body: out = null } = handler(url, init) || {};
    return { ok: status < 300, status, text: async () => (out === null ? '' : JSON.stringify(out)) };
  };
  fn.calls = calls;
  return fn;
}

test('proposals: small files uploaded, big ones by link, list with download links and decisions', async () => {
  const f = fakeFetch((url) => (url.includes('lks_proposals_list')
    ? { body: [
      { id: 'a1', kind: 'skin', car: 'lks_bmw_m2', skin: 'red', track: '', title: 'Livrée rouge', author: 'Pab', message: 'pour le M2', link: '', file: 'v1/a1.zip', size: 1234, created_at: '2026-11-03T10:00:00Z' },
      { id: 'b2', kind: 'car', car: 'kaze_s15', skin: '', track: '', title: 'S15', author: 'Kaze', message: '', link: 'https://drive.google.com/x', file: '', size: 0, created_at: '2026-11-03T11:00:00Z' },
    ] }
    : { body: 'ok' }));
  const c = new Community({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: f });
  const id = await c.propose({ kind: 'skin', car: 'lks_bmw_m2', skin: 'red', title: 'Livrée rouge', author: 'Pab', zip: Buffer.from('PKzip') });
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.match(f.calls[0].url, new RegExp(`/storage/v1/object/lks-proposals/v1/${id}\\.zip$`));
  assert.strictEqual(f.calls[0].init.headers['Content-Type'], 'application/zip');
  assert.strictEqual(f.calls[1].body.p_file, `v1/${id}.zip`);
  assert.strictEqual(f.calls[1].body.p_link, '');
  assert.strictEqual(f.calls[1].body.p_size, 5);
  assert.ok(!('p_steam_id' in f.calls[1].body), 'no Steam ID sent');

  await c.propose({ kind: 'car', car: 'kaze_s15', title: 'S15', author: 'Kaze', link: 'https://drive.google.com/x' });
  assert.ok(f.calls[2].url.endsWith('/rest/v1/rpc/submit_proposal'), 'link: no upload');
  assert.strictEqual(f.calls[2].body.p_link, 'https://drive.google.com/x');
  await assert.rejects(c.propose({ kind: 'car', car: 'x', title: 'x', author: 'a' }), /fichier ou un lien/);
  await assert.rejects(c.propose({ kind: 'track', car: 'x', title: 'x', author: 'a', link: 'https://a.b/c' }), /inconnu/);
  await assert.rejects(c.upload('id', Buffer.alloc(MAX_UPLOAD + 1)), /50 Mo/);

  const list = await c.proposals();
  assert.strictEqual(list[0].download, 'https://x.supabase.co/storage/v1/object/public/lks-proposals/v1/a1.zip');
  assert.strictEqual(list[0].direct, true);
  assert.strictEqual(list[1].download, 'https://drive.google.com/x');
  assert.strictEqual(list[1].direct, false);
  const manifest = { proposals: { a1: { status: 'accepted', note: 'top' }, b2: { status: 'weird' } } };
  assert.strictEqual(decisionOf(manifest, 'a1').status, 'accepted');
  assert.strictEqual(decisionOf(manifest, 'b2').status, 'pending');
  assert.strictEqual(decisionOf({}, 'zz').status, 'pending');
});

test('presence: announce (server or hosted game), list without secrets, remove', async () => {
  const f = fakeFetch((url) => (url.includes('lks_presence_live')
    ? { body: [
      { id: 'p1', name: 'Kaze', state: 'online', server: { name: 'LKS 1', ip: '1.2.3.4', port: 9600, httpPort: 8081 }, car: 'lks_s14', track: 'cfd_calmont_2023', layout: 'Calmont', updated_at: 'x' },
      { id: 'p2', name: 'Jojo', state: 'launcher', server: {}, car: '', track: '', layout: '', updated_at: 'x' },
    ] }
    : { body: 'ok' }));
  const c = new Community({ url: 'https://x.supabase.co/', anonKey: 'k', fetchImpl: f });
  await c.setPresence({ id: 'pabcdef12', secret: 's'.repeat(20), name: 'Pab', state: 'online', server: { name: 'LKS 1', ip: '1.2.3.4', port: 9600, httpPort: 8081 }, car: 'm2', track: 't' });
  assert.deepStrictEqual(f.calls[0].body.p_server, { name: 'LKS 1', ip: '1.2.3.4', port: 9600, httpPort: 8081 });
  await c.setPresence({ id: 'pabcdef12', secret: 's'.repeat(20), name: 'Pab', state: 'hosting', server: { name: 'Ma partie', hostId: 'h123' } });
  assert.deepStrictEqual(f.calls[1].body.p_server, { name: 'Ma partie', hostId: 'h123' });
  await c.setPresence({ id: 'pabcdef12', secret: 's'.repeat(20), name: 'Pab', state: 'launcher' });
  assert.deepStrictEqual(f.calls[2].body.p_server, {});
  const people = await c.presence();
  assert.strictEqual(people[0].server.ip, '1.2.3.4');
  assert.strictEqual(people[1].server, null);
  assert.ok(!('secret' in people[0]));
  await c.removePresence('pabcdef12', 's'.repeat(20));
  assert.ok(f.calls[4].url.endsWith('/rpc/remove_presence'));
  assert.throws(() => new Community({ url: 'http://evil', anonKey: 'k' }), /invalide/);
});

test('discord webhooks: only real webhook URLs, spaced posts, report file attached', async () => {
  const hook = `https://discord.com/api/webhooks/123456789012345678/${'a'.repeat(68)}`;
  let cfg = { webhook: hook, reportWebhook: 'https://evil.example.com/x' };
  const f = fakeFetch(() => ({ status: 204 }));
  let clock = 0;
  const w = new Webhooks({ fetchImpl: f, getConfig: () => cfg, now: () => clock });
  assert.ok(w.configured('news'));
  assert.ok(!w.configured('reports'), 'not a Discord webhook');
  assert.strictEqual(await w.post('reports', 'x'), false);
  assert.strictEqual(await w.post('news', '🏁 record'), true);
  assert.strictEqual(f.calls[0].url, hook);
  assert.strictEqual(f.calls[0].body.content, '🏁 record');
  assert.deepStrictEqual(f.calls[0].body.allowed_mentions, { parse: [] }, 'no @everyone from a driver name');
  cfg = { webhook: hook, reportWebhook: hook };
  clock = 10000;
  await w.post('reports', 'plantage', { name: 'rapport.txt', content: 'log…' });
  assert.ok(f.calls[1].url.endsWith('?wait=true'));
  assert.ok(f.calls[1].body instanceof FormData);
  assert.ok(f.calls[1].body.get('files[0]'));
  const failing = new Webhooks({ fetchImpl: fakeFetch(() => ({ status: 401 })), getConfig: () => cfg });
  await assert.rejects(failing.post('news', 'x'), /refusé/);
});

test('votes and gallery photos', async () => {
  const f = fakeFetch((url) => (url.includes('lks_photos_list')
    ? { body: [{ id: 'ph1', file: 'v1/ph1.jpg', author: 'Kaze', caption: 'Calmont', car: 'lks_s14', track: 'cfd_calmont_2023', created_at: 'x' }] }
    : { body: 'ok' }));
  const c = new Community({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: f });
  await c.vote('a1', 'voter0001', 's'.repeat(20), 1);
  assert.deepStrictEqual(f.calls[0].body, { p_proposal: 'a1', p_voter: 'voter0001', p_secret: 's'.repeat(20), p_value: 1 });
  assert.throws(() => c.vote('a1', 'v', 's', 2), /invalide/);
  const id = await c.addPhoto({ image: Buffer.from('jpg'), ext: 'jpg', author: 'Pab', caption: 'Coucher de soleil' });
  assert.match(f.calls[1].url, new RegExp(`/storage/v1/object/lks-gallery/v1/${id}\\.jpg$`));
  assert.strictEqual(f.calls[1].init.headers['Content-Type'], 'image/jpeg');
  assert.strictEqual(f.calls[2].body.p_file, `v1/${id}.jpg`);
  await assert.rejects(c.addPhoto({ image: Buffer.from('x'), ext: 'gif', author: 'a' }), /JPEG/);
  const photos = await c.photos();
  assert.strictEqual(photos[0].url, 'https://x.supabase.co/storage/v1/object/public/lks-gallery/v1/ph1.jpg');
});

test('judge decisions overrule the launcher’s result of a battle', () => {
  const { decisionFor, judged, cleanJudging, pairOf } = require('../src/main/telemetry/judging');
  const result = { drivers: [{ name: 'Pab', total: 70 }, { name: 'Kaze', total: 69.5 }], omt: true, winner: null };
  const battle = { pair: pairOf(['Pab', 'Kaze']), track: 't', layout: '', date: '2026-11-03T21:10:00Z', result };
  const decisions = cleanJudging([
    { pair: 'kaze|pab', track: 't', layout: '', date: '2026-11-03T21:12:00Z', winner: 'kaze', note: 'Pab a raté le clip 3', by: 'Juge' },
    { pair: 'kaze|pab', track: 't', layout: '', date: '2026-11-03T23:00:00Z', omt: true },
    { pair: 'nope', date: 'x', winner: 'a' },
  ]);
  assert.strictEqual(decisions.length, 2, 'invalid decisions dropped');
  const d = decisionFor(decisions, battle);
  assert.strictEqual(d.winner, 'kaze', 'matched within 5 minutes');
  const r = judged(result, d);
  assert.deepStrictEqual([r.omt, r.winner, r.judge.note, r.auto.omt], [false, 'Kaze', 'Pab a raté le clip 3', true]);
  assert.strictEqual(decisionFor(decisions, { ...battle, track: 'other' }), null);
  assert.strictEqual(judged(result, null), result);
  const late = judged({ ...result, omt: false, winner: 'Pab' }, decisionFor(decisions, { ...battle, date: '2026-11-03T23:01:00Z' }));
  assert.deepStrictEqual([late.omt, late.winner], [true, null]);
});

test('every run note and the live state shared with the judges', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('lks_runs_list')) return { body: [{ id: 'r1', driver: 'Kaze', car: 'lks_s14', track: 'cfd_calmont_2023', layout: 'Calmont', kind: 'drift', score: '72.4', detail: { clips: [{ name: 'Clip 1', hit: true }] }, created_at: '2026-11-03T21:05:00Z' }] };
    if (url.includes('lks_live_now')) return { body: [{ id: 'p1', name: 'Kaze', car: 'lks_s14', track: 'cfd_calmont_2023', layout: 'Calmont', data: { angle: 34, speed: 88, d: 0.4 }, updated_at: 'x' }] };
    return { body: 'ok' };
  });
  const c = new Community({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: f });
  await c.addRun({ id: 'u1', driver: 'Pab', car: 'm2', track: 'cfd_calmont_2023', layout: 'Calmont', kind: 'drift', score: 78.44, detail: { clips: [] } });
  assert.strictEqual(f.calls[0].body.p_score, 78.4);
  assert.strictEqual(f.calls[0].body.p_kind, 'drift');
  assert.ok(!('p_steam_id' in f.calls[0].body));
  const runs = await c.runs({ track: 'cfd_calmont_2023', layout: 'Calmont', since: '2026-11-03T00:00:00Z' });
  assert.match(f.calls[1].url, /track=eq\.cfd_calmont_2023&layout=eq\.Calmont&created_at=gte\./);
  assert.strictEqual(runs[0].score, 72.4);
  await c.setLive({ id: 'pabcdef12', secret: 's'.repeat(20), name: 'Pab', car: 'm2', track: 't', data: { angle: 30 } });
  assert.deepStrictEqual(f.calls[2].body.p_data, { angle: 30 });
  const live = await c.live();
  assert.strictEqual(live[0].data.angle, 34);
});
