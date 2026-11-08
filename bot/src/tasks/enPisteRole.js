/**
 * Rôle « En piste » : donné aux membres liés (/lier) dont le pilote roule
 * (solo, en ligne ou héberge une partie) d'après lks_presence_live. Retiré sinon.
 */
const config = require('../../config.json');
const { query } = require('../lks/supabase');
const { links } = require('../lks/store');
const { getGuild } = require('../lks/discord');

const DRIVING = new Set(['solo', 'online', 'hosting']);

module.exports = {
  name: 'rôle En piste',
  intervalMs: 60 * 1000,
  async run(client) {
    const roleId = config.lks.enPisteRoleId;
    if (!roleId || !Object.keys(links.data).length) return;
    const guild = await getGuild(client);
    if (!guild) return;

    const presence = await query('lks_presence_live', { select: 'name,state' }, { ttlMs: 30 * 1000 });
    const driving = new Set(presence.filter((p) => DRIVING.has(p.state)).map((p) => p.name.toLowerCase()));

    for (const [discordId, { pilot }] of Object.entries(links.data)) {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      const should = driving.has(pilot.toLowerCase());
      const has = member.roles.cache.has(roleId);
      if (should && !has) await member.roles.add(roleId, 'En piste dans le launcher').catch((e) => console.error('[En piste]', e.message));
      if (!should && has) await member.roles.remove(roleId, 'Plus en piste').catch((e) => console.error('[En piste]', e.message));
    }
  },
};
