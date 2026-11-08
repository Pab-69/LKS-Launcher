/**
 * Catégories (Débutant / Amateur / Pro), attribuées par le serveur du groupe selon les notes :
 * - annonce quand un pilote monte (ou redescend) ;
 * - rôle Discord de sa catégorie donné aux membres liés (/lier), les deux autres retirés.
 */
const config = require('../../config.json');
const { query } = require('../lks/supabase');
const { links, state } = require('../lks/store');
const { getGuild, getTextChannel } = require('../lks/discord');
const { brandEmbed } = require('../utils/embeds');
const { categoryLabel, fmtScore, CATEGORY_LABEL } = require('../lks/format');

const ORDER = { debutant: 0, amateur: 1, pro: 2 };

async function announce(client, changes) {
  const channel = await getTextChannel(client, config.lks.channels.categories);
  if (!channel) return;
  for (const c of changes) {
    const up = ORDER[c.to] > ORDER[c.from];
    const id = Object.keys(links.data).find((k) => links.data[k].pilot.toLowerCase() === c.key);
    const embed = brandEmbed()
      .setTitle(up ? `${categoryLabel(c.to).split(' ')[0]} ${c.name} passe ${CATEGORY_LABEL[c.to]} !` : `${c.name} redescend en ${CATEGORY_LABEL[c.to]}`)
      .setDescription(
        up
          ? `Moyenne de ses 5 meilleures notes : **${fmtScore(c.avg)}**. Bravo${id ? ` <@${id}>` : ''} ! Ses runs sont maintenant notées comme la catégorie ${CATEGORY_LABEL[c.to]}.`
          : `Moyenne de ses 5 meilleures notes : **${fmtScore(c.avg)}**. Ses runs sont notées comme la catégorie ${CATEGORY_LABEL[c.to]} : de quoi remonter vite.`,
      );
    await channel.send({ embeds: [embed], allowedMentions: { users: id && up ? [id] : [] } }).catch((e) => console.error('[catégories]', e.message));
  }
}

async function syncRoles(client, catOf) {
  const roles = config.lks.categoryRoles ?? {};
  const ids = Object.values(roles).filter(Boolean);
  if (!ids.length || !Object.keys(links.data).length) return;
  const guild = await getGuild(client);
  if (!guild) return;
  for (const [discordId, { pilot }] of Object.entries(links.data)) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;
    const want = roles[catOf(pilot)];
    for (const id of ids) {
      const has = member.roles.cache.has(id);
      if (id === want && !has) await member.roles.add(id, 'Catégorie LKS').catch((e) => console.error('[catégories]', e.message));
      if (id !== want && has) await member.roles.remove(id, 'Catégorie LKS').catch((e) => console.error('[catégories]', e.message));
    }
  }
}

module.exports = {
  name: 'catégories (rôles + annonces)',
  intervalMs: 5 * 60 * 1000,
  async run(client) {
    let rows;
    try {
      rows = await query('lks_categories_list', { select: 'name,category,avg,runs' }, { ttlMs: 60 * 1000 });
    } catch {
      return; // serveur du groupe pas encore à jour (catégories absentes)
    }
    const now = Object.fromEntries(rows.map((r) => [String(r.name).trim().toLowerCase(), r]));
    const known = state.data.categories;
    if (known) {
      const changes = Object.entries(now)
        .filter(([k, r]) => known[k] && known[k] !== r.category)
        .map(([k, r]) => ({ key: k, name: r.name, from: known[k], to: r.category, avg: r.avg }));
      if (changes.length) await announce(client, changes);
    }
    // premier passage : on retient l'état actuel sans rien annoncer
    state.data.categories = Object.fromEntries(Object.entries(now).map(([k, r]) => [k, r.category]));
    state.save();
    await syncRoles(client, (pilot) => now[String(pilot).trim().toLowerCase()]?.category ?? 'debutant');
  },
};
