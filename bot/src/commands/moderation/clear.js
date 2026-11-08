const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../../../config.json');
const { brandEmbed, successEmbed, sendLog } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprime des messages dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('nombre').setDescription('Nombre de messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre')),

  async execute(interaction) {
    const amount = interaction.options.getInteger('nombre');
    const user = interaction.options.getUser('membre');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let messages = await interaction.channel.messages.fetch({ limit: 100 });
    if (user) messages = messages.filter((m) => m.author.id === user.id);
    messages = [...messages.values()].slice(0, amount);

    // Discord ne permet pas la suppression groupée des messages de plus de 14 jours
    const deleted = await interaction.channel.bulkDelete(messages, true);

    await interaction.editReply({
      embeds: [successEmbed(`${deleted.size} message(s) supprimé(s)${user ? ` de ${user}` : ''}.`)],
    });

    await sendLog(
      interaction.guild,
      config.moderation.logChannelId,
      brandEmbed()
        .setTitle('🧹 Clear')
        .setDescription(`${interaction.user} a supprimé ${deleted.size} message(s) dans ${interaction.channel}${user ? ` (de ${user})` : ''}.`),
    );
  },
};
