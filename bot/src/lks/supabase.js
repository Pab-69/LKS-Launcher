/**
 * Source 2 : le serveur du groupe (ou un projet Supabase : même API), en lecture seule
 * avec la clé publique du manifeste. Ne jamais mettre de clé d'admin ici.
 */
const { getManifest } = require('./manifest');
const { fetchJson, cached, LksError } = require('./http');

const LAP_COLUMNS = 'id,driver,car,track,layout,kind,rules,lap_ms,score,meta,created_at';

/**
 * Lit une vue. params : objet ou liste de paires [clé, valeur] (syntaxe PostgREST).
 * Exemple : query('lks_laps', { kind: 'eq.drift', order: 'score.desc', limit: 10 })
 */
async function query(view, params = {}, { ttlMs = 60 * 1000 } = {}) {
  const m = await getManifest();
  const { url, anonKey } = m.leaderboard ?? {};
  if (!url || !anonKey) {
    throw new LksError('leaderboard absent du manifeste', 'Le classement n’est pas configuré (Publication → Classement).');
  }
  const pairs = Array.isArray(params) ? params : Object.entries(params);
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const full = `${url}/rest/v1/${view}${qs ? `?${qs}` : ''}`;

  return cached(full, ttlMs, async () => {
    try {
      return await fetchJson(full, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    } catch (err) {
      if (err.status === 404) {
        err.userMessage = `La vue « ${view} » est introuvable : relance le script SQL (Publication → Classement → Copier le script).`;
      }
      throw err;
    }
  });
}

/** Adresse publique d'un fichier (photo, proposition). */
async function publicFileUrl(bucket, file) {
  const m = await getManifest();
  return `${m.leaderboard.url}/storage/v1/object/public/${bucket}/${encodeURIComponent(file)}`;
}

/** Nettoie un nom saisi pour un filtre ilike. */
function likeValue(text) {
  return `*${String(text).replace(/[*%,()]/g, '').trim()}*`;
}

/**
 * Catégorie de chaque pilote (Débutant / Amateur / Pro), attribuée par le serveur selon ses notes.
 * Renvoie une fonction nom -> { category, avg, runs } ; Débutant par défaut (ou si le serveur n'est pas à jour).
 */
async function categories() {
  let rows = [];
  try {
    rows = await query('lks_categories_list', { select: '*' }, { ttlMs: 5 * 60 * 1000 });
  } catch {
    rows = [];
  }
  const map = new Map(rows.map((r) => [String(r.name).trim().toLowerCase(), r]));
  return (name) => map.get(String(name ?? '').trim().toLowerCase()) ?? { name, category: 'debutant', avg: null, runs: 0 };
}

module.exports = { query, publicFileUrl, likeValue, categories, LAP_COLUMNS };
