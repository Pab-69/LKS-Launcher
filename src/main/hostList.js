'use strict';

/**
 * Games hosted from the launcher, listed only in the launcher (onglet Serveurs),
 * never in the public Assetto Corsa lobby. Stored on the leaderboard's Supabase
 * project (docs/leaderboard.sql: lks_hosts, announce_host, remove_host).
 */

const crypto = require('crypto');

class HostList {
  constructor({ url, anonKey, fetchImpl }) {
    if (!/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(url || '') && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url || '')) throw new Error('Adresse Supabase invalide');
    if (!anonKey) throw new Error('Clé Supabase manquante');
    this.url = url.replace(/\/$/, '');
    this.key = anonKey;
    this.fetch = fetchImpl || fetch;
  }

  async request(path, init = {}) {
    const res = await this.fetch(`${this.url}${path}`, {
      ...init,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).message || text;
      } catch {
        /* raw */
      }
      if (res.status === 404) msg = 'liste des parties pas encore installée (relancer docs/leaderboard.sql dans Supabase)';
      throw new Error(`Liste des parties indisponible (${res.status}) : ${String(msg).slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  /** e = { id, secret, name, hostDriver, addresses: [{kind, address}], tcpPort, httpPort, hasPassword, track, layout, cars, slots } */
  announce(e) {
    return this.request('/rest/v1/rpc/announce_host', {
      method: 'POST',
      body: JSON.stringify({
        p_id: e.id,
        p_secret: e.secret,
        p_name: String(e.name || 'Partie LKS').slice(0, 60),
        p_host_driver: String(e.hostDriver || '').slice(0, 40),
        p_addresses: (e.addresses || []).slice(0, 8).map((a) => ({ kind: String(a.kind).slice(0, 16), address: String(a.address).slice(0, 64) })),
        p_tcp_port: e.tcpPort,
        p_http_port: e.httpPort,
        p_has_password: Boolean(e.hasPassword),
        p_track: e.track || '',
        p_layout: e.layout || '',
        p_cars: (e.cars || []).slice(0, 40),
        p_slots: e.slots || 0,
      }),
    });
  }

  remove(id, secret) {
    return this.request('/rest/v1/rpc/remove_host', { method: 'POST', body: JSON.stringify({ p_id: id, p_secret: secret }) });
  }

  async list() {
    const rows = await this.request('/rest/v1/lks_hosts_live?select=*&order=updated_at.desc&limit=50');
    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      hostDriver: r.host_driver,
      addresses: Array.isArray(r.addresses) ? r.addresses.filter((a) => a && a.address) : [],
      tcpPort: r.tcp_port,
      httpPort: r.http_port,
      hasPassword: r.has_password,
      track: r.track,
      layout: r.layout,
      cars: r.cars || [],
      slots: r.slots,
      updatedAt: r.updated_at,
    }));
  }
}

const newHostId = () => ({ id: crypto.randomBytes(9).toString('hex'), secret: crypto.randomBytes(24).toString('hex') });

/** Of the addresses a host announced, the one that answers here (lowest ping). */
async function bestAddress(entry, probe) {
  const tries = await Promise.all((entry.addresses || []).map(async (a) => ({ a, info: await probe({ ip: a.address, httpPort: entry.httpPort, name: entry.name }) })));
  const ok = tries.filter((t) => t.info.online).sort((x, y) => x.info.ping - y.info.ping);
  return ok[0] || null;
}

module.exports = { HostList, newHostId, bestAddress };
