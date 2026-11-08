const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, trackLabel } = require('../../lks/manifest');
const { trackChoices, respond, parseTrack } = require('../../lks/autocomplete');
const { courseOf, courseImage } = require('../../lks/courses');
const { truncate } = require('../../lks/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parcours')
    .setDescription('Le parcours drift d’un circuit : ligne, clips, zones, départ et arrivée')
    .addStringOption((o) => o.setName('circuit').setDescription('Circuit').setRequired(true).setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { circuit: trackChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const target = await parseTrack(interaction.options.getString('circuit'));
    if (!target) return interaction.editReply({ embeds: [errorEmbed('Circuit introuvable.')] });
    const found = await courseOf(target.track, target.layout);
    if (!found) {
      return interaction.editReply({ embeds: [errorEmbed('Pas encore de parcours officiel pour ce circuit : le launcher utilise un tracé automatique.')] });
    }
    const { course, source } = found;
    const png = courseImage(course);
    const clips = (course.clips ?? []).map((c, i) => `\`${i + 1}\` ${c.name} — ${c.kind === 'outer' ? 'extérieur (arrière)' : 'intérieur (avant)'}${c.path ? ', zone' : ''}`);
    const embed = brandEmbed()
      .setTitle(`🗺️ ${trackLabel(m, target.track, target.layout)}`)
      .setDescription(
        `${source}\n\n${truncate(clips.join('\n'), 3000)}\n\n` +
          '🟢 ligne de référence · 🔵 clip intérieur · 🟣 clip extérieur\n⚪ ligne de start · 🟡 début du drift · 🔴 arrivée',
      );
    const files = [];
    if (png) {
      files.push(new AttachmentBuilder(png, { name: 'parcours.png' }));
      embed.setImage('attachment://parcours.png');
    }
    await interaction.editReply({ embeds: [embed], files });
  },
};
