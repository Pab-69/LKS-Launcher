'use strict';

/**
 * "VPN du Syndicate": a private virtual network used when the host's box can't
 * open its ports (shared IP, 4G/5G, UPnP disabled).
 *
 *  - ZeroTier: fully driven by the launcher (official installer + join).
 *    The free ZeroTier plan allows 10 devices on one network.
 *  - Radmin VPN: free and without device limit, but it has no command line:
 *    the launcher guides the member and detects when they are connected.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { networkAddresses } = require('./netinfo');

const ZEROTIER_MSI = 'https://download.zerotier.com/dist/ZeroTier%20One.msi';
const RADMIN_PAGE = 'https://www.radmin-vpn.com/fr/';
const NETWORK_ID = /^[0-9a-f]{16}$/;

function zerotierExecutables(env = process.env) {
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pd = env.ProgramData || 'C:\\ProgramData';
  return [
    { file: path.join(pf86, 'ZeroTier', 'One', 'zerotier-cli.bat'), args: [] },
    { file: path.join(pf, 'ZeroTier', 'One', 'zerotier-cli.bat'), args: [] },
    { file: path.join(pd, 'ZeroTier', 'One', 'zerotier-one_x64.exe'), args: ['-q'] },
    { file: path.join(pd, 'ZeroTier', 'One', 'zerotier-one_x86.exe'), args: ['-q'] },
  ];
}

function findZerotier(exists = fs.existsSync, env = process.env) {
  return zerotierExecutables(env).find((c) => exists(c.file)) || null;
}

function radminInstalled(exists = fs.existsSync, env = process.env) {
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return exists(path.join(pf86, 'Radmin VPN'));
}

/** Escape a value for a single-quoted PowerShell string. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * PowerShell command running a program elevated (UAC prompt), hidden, and
 * waiting for it: zerotier-cli needs administrator rights on Windows.
 */
function elevatedCommand(file, args) {
  const list = args.map(psQuote).join(',');
  return `$p = Start-Process -FilePath ${psQuote(file)} -ArgumentList ${list} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
}

function run(command, args, { runner = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const p = runner(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    if (p.stdout) p.stdout.on('data', (c) => (out += c));
    if (p.stderr) p.stderr.on('data', (c) => (out += c));
    p.on('error', reject);
    p.on('exit', (code) => resolve({ code, out }));
  });
}

function requireWindows() {
  if (process.platform !== 'win32') throw new Error('Disponible uniquement sous Windows');
}

/** Current state for the configured network (manifest.vpn). */
function vpnStatus(cfg, { ifaces, exists, env } = {}) {
  const nets = networkAddresses(ifaces);
  const provider = cfg && cfg.provider;
  if (provider === 'zerotier') {
    const net = nets.find((n) => n.kind === 'zerotier');
    return { provider, configured: NETWORK_ID.test(cfg.networkId || ''), networkId: cfg.networkId, installed: Boolean(findZerotier(exists, env)), connected: Boolean(net), address: net ? net.address : null };
  }
  if (provider === 'radmin') {
    const net = nets.find((n) => n.kind === 'radmin');
    return { provider, configured: Boolean(cfg.networkName), networkName: cfg.networkName, password: cfg.password || '', installed: radminInstalled(exists, env) || Boolean(net), connected: Boolean(net), address: net ? net.address : null };
  }
  return { provider: null, configured: false };
}

async function installZerotier({ fetchImpl = fetch, runner } = {}) {
  requireWindows();
  const file = path.join(os.tmpdir(), `ZeroTierOne-${Date.now()}.msi`);
  const res = await fetchImpl(ZEROTIER_MSI);
  if (!res.ok) throw new Error(`Téléchargement de ZeroTier impossible (HTTP ${res.status})`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  try {
    // msiexec asks for administrator rights itself (UAC)
    const { code } = await run('msiexec', ['/i', file, '/passive', '/norestart'], { runner });
    if (code !== 0 && code !== 3010) throw new Error(code === 1602 ? 'Installation annulée' : `Installation de ZeroTier échouée (code ${code})`);
  } finally {
    fs.rmSync(file, { force: true });
  }
  return true;
}

async function zerotierCommand(action, networkId, { runner, exists, env } = {}) {
  requireWindows();
  if (!NETWORK_ID.test(String(networkId || ''))) throw new Error('Identifiant de réseau ZeroTier invalide (16 caractères hexadécimaux)');
  const exe = findZerotier(exists, env);
  if (!exe) throw new Error("ZeroTier n'est pas installé");
  const { code } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', elevatedCommand(exe.file, [...exe.args, action, networkId])], { runner });
  if (code !== 0) throw new Error(code === 1223 ? 'Autorisation refusée' : `ZeroTier a répondu avec le code ${code}`);
  return true;
}

/** Network rules for ZeroTier Central: only the game's ports go through the VPN. */
function zerotierRules(ports = { tcp: 9600, udp: 9600, http: 8081 }) {
  return [
    '# LKS : seul Assetto Corsa passe par ce réseau',
    'drop not ethertype ipv4 and not ethertype arp;',
    `accept ipprotocol tcp and dport ${ports.tcp};`,
    `accept ipprotocol tcp and sport ${ports.tcp};`,
    `accept ipprotocol udp and dport ${ports.udp};`,
    `accept ipprotocol udp and sport ${ports.udp};`,
    `accept ipprotocol tcp and dport ${ports.http};`,
    `accept ipprotocol tcp and sport ${ports.http};`,
    'accept ipprotocol icmp4;',
    'accept ethertype arp;',
    'drop;',
  ].join('\n');
}

module.exports = { vpnStatus, installZerotier, zerotierCommand, zerotierRules, elevatedCommand, findZerotier, ZEROTIER_MSI, RADMIN_PAGE, NETWORK_ID };
