const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, trackLabel } = require('../../lks/manifest');
const { championshipStandings, roundStatus } = require('../../lks/rankings');
const { championshipChoices, respond } = require('../../lks/autocomplete');
const { place, ts, kindLabel, modeLabel, joinLines } = require('../../lks/format');

const STATUS = { upcoming: '⏳ À venir', live: '🔴 En cours', done: '✅ Terminée' };

/** Championnat par défaut : celui qui a une manche en cours ou à venir, sinon le dernier. */
function defaultChampionship(champs) {
  return champs.find((c) => (c.rounds ?? []).some((r) => roundStatus(r) !== 'done')) ?? champs[champs.length - 1];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('championnat')
    .setDescription('Classement général et prochaine manche')
    .addStringOption((o) => o.setName('nom').setDescription('Championnat').setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { nom: championshipChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const champs = m.championships ?? [];
    if (!champs.length) {
      return interaction.editReply({ embeds: [brandEmbed().setDescription('🏆 Aucun championnat pour le moment.')] });
    }

    const wanted = interaction.options.getString('nom');
    const champ = wanted
      ? champs.find((c) => c.id === wanted || (c.name ?? '').toLowerCase() === wanted.toLowerCase())
      : defaultChampionship(champs);
    if (!champ) return interaction.editReply({ embeds: [errorEmbed('Championnat introuvable.')] });

    const { standings, results } = await championshipStandings(m, champ);
    const embed = brandEmbed().setTitle(`🏆 ${champ.name || champ.id}`);

    const lines = standings
      .slice(0, 15)
      .map((s, i) => `${place(i)} **${s.driver}** — ${s.points} pts${s.wins ? ` · ${s.wins} 🏆` : ''}${s.podiums ? ` · ${s.podiums} podium(s)` : ''}`);
    embed.setDescription(lines.length ? joinLines(lines, 2500) : 'Pas encore de points marqués.');

    const next = results.find((r) => r.status !== 'done');
    if (next) {
      const r = next.round;
      embed.addFields({
        name: `Prochaine manche : ${r.name || r.id}`,
        value: [
          `${STATUS[next.status]} · ${kindLabel(r.kind)}${r.mode ? ` ${modeLabel(r.mode)}` : ''}`,
          `🏁 ${trackLabel(m, r.track, r.layout ?? '')}`,
          r.start ? `Du ${ts(r.start, 'f')} au ${r.end ? ts(r.end, 'f') : '?'}` : null,
          next.ranking.length ? `En tête : **${next.ranking[0].driver}**` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }

    const roundLines = results.map(
      ({ round: r, status, ranking }) =>
        `${STATUS[status].split(' ')[0]} **${r.name || r.id}** — ${trackLabel(m, r.track, r.layout ?? '')}${ranking[0] ? ` · 🥇 ${ranking[0].driver}` : ''}`,
    );
    if (roundLines.length) embed.addFields({ name: `Manches (${roundLines.length})`, value: joinLines(roundLines, 1000) });

    await interaction.editReply({ embeds: [embed] });
  },
};
