/** Bonus : état d'un serveur Assetto Corsa via son port HTTP (GET /INFO). Cache 30 s. */
const { fetchJson, cached } = require('./http');

/** Renvoie le JSON /INFO, ou null si le serveur ne répond pas. */
function getAcInfo(ip, httpPort) {
  const port = httpPort || 8081;
  return cached(`ac:${ip}:${port}`, 30 * 1000, () =>
    fetchJson(`http://${ip}:${port}/INFO`, { timeoutMs: 4000 }).catch(() => null),
  );
}

module.exports = { getAcInfo };
