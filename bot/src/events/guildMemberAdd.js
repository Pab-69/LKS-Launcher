const { Events } = require('discord.js');
const config = require('../../config.json');
const { brandEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const { channelId, autoRoleId, message } = config.welcome;

    // Rôle automatique
    if (autoRoleId) {
      await member.roles.add(autoRoleId).catch((err) =>
        console.error(`[bienvenue] impossible de donner le rôle à ${member.user.tag} :`, err.message),
      );
    }

    // Message de bienvenue
    if (!channelId) return;
    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const text = message
      .replaceAll('{user}', `${member}`)
      .replaceAll('{username}', member.user.username)
      .replaceAll('{count}', `${member.guild.memberCount}`);

    const embed = brandEmbed()
      .setTitle(`👋 Bienvenue ${member.user.username} !`)
      .setDescription(text)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }));

    await channel.send({ content: `${member}`, embeds: [embed] });
  },
};
