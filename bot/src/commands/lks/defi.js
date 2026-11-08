const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, trackLabel } = require('../../lks/manifest');
const { trackChoices, respond, parseTrack } = require('../../lks/autocomplete');
const { pilotOf, state } = require('../../lks/store');
const C = require('../../lks/challenges');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('defi')
    .setDescription('Défie un membre en battle : le résultat est posté ici quand vous l’avez roulée')
    .addUserOption((o) => o.setName('membre').setDescription('Qui tu défies').setRequired(true))
    .addStringOption((o) => o.setName('circuit').setDescription('Circuit (facultatif)').setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { circuit: trackChoices }),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const me = pilotOf(interaction.user.id);
    const them = pilotOf(target.id);
    if (target.id === interaction.user.id || target.bot) {
      return interaction.reply({ embeds: [errorEmbed('Choisis un autre membre.')], flags: MessageFlags.Ephemeral });
    }
    if (!me || !them) {
      const who = !me ? 'Tu dois d’abord lier ton pilote avec `/lier`.' : `${target} doit d’abord lier son pilote avec \`/lier\`.`;
      return interaction.reply({ embeds: [errorEmbed(who)], flags: MessageFlags.Ephemeral });
    }
    const m = await getManifest();
    const track = interaction.options.getString('circuit') ? await parseTrack(interaction.options.getString('circuit')) : null;
    const id = Math.random().toString(36).slice(2, 10);
    const challenge = {
      id,
      from: interaction.user.id,
      to: target.id,
      pilots: [me, them],
      track: track?.track ?? null,
      layout: track?.layout ?? '',
      channelId: interaction.channelId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    C.list().push(challenge);
    state.save();
    const where = track ? ` sur **${trackLabel(m, track.track, track.layout)}**` : '';
    const embed = brandEmbed()
      .setTitle(`⚔️ ${me} défie ${them} !`)
      .setDescription(`${target}, tu acceptes la battle${where} ? Une fois acceptée, lancez-la en jeu (appli LKS, onglet Battle, puis « Prêt » chacun) : le résultat sera posté ici.`);
    await interaction.reply({ content: `${target}`, embeds: [embed], components: [C.buttons(id)], allowedMentions: { users: [target.id] } });
    const msg = await interaction.fetchReply();
    challenge.messageId = msg.id;
    state.save();
  },
};
