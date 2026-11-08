const { Events, ActivityType } = require('discord.js');
const { startTasks } = require('../utils/loader');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    client.user.setActivity('Lowkey Syndicate', { type: ActivityType.Playing });
    startTasks(client);
  },
};
