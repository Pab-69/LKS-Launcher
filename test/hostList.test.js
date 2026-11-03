'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { HostList, newHostId, bestAddress } = require('../src/main/hostList');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const { status = 200, body = null } = handler(url, init) || {};
    return { ok: status < 300, status, text: async () => (body === null ? '' : JSON.stringify(body)) };
  };
  fn.calls = calls;
  return fn;
}

test('host list: announce, list (without secret), remove', async () => {
  const f = fakeFetch((url) => (url.includes('lks_hosts_live')
    ? { body: [{ id: 'abc123def456', name: 'Partie de Alex', host_driver: 'Alex', addresses: [{ kind: 'internet', address: '89.93.210.72' }, { kind: 'lan', address: '192.168.1.200' }], tcp_port: 9600, http_port: 8081, has_password: true, track: 'cfd_calmont_2023', layout: 'Calmont', cars: ['lks_bmw_m2_g87_2jz'], slots: 5, updated_at: '2026-11-02T22:00:00Z' }] }
    : { body: 'ok' }));
  const list = new HostList({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: f });
  const { id, secret } = newHostId();
  assert.ok(id.length >= 8 && secret.length >= 16);
  await list.announce({ id, secret, name: 'Partie de Alex', hostDriver: 'Alex', addresses: [{ kind: 'lan', address: '192.168.1.200' }], tcpPort: 9600, httpPort: 8081, hasPassword: true, track: 't', layout: '', cars: ['c'], slots: 5 });
  assert.match(f.calls[0].url, /rpc\/announce_host$/);
  assert.strictEqual(f.calls[0].body.p_secret, secret);
  assert.strictEqual(f.calls[0].body.p_http_port, 8081);
  assert.ok(!('p_password' in f.calls[0].body), 'the game password is never sent');
  const rows = await list.list();
  assert.strictEqual(rows[0].hostDriver, 'Alex');
  assert.strictEqual(rows[0].addresses.length, 2);
  assert.ok(!('secret' in rows[0]));
  await list.remove(id, secret);
  assert.match(f.calls[2].url, /rpc\/remove_host$/);
});

test('host list: missing table gives a clear message', async () => {
  const list = new HostList({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: fakeFetch(() => ({ status: 404, body: { message: 'relation does not exist' } })) });
  await assert.rejects(list.list(), /relancer docs\/leaderboard\.sql/);
});

test('joining a launcher game picks the address that answers, lowest ping first', async () => {
  const entry = { name: 'P', httpPort: 8081, addresses: [{ kind: 'internet', address: '89.93.210.72' }, { kind: 'zerotier', address: '10.147.17.5' }, { kind: 'lan', address: '192.168.1.200' }] };
  const pings = { '89.93.210.72': 60, '10.147.17.5': 30 };
  const probe = async (s) => (pings[s.ip] ? { online: true, ping: pings[s.ip], ip: s.ip } : { online: false });
  const best = await bestAddress(entry, probe);
  assert.strictEqual(best.info.ip, '10.147.17.5');
  assert.strictEqual(await bestAddress(entry, async () => ({ online: false })), null);
});
