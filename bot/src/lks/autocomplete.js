/** Suggestions pour les options des commandes (circuits, voitures, pilotes, championnats). */
const { getManifest, trackLabel } = require('./manifest');
const { query } = require('./supabase');
const { truncate } = require('./format');

const match = (text, focused) => text.toLowerCase().includes(focused.toLowerCase());
const top = (choices) => choices.slice(0, 25).map((c) => ({ name: truncate(c.name, 100), value: c.value }));

/** Valeur d'un circuit : "idCircuit::idTracé". */
async function trackChoices(focused) {
  const m = await getManifest();
  const choices = (m.tracks ?? []).flatMap((t) =>
    (t.layouts?.length ? t.layouts : [{ id: '' }]).map((l) => ({
      name: trackLabel(m, t.id, l.id ?? ''),
      value: `${t.id}::${l.id ?? ''}`,
    })),
  );
  return top(choices.filter((c) => match(c.name, focused) || match(c.value, focused)));
}

async function carChoices(focused) {
  const m = await getManifest();
  const choices = (m.cars ?? []).map((c) => ({ name: c.name, value: c.id }));
  return top(choices.filter((c) => match(c.name, focused) || match(c.value, focused)));
}

async function driverChoices(focused) {
  const rows = await query('lks_laps', { select: 'driver', kind: 'neq.battle', limit: 1000 }, { ttlMs: 2 * 60 * 1000 });
  const names = [...new Set(rows.map((r) => r.driver).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return top(names.filter((n) => match(n, focused)).map((n) => ({ name: n, value: n })));
}

async function championshipChoices(focused) {
  const m = await getManifest();
  return top((m.championships ?? []).map((c) => ({ name: c.name || c.id, value: c.id })).filter((c) => match(c.name, focused)));
}

/** Transforme la valeur saisie en { track, layout } (accepte aussi un nom tapé à la main). */
async function parseTrack(value) {
  const m = await getManifest();
  if (value.includes('::')) {
    const [track, layout] = value.split('::');
    return { track, layout };
  }
  const t = (m.tracks ?? []).find((x) => x.id === value || match(x.name, value));
  return t ? { track: t.id, layout: t.layouts?.[0]?.id ?? '' } : null;
}

async function parseCar(value) {
  if (!value) return null;
  const m = await getManifest();
  return (m.cars ?? []).find((c) => c.id === value || match(c.name, value))?.id ?? value;
}

/** Branche les suggestions : handlers = { nomOption: fonction(focused) } */
async function respond(interaction, handlers) {
  const focused = interaction.options.getFocused(true);
  const fn = handlers[focused.name];
  if (!fn) return interaction.respond([]);
  await interaction.respond(await fn(String(focused.value ?? '')).catch(() => []));
}

module.exports = { trackChoices, carChoices, driverChoices, championshipChoices, parseTrack, parseCar, respond };
