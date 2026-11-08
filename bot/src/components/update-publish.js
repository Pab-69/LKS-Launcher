const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../../config.json');
const { brandEmbed, errorEmbed, successEmbed } = require('../utils/embeds');

module.exports = {
  customId: 'update-publish',
  async execute(interaction) {
    const ping = interaction.customId.split(':')[1] === '1';
    const { channelId, pingRoleId } = config.updates;

    const channel = channelId
      ? await interaction.guild.channels.fetch(channelId).catch(() => null)
      : interaction.channel;
    if (!channel?.isTextBased()) {
      return interaction.reply({
        embeds: [errorEmbed('Le salon des mises à jour est introuvable. Vérifie "updates.channelId" dans config.json.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const version = interaction.fields.getTextInputValue('version').trim();
    const changes = interaction.fields
      .getTextInputValue('changes')
      .split('\n')
      .map((line) => line.trim().replace(/^[-*•]\s*/, ''))
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join('\n');
    const download = interaction.fields.getTextInputValue('download').trim();

    const embed = brandEmbed()
      .setTitle(`🚀 ${config.brand.name} — Mise à jour ${version}`)
      .setDescription(changes)
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() });

    const components = [];
    if (/^https?:\/\//i.test(download)) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Télécharger').setEmoji('⬇️').setStyle(ButtonStyle.Link).setURL(download),
        ),
      );
    }

    const message = await channel.send({
      content: ping && pingRoleId ? `<@&${pingRoleId}>` : undefined,
      embeds: [embed],
      components,
    });

    // Si c'est un salon d'annonces, on le publie aussi sur les serveurs abonnés
    if (message.crosspostable) await message.crosspost().catch(() => {});

    await interaction.reply({
      embeds: [successEmbed(`Mise à jour **${version}** publiée dans ${channel}.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
