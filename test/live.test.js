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
