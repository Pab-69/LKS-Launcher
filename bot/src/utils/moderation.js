const config = require('../../config.json');
const { brandEmbed, sendLog } = require('./embeds');

/**
 * Vérifie qu'un modérateur peut agir sur une cible.
 * Retourne un message d'erreur, ou null si c'est bon.
 */
function checkTarget(interaction, target) {
  if (!target) return 'Ce membre n’est pas sur le serveur.';
  if (target.id === interaction.user.id) return 'Tu ne peux pas faire ça sur toi-même.';
  if (target.id === interaction.client.user.id) return 'Je ne peux pas faire ça sur moi-même.';
  if (target.id === interaction.guild.ownerId) return 'Impossible d’agir sur le propriétaire du serveur.';
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  if (!isOwner && target.roles.highest.position >= interaction.member.roles.highest.position) {
    return 'Ce membre a un rôle égal ou supérieur au tien.';
  }
  if (!target.manageable) return 'Mon rôle est trop bas pour agir sur ce membre (monte le rôle du bot dans la liste).';
  return null;
}

/** Envoie l'action dans le salon de logs de modération. */
function logAction(interaction, { action, target, reason, extra }) {
  const embed = brandEmbed()
    .setTitle(`🛡️ ${action}`)
    .addFields(
      { name: 'Membre', value: `${target} (${target.id})`, inline: true },
      { name: 'Modérateur', value: `${interaction.user}`, inline: true },
      { name: 'Raison', value: reason || 'Aucune raison' },
    );
  if (extra) embed.addFields(extra);
  return sendLog(interaction.guild, config.moderation.logChannelId, embed);
}

/** Prévient le membre en MP (silencieux si ses MP sont fermés). */
function notifyUser(user, text) {
  return user.send(text).catch(() => {});
}

module.exports = { checkTarget, logAction, notifyUser };
