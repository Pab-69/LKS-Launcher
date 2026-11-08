/** Inscriptions aux soirées (bouton « Je viens ») : soirée id@date -> ids Discord. */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { state } = require('./store');
const { launcherButton } = require('./views');

const keyOf = (event) => `${event.id}@${event.date}`;

function members(event) {
  return state.data.signups?.[keyOf(event)] ?? [];
}

function toggle(key, userId) {
  state.data.signups = state.data.signups ?? {};
  const list = state.data.signups[key] ?? [];
  const i = list.indexOf(userId);
  if (i >= 0) list.splice(i, 1);
  else list.push(userId);
  state.data.signups[key] = list;
  state.save();
  return i < 0;
}

/** Boutons sous une soirée : « Je viens » (+ nombre d'inscrits) et le launcher. */
function row(event) {
  const n = members(event).length;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`soiree-join:${keyOf(event)}`).setLabel(n ? `Je viens (${n})` : 'Je viens').setEmoji('✋').setStyle(ButtonStyle.Success),
    launcherButton(),
  );
}

/** Ménage : oublie les soirées passées depuis plus de 2 jours. */
function prune() {
  for (const key of Object.keys(state.data.signups ?? {})) {
    const date = Date.parse(key.slice(key.indexOf('@') + 1));
    if (date < Date.now() - 48 * 3600 * 1000) delete state.data.signups[key];
  }
}

module.exports = { keyOf, members, toggle, row, prune };
