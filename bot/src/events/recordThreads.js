/**
 * Fils « Records » : chaque annonce postée par le launcher (webhook) dans le salon des records
 * ouvre un fil pour que les autres réagissent. Le bot ne poste pas les records lui-même (pas de doublon).
 */
const { Events, ThreadAutoArchiveDuration } = require('discord.js');
const config = require('../../config.json');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    const channelId = config.lks.channels.records;
    if (!channelId || message.channelId !== channelId || !message.webhookId || message.hasThread) return;
    const title = message.embeds?.[0]?.title || message.content || 'Nouveau record';
    const name = `💬 ${String(title).replace(/[*_`~|>]/g, '').slice(0, 90)}`;
    await message.startThread({ name, autoArchiveDuration: ThreadAutoArchiveDuration.OneDay }).catch((e) => console.error('[fils records]', e.message));
  },
};
