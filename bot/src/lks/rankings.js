/** Classements, battles (avec décision du juge) et championnats. */
const { query, categories, LAP_COLUMNS } = require('./supabase');

const sameLayout = (a, b) => (a ?? '') === (b ?? '');
const byDate = (row) => new Date(row.created_at).getTime();

/** Garde la meilleure ligne de chaque pilote (lignes déjà triées du meilleur au moins bon). */
function bestPerDriver(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = r.driver.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Classement « actuel » d'un circuit, comme dans le launcher et sur le site.
 * kind : drift | tandem ; mode : debutant | normal | pro (notation Débutant / Amateur / Pro).
 * Version du parcours la plus récente ; les pilotes qui n'ont qu'un record d'une
 * ancienne version restent, après les autres, marqués `old`.
 * onlyCategory : garder seulement les pilotes de cette catégorie (debutant | amateur | pro).
 */
async function leaderboard({ track, layout, kind = 'drift', mode = 'normal', car, limit = 10, onlyCategory = null }) {
  const params = [
    ['select', 'id,driver,car,track,layout,kind,rules,score,created_at'],
    ['track', `eq.${track}`],
    ['kind', `eq.${kind}`],
    ['rules', `like.*-${mode}`],
    ['order', 'score.desc'],
    ['limit', '1000'],
  ];
  if (car) params.push(['car', `eq.${car}`]);
  let rows = (await query('lks_laps', params, { ttlMs: 90 * 1000 }))
    .filter((r) => sameLayout(r.layout, layout) && r.rules && !r.rules.includes('@'));
  const latest = rows.reduce((best, r) => (!best || byDate(r) > byDate(best) ? r : best), null);
  const rules = latest?.rules ?? null;
  const current = bestPerDriver(rows.filter((r) => r.rules === rules));
  const have = new Set(current.map((r) => r.driver.toLowerCase()));
  const older = bestPerDriver(rows.filter((r) => r.rules !== rules && !have.has(r.driver.toLowerCase()))).map((r) => ({ ...r, old: true }));
  let list = [...current, ...older];
  const catOf = await categories();
  list = list.map((r) => ({ ...r, category: catOf(r.driver).category }));
  if (onlyCategory) list = list.filter((r) => r.category === onlyCategory);
  return { rows: list.slice(0, limit), rules };
}

// ---------- Battles ----------

const pairKey = (names) => names.map((n) => String(n).trim().toLowerCase()).sort().join('|');

function battleNames(row) {
  const b = row.meta?.battle ?? {};
  const fromResult = (b.result?.drivers ?? []).map((d) => d.name).filter(Boolean);
  if (fromResult.length >= 2) return fromResult;
  if (Array.isArray(b.pair)) return b.pair.map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
  if (typeof b.pair === 'string') return b.pair.split('|');
  return String(row.driver ?? '').split(/\s+vs\s+/i);
}

/** Décision du juge : même paire, même circuit/tracé, date à ± 5 min. La plus récente gagne. */
function findJudging(m, row, names, date) {
  const key = pairKey(names);
  const t = new Date(date).getTime();
  return (
    (m.judging ?? [])
      .filter(
        (j) =>
          pairKey(String(j.pair ?? '').split('|')) === key &&
          j.track === row.track &&
          sameLayout(j.layout, row.layout) &&
          Math.abs(new Date(j.date).getTime() - t) <= 5 * 60 * 1000,
      )
      .sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))[0] ?? null
  );
}

/** Résultat final d'une battle : { names, totals, winner, omt, judged, note, date }. */
function resolveBattle(m, row) {
  const b = row.meta?.battle ?? {};
  const names = battleNames(row);
  const date = b.date ?? row.created_at;
  const totals = Object.fromEntries((b.result?.drivers ?? []).map((d) => [d.name, d.total]));
  const judge = findJudging(m, row, names, date);
  const source = judge ?? b.result ?? {};
  return {
    row,
    names,
    totals,
    date,
    winner: source.omt ? null : source.winner ?? null,
    omt: Boolean(source.omt),
    judged: Boolean(judge),
    note: judge?.note ?? '',
    by: judge?.by ?? '',
  };
}

