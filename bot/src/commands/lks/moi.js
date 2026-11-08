const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel } = require('../../lks/manifest');
const { query, categories } = require('../../lks/supabase');
const { pilotRecords, lastRun, recordLine } = require('../../lks/pilot');
const { pilotOf } = require('../../lks/store');
const { ts, fmtScore, clipsLine, joinLines, categoryLabel } = require('../../lks/format');

const STATE = { launcher: '⚪ Dans le launcher', solo: '🔵 En solo', online: '🟢 En ligne', hosting: '🏠 Héberge une partie' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moi')
    .setDescription('Ta fiche pilote (ou celle d’un membre lié)')
    .addUserOption((o) => o.setName('membre').setDescription('Voir la fiche d’un autre membre')),

  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const pilot = pilotOf(user.id);
    if (!pilot) {
      const who = user.id === interaction.user.id ? 'Tu n’as' : `${user} n’a`;
      return interaction.reply({ embeds: [errorEmbed(`${who} pas encore lié de pilote. Utilise \`/lier\`.`)], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    const m = await getManifest();
    const [records, run, presence, catOf] = await Promise.all([
      pilotRecords(pilot, { exact: true }),
      lastRun(pilot, { exact: true }),
      query('lks_presence_live', { select: 'name,state,car,track,layout,server' }, { ttlMs: 30 * 1000 }).catch(() => []),
      categories(),
    ]);
    const cat = catOf(pilot);

    const embed = brandEmbed().setTitle(`🏎️ ${pilot}`).setThumbnail(user.displayAvatarURL());
    const here = presence.find((p) => p.name.toLowerCase() === pilot.toLowerCase());
    const status = here
      ? `${STATE[here.state] ?? here.state}${here.car ? ` · ${carName(m, here.car)}` : ''}${here.track ? ` · ${trackLabel(m, here.track, here.layout)}` : ''}`
      : '⚫ Hors ligne';
    embed.setDescription(`${user} · ${status}`);

    const drift = [...records].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    embed.addFields(
      { name: '🏷️ Catégorie', value: `${categoryLabel(cat.category)}${cat.runs >= 3 && cat.avg != null ? `\nmoyenne ${fmtScore(cat.avg)}` : ''}`, inline: true },
      { name: '📈 Records', value: `${records.length} au total`, inline: true },
      { name: '⭐ Meilleure note', value: drift[0] ? `${fmtScore(drift[0].score)}/100` : '—', inline: true },
    );
    if (drift.length) embed.addFields({ name: 'Top drift / tandem', value: joinLines(drift.slice(0, 5).map((r) => recordLine(m, r)), 1024) });
    if (run) {
      embed.addFields({
        name: 'Dernière run',
        value: `**${fmtScore(run.score)}**/100 · ${trackLabel(m, run.track, run.layout)} · ${ts(run.created_at, 'R')}\n${clipsLine(run.detail?.clips)}`,
      });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
