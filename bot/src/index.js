const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands, loadComponents, loadEvents } = require('./utils/loader');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN manquant : copie .env.example en .env et remplis-le.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // nécessaire pour les messages de bienvenue (à activer dans le portail développeur)
    GatewayIntentBits.GuildMessages, // fils sous les records postés par le launcher (pas besoin du contenu des messages)
  ],
  partials: [Partials.GuildMember],
});

client.commands = loadCommands();
client.components = loadComponents();

for (const event of loadEvents()) {
  const handler = (...args) => event.execute(...args, client);
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

process.on('unhandledRejection', (err) => console.error('[erreur non gérée]', err));

// Arrêt propre (Ctrl+C, ou systemctl stop/restart sur le VPS)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.log(`Arrêt du bot (${signal})…`);
    client.destroy().finally(() => process.exit(0));
  });
}

client.login(process.env.DISCORD_TOKEN);