async function recentBattles(m, { track, since, limit = 10 } = {}) {
  const params = [
    ['select', LAP_COLUMNS],
    ['kind', 'eq.battle'],
    ['order', 'created_at.desc'],
    ['limit', String(limit)],
  ];
  if (track) params.push(['track', `eq.${track}`]);
  if (since) params.push(['created_at', `gte.${since}`]);
  const rows = await query('lks_laps', params, { ttlMs: 60 * 1000 });
  return rows.map((r) => resolveBattle(m, r));
}

// ---------- Championnats ----------

const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

function roundStatus(round, now = Date.now()) {
  if (round.start && now < new Date(round.start).getTime()) return 'upcoming';
  if (round.end && now > new Date(round.end).getTime()) return 'done';
  return 'live';
}

async function roundRows(round, kind) {
  const rows = await query(
    'lks_laps',
    [
      ['select', LAP_COLUMNS],
      ['kind', `eq.${kind}`],
      ['track', `eq.${round.track}`],
      ['rules', `like.*@${round.id}`],
      ['order', kind === 'battle' ? 'created_at.asc' : 'score.desc'],
      ['limit', '1000'],
    ],
    { ttlMs: 2 * 60 * 1000 },
  );
  return rows.filter((r) => sameLayout(r.layout, round.layout));
}

/** Classement d'une manche : liste ordonnée de noms de pilotes. */
async function roundRanking(m, round) {
  if (round.kind !== 'battle') {
    return bestPerDriver(await roundRows(round, round.kind)).map((r) => ({ driver: r.driver, score: r.score }));
  }

  // Manche battle : qualifs en drift, puis le tableau (top N) se joue en battles.
  const qualifs = bestPerDriver(await roundRows(round, 'drift'));
  const battles = (await roundRows(round, 'battle')).map((r) => resolveBattle(m, r));
  const size = Number(round.bracket?.size ?? round.bracket) || 8;

  const qualifRank = new Map(qualifs.map((q, i) => [q.driver.toLowerCase(), i]));
  const wins = new Map();
  const inBracket = new Map(); // nom en minuscules -> nom affiché
  qualifs.slice(0, size).forEach((q) => inBracket.set(q.driver.toLowerCase(), q.driver));
  for (const b of battles) {
    b.names.forEach((n) => inBracket.set(n.toLowerCase(), inBracket.get(n.toLowerCase()) ?? n));
    if (b.winner) wins.set(b.winner.toLowerCase(), (wins.get(b.winner.toLowerCase()) ?? 0) + 1);
  }

  // Élimination directe : plus de battles gagnées = plus loin dans le tableau ; égalité -> place en qualif.
  const bracket = [...inBracket.keys()].sort(
    (a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0) || (qualifRank.get(a) ?? 999) - (qualifRank.get(b) ?? 999),
  );
  const rest = qualifs.filter((q) => !inBracket.has(q.driver.toLowerCase()));
  return [
    ...bracket.map((k) => ({ driver: inBracket.get(k), wins: wins.get(k) ?? 0 })),
    ...rest.map((q) => ({ driver: q.driver, score: q.score })),
  ];
}

/** Classement général : somme des points ; égalité -> victoires, puis podiums. */
async function championshipStandings(m, champ) {
  const points = champ.points?.length ? champ.points : DEFAULT_POINTS;
  const rounds = champ.rounds ?? [];
  const table = new Map();
  const results = [];

  for (const round of rounds) {
    const status = roundStatus(round);
    const ranking = status === 'upcoming' ? [] : await roundRanking(m, round);
    results.push({ round, status, ranking });
    ranking.forEach((r, i) => {
      const key = r.driver.toLowerCase();
      const entry = table.get(key) ?? { driver: r.driver, points: 0, wins: 0, podiums: 0 };
      entry.points += points[i] ?? 0;
      if (i === 0) entry.wins += 1;
      if (i < 3) entry.podiums += 1;
      table.set(key, entry);
    });
  }

  const standings = [...table.values()].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums,
  );
  return { standings, results };
}

module.exports = {
  leaderboard,
  bestPerDriver,
  resolveBattle,
  recentBattles,
  roundStatus,
  roundRanking,
  championshipStandings,
};
