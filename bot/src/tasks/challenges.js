/** Défis acceptés : dès que la battle entre les deux pilotes arrive sur le serveur, le résultat est posté. */
const { getManifest } = require('../lks/manifest');
const { recentBattles } = require('../lks/rankings');
const { state } = require('../lks/store');
const { getTextChannel } = require('../lks/discord');
const C = require('../lks/challenges');

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

module.exports = {
  name: 'défis (résultats)',
  intervalMs: 60 * 1000,
  async run(client) {
    const open = C.list().filter((c) => c.status === 'accepted');
    if (!open.length) return;
    const m = await getManifest();
    const since = new Date(Math.min(...open.map((c) => Date.parse(c.acceptedAt))) - 5 * 60 * 1000).toISOString();
    const battles = await recentBattles(m, { since, limit: 50 });
    for (const c of open) {
      const b = battles.find(
        (x) =>
          Date.parse(x.date) >= Date.parse(c.acceptedAt) - 5 * 60 * 1000 &&
          x.names.length === 2 &&
          c.pilots.every((p) => x.names.some((n) => same(n, p))) &&
          (!c.track || (x.row.track === c.track && (x.row.layout || '') === (c.layout || ''))),
      );
      if (!b) continue;
      const channel = await getTextChannel(client, c.channelId);
      if (channel) {
        await channel
          .send({ content: `<@${c.from}> <@${c.to}>`, embeds: [C.resultEmbed(m, c, b)], allowedMentions: { users: [c.from, c.to] }, reply: c.messageId ? { messageReference: c.messageId, failIfNotExists: false } : undefined })
          .catch((e) => console.error('[défis]', e.message));
      }
      c.status = 'done';
      state.save();
    }
  },
};
