'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dgram = require('dgram');
const ini = require('../src/main/ini');
const { buildServerConfig, packContent, ServerHost, serverStopReason, LOBBY_REFUSED } = require('../src/main/hosting');
const { findGateway, isPrivateIp } = require('../src/main/upnp');
const { networkAddresses } = require('../src/main/netinfo');
const { encodeInvite, decodeInvite } = require('../src/shared/invite');
const { getServerInfo } = require('../src/main/servers');
const { makeFakeAc, write } = require('./helpers/fakeAc');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-host-'));

test('server_cfg.ini and entry_list.ini for a free drift session', () => {
  const { serverCfg, entryList } = buildServerConfig({
    name: 'Partie de Pab', track: 'lks_touge', layout: 'downhill', slots: 5, mode: 'free', timeOfDay: 18,
    cars: [{ id: 'lks_bmw_m2', skins: ['a', 'b'] }, { id: 'lks_s15', skins: ['x'] }], password: 'secret', ambient: 20, road: 28, weather: '3_clear',
  });
  const c = ini.parse(serverCfg);
  assert.strictEqual(c.SERVER.TRACK, 'lks_touge');
  assert.strictEqual(c.SERVER.CONFIG_TRACK, 'downhill');
  assert.strictEqual(c.SERVER.CARS, 'lks_bmw_m2;lks_s15');
  assert.strictEqual(c.SERVER.MAX_CLIENTS, '5');
  assert.strictEqual(c.SERVER.PASSWORD, 'secret');
  assert.strictEqual(c.SERVER.REGISTER_TO_LOBBY, '0');
  assert.strictEqual(c.SERVER.SUN_ANGLE, '80');
  assert.strictEqual(c.SERVER.TCP_PORT, '9600');
  assert.strictEqual(c.SERVER.HTTP_PORT, '8081');
  assert.ok(c.PRACTICE && !c.RACE, 'free mode = open practice only');
  assert.strictEqual(c.WEATHER_0.BASE_TEMPERATURE_ROAD, '8', 'road temperature is relative to ambient');
  const e = ini.parse(entryList);
  assert.strictEqual(Object.keys(e).length, 5);
  assert.deepStrictEqual([e.CAR_0.MODEL, e.CAR_1.MODEL, e.CAR_2.MODEL], ['lks_bmw_m2', 'lks_s15', 'lks_bmw_m2']);
  assert.deepStrictEqual([e.CAR_0.SKIN, e.CAR_2.SKIN], ['a', 'b']);
  const race = ini.parse(buildServerConfig({ track: 't', cars: [{ id: 'c' }], mode: 'race', qualifyMinutes: 10, raceLaps: 12 }).serverCfg);
  assert.strictEqual(race.RACE.LAPS, '12');
  assert.strictEqual(race.QUALIFY.TIME, '10');
  assert.throws(() => buildServerConfig({ track: 't', cars: [] }), /voiture/);
});

test('content packing copies only what the server needs', () => {
  const ac = makeFakeAc(tmp(), { cars: { lks_bmw_m2: {} }, tracks: { lks_touge: { layouts: ['downhill', 'uphill'] } } });
  write(path.join(ac, 'content', 'tracks', 'lks_touge', 'models_downhill.ini'), '[MODEL_0]');
  write(path.join(ac, 'content', 'tracks', 'lks_touge', 'downhill', 'ai', 'fast_lane.ai'), 'ai');
  const dir = path.join(ac, 'server');
  const n = packContent(ac, dir, { cars: ['lks_bmw_m2'], track: 'lks_touge', layout: 'downhill' });
  assert.ok(n >= 5);
  assert.ok(fs.existsSync(path.join(dir, 'content', 'cars', 'lks_bmw_m2', 'data.acd')));
  assert.ok(!fs.existsSync(path.join(dir, 'content', 'cars', 'lks_bmw_m2', 'lks_bmw_m2.kn5')), '3D models are not copied');
  assert.ok(fs.existsSync(path.join(dir, 'content', 'tracks', 'lks_touge', 'downhill', 'data', 'surfaces.ini')));
  assert.ok(fs.existsSync(path.join(dir, 'content', 'tracks', 'lks_touge', 'downhill', 'ai', 'fast_lane.ai')));
  assert.ok(fs.existsSync(path.join(dir, 'content', 'tracks', 'lks_touge', 'models_downhill.ini')));
  assert.ok(!fs.existsSync(path.join(dir, 'content', 'tracks', 'lks_touge', 'uphill')), 'other layouts skipped');
  assert.strictEqual(packContent(ac, dir, { cars: ['lks_bmw_m2'], track: 'lks_touge', layout: 'downhill' }), 0, 'second pack is instant');
  assert.throws(() => packContent(ac, dir, { cars: ['missing'], track: 'lks_touge', layout: '' }), /non installée/);
});

