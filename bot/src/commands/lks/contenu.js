const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, findCar, findTrack, trackLabel } = require('../../lks/manifest');
const { carChoices, trackChoices, respond, parseCar, parseTrack } = require('../../lks/autocomplete');
const { launcherRow } = require('../../lks/views');
const { ts, truncate, joinLines } = require('../../lks/format');

const mb = (bytes) => (bytes ? `${Math.round(bytes / 1024 / 1024)} Mo` : '?');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contenu')
    .setDescription('Voitures et circuits du groupe')
    .addStringOption((o) => o.setName('voiture').setDescription('Fiche d’une voiture').setAutocomplete(true))
    .addStringOption((o) => o.setName('circuit').setDescription('Fiche d’un circuit').setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { voiture: carChoices, circuit: trackChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const carValue = interaction.options.getString('voiture');
    const trackValue = interaction.options.getString('circuit');

    if (carValue) {
      const car = findCar(m, await parseCar(carValue));
      if (!car) return interaction.editReply({ embeds: [errorEmbed('Voiture introuvable.')] });
      const specs = Object.entries(car.specs ?? {})
        .filter(([k, v]) => v != null && k !== 'range')
        .map(([k, v]) => `**${k}** : ${v}`);
      const embed = brandEmbed()
        .setTitle(`🚗 ${car.name}`)
        .addFields(
          { name: 'Marque', value: car.brand || '?', inline: true },
          { name: 'Classe', value: car.carClass || '?', inline: true },
          { name: 'Skins', value: String(car.skins?.length ?? 0), inline: true },
          { name: 'Taille', value: mb(car.size), inline: true },
        );
      if (car.publishedAt) embed.addFields({ name: 'Publiée', value: ts(car.publishedAt, 'D'), inline: true });
      if (specs.length) embed.addFields({ name: 'Caractéristiques', value: specs.join('\n') });
      if (car.notes) embed.addFields({ name: 'Notes', value: truncate(car.notes, 1024) });
      if (car.preview) embed.setImage(car.preview);
      return interaction.editReply({ embeds: [embed], components: [launcherRow()] });
    }

    if (trackValue) {
      const parsed = await parseTrack(trackValue);
      const track = parsed && findTrack(m, parsed.track);
      if (!track) return interaction.editReply({ embeds: [errorEmbed('Circuit introuvable.')] });
      const layouts = (track.layouts ?? []).map(
        (l) => `• ${trackLabel(m, track.id, l.id ?? '')} — ${l.length || '?'}${/\d$/.test(l.length ?? '') ? ' m' : ''}, ${l.pitboxes ?? '?'} places`,
      );
      const embed = brandEmbed()
        .setTitle(`🏁 ${track.name}`)
        .addFields(
          { name: 'Pays', value: track.country || '?', inline: true },
          { name: 'Taille', value: mb(track.size), inline: true },
        );
      if (track.publishedAt) embed.addFields({ name: 'Publié', value: ts(track.publishedAt, 'D'), inline: true });
      if (layouts.length) embed.addFields({ name: 'Tracés', value: truncate(layouts.join('\n'), 1024) });
      if (track.notes) embed.addFields({ name: 'Notes', value: truncate(track.notes, 1024) });
      if (track.preview) embed.setImage(track.preview);
      return interaction.editReply({ embeds: [embed], components: [launcherRow()] });
    }

    const cars = (m.cars ?? []).map((c) => `• **${c.name}**${c.carClass ? ` · ${c.carClass}` : ''}`);
    const tracks = (m.tracks ?? []).map((t) => `• **${t.name}**${t.country ? ` · ${t.country}` : ''}`);
    const embed = brandEmbed()
      .setTitle('📦 Contenu du groupe')
      .setDescription('Tout est installé automatiquement par le launcher. `/contenu voiture:` ou `circuit:` pour une fiche.')
      .addFields(
        { name: `🚗 Voitures (${cars.length})`, value: joinLines(cars, 1000) || 'Aucune' },
        { name: `🏁 Circuits (${tracks.length})`, value: joinLines(tracks, 1000) || 'Aucun' },
      );
    await interaction.editReply({ embeds: [embed], components: [launcherRow()] });
  },
};
