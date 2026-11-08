const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

/** Embed aux couleurs de Lowkey Syndicate. */
function brandEmbed() {
  const embed = new EmbedBuilder()
    .setColor(config.brand.color)
    .setTimestamp()
    .setFooter({ text: config.brand.name, iconURL: config.brand.logoUrl || undefined });
  return embed;
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor('#EF4444').setDescription(`❌ ${message}`);
}

function successEmbed(message) {
  return new EmbedBuilder().setColor('#22C55E').setDescription(`✅ ${message}`);
}

/** Envoie un embed dans un salon de logs, sans planter si le salon n'est pas configuré. */
async function sendLog(guild, channelId, embed) {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(console.error);
}

module.exports = { brandEmbed, errorEmbed, successEmbed, sendLog };
