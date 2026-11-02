'use strict';

/**
 * Minimal UPnP IGD client (no dependency): finds the home router, opens the
 * ports of the hosted server, reads the public IP, and closes everything when
 * the server stops. Works with most French boxes when UPnP is enabled.
 */

const dgram = require('dgram');
const http = require('http');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

function httpRequest(url, { method = 'GET', headers = {}, body = null, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const tag = (xml, name) => {
  const m = String(xml).match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`));
  return m ? m[1].trim() : null;
};

const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANIPConnection:2'];

/** IPv4 addresses of this PC's network cards (not loopback, not link-local). */
function localIPv4() {
  const out = [];
  for (const [name, list] of Object.entries(require('os').networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
  }
  return out;
}

/** Usual addresses of a box on a home network (asked directly when multicast gets lost). */
function likelyGateways(addresses) {
  const out = new Set();
  for (const ip of addresses) {
    const p = ip.split('.');
    if (!isPrivateIp(ip) || ip.startsWith('100.')) continue;
    out.add(`${p[0]}.${p[1]}.${p[2]}.1`);
    out.add(`${p[0]}.${p[1]}.${p[2]}.254`);
  }
  return [...out];
}

/**
 * SSDP search on every network card (VPN cards like ZeroTier or Radmin often
 * take the multicast traffic) plus a direct question to the usual box
 * addresses. Returns every LOCATION that answered, in order of arrival.
 */
function discoverAll({ address = SSDP_ADDR, port = SSDP_PORT, timeout = 2500, interfaces, unicast } = {}) {
  const ifaces = interfaces || localIPv4().map((i) => i.address);
  const direct = unicast || likelyGateways(ifaces);
  return new Promise((resolve) => {
    const found = [];
    const sockets = [];
    const onMessage = (msg) => {
      const loc = String(msg).match(/^location:\s*(.+)$/im);
      if (loc && !found.includes(loc[1].trim())) found.push(loc[1].trim());
    };
    const search = (st) => Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
    const open = (bindAddress) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);
      socket.on('message', onMessage);
      socket.on('error', () => {});
      socket.bind({ port: 0, address: bindAddress }, () => {
        try {
          if (bindAddress) socket.setMulticastInterface(bindAddress);
        } catch {
          /* card without multicast */
        }
        for (const st of SEARCH_TARGETS) {
          socket.send(search(st), port, address, () => {});
          if (bindAddress) for (const gw of direct) socket.send(search(st), port, gw, () => {});
        }
      });
    };
    if (ifaces.length) ifaces.forEach(open);
    else open(undefined);
    setTimeout(() => {
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          /* closed */
        }
      }
      resolve(found);
    }, timeout);
  });
}

/** SSDP search: LOCATION of the first gateway that answers (kept for compatibility). */
async function discover(opts = {}) {
  const found = await discoverAll(opts);
  if (!found.length) throw new Error('Aucune box compatible UPnP trouvée');
  return found[0];
}

/** Local IP used to reach the gateway (the "internal client" of the mapping). */
function localAddressFor(host) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.connect(1900, host, (err) => {
      if (err) {
        s.close();
        return reject(err);
      }
      const { address } = s.address();
      s.close();
      resolve(address);
    });
  });
}

class Gateway {
  constructor({ controlUrl, serviceType, localAddress, location }) {
    this.controlUrl = controlUrl;
    this.serviceType = serviceType;
    this.localAddress = localAddress;
    this.location = location || '';
  }

  async soap(action, args = {}) {
    const params = Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${this.serviceType}">${params}</u:${action}></s:Body></s:Envelope>`;
    const res = await httpRequest(this.controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${this.serviceType}#${action}"`, 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    if (res.status !== 200) {
      const code = tag(res.body, 'errorCode');
      const desc = tag(res.body, 'errorDescription');
      const err = new Error(`La box a refusé ${action}${code ? ` (${code}${desc ? ` ${desc}` : ''})` : ` (HTTP ${res.status})`}`);
      err.code = code;
      throw err;
    }
    return res.body;
  }

  async externalIp() {
    return tag(await this.soap('GetExternalIPAddress'), 'NewExternalIPAddress');
  }

  async map(port, protocol, description) {
    const args = (lease) => ({
      NewRemoteHost: '',
      NewExternalPort: port,
      NewProtocol: protocol,
      NewInternalPort: port,
      NewInternalClient: this.localAddress,
      NewEnabled: 1,
      NewPortMappingDescription: description,
      NewLeaseDuration: lease,
    });
    const tryAdd = async (lease) => {
      try {
        await this.soap('AddPortMapping', args(lease));
        return null;
      } catch (err) {
        return err;
      }
    };
    let err = await tryAdd(0);
    // some boxes only accept limited leases (725, or a generic refusal)
    if (err && ['725', '402', '501'].includes(err.code)) err = await tryAdd(86400);
    // port still open from a previous session or another PC: close it and retry
    if (err && err.code === '718') {
      await this.unmap(port, protocol).catch(() => {});
      err = await tryAdd(0);
      if (err && ['725', '402', '501'].includes(err.code)) err = await tryAdd(86400);
    }
    if (err) throw friendlyUpnpError(err, port, protocol);
  }

  unmap(port, protocol) {
    return this.soap('DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol });
  }
}

/** What a box refusal means, in plain words. */
function friendlyUpnpError(err, port, protocol) {
  const messages = {
    606: 'La box refuse que les programmes ouvrent ses ports (UPnP en lecture seule ou protégé). Active l’UPnP complet dans l’interface de ta box.',
    718: `Le port ${port} (${protocol}) est déjà ouvert vers un autre appareil. Change le port du serveur ou ferme cette redirection dans ta box.`,
    724: 'La box exige le même port à l’extérieur et à l’intérieur, mais refuse celui-ci. Change le port du serveur.',
    725: 'La box n’accepte que des ouvertures permanentes : ouvre les ports à la main dans ta box.',
    728: 'La box n’a plus de place pour de nouvelles redirections : supprimes-en dans son interface.',
    501: 'La box a refusé l’ouverture (erreur interne). Redémarre la box ou ouvre les ports à la main.',
  };
  const e = new Error(messages[err.code] || err.message);
  e.code = err.code;
  return e;
}

async function gatewayAt(location, opts = {}) {
  const desc = await httpRequest(location);
  let serviceType = null;
  let controlPath = null;
  for (const block of desc.body.split(/<service>/i).slice(1)) {
    const type = tag(block, 'serviceType');
    if (type && SERVICES.includes(type)) {
      serviceType = type;
      controlPath = tag(block, 'controlURL');
      if (type.includes('WANIP')) break;
    }
  }
  if (!serviceType || !controlPath) return null;
  const base = tag(desc.body, 'URLBase') || location;
  const controlUrl = new URL(controlPath, base).toString();
  const localAddress = opts.localAddress || (await localAddressFor(new URL(location).hostname));
  return new Gateway({ controlUrl, serviceType, localAddress, location });
}

/** The box: the first device that answered and really offers port opening. */
async function findGateway(opts = {}) {
  const locations = await discoverAll(opts);
  if (!locations.length) throw new Error('Aucune box compatible UPnP trouvée');
  for (const location of locations) {
    try {
      const gw = await gatewayAt(location, opts);
      if (gw) return gw;
    } catch {
      /* another device (TV, NAS…): try the next one */
    }
  }
  throw new Error("La box a répondu mais ne propose pas l'ouverture automatique des ports (UPnP IGD)");
}

/** Private, loopback or carrier-grade NAT address (not reachable from internet). */
function isPrivateIp(ip) {
  const p = String(ip || '').split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || p[0] === 0;
}

module.exports = { findGateway, discover, discoverAll, gatewayAt, likelyGateways, localIPv4, friendlyUpnpError, isPrivateIp, Gateway };
