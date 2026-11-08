const { MessageFlags } = require('discord.js');
const { errorEmbed, brandEmbed } = require('../utils/embeds');
const { state } = require('../lks/store');
const C = require('../lks/challenges');

module.exports = {
  customId: 'defi',
  async execute(interaction) {
    const [, action, id] = interaction.customId.split(':');
    const c = C.find(id);
    if (!c || c.status !== 'pending') {
      return interaction.reply({ embeds: [errorEmbed('Ce défi n’est plus en cours.')], flags: MessageFlags.Ephemeral });
    }
    if (interaction.user.id !== c.to && !(action === 'refuse' && interaction.user.id === c.from)) {
      return interaction.reply({ embeds: [errorEmbed('Seul le membre défié peut répondre.')], flags: MessageFlags.Ephemeral });
    }
    if (action === 'accept') {
      c.status = 'accepted';
      c.acceptedAt = new Date().toISOString();
      const embed = brandEmbed()
        .setTitle(`⚔️ ${c.pilots[0]} vs ${c.pilots[1]} : défi accepté !`)
        .setDescription('Lancez la battle en jeu (appli LKS → Battle → « Prêt » chacun). Le résultat sera posté ici, avec la décision du juge s’il y en a une.');
      await interaction.update({ embeds: [embed], components: [C.buttons(id, true)] });
    } else {
      c.status = 'refused';
      await interaction.update({ embeds: [brandEmbed().setDescription(`Défi ${c.pilots[0]} vs ${c.pilots[1]} ${interaction.user.id === c.from ? 'annulé' : 'refusé'}.`)], components: [] });
    }
    state.save();
  },
};
