const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { driverChoices, respond } = require('../../lks/autocomplete');
const { links, discordIdOf } = require('../../lks/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lier')
    .setDescription('Lie ton compte Discord à ton nom de pilote LKS')
    .addStringOption((o) =>
      o.setName('pilote').setDescription('Ton nom dans le launcher').setRequired(true).setAutocomplete(true).setMaxLength(64),
    )
    .addUserOption((o) => o.setName('membre').setDescription('(Staff) lier un autre membre')),

  autocomplete: (interaction) => respond(interaction, { pilote: driverChoices }),

  async execute(interaction) {
    const pilot = interaction.options.getString('pilote').trim();
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);

    if (target.id !== interaction.user.id && !isStaff) {
      return interaction.reply({ embeds: [errorEmbed('Seul le staff peut lier un autre membre.')], flags: MessageFlags.Ephemeral });
    }
    const owner = discordIdOf(pilot);
    if (owner && owner !== target.id && !isStaff) {
      return interaction.reply({
        embeds: [errorEmbed(`Le pilote **${pilot}** est déjà lié à un autre membre. Demande au staff si c’est une erreur.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (owner && owner !== target.id) delete links.data[owner]; // le staff réattribue le pilote
    links.data[target.id] = { pilot, linkedAt: new Date().toISOString() };
    links.save();

    await interaction.reply({
      embeds: [successEmbed(`${target} est maintenant lié au pilote **${pilot}**. Utilise \`/moi\` pour voir ta fiche.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
