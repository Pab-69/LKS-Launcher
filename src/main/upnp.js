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

/** SSDP search: returns the LOCATION of the first gateway that answers. */
function discover({ address = SSDP_ADDR, port = SSDP_PORT, timeout = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* closed */
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Aucune box compatible UPnP trouvée')), timeout);
    socket.on('message', (msg) => {
      const loc = String(msg).match(/^location:\s*(.+)$/im);
      if (loc) finish(null, loc[1].trim());
    });
    socket.on('error', (err) => finish(err));
    socket.bind(() => {
      const search = (st) =>
        Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
      for (const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1']) {
        socket.send(search(st), port, address);
      }
    });
  });
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
  constructor({ controlUrl, serviceType, localAddress }) {
    this.controlUrl = controlUrl;
    this.serviceType = serviceType;
    this.localAddress = localAddress;
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
    try {
      await this.soap('AddPortMapping', args(0));
    } catch (err) {
      // some boxes only accept limited leases
      if (err.code === '725' || err.code === '402') await this.soap('AddPortMapping', args(86400));
      else throw err;
    }
  }

  unmap(port, protocol) {
    return this.soap('DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol });
  }
}

async function findGateway(opts = {}) {
  const location = await discover(opts);
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
  if (!serviceType || !controlPath) throw new Error("La box ne propose pas l'ouverture automatique des ports");
  const base = tag(desc.body, 'URLBase') || location;
  const controlUrl = new URL(controlPath, base).toString();
  const localAddress = opts.localAddress || (await localAddressFor(new URL(location).hostname));
  return new Gateway({ controlUrl, serviceType, localAddress });
}

/** Private, loopback or carrier-grade NAT address (not reachable from internet). */
function isPrivateIp(ip) {
  const p = String(ip || '').split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || p[0] === 0;
}

module.exports = { findGateway, discover, isPrivateIp, Gateway };
