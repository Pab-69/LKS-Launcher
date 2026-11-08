/** Données d'un pilote : meilleurs scores et dernière run. */
const { brandEmbed } = require('../utils/embeds');
const { carName, trackLabel } = require('./manifest');
const { query, LAP_COLUMNS } = require('./supabase');
const { ts, fmtScore, kindLabel, modeLabel, modeFromRules, clipsLine, joinLines, truncate } = require('./format');

/** exact = true : nom exact (sans tenir compte des majuscules), sinon recherche partielle. */
function driverFilter(name, exact) {
  const clean = String(name).replace(/[*%,()]/g, '').trim();
  return exact ? `ilike.${clean}` : `ilike.*${clean}*`;
}

async function pilotRecords(name, { exact = false } = {}) {
  const rows = await query(
    'lks_laps',
    [
      ['select', LAP_COLUMNS],
      ['driver', driverFilter(name, exact)],
      ['kind', 'in.(drift,tandem)'],
      ['order', 'created_at.desc'],
      ['limit', '200'],
    ],
    { ttlMs: 60 * 1000 },
  );
  return rows.filter((r) => !r.rules?.includes('@')); // hors manches de championnat
}

async function lastRun(name, { exact = false } = {}) {
  const rows = await query(
    'lks_runs_list',
    [
      ['driver', driverFilter(name, exact)],
      ['order', 'created_at.desc'],
      ['limit', '1'],
    ],
    { ttlMs: 30 * 1000 },
  );
  return rows[0] ?? null;
}

function recordLine(m, r) {
  const value = `**${fmtScore(r.score)}**/100`;
  const mode = ` · notation ${modeLabel(modeFromRules(r.rules))}`;
  return `${value} — ${kindLabel(r.kind)}${mode}\n  ${trackLabel(m, r.track, r.layout)} · ${carName(m, r.car)} · ${ts(r.created_at, 'R')}`;
}

/** Fiche détaillée d'une run (note, clips, zones, pénalités). */
function runEmbed(m, run) {
  const d = run.detail ?? {};
  const clips = d.clips ?? [];
  const hit = clips.filter((c) => c.hit).length;
  const embed = brandEmbed()
    .setTitle(`${run.kind === 'tandem' ? '🤝' : '🏁'} ${run.driver} — ${fmtScore(run.score)}/100`)
    .setDescription(`${trackLabel(m, run.track, run.layout)}\n🚗 ${carName(m, run.car)} · ${ts(run.created_at, 'R')}`);

  const stats = [
    d.angle != null && `Angle : **${fmtScore(d.angle)}**`,
    d.speed != null && `Vitesse : **${fmtScore(d.speed)}**`,
    d.line != null && `Ligne : **${fmtScore(d.line)}**`,
    d.penalty ? `Pénalités : **-${d.penalty}**` : null,
    d.avgAngle != null && `Angle moyen : ${d.avgAngle}°`,
    d.avgSpeed != null && `Vitesse moyenne : ${d.avgSpeed} km/h`,
  ].filter(Boolean);
  if (stats.length) embed.addFields({ name: 'Note', value: stats.join('\n'), inline: true });

  if (run.kind === 'tandem') {
    const t = [
      d.lead && `Lead : **${typeof d.lead === 'object' ? d.lead.name ?? '?' : d.lead}**`,
      d.proximity != null && `Proximité : **${fmtScore(d.proximity)}**`,
      d.avgGap != null && `Écart moyen : ${d.avgGap} m`,
    ].filter(Boolean);
    if (t.length) embed.addFields({ name: 'Tandem', value: t.join('\n'), inline: true });
  }

  if (clips.length) {
    const lines = clips.map((c) => `${c.hit ? '✅' : '❌'} ${c.name}${c.cover != null ? ` (${c.cover} %)` : ''}`);
    embed.addFields({ name: `Clips ${hit}/${clips.length}  ${clipsLine(clips)}`, value: truncate(lines.join('\n'), 1024) });
  }
  if (d.zones?.length) {
    embed.addFields({ name: 'Zones', value: truncate(d.zones.map((z) => `${z.name} : **${fmtScore(z.score)}**`).join(' · '), 1024) });
  }
  if (d.penalties?.length) {
    const counts = {};
    for (const p of d.penalties) counts[p] = (counts[p] ?? 0) + 1;
    embed.addFields({ name: 'Pénalités', value: Object.entries(counts).map(([p, n]) => `${p}${n > 1 ? ` ×${n}` : ''}`).join(', ') });
  }
  if (d.zeroed) embed.addFields({ name: '⚠️ Run annulée', value: String(d.zeroed) });
  return embed;
}

module.exports = { pilotRecords, lastRun, recordLine, runEmbed, joinLines };
