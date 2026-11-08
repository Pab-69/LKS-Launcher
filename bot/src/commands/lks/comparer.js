const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel } = require('../../lks/manifest');
const { query, LAP_COLUMNS } = require('../../lks/supabase');
const { trackChoices, driverChoices, respond, parseTrack } = require('../../lks/autocomplete');
const { fmtScore, ts, truncate, CATEGORY_MODE, CATEGORY_LABEL } = require('../../lks/format');

/** Meilleur record d'un pilote sur un circuit, version du parcours la plus récente d'abord. */
async function best(pilot, target, kind, mode) {
  const rows = (
    await query(
      'lks_laps',
      [
        ['select', LAP_COLUMNS],
        ['driver', `ilike.${String(pilot).replace(/[*%,()]/g, '').trim()}`],
        ['track', `eq.${target.track}`],
        ['kind', `eq.${kind}`],
        ['rules', `like.*-${mode}`],
        ['order', 'score.desc'],
        ['limit', '50'],
      ],
      { ttlMs: 60 * 1000 },
    )
  ).filter((r) => (r.layout ?? '') === (target.layout ?? '') && !r.rules.includes('@'));
  return rows;
}

const diff = (a, b) => {
  if (a == null || b == null) return '';
  const d = Number(a) - Number(b);
  return d === 0 ? ' (=)' : ` (${d > 0 ? '+' : ''}${d.toFixed(1)})`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('comparer')
    .setDescription('Face-à-face de deux pilotes sur un circuit : notes, clips et zones')
    .addStringOption((o) => o.setName('pilote1').setDescription('Premier pilote').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('pilote2').setDescription('Second pilote').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('circuit').setDescription('Circuit').setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o
        .setName('categorie')
        .setDescription('Notation (Amateur par défaut)')
        .addChoices({ name: 'Débutant', value: 'debutant' }, { name: 'Amateur', value: 'amateur' }, { name: 'Pro', value: 'pro' }),
    )
    .addStringOption((o) =>
      o.setName('type').setDescription('Drift (par défaut) ou tandem').addChoices({ name: 'Drift', value: 'drift' }, { name: 'Tandem', value: 'tandem' }),
    ),

  autocomplete: (interaction) => respond(interaction, { pilote1: driverChoices, pilote2: driverChoices, circuit: trackChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const target = await parseTrack(interaction.options.getString('circuit'));
    if (!target) return interaction.editReply({ embeds: [errorEmbed('Circuit introuvable.')] });
    const names = [interaction.options.getString('pilote1'), interaction.options.getString('pilote2')];
    const kind = interaction.options.getString('type') ?? 'drift';
    const category = interaction.options.getString('categorie') ?? 'amateur';
    const [ra, rb] = await Promise.all(names.map((n) => best(n, target, kind, CATEGORY_MODE[category])));
    if (!ra.length || !rb.length) {
      const who = !ra.length ? names[0] : names[1];
      return interaction.editReply({ embeds: [errorEmbed(`Pas de record de **${who}** sur ce circuit (notation ${CATEGORY_LABEL[category]}).`)] });
    }
    // même version du parcours si possible : sinon on le signale
    const common = ra.find((x) => rb.some((y) => y.rules === x.rules));
    const a = common ?? ra[0];
    const b = common ? rb.find((y) => y.rules === common.rules) : rb[0];
    const da = a.meta?.drift ?? a.meta?.tandem ?? {};
    const db = b.meta?.drift ?? b.meta?.tandem ?? {};
    const [na, nb] = [a.driver, b.driver];
    const lead = Number(a.score) === Number(b.score) ? 'Égalité parfaite !' : `**${Number(a.score) > Number(b.score) ? na : nb}** devant de ${Math.abs(a.score - b.score).toFixed(1)} point(s)`;

    const embed = brandEmbed()
      .setTitle(`🆚 ${na} vs ${nb}`)
      .setDescription(`${trackLabel(m, target.track, target.layout)} · ${kind === 'tandem' ? 'Tandem' : 'Drift'} · notation ${CATEGORY_LABEL[category]}\n${lead}${common ? '' : '\n-# ⚠️ Records faits sur deux versions différentes du parcours.'}`)
      .addFields(
        { name: na, value: `**${fmtScore(a.score)}**/100\n${carName(m, a.car)}\n${ts(a.created_at, 'R')}`, inline: true },
        { name: nb, value: `**${fmtScore(b.score)}**/100\n${carName(m, b.car)}\n${ts(b.created_at, 'R')}`, inline: true },
      );
    const parts = kind === 'tandem' ? [['Proximité', 'proximity'], ['Angle copié', 'angleMatch'], ['Ligne', 'line']] : [['Angle', 'angle'], ['Vitesse', 'speed'], ['Ligne et clips', 'line']];
    embed.addFields({ name: 'Détail', value: parts.map(([label, k]) => `${label} : **${fmtScore(da[k])}** vs **${fmtScore(db[k])}**${diff(da[k], db[k])}`).join('\n') });
    if ((da.penalty || 0) + (db.penalty || 0) > 0) embed.addFields({ name: 'Pénalités', value: `−${da.penalty || 0} vs −${db.penalty || 0}` });

    // clips et zones, clip par clip
    const clipsA = da.clips ?? [];
    const clipsB = db.clips ?? [];
    if (clipsA.length || clipsB.length) {
      const zonesA = Object.fromEntries((da.zones ?? []).map((z) => [z.name, z.score]));
      const zonesB = Object.fromEntries((db.zones ?? []).map((z) => [z.name, z.score]));
      const namesC = [...new Set([...clipsA.map((c) => c.name), ...clipsB.map((c) => c.name)])];
      const lines = namesC.map((n) => {
        const ca = clipsA.find((c) => c.name === n);
        const cb = clipsB.find((c) => c.name === n);
        const z = zonesA[n] != null || zonesB[n] != null ? ` · zone ${fmtScore(zonesA[n])} vs ${fmtScore(zonesB[n])}` : '';
        return `${ca?.hit ? '✅' : '❌'} ${n} ${cb?.hit ? '✅' : '❌'}${z}`;
      });
      embed.addFields({ name: `Clips (${na} · ${nb})`, value: truncate(lines.join('\n'), 1024) });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
