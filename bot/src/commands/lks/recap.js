const { SlashCommandBuilder } = require('discord.js');
const { getManifest } = require('../../lks/manifest');
const { buildWeeklyRecap } = require('../../lks/recap');

module.exports = {
  data: new SlashCommandBuilder().setName('recap').setDescription('Le récap des 7 derniers jours'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    await interaction.editReply({ embeds: [await buildWeeklyRecap(m)] });
  },
};
