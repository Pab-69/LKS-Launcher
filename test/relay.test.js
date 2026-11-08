'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.ANON_KEY = 'public-key';
process.env.HIDE_WEBHOOKS = '1';
const { discordRelay, publicManifest } = require('../server/admin/server');

const req = (key = 'public-key') => ({ headers: { authorization: `Bearer ${key}` } });
const URL_OK = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';

function stubFetch() {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 204 };
  };
  return calls;
}

test('discord relay: posts with mentions disabled, needs the public key, hides nothing it should not', async () => {
  const calls = stubFetch();
  const r = await discordRelay(req(), 'news', { content: '🏁 @everyone record !' }, '1.1.1.1', async () => URL_OK);
  assert.deepStrictEqual(r, { ok: true });
  const payload = JSON.parse(calls[0].init.body);
  assert.deepStrictEqual(payload.allowed_mentions, { parse: [] });
  assert.strictEqual(calls[0].url, URL_OK);
  await assert.rejects(discordRelay(req('wrong'), 'news', { content: 'x' }, '1.1.1.2', async () => URL_OK), /Clé invalide/);
  await assert.rejects(discordRelay(req(), 'news', { content: '  ' }, '1.1.1.3', async () => URL_OK), /vide/);
  await assert.rejects(discordRelay(req(), 'news', { content: 'x', file: { name: 'a.txt', content: 'y' } }, '1.1.1.4', async () => URL_OK), /Fichier refusé/, 'files only for reports');
  const lap = await discordRelay(req(), 'reports', { content: 'lap', file: { name: 'calmont-pab.lkslap', b64: Buffer.from('gzip bytes').toString('base64') } }, '1.1.1.7', async () => URL_OK);
  assert.deepStrictEqual(lap, { ok: true });
  await assert.rejects(discordRelay(req(), 'reports', { content: 'x', file: { name: 'a', b64: 'A'.repeat(900000) } }, '1.1.1.8', async () => URL_OK), /Fichier refusé/, 'too big');
  await assert.rejects(discordRelay(req(), 'reports', { content: 'x', file: { name: '../a', content: 'y' } }, '1.1.1.5', async () => URL_OK), /Fichier refusé/);
  await assert.rejects(discordRelay(req(), 'news', { content: 'x' }, '1.1.1.6', async () => null), /non réglé/);
});

test('discord relay: crash reports are rate limited per address', async () => {
  stubFetch();
  for (let i = 0; i < 3; i++) await discordRelay(req(), 'reports', { content: `r${i}`, file: { name: 'crash.txt', content: 'log' } }, '9.9.9.9', async () => URL_OK);
  await assert.rejects(discordRelay(req(), 'reports', { content: 'r4' }, '9.9.9.9', async () => URL_OK), (e) => e.status === 429);
  await discordRelay(req(), 'reports', { content: 'autre adresse' }, '8.8.8.8', async () => URL_OK); // someone else is not blocked
});

test('public manifest: webhook addresses removed when kept private', () => {
  const m = { name: 'x', discord: { webhook: URL_OK, reportWebhook: URL_OK, inviteUrl: 'https://discord.gg/x', clientId: '1' } };
  const out = publicManifest(m);
  assert.deepStrictEqual(Object.keys(out.discord).sort(), ['clientId', 'inviteUrl']);
  assert.ok(m.discord.webhook, 'original untouched');
});
