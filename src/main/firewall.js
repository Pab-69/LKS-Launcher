'use strict';

/**
 * Windows firewall and the hosted server (acServer.exe).
 * Even with the box ports open, Windows blocks the players when:
 *  - « Annuler » was clicked on its prompt the first time: it then creates
 *    BLOCK rules for the program, which win over everything;
 *  - the server is only allowed on « Private » networks while this PC's
 *    network is « Public ».
 * status() reads the rules (no admin rights); fix() removes the block rules
 * and allows the server on every network (one Windows prompt).
 */

const { spawn } = require('child_process');

const RULE_NAME = 'LKS Launcher - serveur Assetto Corsa';
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

function run(command, args, { runner = spawn, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = runner(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      try {
        p.kill();
      } catch {
        /* gone */
      }
    }, timeout);
    if (p.stdout) p.stdout.on('data', (c) => (out += c));
    if (p.stderr) p.stderr.on('data', (c) => (out += c));
    p.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    p.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

// rules of this program (paths can be written with %ProgramFiles% & co)
const rulesOf = (exe) => `$p = ${psQuote(exe)}
$r = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $p } | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction.ToString() -eq 'Inbound' -and $_.Enabled.ToString() -eq 'True' }`;

function statusScript(exe) {
  return `${rulesOf(exe)}
$allow = @($r | Where-Object { $_.Action.ToString() -eq 'Allow' } | ForEach-Object { $_.Profile.ToString() })
$block = @($r | Where-Object { $_.Action.ToString() -eq 'Block' }).Count
$nets = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $_.NetworkCategory.ToString() })
[pscustomobject]@{ allow = $allow; block = $block; networks = $nets } | ConvertTo-Json -Compress`;
}

function fixScript(exe) {
  return `${rulesOf(exe)}
$r | Where-Object { $_.Action.ToString() -eq 'Block' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -Direction Inbound -Program $p -Action Allow -Profile Any | Out-Null`;
}

/** Profiles of a rule ("Any", "Private, Public"…) cover this network category? */
function covers(profiles, category) {
  const p = String(profiles).toLowerCase();
  if (p.includes('any')) return true;
  const c = String(category).toLowerCase();
  if (c.startsWith('domain')) return p.includes('domain');
  return p.includes(c);
}

/** Read the rules' answer: { ok, blocked, missingFor: [network categories] }. */
function evaluate(raw) {
  const data = JSON.parse(String(raw).trim().split(/\r?\n/).filter(Boolean).pop());
  const allow = [].concat(data.allow || []).filter(Boolean);
  const networks = [].concat(data.networks || []).filter(Boolean);
  const blocked = Number(data.block) > 0;
  const missingFor = (networks.length ? networks : ['Private']).filter((n) => !allow.some((a) => covers(a, n)));
  return { checked: true, ok: !blocked && missingFor.length === 0, blocked, missingFor, networks };
}

async function firewallStatus(exe, { runner, platform = process.platform } = {}) {
  if (platform !== 'win32' || !exe) return { checked: false };
  try {
    const { code, out } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(statusScript(exe))], { runner });
    if (code !== 0) return { checked: false, error: out.slice(0, 300) };
    return evaluate(out);
  } catch (err) {
    return { checked: false, error: err.message };
  }
}

/** Allow the server (removes the block rules). One Windows administrator prompt. */
async function fixFirewall(exe, { runner, platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('Disponible uniquement sous Windows');
  if (!exe) throw new Error('Serveur Assetto Corsa introuvable');
  const elevated = `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encode(fixScript(exe))}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  const { code } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', elevated], { runner, timeout: 120000 });
  if (code === 1223 || code === 1) throw new Error('Autorisation refusée');
  if (code !== 0) throw new Error(`Le pare-feu n'a pas pu être réglé (code ${code})`);
  return true;
}

module.exports = { firewallStatus, fixFirewall, evaluate, covers, statusScript, fixScript, RULE_NAME };
