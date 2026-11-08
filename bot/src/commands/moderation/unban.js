const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { logAction } = require('../../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannit un utilisateur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('id').setDescription('ID de l’utilisateur à débannir').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison').setMaxLength(400)),

  async execute(interaction) {
    const id = interaction.options.getString('id').trim();
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';

    const user = await interaction.guild.bans
      .remove(id, `${interaction.user.tag} : ${reason}`)
      .catch(() => null);
    if (!user) {
      return interaction.reply({
        embeds: [errorEmbed('Aucun ban trouvé pour cet ID.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({ embeds: [successEmbed(`**${user.tag}** a été débanni.`)] });
    await logAction(interaction, { action: 'Unban', target: user, reason });
  },
};
