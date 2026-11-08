/**
 * Parcours drift d'un circuit : celui publié par les admins (manifeste), sinon le parcours officiel
 * livré avec le launcher (fichiers du dépôt, lus sur GitHub).
 */
const { getManifest } = require('./manifest');
const { fetchJson, cached } = require('./http');
const { Canvas } = require('./png');

const RAW = 'https://raw.githubusercontent.com/Pab-69/LKS-Launcher/main/src/main/telemetry/courses/';

async function courseOf(track, layout = '') {
  const m = await getManifest();
  const published = (m.drift ?? {})[`${track}|${layout}`];
  if (published) return { course: published, source: 'publié par les admins' };
  for (const file of layout ? [`${track}.${layout}.json`, `${track}.json`] : [`${track}.json`]) {
    try {
      const data = await cached(RAW + file, 60 * 60 * 1000, () => fetchJson(RAW + file, { timeoutMs: 10000 }));
      if (data?.course) return { course: data.course, source: `parcours officiel (${data.name})`, notes: data.notes };
    } catch {
      /* fichier suivant */
    }
  }
  return null;
}

const COLORS = { line: [63, 207, 134], inner: [90, 200, 255], outer: [255, 90, 255], staging: [236, 229, 218], start: [255, 230, 0], finish: [224, 27, 58] };

/** Image du parcours : ligne de référence, clips numérotés, start / début du drift / arrivée (z vers le bas, comme le jeu). */
function courseImage(course, size = 900) {
  const pts = [...(course.refLine ?? [])];
  for (const c of course.clips ?? []) pts.push([c.x, c.z], ...(c.path ?? []));
  for (const g of [course.staging, course.start, course.finish]) if (Array.isArray(g)) pts.push(...g);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]); const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const pad = 40;
  const k = Math.min((size - 2 * pad) / (x1 - x0 || 1), (size - 2 * pad) / (z1 - z0 || 1));
  const W = Math.round((x1 - x0) * k + 2 * pad); const H = Math.round((z1 - z0) * k + 2 * pad);
  const P = ([x, z]) => [pad + (x - x0) * k, pad + (z - z0) * k];
  const cv = new Canvas(W, H);
  const line = (course.refLine ?? []).map(P);
  cv.poly(line, [40, 40, 44], Math.max(10, 9 * k)); // la route, à peu près
  cv.poly(line, COLORS.line, 3);
  (course.clips ?? []).forEach((c, i) => {
    const col = COLORS[c.kind] ?? COLORS.inner;
    if (c.path?.length > 1) cv.poly(c.path.map(P), col, Math.max(4, (c.r || 1.5) * 2 * k), 0.6);
    const [cx, cy] = P([c.x, c.z]);
    cv.ring(cx, cy, Math.max(6, (c.r || 2) * k), col, 2);
    cv.text(cx + Math.max(9, (c.r || 2) * k) + 3, cy - 7, String(i + 1), col, 3);
  });
  for (const [g, col] of [[course.staging, COLORS.staging], [course.start, COLORS.start], [course.finish, COLORS.finish]]) {
    if (Array.isArray(g) && g.length === 2) cv.line(...P(g[0]), ...P(g[1]), col, 4);
  }
  return cv.png();
}

module.exports = { courseOf, courseImage };
