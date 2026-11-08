const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { checkTarget, logAction, notifyUser } = require('../../utils/moderation');

const DURATIONS = [
  { name: '1 minute', value: 60 },
  { name: '5 minutes', value: 5 * 60 },
  { name: '10 minutes', value: 10 * 60 },
  { name: '1 heure', value: 60 * 60 },
  { name: '6 heures', value: 6 * 60 * 60 },
  { name: '1 jour', value: 24 * 60 * 60 },
  { name: '1 semaine', value: 7 * 24 * 60 * 60 },
  { name: '28 jours (max)', value: 28 * 24 * 60 * 60 },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Rend un membre muet temporairement (timeout)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('membre').setDescription('Membre à rendre muet').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('duree').setDescription('Durée du mute').setRequired(true).addChoices(...DURATIONS),
    )
    .addStringOption((o) => o.setName('raison').setDescription('Raison du mute').setMaxLength(400)),

  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    const seconds = interaction.options.getInteger('duree');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    const label = DURATIONS.find((d) => d.value === seconds)?.name ?? `${seconds}s`;

    const error = checkTarget(interaction, target);
    if (error) return interaction.reply({ embeds: [errorEmbed(error)], flags: MessageFlags.Ephemeral });
    if (!target.moderatable) {
      return interaction.reply({ embeds: [errorEmbed('Je ne peux pas rendre ce membre muet.')], flags: MessageFlags.Ephemeral });
    }

    await target.timeout(seconds * 1000, `${interaction.user.tag} : ${reason}`);
    await notifyUser(target.user, `🔇 Tu as été rendu muet sur **${interaction.guild.name}** pour ${label}.\nRaison : ${reason}`);

    await interaction.reply({ embeds: [successEmbed(`**${target.user.tag}** est muet pour ${label}. Raison : ${reason}`)] });
    await logAction(interaction, {
      action: 'Mute',
      target: target.user,
      reason,
      extra: { name: 'Durée', value: label, inline: true },
    });
  },
};
