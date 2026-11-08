const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, trackLabel } = require('../../lks/manifest');
const { recentBattles } = require('../../lks/rankings');
const { trackChoices, respond, parseTrack } = require('../../lks/autocomplete');
const { ts, fmtScore, joinLines, truncate } = require('../../lks/format');

/** Une ligne de résultat de battle (décision du juge comprise). */
function battleLine(m, b) {
  const [a, c] = b.names;
  const score = (n) => (b.totals[n] != null ? ` (${fmtScore(b.totals[n])})` : '');
  const vs = `**${a ?? '?'}**${score(a)} vs **${c ?? '?'}**${score(c)}`;
  const result = b.omt ? '🔁 One more time' : b.winner ? `🏆 **${b.winner}**` : '⏳ en attente';
  const judge = b.judged ? `\n  ⚖️ Décision du juge${b.by ? ` (${b.by})` : ''}${b.note ? ` : ${truncate(b.note, 150)}` : ''}` : '';
  return `${vs} → ${result}\n  ${trackLabel(m, b.row.track, b.row.layout)} · ${ts(b.date, 'R')}${judge}`;
}

module.exports = {
  battleLine,
  data: new SlashCommandBuilder()
    .setName('battles')
    .setDescription('Derniers résultats de battle')
    .addStringOption((o) => o.setName('circuit').setDescription('Seulement ce circuit').setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { circuit: trackChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const value = interaction.options.getString('circuit');
    const target = value ? await parseTrack(value) : null;
    if (value && !target) return interaction.editReply({ embeds: [errorEmbed('Circuit introuvable.')] });

    let battles = await recentBattles(m, { track: target?.track, limit: 25 });
    if (target) battles = battles.filter((b) => (b.row.layout ?? '') === (target.layout ?? ''));
    battles = battles.slice(0, 10);

    const embed = brandEmbed().setTitle(`⚔️ Dernières battles${target ? ` — ${trackLabel(m, target.track, target.layout)}` : ''}`);
    embed.setDescription(battles.length ? joinLines(battles.map((b) => battleLine(m, b)), 4000) : 'Aucune battle pour le moment.');
    await interaction.editReply({ embeds: [embed] });
  },
};
