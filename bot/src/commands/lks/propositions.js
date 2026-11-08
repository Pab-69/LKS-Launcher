const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel } = require('../../lks/manifest');
const { query, publicFileUrl } = require('../../lks/supabase');
const { ts, truncate, joinLines } = require('../../lks/format');

const KIND = { car: '🚗 Voiture', skin: '🎨 Livrée', setup: '🔧 Setup' };
const STATUS = { pending: '⏳ En attente', accepted: '✅ Acceptée', refused: '❌ Refusée' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('propositions')
    .setDescription('Propositions de voitures, livrées et setups')
    .addStringOption((o) =>
      o
        .setName('statut')
        .setDescription('En attente par défaut')
        .addChoices(
          { name: 'En attente', value: 'pending' },
          { name: 'Acceptées', value: 'accepted' },
          { name: 'Refusées', value: 'refused' },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const wanted = interaction.options.getString('statut') ?? 'pending';
    const decisions = m.proposals ?? {};

    const all = await query('lks_proposals_list', { order: 'created_at.desc', limit: 200 }, { ttlMs: 2 * 60 * 1000 });
    const list = all.filter((p) => (decisions[p.id]?.status ?? 'pending') === wanted).slice(0, 10);

    const embed = brandEmbed().setTitle(`📦 Propositions — ${STATUS[wanted]}`);
    if (!list.length) {
      embed.setDescription('Aucune proposition ici. Propose du contenu depuis le launcher !');
      return interaction.editReply({ embeds: [embed] });
    }

    const lines = await Promise.all(
      list.map(async (p) => {
        const what = [p.car && carName(m, p.car), p.skin, p.track && trackLabel(m, p.track, p.layout)].filter(Boolean).join(' · ');
        const link = p.file ? await publicFileUrl('lks-proposals', p.file) : p.link;
        const note = decisions[p.id]?.note ? `\n  💬 ${truncate(decisions[p.id].note, 150)}` : '';
        return [
          `${KIND[p.kind] ?? '📦'} **${truncate(p.title || what || 'Sans titre', 80)}** — par ${p.author || '?'} · ${ts(p.created_at, 'R')}`,
          `  👍 ${p.up ?? 0}  👎 ${p.down ?? 0}${what && p.title ? ` · ${what}` : ''}${link ? ` · [télécharger](${link})` : ''}`,
          p.message ? `  > ${truncate(p.message.replace(/\n/g, ' '), 150)}` : null,
        ]
          .filter(Boolean)
          .join('\n') + note;
      }),
    );
    embed.setDescription(`${joinLines(lines, 3900)}\n\n-# Pour voter, ouvre le launcher.`);
    await interaction.editReply({ embeds: [embed] });
  },
};
