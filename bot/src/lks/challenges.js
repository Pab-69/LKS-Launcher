/** Défis /defi : entre deux membres liés ; le résultat est posté quand leur battle arrive sur le serveur. */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const { state } = require('./store');
const { brandEmbed } = require('../utils/embeds');
const { trackLabel } = require('./manifest');
const { fmtScore, ts } = require('./format');

const TTL_MS = 48 * 60 * 60 * 1000; // un défi accepté attend sa battle 48 h

function list() {
  state.data.challenges = (state.data.challenges ?? []).filter((c) => Date.now() - Date.parse(c.createdAt) < TTL_MS);
  return state.data.challenges;
}

function find(id) {
  return list().find((c) => c.id === id) ?? null;
}

function buttons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`defi:accept:${id}`).setLabel('Accepter').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`defi:refuse:${id}`).setLabel('Refuser').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

function siteLink(track, layout) {
  const base = (config.lks.siteUrl || '').replace(/\/$/, '');
  return base ? `${base}/classement.html#track=${encodeURIComponent(track)}&layout=${encodeURIComponent(layout || '')}` : null;
}

/** Fiche du résultat d'une battle d'un défi. */
function resultEmbed(m, c, b) {
  const totals = b.row.meta?.battle?.result?.drivers ?? [];
  const lines = totals.map((d) => `**${d.name}** — ${fmtScore(d.total)} (lead ${fmtScore(d.lead)} · chase ${fmtScore(d.chase)})`);
  const head = b.omt ? '🔁 One more time !' : `🏆 Victoire de **${b.winner}**${b.judged ? ' (décision du juge)' : ''}`;
  const embed = brandEmbed()
    .setTitle(`⚔️ Défi ${c.pilots[0]} vs ${c.pilots[1]}`)
    .setDescription(`${head}\n\n${lines.join('\n')}\n\n${trackLabel(m, b.row.track, b.row.layout)} · ${ts(b.date, 'R')}`);
  const link = siteLink(b.row.track, b.row.layout);
  if (link) embed.addFields({ name: 'Sur le site', value: `[Classement et battles du circuit](${link})` });
  return embed;
}

module.exports = { list, find, buttons, resultEmbed, TTL_MS };
