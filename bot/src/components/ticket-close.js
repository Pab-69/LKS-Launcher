const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../../config.json');
const { brandEmbed, errorEmbed, sendLog } = require('../utils/embeds');
const { getTicketOwnerId } = require('../utils/tickets');

const DELETE_DELAY_MS = 5000;

module.exports = {
  customId: 'ticket-close',
  async execute(interaction) {
    const { channel, member, guild } = interaction;
    const ownerId = getTicketOwnerId(channel);
    if (!ownerId) {
      return interaction.reply({ embeds: [errorEmbed('Ce salon n’est pas un ticket.')], flags: MessageFlags.Ephemeral });
    }

    const { staffRoleId, logChannelId } = config.tickets;
    const isStaff =
      member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      (staffRoleId && member.roles.cache.has(staffRoleId));
    if (member.id !== ownerId && !isStaff) {
      return interaction.reply({
        embeds: [errorEmbed('Seul l’auteur du ticket ou le staff peut le fermer.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({ content: `🔒 Ticket fermé par ${member}. Suppression dans ${DELETE_DELAY_MS / 1000} secondes…` });

    await sendLog(
      guild,
      logChannelId,
      brandEmbed()
        .setTitle('🔒 Ticket fermé')
        .setDescription(`**${channel.name}** (de <@${ownerId}>) fermé par ${member}`),
    );

    setTimeout(() => channel.delete('Ticket fermé').catch(console.error), DELETE_DELAY_MS);
  },
};
