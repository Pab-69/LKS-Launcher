const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { logAction } = require('../../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Retire le mute (timeout) d’un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('membre').setDescription('Membre à démuter').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison').setMaxLength(400)),

  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';

    if (!target?.isCommunicationDisabled()) {
      return interaction.reply({ embeds: [errorEmbed('Ce membre n’est pas muet.')], flags: MessageFlags.Ephemeral });
    }

    await target.timeout(null, `${interaction.user.tag} : ${reason}`);
    await interaction.reply({ embeds: [successEmbed(`**${target.user.tag}** n’est plus muet.`)] });
    await logAction(interaction, { action: 'Unmute', target: target.user, reason });
  },
};
