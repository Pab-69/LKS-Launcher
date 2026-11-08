'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('live manifest: published content from GitHub, group data from the server', () => {
  const { overlay, serverBase, OWNED } = require('../src/main/liveManifest');
  const github = { name: 'old', news: [], cars: [{ id: 'gh-car' }], tracks: [{ id: 'gh-track' }], branding: { version: 'g' }, leaderboard: { url: 'https://lks.example/' } };
  const live = { name: 'live', news: [{ title: 'n' }], cars: [{ id: 'stale' }], events: [{ id: 'e' }], leaderboard: { url: 'https://lks.example' } };
  const out = overlay(github, live);
  assert.deepStrictEqual(out.cars, github.cars, 'cars come from GitHub');
  assert.deepStrictEqual([out.name, out.news.length, out.events.length], ['live', 1, 1]);
  assert.strictEqual(out.branding.version, 'g');
  assert.strictEqual(overlay(github, null), github, 'server down: GitHub manifest as is');
  assert.strictEqual(serverBase(github), 'https://lks.example');
  assert.strictEqual(serverBase({ leaderboard: { url: 'http://insecure.example' } }), null, 'https only');
  assert.deepStrictEqual(OWNED, ['cars', 'tracks', 'branding', 'setups']);
});

test('live manifest: change stream reads SSE events and reconnects', async () => {
  const http = require('http');
  const { LiveStream } = require('../src/main/liveManifest');
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('retry: 5000\n\nevent: hello\ndata: {}\n\n');
    setTimeout(() => res.write('event: meta\ndata: {"t":"meta"}\n\n: ping\n\nevent: runs\ndata: {"t":"runs"}\n\n'), 30);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  // https is required for real use; the stream itself accepts http for tests
  const stream = new LiveStream({ getBase: () => `http://127.0.0.1:${srv.address().port}` });
  const got = [];
  stream.on('event', (t) => got.push(t));
  stream.start();
  await new Promise((r) => setTimeout(r, 400));
  stream.stop();
  srv.closeAllConnections();
  srv.close();
  assert.deepStrictEqual(got, ['hello', 'meta', 'runs']);
});

test('discord posts go through the group server, with the direct webhook as a fallback for older servers', async () => {
  const { Webhooks } = require('../src/main/webhook');
  const hook = `https://discord.com/api/webhooks/123456789012345678/${'a'.repeat(68)}`;
  const calls = [];
  let relayStatus = 200;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: url.includes('/admin/api/discord/') ? relayStatus === 200 : true, status: url.includes('/admin/api/discord/') ? relayStatus : 204 };
  };
  const server = { base: 'https://lks.example', key: 'pub' };
  // no webhook in the manifest any more (kept private on the server): the relay is the only way
  const w = new Webhooks({ fetchImpl, getConfig: () => ({}), getServer: () => server, now: () => 0 });
  assert.ok(w.configured('reports'));
  assert.strictEqual(await w.post('reports', 'plantage', { name: 'a.lkslap', content: Buffer.from([1, 2, 3]) }), true);
  assert.strictEqual(calls[0].url, 'https://lks.example/admin/api/discord/reports');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer pub');
  assert.strictEqual(JSON.parse(calls[0].init.body).file.b64, Buffer.from([1, 2, 3]).toString('base64'));
  // older server (404) with a webhook still in the manifest: direct post
  relayStatus = 404;
  const old = new Webhooks({ fetchImpl, getConfig: () => ({ webhook: hook }), getServer: () => server, now: () => 0 });
  assert.strictEqual(await old.post('news', 'record'), true);
  assert.strictEqual(calls[calls.length - 1].url, hook);
  // nothing anywhere: not sent
  assert.strictEqual(await w.post('news', 'x'), false);
  // rate limited by the server: the user is told
  relayStatus = 429;
  await assert.rejects(w.post('reports', 'encore'), /Trop de messages/);
});
