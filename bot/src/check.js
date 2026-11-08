// Vérifie que toutes les commandes, composants et événements se chargent (sans se connecter à Discord).
const { loadCommands, loadComponents, loadEvents, loadTasks } = require('./utils/loader');

const commands = loadCommands();
for (const c of commands.values()) c.data.toJSON(); // lève une erreur si une commande est mal définie
const components = loadComponents();
const events = loadEvents();

console.log(`Commandes  (${commands.size}) : ${[...commands.keys()].map((n) => '/' + n).join(', ')}`);
console.log(`Composants (${components.size}) : ${[...components.keys()].join(', ')}`);
console.log(`Événements (${events.length}) : ${events.map((e) => e.name).join(', ')}`);
console.log(`Tâches     (${loadTasks().length}) : ${loadTasks().map((t) => t.name).join(', ')}`);
console.log('✅ Tout se charge correctement.');
process.exit(0); // le cache HTTP garde un minuteur actif