test('server lifecycle: start, answers /INFO, logs, stop', async () => {
  const ac = makeFakeAc(tmp(), { cars: { c1: {} }, tracks: { t1: { layouts: ['gp'] } } });
  const config = buildServerConfig({ name: 'Test', track: 't1', layout: 'gp', cars: [{ id: 'c1' }], slots: 4, ports: { tcp: 9600, udp: 9600, http: 0 } });
  // fake acServer: a tiny HTTP server answering /INFO like the real one
  const fake = path.join(tmp(), 'fake-server.js');
  fs.writeFileSync(fake, `
    const http = require('http');
    const s = http.createServer((q, r) => r.end(JSON.stringify({ name: 'Test', clients: 0, maxclients: 4, track: 't1-gp', cars: ['c1'], port: 9600, tport: 9600, cport: 0 })));
    s.listen(0, '127.0.0.1', () => { console.log('PORT ' + s.address().port); console.log('Lobby registration skipped'); });
    process.on('SIGTERM', () => process.exit(0));
  `);
  const host = new ServerHost();
  const portLine = new Promise((resolve) => host.on('log', (l) => l.startsWith('PORT ') && resolve(Number(l.slice(5)))));
  host.start({ acRoot: ac, config, pack: { cars: ['c1'], track: 't1', layout: 'gp' }, exe: { command: process.execPath, args: [fake] } });
  assert.ok(host.running);
  assert.throws(() => host.start({ acRoot: ac, config }), /déjà/);
  const port = await portLine;
  const info = await getServerInfo({ ip: '127.0.0.1', httpPort: port, name: 'x' });
  assert.strictEqual(info.online, true);
  assert.strictEqual(info.maxClients, 4);
  assert.ok(fs.existsSync(path.join(ac, 'server', 'presets', 'lks-launcher', 'server_cfg.ini')));
  assert.ok(host.log.some((l) => /Contenu préparé/.test(l)));
  const stopped = new Promise((r) => host.once('stopped', r));
  host.stop();
  await stopped;
  assert.strictEqual(host.running, false);
});

