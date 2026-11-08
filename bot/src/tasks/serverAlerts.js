/** Alerte « Ça roule sur … » quand un serveur du groupe passe de 0 à 1 joueur (au plus 1 fois / 30 min). */
const config = require('../../config.json');
const { brandEmbed } = require('../utils/embeds');
const { getManifest, acTrackLabel } = require('../lks/manifest');
const { getAcInfo } = require('../lks/acServer');
const { state } = require('../lks/store');
const { getTextChannel } = require('../lks/discord');

const COOLDOWN_MS = 30 * 60 * 1000;
const lastClients = new Map(); // en mémoire : au redémarrage, pas d'alerte pour un serveur déjà occupé

module.exports = {
  name: 'alertes serveurs',
  intervalMs: 45 * 1000,
  async run(client) {
    const channel = await getTextChannel(client, config.lks.channels.serverAlerts);
    if (!channel) return;
    const m = await getManifest();

    for (const s of m.servers ?? []) {
      const key = `${s.ip}:${s.httpPort || 8081}`;
      const info = await getAcInfo(s.ip, s.httpPort);
      if (!info) continue;
      const clients = Number(info.clients) || 0;
      const before = lastClients.get(key);
      lastClients.set(key, clients);

      const lastAlert = state.data.serverAlerts[key] ?? 0;
      if (before === 0 && clients > 0 && Date.now() - lastAlert > COOLDOWN_MS) {
        await channel.send({
          embeds: [
            brandEmbed()
              .setTitle(`🏁 Ça roule sur ${s.name} !`)
              .setDescription(`👥 ${clients}/${info.maxclients ?? '?'} · ${acTrackLabel(m, info.track)}\nRejoins-les depuis le launcher.`),
          ],
        });
        state.data.serverAlerts[key] = Date.now();
        state.save();
      }
    }
  },
};
