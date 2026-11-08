/** Récap de la semaine : meilleures notes, pilote le plus actif, nouveaux records, battles. */
const { brandEmbed } = require('../utils/embeds');
const { carName, trackLabel } = require('./manifest');
const { query, LAP_COLUMNS } = require('./supabase');
const { state } = require('./store');
const { recentBattles, bestPerDriver } = require('./rankings');
const { place, fmtScore, kindLabel, joinLines } = require('./format');

/** Moyennes de catégorie de tous les pilotes : nom (minuscules) -> { name, category, avg }. */
async function categorySnapshot() {
  try {
    const rows = await query('lks_categories_list', { select: 'name,category,avg,runs' }, { ttlMs: 60 * 1000 });
    return Object.fromEntries(rows.filter((r) => r.runs >= 3).map((r) => [String(r.name).trim().toLowerCase(), { name: r.name, category: r.category, avg: Number(r.avg) }]));
  } catch {
    return null; // serveur sans catégories
  }
}

const RANK = { debutant: 0, amateur: 1, pro: 2 };

/**
 * Pilote de la semaine : la plus grosse progression depuis le dernier récap
 * (une montée de catégorie compte d'abord, puis le gain de moyenne).
 */
function pilotOfTheWeek(before, now) {
  if (!before || !now) return null;
  const moves = Object.entries(now)
    .filter(([k]) => before[k])
    .map(([k, r]) => ({ ...r, up: (RANK[r.category] ?? 0) - (RANK[before[k].category] ?? 0), gain: r.category === before[k].category ? r.avg - before[k].avg : 0, from: before[k] }))
    .filter((x) => x.up > 0 || x.gain > 0.5)
    .sort((a, b) => b.up - a.up || b.gain - a.gain);
  return moves[0] ?? null;
}

async function buildWeeklyRecap(m) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [runs, laps, battles] = await Promise.all([
    query(
      'lks_runs_list',
      [
        ['select', 'driver,car,track,layout,kind,score,created_at'],
        ['created_at', `gte.${since}`],
        ['order', 'score.desc'],
        ['limit', '2000'],
      ],
      { ttlMs: 60 * 1000 },
    ),
    query(
      'lks_laps',
      [
        ['select', LAP_COLUMNS],
        ['created_at', `gte.${since}`],
        ['kind', 'in.(drift,tandem)'],
        ['order', 'created_at.desc'],
        ['limit', '500'],
      ],
      { ttlMs: 60 * 1000 },
    ),
    recentBattles(m, { since, limit: 50 }),
  ]);

  const embed = brandEmbed().setTitle('📊 Récap de la semaine LKS');

  if (!runs.length && !laps.length && !battles.length) {
    return embed.setDescription('Semaine calme… Personne n’a roulé ces 7 derniers jours. On se rattrape ce week-end ?');
  }

  const best = bestPerDriver(runs).slice(0, 5);
  if (best.length) {
    embed.addFields({
      name: '🏁 Meilleures notes',
      value: joinLines(
        best.map((r, i) => `${place(i)} **${r.driver}** — ${fmtScore(r.score)}/100 · ${trackLabel(m, r.track, r.layout)}`),
        1000,
      ),
    });
  }

  const week = pilotOfTheWeek(state.data.weekly, await categorySnapshot());
  if (week) {
    const label = { debutant: 'Débutant', amateur: 'Amateur', pro: 'Pro' };
    embed.addFields({
      name: '⭐ Pilote de la semaine',
      value: week.up > 0
        ? `**${week.name}** passe **${label[week.category]}** (moyenne ${fmtScore(week.avg)})`
        : `**${week.name}** : moyenne ${fmtScore(week.from.avg)} → **${fmtScore(week.avg)}** (+${week.gain.toFixed(1)}) en ${label[week.category]}`,
    });
  }

  if (runs.length) {
    const counts = new Map();
    for (const r of runs) counts.set(r.driver, (counts.get(r.driver) ?? 0) + 1);
    const [driver, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    embed.addFields(
      { name: '🔥 Pilote le plus actif', value: `**${driver}** avec ${n} runs`, inline: true },
      { name: '🚗 Runs cette semaine', value: `${runs.length} runs · ${counts.size} pilote${counts.size > 1 ? "s" : ""}`, inline: true },
    );
  }

  const records = laps.filter((r) => !r.rules?.includes('@'));
  if (records.length) {
    embed.addFields({
      name: `🆕 Nouveaux records (${records.length})`,
      value: joinLines(
        records
          .slice(0, 8)
          .map(
            (r) =>
              `• **${r.driver}** — ${fmtScore(r.score)}/100 en ${kindLabel(r.kind)} · ${trackLabel(m, r.track, r.layout)} (${carName(m, r.car)})`,
          ),
        1000,
      ),
    });
  }

  if (battles.length) {
    const wins = new Map();
    for (const b of battles) if (b.winner) wins.set(b.winner, (wins.get(b.winner) ?? 0) + 1);
    const top = [...wins].sort((a, b) => b[1] - a[1]).slice(0, 3);
    embed.addFields({
      name: `⚔️ Battles (${battles.length})`,
      value: top.length ? top.map(([n, w]) => `**${n}** : ${w} victoire(s)`).join('\n') : 'Pas encore de vainqueur désigné.',
    });
  }
  return embed;
}

module.exports = { buildWeeklyRecap, categorySnapshot, pilotOfTheWeek };
