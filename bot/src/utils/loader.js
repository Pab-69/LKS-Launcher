const fs = require('node:fs');
const path = require('node:path');

/** Liste récursivement tous les fichiers .js d'un dossier. */
function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** Charge les commandes slash : chaque fichier exporte { data, execute }. */
function loadCommands() {
  const commands = new Map();
  for (const file of listJsFiles(path.join(__dirname, '..', 'commands'))) {
    const command = require(file);
    if (!command.data || !command.execute) {
      console.warn(`[commandes] ${file} ignoré : il manque "data" ou "execute".`);
      continue;
    }
    commands.set(command.data.name, command);
  }
  return commands;
}

/** Charge les composants (boutons, modals) : chaque fichier exporte { customId, execute }. */
function loadComponents() {
  const components = new Map();
  for (const file of listJsFiles(path.join(__dirname, '..', 'components'))) {
    const component = require(file);
    components.set(component.customId, component);
  }
  return components;
}

/** Charge les événements : chaque fichier exporte { name, once?, execute }. */
function loadEvents() {
  return listJsFiles(path.join(__dirname, '..', 'events')).map((file) => require(file));
}

/** Charge les tâches automatiques : chaque fichier exporte { name, intervalMs, run(client) }. */
function loadTasks() {
  return listJsFiles(path.join(__dirname, '..', 'tasks')).map((file) => require(file));
}

/** Lance chaque tâche à intervalle régulier (sans chevauchement, erreurs journalisées). */
function startTasks(client) {
  for (const task of loadTasks()) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await task.run(client);
      } catch (err) {
        console.error(`[tâche ${task.name}]`, err.message ?? err);
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 5000);
    setInterval(tick, task.intervalMs);
    console.log(`⏱️  Tâche « ${task.name} » toutes les ${Math.round(task.intervalMs / 1000)} s`);
  }
}

module.exports = { loadCommands, loadComponents, loadEvents, loadTasks, startTasks };
