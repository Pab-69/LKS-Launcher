const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest } = require('../../lks/manifest');
const { driverChoices, respond } = require('../../lks/autocomplete');
const { pilotRecords, recordLine, joinLines } = require('../../lks/pilot');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('Les meilleurs scores d’un pilote')
    .addStringOption((o) => o.setName('pilote').setDescription('Nom du pilote').setRequired(true).setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { pilote: driverChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const name = interaction.options.getString('pilote');
    const rows = await pilotRecords(name);

    if (!rows.length) {
      return interaction.editReply({ embeds: [brandEmbed().setDescription(`Aucun record trouvé pour « ${name} ».`)] });
    }

    // Plusieurs pilotes peuvent correspondre à la recherche : on les regroupe
    const byDriver = new Map();
    for (const r of rows) byDriver.set(r.driver, [...(byDriver.get(r.driver) ?? []), r]);

    const embeds = [...byDriver].slice(0, 3).map(([driver, list]) => {
      const sorted = list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return brandEmbed()
        .setTitle(`🏁 Records de ${driver}`)
        .setDescription(joinLines(sorted.map((r) => recordLine(m, r)), 3800));
    });
    await interaction.editReply({ embeds });
  },
};
