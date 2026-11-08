const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel } = require('../../lks/manifest');
const { query, publicFileUrl } = require('../../lks/supabase');
const { ts, truncate } = require('../../lks/format');

module.exports = {
  data: new SlashCommandBuilder().setName('photo').setDescription('Une photo au hasard de la galerie LKS'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const hidden = new Set((m.galleryHidden ?? []).map(String));
    const photos = (await query('lks_photos_list', { order: 'created_at.desc', limit: 500 }, { ttlMs: 2 * 60 * 1000 }))
      .filter((p) => p.file && !hidden.has(String(p.id)));

    if (!photos.length) {
      return interaction.editReply({ embeds: [brandEmbed().setDescription('📸 La galerie est vide pour le moment.')] });
    }

    const photo = photos[Math.floor(Math.random() * photos.length)];
    const embed = brandEmbed()
      .setTitle('📸 Galerie LKS')
      .setImage(await publicFileUrl('lks-gallery', photo.file))
      .setDescription(
        [
          photo.caption ? `*${truncate(photo.caption, 500)}*` : null,
          `Par **${photo.author || '?'}** · ${ts(photo.created_at, 'D')}`,
          photo.car ? `🚗 ${carName(m, photo.car)}` : null,
          photo.track ? `🏁 ${trackLabel(m, photo.track, photo.layout ?? '')}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
