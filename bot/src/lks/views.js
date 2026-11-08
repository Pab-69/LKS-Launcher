/** Embeds réutilisés par les commandes et les tâches automatiques. */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const { brandEmbed } = require('../utils/embeds');
const { carName, trackLabel, findTrack, eventTimes, isEventLive, eventServer } = require('./manifest');
const { ts, modeLabel, truncate } = require('./format');

function launcherButton(label = 'Télécharger le launcher') {
  return new ButtonBuilder().setLabel(label).setEmoji('⬇️').setStyle(ButtonStyle.Link).setURL(config.lks.launcherUrl);
}

function launcherRow() {
  return new ActionRowBuilder().addComponents(launcherButton());
}

function serverText(server) {
  if (!server) return null;
  const address = server.ip ? ` — \`${server.ip}${server.port ? `:${server.port}` : ''}\`` : '';
  return `${server.name ?? 'Serveur'}${address}`;
}

/** Fiche d'une soirée. */
function eventEmbed(m, event, { title } = {}) {
  const { start, end } = eventTimes(event);
  const live = isEventLive(event);
  const embed = brandEmbed()
    .setTitle(title ?? `${live ? '🔴 En cours — ' : '📅 '}${event.title || 'Soirée LKS'}`)
    .addFields({ name: 'Quand', value: `${ts(start, 'F')} (${ts(start, 'R')})\nFin vers ${ts(end, 't')}` });

  if (event.description) embed.setDescription(truncate(event.description, 2000));
  if (event.track) {
    embed.addFields({ name: 'Circuit', value: trackLabel(m, event.track, event.layout ?? ''), inline: true });
    const preview = findTrack(m, event.track)?.preview;
    if (preview) embed.setImage(preview);
  }
  if (event.cars?.length) {
    embed.addFields({ name: 'Voitures', value: truncate(event.cars.map((c) => `• ${carName(m, c)}`).join('\n'), 1024), inline: true });
  }
  const server = serverText(eventServer(m, event));
  if (server) embed.addFields({ name: 'Serveur', value: server });
  if (event.battle) {
    const { size, mode } = event.battle;
    const parts = [size ? `Top ${size}` : null, mode ? `mode ${modeLabel(mode)}` : null].filter(Boolean);
    embed.addFields({ name: '⚔️ Battle', value: parts.join(' · ') || 'Oui', inline: true });
  }
  return embed;
}

/** Adresse d'une partie hébergée (addresses peut être une liste ou un texte). */
function hostAddress(host) {
  const first = Array.isArray(host?.addresses) ? host.addresses[0] : host?.addresses;
  return first ? `\`${first}${host.tcp_port ? `:${host.tcp_port}` : ''}\`` : '';
}

module.exports = { launcherButton, launcherRow, serverText, eventEmbed, hostAddress };
