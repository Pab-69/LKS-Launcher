const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel, acTrackLabel } = require('../../lks/manifest');
const { query } = require('../../lks/supabase');
const { getAcInfo } = require('../../lks/acServer');
const { truncate } = require('../../lks/format');
const { hostAddress } = require('../../lks/views');

const carList = (m, cars) => truncate([...new Set(cars ?? [])].map((c) => carName(m, c)).join(', '), 300) || '?';

module.exports = {
  data: new SlashCommandBuilder().setName('serveurs').setDescription('Les serveurs du groupe et les parties hébergées'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const servers = m.servers ?? [];
    const [infos, hosts] = await Promise.all([
      Promise.all(servers.map((s) => getAcInfo(s.ip, s.httpPort))),
      query('lks_hosts_live', {}, { ttlMs: 30 * 1000 }).catch(() => []),
    ]);

    const embed = brandEmbed().setTitle('🖥️ Serveurs LKS');

    servers.forEach((s, i) => {
      const info = infos[i];
      const value = info
        ? [
            `👥 **${info.clients ?? 0}/${info.maxclients ?? '?'}** pilotes`,
            `🏁 ${acTrackLabel(m, info.track)}`,
            `🚗 ${carList(m, info.cars)}`,
            `\`${s.ip}:${info.port ?? '?'}\`${info.pass ? ' 🔒' : ''}`,
          ].join('\n')
        : `🔴 Hors ligne\n\`${s.ip}\``;
      embed.addFields({ name: `${info ? (info.clients > 0 ? '🟢' : '🟡') : '🔴'} ${s.name}`, value: truncate(value, 1024) });
    });

    for (const h of hosts.slice(0, 10)) {
      const address = hostAddress(h);
      embed.addFields({
        name: `🏠 ${h.name || 'Partie hébergée'} (par ${h.host_driver || '?'})`,
        value: truncate(
          [
            h.slots ? `👥 ${h.slots} places` : null,
            h.track ? `🏁 ${trackLabel(m, h.track, h.layout)}` : null,
            h.cars?.length ? `🚗 ${carList(m, h.cars)}` : null,
            `${address}${h.has_password ? ' 🔒' : ''}`,
          ]
            .filter(Boolean)
            .join('\n'),
          1024,
        ),
      });
    }

    if (!servers.length && !hosts.length) {
      embed.setDescription('Aucun serveur publié et aucune partie hébergée en ce moment.');
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
