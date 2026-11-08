const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { brandEmbed, successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Publie le panneau d’ouverture de tickets dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = brandEmbed()
      .setTitle('🎫 Support Lowkey Syndicate')
      .setDescription(
        [
          'Un problème avec le **launcher** ? Une question ?',
          '',
          'Clique sur le bouton ci-dessous pour ouvrir un ticket privé avec le staff.',
          '> Pense à indiquer ta version du launcher et ton système (Windows, etc.).',
        ].join('\n'),
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket-open')
        .setLabel('Ouvrir un ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ embeds: [successEmbed('Panneau de tickets publié.')], flags: MessageFlags.Ephemeral });
  },
};
