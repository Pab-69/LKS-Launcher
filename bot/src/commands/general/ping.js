const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Vérifie que le bot répond'),
  async execute(interaction, client) {
    await interaction.reply(`🏓 Pong ! Latence : ${client.ws.ping} ms`);
  },
};
