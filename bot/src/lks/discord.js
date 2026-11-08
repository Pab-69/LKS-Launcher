/** Accès au serveur Discord LKS et à ses salons depuis les tâches automatiques. */

async function getGuild(client) {
  const id = process.env.GUILD_ID;
  if (!id) return null;
  return client.guilds.cache.get(id) ?? (await client.guilds.fetch(id).catch(() => null));
}

/** Renvoie le salon texte configuré, ou null s'il n'est pas configuré / introuvable. */
async function getTextChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

module.exports = { getGuild, getTextChannel };
