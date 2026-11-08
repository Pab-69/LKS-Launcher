const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { checkTarget, logAction, notifyUser } = require('../../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulse un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('membre').setDescription('Membre à expulser').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison de l’expulsion').setMaxLength(400)),

  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';

    const error = checkTarget(interaction, target);
    if (error) return interaction.reply({ embeds: [errorEmbed(error)], flags: MessageFlags.Ephemeral });

    await notifyUser(target.user, `👢 Tu as été expulsé de **${interaction.guild.name}**.\nRaison : ${reason}`);
    await target.kick(`${interaction.user.tag} : ${reason}`);

    await interaction.reply({ embeds: [successEmbed(`**${target.user.tag}** a été expulsé. Raison : ${reason}`)] });
    await logAction(interaction, { action: 'Kick', target: target.user, reason });
  },
};
