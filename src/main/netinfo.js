'use strict';

const os = require('os');

/**
 * Addresses friends can use to reach this PC, by network:
 * local network, and the free virtual LANs gamers use (Radmin VPN, ZeroTier,
 * Tailscale, Hamachi).
 */
function networkAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  const others = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      const ip = a.address;
      const n = name.toLowerCase();
      let kind = null;
      if (/radmin/.test(n) || /^26\./.test(ip)) kind = 'radmin';
      else if (/hamachi/.test(n) || /^25\./.test(ip)) kind = 'hamachi';
      else if (/zerotier/.test(n) || /^zt/.test(n)) kind = 'zerotier';
      else if (/tailscale/.test(n) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) kind = 'tailscale';
      else if (/vethernet|virtualbox|vmware|docker|wsl|hyper-v|vbox|loopback|br-|veth/.test(n)) continue;
      // VirtualBox host-only card (Windows names it « Ethernet N »): never the home network
      else if (/^192\.168\.56\./.test(ip)) continue;
      else if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) kind = 'lan';
      if (kind) out.push({ kind, address: ip, iface: name, label: LABELS[kind] });
      else others.push({ kind: 'other', address: ip, iface: name, label: LABELS.other });
    }
  }
  // nothing recognised (unusual network): still offer this PC's addresses
  if (!out.length) out.push(...others);
  const order = ['radmin', 'zerotier', 'tailscale', 'hamachi', 'lan', 'other'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

const LABELS = {
  lan: 'Même réseau (LAN)',
  radmin: 'Radmin VPN',
  zerotier: 'ZeroTier',
  tailscale: 'Tailscale',
  hamachi: 'Hamachi',
  internet: 'Internet (via la box)',
  other: 'Adresse de ce PC',
};

module.exports = { networkAddresses, LABELS };
