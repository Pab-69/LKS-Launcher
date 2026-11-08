const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { links } = require('../../lks/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delier')
    .setDescription('Retire le lien entre ton compte Discord et ton pilote')
    .addUserOption((o) => o.setName('membre').setDescription('(Staff) délier un autre membre')),

  async execute(interaction) {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    if (target.id !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Seul le staff peut délier un autre membre.')], flags: MessageFlags.Ephemeral });
    }
    if (!links.data[target.id]) {
      return interaction.reply({ embeds: [errorEmbed('Aucun pilote lié.')], flags: MessageFlags.Ephemeral });
    }
    const { pilot } = links.data[target.id];
    delete links.data[target.id];
    links.save();
    await interaction.reply({ embeds: [successEmbed(`${target} n’est plus lié à **${pilot}**.`)], flags: MessageFlags.Ephemeral });
  },
};
