const { Events, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');

/**
 * Aiguille chaque interaction :
 * - commandes slash  -> src/commands (et leur autocomplete)
 * - boutons / modals -> src/components (customId de la forme "nom" ou "nom:argument")
 */
module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction).catch(() => {});
      return;
    }

    let handler;
    if (interaction.isChatInputCommand()) {
      handler = client.commands.get(interaction.commandName);
    } else if (interaction.isButton() || interaction.isModalSubmit()) {
      handler = client.components.get(interaction.customId.split(':')[0]);
    }
    if (!handler) return;

    try {
      await handler.execute(interaction, client);
    } catch (err) {
      console.error(`[interaction] erreur sur ${interaction.commandName ?? interaction.customId}`, err);
      const message = err.userMessage ?? 'Une erreur est survenue.';
      const reply = { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral };
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: reply.embeds }).catch(() => {});
      else if (interaction.replied) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  },
};
