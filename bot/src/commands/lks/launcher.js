const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed } = require('../../utils/embeds');
const { getManifest } = require('../../lks/manifest');
const { launcherRow } = require('../../lks/views');

module.exports = {
  data: new SlashCommandBuilder().setName('launcher').setDescription('Lien de téléchargement du launcher LKS'),

  async execute(interaction) {
    const m = await getManifest().catch(() => null);
    const embed = brandEmbed()
      .setTitle('⬇️ Launcher Lowkey Syndicate')
      .setDescription(
        [
          m?.motd ? `> ${m.motd}\n` : null,
          'Télécharge le launcher pour avoir toutes les voitures et circuits du groupe, les classements et les soirées.',
          m ? `\n**${m.cars?.length ?? 0}** voitures · **${m.tracks?.length ?? 0}** circuits` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    await interaction.reply({ embeds: [embed], components: [launcherRow()] });
  },
};
