// Enregistre les commandes slash sur ton serveur.
// À relancer (npm run deploy) chaque fois que tu ajoutes ou modifies une commande.
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./utils/loader');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Il faut DISCORD_TOKEN, CLIENT_ID et GUILD_ID dans le fichier .env');
  process.exit(1);
}

const body = [...loadCommands().values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
    console.log(`✅ ${body.length} commandes enregistrées : ${body.map((c) => '/' + c.name).join(', ')}`);
  } catch (err) {
    console.error('Échec de l’enregistrement des commandes :', err);
    process.exit(1);
  }
})();
