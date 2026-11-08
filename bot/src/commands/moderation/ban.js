const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { checkTarget, logAction, notifyUser } = require('../../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannit un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('membre').setDescription('Membre à bannir').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison du ban').setMaxLength(400))
    .addIntegerOption((o) =>
      o
        .setName('supprimer_messages')
        .setDescription('Supprimer ses messages des X derniers jours (0-7)')
        .setMinValue(0)
        .setMaxValue(7),
    ),

  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    const days = interaction.options.getInteger('supprimer_messages') ?? 0;

    const error = checkTarget(interaction, target);
    if (error) return interaction.reply({ embeds: [errorEmbed(error)], flags: MessageFlags.Ephemeral });

    await notifyUser(target.user, `🔨 Tu as été banni de **${interaction.guild.name}**.\nRaison : ${reason}`);
    await target.ban({ reason: `${interaction.user.tag} : ${reason}`, deleteMessageSeconds: days * 86400 });

    await interaction.reply({ embeds: [successEmbed(`**${target.user.tag}** a été banni. Raison : ${reason}`)] });
    await logAction(interaction, { action: 'Ban', target: target.user, reason });
  },
};
