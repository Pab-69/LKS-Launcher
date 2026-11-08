/**
 * Soirées : rappels (la veille et 1 h avant) + « événements programmés » Discord.
 * Le launcher n'annonce que la création d'une soirée : ici on fait le reste, sans doublon.
 */
const { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus } = require('discord.js');
const config = require('../../config.json');
const { getManifest, sortedEvents, eventTimes, trackLabel, carName, findTrack, eventServer } = require('../lks/manifest');
const { state } = require('../lks/store');
const { getGuild, getTextChannel } = require('../lks/discord');
const { eventEmbed, launcherRow } = require('../lks/views');
const { truncate } = require('../lks/format');

const HOUR = 60 * 60 * 1000;

async function sendReminders(client, m) {
  const channel = await getTextChannel(client, config.lks.channels.reminders);
  if (!channel) return;
  const now = Date.now();
  const ping = config.lks.soireePingRoleId ? `<@&${config.lks.soireePingRoleId}> ` : '';

  for (const event of sortedEvents(m)) {
    const { start } = eventTimes(event);
    const key = `${event.id}@${event.date}`; // si la date change, on refait les rappels
    const sent = state.data.reminders[key] ?? {};

    let which = null;
    if (!sent.h1 && now >= start - HOUR && now < start) which = 'h1';
    else if (!sent.veille && now >= start - 24 * HOUR && now < start - HOUR) which = 'veille';
    if (!which) continue;

    const title = which === 'h1' ? '⏰ La soirée commence dans moins d’1 heure !' : '📅 Rappel : soirée demain';
    await channel.send({
      content: `${ping}${which === 'h1' ? 'Lancez le launcher, ça commence bientôt !' : 'N’oubliez pas la soirée !'}`,
      embeds: [eventEmbed(m, event, { title: `${title} — ${event.title || 'Soirée LKS'}` })],
      components: [launcherRow()],
      allowedMentions: { roles: config.lks.soireePingRoleId ? [config.lks.soireePingRoleId] : [] },
    });
    state.data.reminders[key] = { ...sent, [which]: new Date().toISOString(), ...(which === 'h1' ? { veille: true } : {}) };
    state.save();
  }

  // Ménage : on oublie les rappels des soirées passées depuis plus de 2 jours
  for (const key of Object.keys(state.data.reminders)) {
    const date = key.split('@')[1];
    if (new Date(date).getTime() < now - 48 * HOUR) delete state.data.reminders[key];
  }
}

function scheduledPayload(m, event) {
  const { start, end } = eventTimes(event);
  const server = eventServer(m, event);
  const description = [
    event.description,
    event.track ? `🏁 ${trackLabel(m, event.track, event.layout ?? '')}` : null,
    event.cars?.length ? `🚗 ${event.cars.map((c) => carName(m, c)).join(', ')}` : null,
    event.battle ? `⚔️ Battle${event.battle.size ? ` top ${event.battle.size}` : ''}` : null,
    `⬇️ Launcher : ${config.lks.launcherUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    name: truncate(event.title || 'Soirée LKS', 100),
    scheduledStartTime: new Date(start),
    scheduledEndTime: new Date(end),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: truncate(server?.name ? `Serveur ${server.name}` : 'Assetto Corsa — launcher LKS', 100) },
    description: truncate(description, 1000),
    image: findTrack(m, event.track)?.preview ?? undefined,
  };
}

async function syncScheduledEvents(client, m) {
  if (!config.lks.scheduledEvents) return;
  const guild = await getGuild(client);
  if (!guild) return;
  const now = Date.now();
  const stored = state.data.scheduledEvents;
  const events = sortedEvents(m);
  const ids = new Set(events.map((e) => e.id));

  for (const event of events) {
    const { start, end } = eventTimes(event);
    const entry = stored[event.id];
    const payload = scheduledPayload(m, event);
    const hash = JSON.stringify([payload.name, event.date, event.durationMinutes, payload.entityMetadata, payload.description]);

    try {
      if (!entry) {
        if (start < now + 60 * 1000) continue; // déjà commencée : trop tard pour la créer
        const created = await guild.scheduledEvents.create(payload).catch(() => {
          const { image, ...withoutImage } = payload; // l'image peut échouer, on réessaie sans
          return guild.scheduledEvents.create(withoutImage);
        });
        stored[event.id] = { discordId: created.id, hash, status: 'scheduled' };
        console.log(`[soirées] événement Discord créé : ${payload.name}`);
      } else if (now > end) {
        await guild.scheduledEvents.edit(entry.discordId, { status: GuildScheduledEventStatus.Completed }).catch(() => {});
        delete stored[event.id];
      } else if (now >= start && entry.status !== 'active') {
        await guild.scheduledEvents.edit(entry.discordId, { status: GuildScheduledEventStatus.Active }).catch(() => {});
        entry.status = 'active';
      } else if (entry.hash !== hash && entry.status !== 'active') {
        const { image, ...withoutImage } = payload;
        await guild.scheduledEvents.edit(entry.discordId, withoutImage);
        entry.hash = hash;
        console.log(`[soirées] événement Discord mis à jour : ${payload.name}`);
      }
    } catch (err) {
      console.error(`[soirées] événement « ${payload.name} » :`, err.message);
      if (err.code === 10070) delete stored[event.id]; // supprimé à la main sur Discord : on le recréera
    }
  }

  // Soirée retirée du manifeste : on supprime l'événement Discord
  for (const [id, entry] of Object.entries(stored)) {
    if (ids.has(id)) continue;
    await guild.scheduledEvents.delete(entry.discordId).catch(() => {});
    delete stored[id];
  }
  state.save();
}

module.exports = {
  name: 'soirées (rappels + événements)',
  intervalMs: 60 * 1000,
  async run(client) {
    const m = await getManifest();
    await sendReminders(client, m);
    await syncScheduledEvents(client, m);
  },
};
