const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel } = require('../../lks/manifest');
const { query } = require('../../lks/supabase');
const { launcherRow, hostAddress } = require('../../lks/views');
const { joinLines } = require('../../lks/format');
const { discordIdOf } = require('../../lks/store');

const GROUPS = [
  { state: 'online', title: '🟢 En ligne' },
  { state: 'hosting', title: '🏠 Héberge une partie' },
  { state: 'solo', title: '🔵 En solo' },
  { state: 'launcher', title: '⚪ Dans le launcher' },
];

module.exports = {
  data: new SlashCommandBuilder().setName('qui-roule').setDescription('Qui est en ligne, où et avec quelle voiture'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const [presence, hosts] = await Promise.all([
      query('lks_presence_live', { order: 'name.asc' }, { ttlMs: 30 * 1000 }),
      query('lks_hosts_live', {}, { ttlMs: 30 * 1000 }),
    ]);

    const embed = brandEmbed().setTitle('🏎️ Qui roule ?');
    if (!presence.length) {
      embed.setDescription('Personne n’a le launcher ouvert en ce moment.');
      return interaction.editReply({ embeds: [embed], components: [launcherRow()] });
    }

    for (const { state, title } of GROUPS) {
      const list = presence.filter((p) => p.state === state);
      if (!list.length) continue;
      const lines = list.map((p) => {
        const id = discordIdOf(p.name);
        const who = `**${p.name}**${id ? ` (<@${id}>)` : ''}`;
        if (state === 'launcher') return `• ${who}`;
        const where = [p.car && carName(m, p.car), p.track && trackLabel(m, p.track, p.layout)].filter(Boolean).join(' · ');
        let server = '';
        if (p.server?.hostId) {
          const host = hosts.find((h) => String(h.id) === String(p.server.hostId));
          const address = host && hostAddress(host) ? ` — ${hostAddress(host)}` : '';
          server = `\n  🏠 ${p.server.name ?? host?.name ?? 'Partie hébergée'}${address}${host?.has_password ? ' 🔒' : ''}`;
        } else if (p.server?.name) {
          server = `\n  🖥️ ${p.server.name}${p.server.ip ? ` — \`${p.server.ip}:${p.server.port}\`` : ''}`;
        }
        return `• ${who}${where ? ` — ${where}` : ''}${server}`;
      });
      embed.addFields({ name: `${title} (${list.length})`, value: joinLines(lines, 1000) });
    }
    embed.setDescription('-# Seuls les pilotes qui ont activé « Me montrer en ligne aux membres » apparaissent.');
    await interaction.editReply({ embeds: [embed], components: [launcherRow()], allowedMentions: { parse: [] } });
  },
};
