/** Annonce les nouvelles voitures / nouveaux circuits (ou nouvelles versions) publiés dans le manifeste. */
const config = require('../../config.json');
const { brandEmbed } = require('../utils/embeds');
const { getManifest } = require('../lks/manifest');
const { state } = require('../lks/store');
const { getTextChannel } = require('../lks/discord');
const { launcherRow } = require('../lks/views');
const { truncate } = require('../lks/format');

const snapshot = (m) => ({
  updatedAt: m.updatedAt,
  cars: Object.fromEntries((m.cars ?? []).map((c) => [c.id, c.version ?? ''])),
  tracks: Object.fromEntries((m.tracks ?? []).map((t) => [t.id, t.version ?? ''])),
});

function announce(item, type, isUpdate) {
  const emoji = type === 'car' ? '🚗' : '🏁';
  const label = type === 'car' ? (isUpdate ? 'Voiture mise à jour' : 'Nouvelle voiture') : isUpdate ? 'Circuit mis à jour' : 'Nouveau circuit';
  const embed = brandEmbed().setTitle(`${emoji} ${label} : ${item.name}`);
  const details = [
    type === 'car' && item.brand ? `Marque : **${item.brand}**` : null,
    type === 'car' && item.carClass ? `Classe : **${item.carClass}**` : null,
    type === 'track' && item.country ? `Pays : **${item.country}**` : null,
    item.notes ? `\n${truncate(item.notes, 500)}` : null,
    '\nDisponible dans le launcher.',
  ].filter(Boolean);
  embed.setDescription(details.join('\n'));
  if (item.preview) embed.setImage(item.preview);
  return embed;
}

module.exports = {
  name: 'nouveau contenu',
  intervalMs: 5 * 60 * 1000,
  async run(client) {
    const m = await getManifest();
    const previous = state.data.content;
    const current = snapshot(m);

    // Première lecture : on mémorise sans rien annoncer
    if (!previous) {
      state.data.content = current;
      state.save();
      return;
    }
    if (previous.updatedAt === current.updatedAt) return;

    const channel = await getTextChannel(client, config.lks.channels.newContent);
    if (channel) {
      const embeds = [];
      for (const car of m.cars ?? []) {
        if (!(car.id in previous.cars)) embeds.push(announce(car, 'car', false));
        else if (previous.cars[car.id] !== (car.version ?? '')) embeds.push(announce(car, 'car', true));
      }
      for (const track of m.tracks ?? []) {
        if (!(track.id in previous.tracks)) embeds.push(announce(track, 'track', false));
        else if (previous.tracks[track.id] !== (track.version ?? '')) embeds.push(announce(track, 'track', true));
      }
      // 10 embeds max par message Discord
      for (let i = 0; i < embeds.length; i += 10) {
        await channel.send({ embeds: embeds.slice(i, i + 10), components: [launcherRow()] });
      }
    }

    state.data.content = current;
    state.save();
  },
};
