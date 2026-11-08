const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest, nextEvent, sortedEvents, eventTimes } = require('../../lks/manifest');
const { eventEmbed } = require('../../lks/views');
const { ts, truncate } = require('../../lks/format');
const S = require('../../lks/signups');

module.exports = {
  data: new SlashCommandBuilder().setName('soiree').setDescription('La prochaine soirée LKS (ou celle en cours)'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const event = nextEvent(m);
    if (!event) {
      return interaction.editReply({ embeds: [brandEmbed().setDescription('📅 Aucune soirée prévue pour le moment.')] });
    }

    const embeds = [eventEmbed(m, event)];
    const later = sortedEvents(m).filter((e) => e !== event && eventTimes(e).start > Date.now()).slice(0, 5);
    if (later.length) {
      embeds.push(
        brandEmbed()
          .setTitle('Ensuite')
          .setDescription(truncate(later.map((e) => `• **${e.title || 'Soirée LKS'}** — ${ts(e.date, 'f')}`).join('\n'), 4000)),
      );
    }
    await interaction.editReply({ embeds, components: [S.row(event)] });
  },
};
