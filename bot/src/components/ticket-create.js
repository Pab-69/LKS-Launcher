const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const config = require('../../config.json');
const { brandEmbed, errorEmbed, successEmbed, sendLog } = require('../utils/embeds');
const { ownerTopic, findOpenTicket } = require('../utils/tickets');

// Envoi du formulaire -> création du salon privé
module.exports = {
  customId: 'ticket-create',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, user } = interaction;
    const { categoryId, staffRoleId, logChannelId } = config.tickets;

    const existing = findOpenTicket(guild, user.id);
    if (existing) {
      return interaction.editReply({ embeds: [errorEmbed(`Tu as déjà un ticket ouvert : ${existing}`)] });
    }

    const subject = interaction.fields.getTextInputValue('subject');
    const details = interaction.fields.getTextInputValue('details');

    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
    ];
    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow },
      { id: interaction.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] },
    ];
    if (staffRoleId) permissionOverwrites.push({ id: staffRoleId, allow });

    const safeName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || user.id;
    const channel = await guild.channels.create({
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,
      parent: categoryId || null,
      topic: ownerTopic(user.id),
      permissionOverwrites,
    });

    const embed = brandEmbed()
      .setTitle(`🎫 ${subject}`)
      .setDescription(details)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .addFields({ name: 'Info', value: 'Un membre du staff va te répondre au plus vite. Merci de patienter !' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket-close')
        .setLabel('Fermer le ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({
      content: `${user}${staffRoleId ? ` <@&${staffRoleId}>` : ''}`,
      embeds: [embed],
      components: [row],
    });

    await interaction.editReply({ embeds: [successEmbed(`Ton ticket a été créé : ${channel}`)] });

    await sendLog(
      guild,
      logChannelId,
      brandEmbed().setTitle('🎫 Ticket ouvert').setDescription(`${user} a ouvert ${channel}\n**Sujet :** ${subject}`),
    );
  },
};
