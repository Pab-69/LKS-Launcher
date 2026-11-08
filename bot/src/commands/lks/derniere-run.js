const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest } = require('../../lks/manifest');
const { driverChoices, respond } = require('../../lks/autocomplete');
const { lastRun, runEmbed } = require('../../lks/pilot');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('derniere-run')
    .setDescription('La dernière note d’un pilote, clip par clip')
    .addStringOption((o) => o.setName('pilote').setDescription('Nom du pilote').setRequired(true).setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { pilote: driverChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const name = interaction.options.getString('pilote');
    const run = await lastRun(name);
    if (!run) {
      return interaction.editReply({
        embeds: [brandEmbed().setDescription(`Aucune run trouvée pour « ${name} » ces 30 derniers jours.`)],
      });
    }
    await interaction.editReply({ embeds: [runEmbed(m, run)] });
  },
};
