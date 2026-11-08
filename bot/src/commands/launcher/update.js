const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('Publie une mise à jour du launcher dans le salon des annonces')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) =>
      o.setName('ping').setDescription('Mentionner le rôle des notifications de mise à jour ? (oui par défaut)'),
    ),

  async execute(interaction) {
    const ping = interaction.options.getBoolean('ping') ?? true;

    const modal = new ModalBuilder()
      // le choix du ping est transmis au formulaire via le customId
      .setCustomId(`update-publish:${ping ? 1 : 0}`)
      .setTitle('Nouvelle mise à jour du launcher')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('version')
            .setLabel('Version')
            .setPlaceholder('Ex : 1.4.0')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(30)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('changes')
            .setLabel('Changements (un par ligne)')
            .setPlaceholder('Ajout du mode sombre\nCorrection du crash au démarrage\n…')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(3500)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('download')
            .setLabel('Lien de téléchargement (optionnel)')
            .setPlaceholder('https://…')
            .setStyle(TextInputStyle.Short)
            .setRequired(false),
        ),
      );

    await interaction.showModal(modal);
  },
};
