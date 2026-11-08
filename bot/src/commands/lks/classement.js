const { SlashCommandBuilder } = require('discord.js');
const { brandEmbed, errorEmbed } = require('../../utils/embeds');
const { getManifest, carName, trackLabel, findTrack } = require('../../lks/manifest');
const { leaderboard } = require('../../lks/rankings');
const { trackChoices, carChoices, respond, parseTrack, parseCar } = require('../../lks/autocomplete');
const { place, fmtScore, kindLabel, ts, joinLines, CATEGORY_MODE, CATEGORY_LABEL, categoryLabel } = require('../../lks/format');
const { discordIdOf } = require('../../lks/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Top 10 d’un circuit (drift ou tandem), par catégorie')
    .addStringOption((o) => o.setName('circuit').setDescription('Circuit').setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o
        .setName('categorie')
        .setDescription('Catégorie (Amateur par défaut) : ses pilotes, notés comme elle')
        .addChoices({ name: 'Débutant', value: 'debutant' }, { name: 'Amateur', value: 'amateur' }, { name: 'Pro', value: 'pro' }),
    )
    .addStringOption((o) =>
      o.setName('type').setDescription('Drift (par défaut) ou tandem').addChoices({ name: 'Drift', value: 'drift' }, { name: 'Tandem', value: 'tandem' }),
    )
    .addBooleanOption((o) => o.setName('tous').setDescription('Tous les pilotes, pas seulement ceux de la catégorie'))
    .addStringOption((o) => o.setName('voiture').setDescription('Seulement cette voiture').setAutocomplete(true)),

  autocomplete: (interaction) => respond(interaction, { circuit: trackChoices, voiture: carChoices }),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await getManifest();
    const target = await parseTrack(interaction.options.getString('circuit'));
    if (!target) return interaction.editReply({ embeds: [errorEmbed('Circuit introuvable.')] });

    const kind = interaction.options.getString('type') ?? 'drift';
    const category = interaction.options.getString('categorie') ?? 'amateur';
    const all = interaction.options.getBoolean('tous') ?? false;
    const car = await parseCar(interaction.options.getString('voiture'));

    const { rows, rules } = await leaderboard({ ...target, kind, mode: CATEGORY_MODE[category], car, onlyCategory: all ? null : category });
    const subtitle = [
      kindLabel(kind),
      all ? `tous les pilotes, notation ${CATEGORY_LABEL[category]}` : `catégorie ${categoryLabel(category)}`,
      car ? carName(m, car) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const embed = brandEmbed().setTitle(`🏆 ${trackLabel(m, target.track, target.layout)}`);
    const preview = findTrack(m, target.track)?.preview;
    if (preview) embed.setThumbnail(preview);

    if (!rows.length) {
      embed.setDescription(`${subtitle}\n\nAucun score pour le moment${all ? '' : ' dans cette catégorie (essaie `tous: vrai`)'}. À toi de jouer !`);
      return interaction.editReply({ embeds: [embed] });
    }

    const lines = rows.map((r, i) => {
      const id = discordIdOf(r.driver);
      const badge = all ? ` ${categoryLabel(r.category).split(' ')[0]}` : '';
      const old = r.old ? ' · _ancien parcours_' : '';
      return `${place(i)} **${r.driver}**${badge}${id ? ` (<@${id}>)` : ''} — ${fmtScore(r.score)}/100\n  ${car ? '' : `${carName(m, r.car)} · `}${ts(r.created_at, 'R')}${old}`;
    });
    const version = rules ? `\n-# Parcours version ${rules.split('-')[0]}` : '';
    embed.setDescription(`${subtitle}\n\n${joinLines(lines, 3800)}${version}`);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