test('UPnP: finds the box, opens and closes ports, reads public IP', async (t) => {
  const calls = [];
  const web = http.createServer((req, res) => {
    if (req.url === '/desc.xml') {
      return res.end(`<?xml version="1.0"?><root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`);
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const action = String(req.headers.soapaction).split('#')[1].replace('"', '');
      calls.push({ action, body });
      if (action === 'GetExternalIPAddress') return res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>203.0.113.7</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
      if (action === 'AddPortMapping' && body.includes('<NewLeaseDuration>0<')) {
        res.statusCode = 500;
        return res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>725</errorCode><errorDescription>OnlyPermanentLeasesSupported</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>');
      }
      res.end('<ok/>');
    });
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const ssdp = dgram.createSocket('udp4');
  ssdp.on('message', (msg, rinfo) => {
    if (String(msg).startsWith('M-SEARCH')) ssdp.send(Buffer.from(`HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:${web.address().port}/desc.xml\r\n\r\n`), rinfo.port, rinfo.address);
  });
  await new Promise((r) => ssdp.bind(0, '127.0.0.1', r));
  t.after(() => { web.close(); ssdp.close(); });

  const gw = await findGateway({ address: '127.0.0.1', port: ssdp.address().port, localAddress: '192.168.1.42', interfaces: ['127.0.0.1'], unicast: [] });
  assert.match(gw.controlUrl, /\/ctl\/IPConn$/);
  assert.strictEqual(await gw.externalIp(), '203.0.113.7');
  await gw.map(9600, 'UDP', 'LKS');
  const adds = calls.filter((c) => c.action === 'AddPortMapping');
  assert.strictEqual(adds.length, 2, 'retried with a limited lease after error 725');
  assert.match(adds[1].body, /<NewInternalClient>192\.168\.1\.42</);
  await gw.unmap(9600, 'UDP');
  assert.ok(calls.some((c) => c.action === 'DeletePortMapping'));
  assert.strictEqual(isPrivateIp('203.0.113.7'), false);
  assert.strictEqual(isPrivateIp('100.70.1.2'), true, 'CGNAT');
  assert.strictEqual(isPrivateIp('192.168.1.1'), true);
});

test('UPnP: skips a TV that answers first, port already taken, box refusing', async (t) => {
  const { friendlyUpnpError } = require('../src/main/upnp');
  const calls = [];
  let conflict = true;
  const web = http.createServer((req, res) => {
    if (req.url === '/tv.xml') return res.end('<?xml version="1.0"?><root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service></serviceList></device></root>');
    if (req.url === '/box.xml') return res.end('<?xml version="1.0"?><root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType><controlURL>/ipc</controlURL></service></serviceList></device></root>');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const action = String(req.headers.soapaction).split('#')[1].replace('"', '');
      calls.push(action);
      if (action === 'AddPortMapping' && conflict) {
        conflict = false;
        res.statusCode = 500;
        return res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>718</errorCode><errorDescription>ConflictInMappingEntry</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>');
      }
      res.end('<ok/>');
    });
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const ssdp = dgram.createSocket('udp4');
  ssdp.on('message', (msg, rinfo) => {
    if (!String(msg).startsWith('M-SEARCH')) return;
    const p = web.address().port;
    ssdp.send(Buffer.from(`HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:${p}/tv.xml\r\n\r\n`), rinfo.port, rinfo.address);
    setTimeout(() => ssdp.send(Buffer.from(`HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:${p}/box.xml\r\n\r\n`), rinfo.port, rinfo.address), 50);
  });
  await new Promise((r) => ssdp.bind(0, '127.0.0.1', r));
  t.after(() => { web.close(); ssdp.close(); });
  const gw = await findGateway({ address: '127.0.0.1', port: ssdp.address().port, localAddress: '192.168.1.42', interfaces: ['127.0.0.1'], unicast: [], timeout: 600 });
  assert.match(gw.controlUrl, /\/ipc$/, 'the TV is skipped');
  await gw.map(9600, 'TCP', 'LKS');
  assert.deepStrictEqual(calls, ['AddPortMapping', 'DeletePortMapping', 'AddPortMapping'], 'old mapping closed then opened again');
  assert.match(friendlyUpnpError({ code: '606', message: 'x' }, 9600, 'TCP').message, /UPnP complet/);
  assert.strictEqual(friendlyUpnpError({ code: '999', message: 'brut' }, 1, 'TCP').message, 'brut');
});

test('network detection and invitation codes', () => {
  const nets = networkAddresses({
    Ethernet: [{ family: 'IPv4', address: '192.168.1.42', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    'Radmin VPN': [{ family: 'IPv4', address: '26.12.34.56', internal: false }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    ztabc123: [{ family: 'IPv4', address: '10.147.17.5', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  });
  assert.deepStrictEqual(nets.map((n) => [n.kind, n.address]), [['radmin', '26.12.34.56'], ['zerotier', '10.147.17.5'], ['lan', '192.168.1.42']]);
  const code = encodeInvite({ name: 'Partie de Pab', address: '26.12.34.56', tcpPort: 9600, httpPort: 8081, password: 'drift', kind: 'radmin' });
  assert.match(code, /^LKS-[A-Za-z0-9_-]+$/);
  assert.deepStrictEqual(decodeInvite(`  ${code} `), { name: 'Partie de Pab', address: '26.12.34.56', tcpPort: 9600, httpPort: 8081, password: 'drift', kind: 'radmin' });
  assert.strictEqual(decodeInvite(encodeInvite({ name: 'x', address: '1.2.3.4', tcpPort: 1, httpPort: 2 })).kind, '', 'codes without network kind still work');
  assert.throws(() => decodeInvite('hello'), /LKS-/);
  const evil = `LKS-${Buffer.from(JSON.stringify({ a: 'x;rm -rf', t: 1, h: 2 })).toString('base64url')}`;
  assert.throws(() => decodeInvite(evil), /invalide/);
});

test('VPN du Syndicate: status, elevated ZeroTier commands, rules', async () => {
  const vpn = require('../src/main/vpn');
  const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', ProgramData: 'C:\\PD' };
  const zt = { provider: 'zerotier', networkId: '8056c2e21c000001' };
  const none = () => false;
  const onlyService = (f) => f.endsWith('zerotier-one_x64.exe');
  const off = vpn.vpnStatus(zt, { ifaces: { Ethernet: [{ family: 'IPv4', address: '192.168.1.2', internal: false }] }, exists: none, env });
  assert.deepStrictEqual([off.configured, off.installed, off.connected], [true, false, false]);
  const on = vpn.vpnStatus(zt, { ifaces: { 'ZeroTier One [8056c2e21c000001]': [{ family: 'IPv4', address: '10.147.20.3', internal: false }] }, exists: onlyService, env });
  assert.deepStrictEqual([on.installed, on.connected, on.address], [true, true, '10.147.20.3']);
  const radmin = vpn.vpnStatus({ provider: 'radmin', networkName: 'LKS-Syndicate', password: 'x' }, { ifaces: { 'Radmin VPN': [{ family: 'IPv4', address: '26.1.2.3', internal: false }] }, exists: none, env });
  assert.deepStrictEqual([radmin.configured, radmin.connected, radmin.networkName], [true, true, 'LKS-Syndicate']);
  assert.strictEqual(vpn.vpnStatus(null).configured, false);

  // elevated command: values are quoted for PowerShell, the network id is validated first
  const cmd = vpn.elevatedCommand("C:\\PD\\ZeroTier\\One\\zerotier-one_x64.exe", ['-q', 'join', '8056c2e21c000001']);
  assert.match(cmd, /Start-Process -FilePath 'C:\\PD\\ZeroTier\\One\\zerotier-one_x64\.exe' -ArgumentList '-q','join','8056c2e21c000001' -Verb RunAs/);
  assert.strictEqual(vpn.elevatedCommand("C:\\it's", ['a']).includes("'C:\\it''s'"), true);
  if (process.platform === 'win32') {
    await assert.rejects(() => vpn.zerotierCommand('join', "x'; rm", { exists: onlyService, env }), /invalide/);
  } else {
    await assert.rejects(() => vpn.zerotierCommand('join', '8056c2e21c000001'), /Windows/);
  }
  const rules = vpn.zerotierRules();
  assert.match(rules, /accept ipprotocol udp and dport 9600;/);
  assert.match(rules, /accept ipprotocol tcp and dport 8081;/);
  assert.match(rules.trim(), /drop;$/);
});

test('Windows firewall: reading the rules and the fix command', async () => {
  const fw = require('../src/main/firewall');
  // blocked after « Annuler » on the Windows prompt
  let r = fw.evaluate('{"allow":["Private"],"block":1,"networks":["Public"]}');
  assert.deepStrictEqual([r.ok, r.blocked, r.missingFor], [false, true, ['Public']]);
  // only allowed on private networks while this network is public
  r = fw.evaluate('{"allow":"Private","block":0,"networks":"Public"}');
  assert.deepStrictEqual([r.ok, r.blocked, r.missingFor], [false, false, ['Public']]);
  assert.strictEqual(fw.evaluate('{"allow":["Any"],"block":0,"networks":["Public","Private"]}').ok, true);
  assert.strictEqual(fw.evaluate('{"allow":["Domain, Private, Public"],"block":0,"networks":["DomainAuthenticated"]}').ok, true);
  assert.strictEqual(fw.covers('Private, Public', 'Public'), true);
  // the path is quoted for PowerShell, block rules are removed before allowing
  const exe = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa\\server\\acServer.exe";
  const fix = fw.fixScript(exe);
  assert.match(fix, /Remove-NetFirewallRule/);
  assert.match(fix, /-Action Allow -Profile Any/);
  assert.ok(fix.includes(`'${exe}'`));
  assert.ok(fw.fixScript("C:\\it's\\acServer.exe").includes("'C:\\it''s\\acServer.exe'"), 'quote escaped');
  // the status command runs PowerShell without elevation, and never on other systems
  const calls = [];
  const { EventEmitter } = require('events');
  const runner = (cmd, args) => {
    calls.push([cmd, args]);
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    setImmediate(() => { p.stdout.emit('data', '{"allow":["Any"],"block":0,"networks":["Private"]}\r\n'); p.emit('exit', 0); });
    return p;
  };
  assert.deepStrictEqual(await fw.firewallStatus(exe, { platform: 'linux', runner }), { checked: false });
  const st = await fw.firewallStatus(exe, { platform: 'win32', runner });
  assert.strictEqual(st.ok, true);
  assert.deepStrictEqual(calls[0][1].slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.ok(!Buffer.from(calls[0][1][3], 'base64').toString('utf16le').includes('RunAs'), 'reading needs no admin rights');
});

test('real PC report: PowerShell progress output, VirtualBox card, v2 box answering 501', async (t) => {
  const fw = require('../src/main/firewall');
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"></Obj></Objs>\r\n{"allow":["Any"],"block":0,"networks":["Private"]}\r\n<Objs Version="1.1.0.1"></Objs>';
  assert.strictEqual(fw.evaluate(clixml).ok, true);
  assert.throws(() => fw.evaluate('<Objs Version="1.1.0.1"></Objs>'), /illisible/);
  assert.match(fw.statusScript('C:\\a.exe'), /\$ProgressPreference = 'SilentlyContinue'/);

  const nets = networkAddresses({ 'Ethernet 5': [{ family: 'IPv4', address: '192.168.56.1', internal: false }], 'Ethernet 4': [{ family: 'IPv4', address: '192.168.1.117', internal: false }] });
  assert.deepStrictEqual(nets.map((n) => n.address), ['192.168.1.117'], 'VirtualBox host-only card ignored');

  const actions = [];
  const web = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const action = String(req.headers.soapaction).split('#')[1].replace('"', '');
      actions.push(`${action}${(body.match(/<NewLeaseDuration>(\d+)</) || [])[1] ? `:${body.match(/<NewLeaseDuration>(\d+)</)[1]}` : ''}`);
      if (action === 'AddPortMapping') {
        res.statusCode = 500;
        return res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>501</errorCode><errorDescription>Action Failed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>');
      }
      if (action === 'AddAnyPortMapping') return res.end('<s:Envelope><s:Body><u:AddAnyPortMappingResponse><NewReservedPort>9600</NewReservedPort></u:AddAnyPortMappingResponse></s:Body></s:Envelope>');
      res.end('<ok/>');
    });
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  t.after(() => web.close());
  const { Gateway } = require('../src/main/upnp');
  const gw = new Gateway({ controlUrl: `http://127.0.0.1:${web.address().port}/ctl`, serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:2', localAddress: '192.168.1.117' });
  await gw.map(9600, 'TCP', 'LKS');
  assert.deepStrictEqual(actions, ['AddPortMapping:0', 'AddPortMapping:86400', 'AddPortMapping:3600', 'AddAnyPortMapping:3600']);
});

test('stop reason: the AC lobby refusing the server is recognised', () => {
  const log = [
    'Registering to AC central server',
    'RESPONSE: ERROR - TOO MANY REGISTRATION ATTEMPTS, SLOW DOWN',
    'LOBBY COULD NOT BE RACHED, SHUTTING SERVER DOWN',
    'Serveur arrêté (code 0)',
  ];
  assert.strictEqual(serverStopReason(log), LOBBY_REFUSED);
  assert.strictEqual(serverStopReason(['listen udp :9600: bind: address already in use']), 'un port du serveur est déjà utilisé');
  assert.strictEqual(serverStopReason(['all good']), '');
});
