const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { errorEmbed } = require('../utils/embeds');
const { findOpenTicket } = require('../utils/tickets');

// Clic sur "Ouvrir un ticket" -> formulaire pour décrire le problème
module.exports = {
  customId: 'ticket-open',
  async execute(interaction) {
    const existing = findOpenTicket(interaction.guild, interaction.user.id);
    if (existing) {
      return interaction.reply({
        embeds: [errorEmbed(`Tu as déjà un ticket ouvert : ${existing}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('ticket-create')
      .setTitle('Ouvrir un ticket')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('subject')
            .setLabel('Sujet')
            .setPlaceholder('Ex : le launcher ne démarre pas')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('details')
            .setLabel('Décris ton problème')
            .setPlaceholder('Version du launcher, message d’erreur, ce que tu as déjà essayé…')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1500)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  },
};
