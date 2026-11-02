'use strict';

const http = require('http');

/** Raw HTTP GET (the AC server uses paths like "/JSON|<guid>" that URL parsers would escape). */
function rawGet(host, port, pathName, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request({ host, port, path: pathName, method: 'GET', timeout, headers: { Accept: 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve({ body: Buffer.concat(chunks).toString('utf8'), ping: Date.now() - started });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', reject);
    req.end();
  });
}

function parseJson(text) {
  return JSON.parse(String(text).replace(/^﻿/, ''));
}

/** Split "csp/2144/../ks_track" or "ks_track-layout" into { track, layout } using installed tracks. */
function resolveTrack(raw, installedTracks) {
  let value = String(raw || '');
  if (value.includes('/')) value = value.split('/').pop();
  const installed = installedTracks || [];
  const exact = installed.find((t) => t.id === value);
  if (exact) return { track: value, layout: exact.layouts.length === 1 ? exact.layouts[0].id : '' };
  for (let i = value.lastIndexOf('-'); i > 0; i = value.lastIndexOf('-', i - 1)) {
    const id = value.slice(0, i);
    const layout = value.slice(i + 1);
    const t = installed.find((x) => x.id === id);
    if (t && (t.layouts.some((l) => l.id === layout) || t.layouts.length === 0)) return { track: id, layout };
  }
  const dash = value.indexOf('-');
  return dash > 0 ? { track: value.slice(0, dash), layout: value.slice(dash + 1), guessed: true } : { track: value, layout: '', guessed: true };
}

async function getServerInfo(server) {
  try {
    const { body, ping } = await rawGet(server.ip, server.httpPort, '/INFO');
    const info = parseJson(body);
    return {
      online: true,
      ping,
      name: info.name || server.name,
      ip: server.ip,
      httpPort: info.cport || server.httpPort,
      tcpPort: info.tport || info.port,
      udpPort: info.port,
      clients: info.clients || 0,
      maxClients: info.maxclients || 0,
      track: info.track || '',
      cars: Array.isArray(info.cars) ? info.cars : [],
      session: info.session,
      sessionTypes: info.sessiontypes || [],
      durations: info.durations || [],
      timeLeft: info.timeleft,
      hasPassword: Boolean(info.pass),
      country: Array.isArray(info.country) ? info.country[0] : info.country,
    };
  } catch (err) {
    return { online: false, error: err.message, name: server.name, ip: server.ip, httpPort: server.httpPort };
  }
}

/** Entry list with availability: [{ model, skin, connected, driver }] */
async function getServerCars(server, steamId) {
  const { body } = await rawGet(server.ip, server.httpPort, `/JSON|${steamId || '0'}`);
  const data = parseJson(body);
  const cars = Array.isArray(data.Cars) ? data.Cars : [];
  return cars.map((c, index) => ({
    index,
    model: c.Model,
    skin: c.Skin,
    connected: Boolean(c.IsConnected),
    driver: c.DriverName || '',
    isMine: Boolean(c.IsRequestedGUID),
    isEntryList: c.IsEntryList !== false,
  }));
}

module.exports = { getServerInfo, getServerCars, resolveTrack, rawGet };
