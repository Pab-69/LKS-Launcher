/**
 * Tableau « en piste » pendant les soirées : un seul message, modifié toutes les ~12 s.
 * Source : lks_live_now. En dehors des soirées, la tâche ne fait rien.
 */
const config = require('../../config.json');
const { brandEmbed } = require('../utils/embeds');
const { getManifest, liveEvent, carName, trackLabel } = require('../lks/manifest');
const { query } = require('../lks/supabase');
const { state } = require('../lks/store');
const { getTextChannel } = require('../lks/discord');
const { progressBar, joinLines, fmtLap } = require('../lks/format');

function boardEmbed(m, event, rows) {
  const embed = brandEmbed().setTitle(`🔴 En piste — ${event.title || 'Soirée LKS'}`);
  if (!rows.length) return embed.setDescription('Personne en piste pour l’instant…');

  const sorted = [...rows].sort((a, b) => (b.data?.inRun ? 1 : 0) - (a.data?.inRun ? 1 : 0) || a.name.localeCompare(b.name));
  const lines = sorted.map((r) => {
    const d = r.data ?? {};
    const head = `${d.inRun ? '🟢' : '⚪'} **${r.name}** — ${carName(m, r.car)}`;
    const clips = d.total ? ` · clips **${d.hit ?? 0}/${d.total}**` : '';
    const detail = d.inRun
      ? `  ${Math.round(d.angle ?? 0)}° · ${Math.round(d.speed ?? 0)} km/h${clips}\n  ${progressBar(d.d)} ${Math.round((d.d ?? 0) * 100)} %${d.ms ? ` · ${fmtLap(d.ms)}` : ''}`
      : `  ${trackLabel(m, r.track, r.layout)} · en attente`;
    return `${head}\n${detail}`;
  });
  return embed.setDescription(joinLines(lines, 4000));
}

module.exports = {
  name: 'direct des soirées',
  intervalMs: 12 * 1000,
  async run(client) {
    const channelId = config.lks.channels.live;
    if (!channelId) return;
    const m = await getManifest();
    const event = liveEvent(m);
    const board = state.data.liveBoard;
    const channel = await getTextChannel(client, channelId);
    if (!channel) return;

    // Fin de soirée : on fige le message
    if (!event) {
      if (board) {
        const msg = await channel.messages.fetch(board.messageId).catch(() => null);
        await msg?.edit({ embeds: [brandEmbed().setTitle('🏁 Direct terminé').setDescription('Merci à tous, à la prochaine soirée !')] });
        state.data.liveBoard = null;
        state.save();
      }
      return;
    }

    const rows = await query('lks_live_now', {}, { ttlMs: 5 * 1000 });
    const embed = boardEmbed(m, event, rows);

    if (board?.eventId === event.id) {
      const msg = await channel.messages.fetch(board.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
    }
    const msg = await channel.send({ embeds: [embed] });
    state.data.liveBoard = { eventId: event.id, messageId: msg.id };
    state.save();
  },
};
