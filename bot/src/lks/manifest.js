/** Source 1 : le manifeste public (GitHub). Relu au plus toutes les 5 minutes. */
const config = require('../../config.json');
const { fetchJson } = require('./http');

const TTL_MS = 5 * 60 * 1000;
let current = null;
let fetchedAt = 0;
let pending = null;

async function getManifest() {
  if (current && Date.now() - fetchedAt < TTL_MS) return current;
  if (pending) return pending;
  pending = fetchJson(config.lks.manifestUrl, { timeoutMs: 15000 })
    .then((m) => {
      current = m;
      fetchedAt = Date.now();
      return m;
    })
    .catch((err) => {
      if (!current) throw err;
      console.warn('[manifeste] lecture impossible, on garde l’ancienne version :', err.message);
      fetchedAt = Date.now() - TTL_MS + 60 * 1000; // on réessaie dans 1 minute
      return current;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

// ---------- Noms à afficher ----------

function findCar(m, id) {
  return (m.cars ?? []).find((c) => c.id === id);
}

function findTrack(m, id) {
  return (m.tracks ?? []).find((t) => t.id === id);
}

function carName(m, id) {
  if (!id) return '?';
  return findCar(m, id)?.name ?? id;
}

/** Nom du circuit + tracé. Si le tracé commence par le nom du circuit, on n'affiche que le tracé. */
function trackLabel(m, trackId, layoutId) {
  if (!trackId) return '?';
  const track = findTrack(m, trackId);
  if (!track) return layoutId ? `${trackId} (${layoutId})` : trackId;
  const layout = (track.layouts ?? []).find((l) => (l.id ?? '') === (layoutId ?? ''));
  if (!layout?.name) return track.name;
  if (layout.name.startsWith(track.name)) return layout.name;
  return `${track.name} — ${layout.name}`;
}

/** Retrouve le circuit dans l'état renvoyé par un serveur AC (/INFO "track" = "circuit" ou "circuit-tracé"). */
function acTrackLabel(m, acTrack) {
  if (!acTrack) return '?';
  const track = (m.tracks ?? []).find((t) => acTrack === t.id || acTrack.startsWith(`${t.id}-`));
  if (!track) return acTrack;
  const layoutId = acTrack.length > track.id.length ? acTrack.slice(track.id.length + 1) : track.layouts?.[0]?.id;
  return trackLabel(m, track.id, layoutId ?? '');
}

// ---------- Soirées ----------

const LIVE_BEFORE_MS = 30 * 60 * 1000;

function eventTimes(event) {
  const start = new Date(event.date).getTime();
  const end = start + (Number(event.durationMinutes) || 120) * 60 * 1000;
  return { start, end };
}

/** Soirée « en cours » : de 30 min avant le début jusqu'à la fin. */
function isEventLive(event, now = Date.now()) {
  const { start, end } = eventTimes(event);
  return now >= start - LIVE_BEFORE_MS && now <= end;
}

function sortedEvents(m) {
  return [...(m.events ?? [])].filter((e) => e.date).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function liveEvent(m, now = Date.now()) {
  return sortedEvents(m).find((e) => isEventLive(e, now)) ?? null;
}

/** Soirée en cours, sinon la prochaine. */
function nextEvent(m, now = Date.now()) {
  return sortedEvents(m).find((e) => eventTimes(e).end >= now) ?? null;
}

/** Le champ server d'une soirée peut être un nom, un objet ou vide. */
function eventServer(m, event) {
  const s = event.server;
  if (!s) return null;
  if (typeof s === 'object') return s;
  return (m.servers ?? []).find((srv) => srv.name === s || srv.ip === s) ?? { name: s };
}

module.exports = {
  getManifest,
  findCar,
  findTrack,
  carName,
  trackLabel,
  acTrackLabel,
  eventTimes,
  isEventLive,
  liveEvent,
  nextEvent,
  sortedEvents,
  eventServer,
};
