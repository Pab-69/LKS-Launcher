const { MessageFlags } = require('discord.js');
const { getManifest, sortedEvents } = require('../lks/manifest');
const S = require('../lks/signups');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  customId: 'soiree-join',
  async execute(interaction) {
    const key = interaction.customId.slice('soiree-join:'.length);
    const m = await getManifest();
    const event = sortedEvents(m).find((e) => S.keyOf(e) === key);
    if (!event) return interaction.reply({ embeds: [errorEmbed('Cette soirée n’existe plus (date changée ?).')], flags: MessageFlags.Ephemeral });
    const joined = S.toggle(key, interaction.user.id);
    // le compteur du bouton se met à jour sur le message
    await interaction.message.edit({ components: [S.row(event)] }).catch(() => {});
    await interaction.reply({
      embeds: [successEmbed(joined ? 'Inscrit ! Tu seras mentionné 1 h avant le début.' : 'Inscription annulée.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};
