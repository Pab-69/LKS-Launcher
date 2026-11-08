const { ChannelType } = require('discord.js');

// Le propriétaire d'un ticket est stocké dans le sujet (topic) du salon.
const ownerTopic = (userId) => `ticket-owner:${userId}`;

function findOpenTicket(guild, userId) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.topic === ownerTopic(userId),
  );
}

function getTicketOwnerId(channel) {
  const match = channel.topic?.match(/^ticket-owner:(\d+)$/);
  return match ? match[1] : null;
}

module.exports = { ownerTopic, findOpenTicket, getTicketOwnerId };
