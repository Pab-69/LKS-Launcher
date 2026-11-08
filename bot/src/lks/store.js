/** Petite base JSON du bot (dossier data/) : liens Discord ↔ pilote et état des tâches automatiques. */
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function createStore(name, defaults) {
  const file = path.join(DATA_DIR, `${name}.json`);
  let data = structuredClone(defaults);
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[store] ${file} illisible, on repart de zéro :`, err.message);
  }

  return {
    data,
    save() {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

/** discordId -> { pilot, linkedAt } */
const links = createStore('links', {});

/** État persistant des tâches (rappels envoyés, message du direct, etc.) */
const state = createStore('state', {
  reminders: {},
  scheduledEvents: {},
  content: null,
  liveBoard: null,
  lastRecap: null,
  serverAlerts: {},
});

function pilotOf(discordId) {
  return links.data[discordId]?.pilot ?? null;
}

function discordIdOf(pilot) {
  const p = String(pilot).toLowerCase();
  return Object.keys(links.data).find((id) => links.data[id].pilot.toLowerCase() === p) ?? null;
}

module.exports = { links, state, pilotOf, discordIdOf };
