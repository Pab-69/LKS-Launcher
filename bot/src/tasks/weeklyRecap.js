/** Récap de la semaine posté automatiquement (par défaut le lundi à 10 h, heure de Paris). */
const config = require('../../config.json');
const { getManifest } = require('../lks/manifest');
const { buildWeeklyRecap } = require('../lks/recap');
const { state } = require('../lks/store');
const { getTextChannel } = require('../lks/discord');

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parisNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { weekday: WEEKDAYS[parts.weekday], hour: Number(parts.hour), day: `${parts.year}-${parts.month}-${parts.day}` };
}

module.exports = {
  name: 'récap de la semaine',
  intervalMs: 5 * 60 * 1000,
  async run(client) {
    const { weekday = 1, hour = 10 } = config.lks.recap ?? {};
    const now = parisNow();
    if (now.weekday !== weekday || now.hour !== hour || state.data.lastRecap === now.day) return;

    const channel = await getTextChannel(client, config.lks.channels.recap);
    if (!channel) return;
    const m = await getManifest();
    await channel.send({ embeds: [await buildWeeklyRecap(m)] });
    state.data.lastRecap = now.day;
    state.save();
  },
};
