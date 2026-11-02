'use strict';

/**
 * Invitation codes for privately hosted games:
 *   LKS-<base64url({ n: name, a: address, t: tcpPort, h: httpPort, p: password, k: network kind })>
 */

const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

function encodeInvite({ name, address, tcpPort, httpPort, password, kind }) {
  const data = { n: String(name || '').slice(0, 60), a: address, t: Number(tcpPort), h: Number(httpPort) };
  if (kind) data.k = String(kind);
  if (password) data.p = String(password);
  return `LKS-${Buffer.from(JSON.stringify(data)).toString('base64url')}`;
}

function decodeInvite(code) {
  const m = String(code || '').trim().match(/^LKS-([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('Code invalide : il doit commencer par « LKS- »');
  let d;
  try {
    d = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Code invalide ou incomplet');
  }
  const port = (v) => Number.isInteger(v) && v > 0 && v < 65536;
  if (!d || !HOST_RE.test(String(d.a || '')) || !port(d.t) || !port(d.h)) throw new Error('Code invalide');
  const kind = ['internet', 'lan', 'radmin', 'zerotier', 'tailscale', 'hamachi', 'other'].includes(d.k) ? d.k : '';
  return { name: String(d.n || 'Partie privée'), address: d.a, tcpPort: d.t, httpPort: d.h, password: d.p ? String(d.p) : '', kind };
}

module.exports = { encodeInvite, decodeInvite };
