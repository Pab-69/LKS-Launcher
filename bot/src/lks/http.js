/** Petit utilitaire HTTP : JSON + délai max + cache mémoire. */

class LksError extends Error {
  /** userMessage : texte montré au membre sur Discord. */
  constructor(message, userMessage, status) {
    super(message);
    this.userMessage = userMessage;
    this.status = status;
  }
}

async function fetchJson(url, { headers, timeoutMs = 8000 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new LksError(`Réseau : ${url} (${err.message})`, 'Impossible de joindre le serveur de données, réessaie dans un instant.');
  }
  if (!res.ok) {
    throw new LksError(`HTTP ${res.status} sur ${url}`, `Le serveur de données a répondu une erreur (${res.status}).`, res.status);
  }
  return res.json();
}

const cache = new Map(); // clé -> { at, value }
const inflight = new Map(); // clé -> Promise

/** Renvoie la valeur en cache si elle a moins de ttlMs, sinon appelle fn(). */
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      cache.set(key, { at: Date.now(), value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Nettoyage du cache toutes les 10 minutes
setInterval(() => {
  const limit = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of cache) if (v.at < limit) cache.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { LksError, fetchJson, cached };
