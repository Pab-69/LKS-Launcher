import { h, modal } from './ui.js';

/** What the launcher does, in a few screens (first start, or Paramètres → Revoir la présentation). */
const STEPS = [
  {
    title: 'Bienvenue dans le launcher LKS',
    text: [
      'Le launcher du Lowkey Syndicate : le contenu du groupe toujours à jour, des parties en un clic, et ton drift noté comme par des juges.',
      'Voici l’essentiel en quelques écrans. Tu peux revoir cette présentation à tout moment dans Paramètres.',
    ],
  },
  {
    title: 'Contenu',
    text: [
      'Les voitures et circuits du groupe s’installent et se mettent à jour tout seuls. Tu n’as rien à télécharger à la main.',
      'Onglet Propositions : propose ta voiture, ta livrée ou tes setups. Les membres votent, les admins acceptent ou refusent.',
    ],
  },
  {
    title: 'Rouler ensemble',
    text: [
      'Accueil : la prochaine soirée (avec un bouton Préparer qui installe ce qu’il faut) et qui est en ligne, avec un bouton Rejoindre.',
      'Serveurs : les parties du groupe. Héberger : lance ta propre partie, les autres la voient tout de suite.',
      'Solo : roule seul, avec les sessions préparées par le groupe.',
    ],
  },
  {
    title: 'L’appli en jeu',
    text: [
      'À installer une fois dans Télémétrie → Outils. En jeu, ouvre la barre d’applis à droite et choisis « LKS ».',
      'Elle affiche l’angle, les clips sur la piste, et ta note juste après la run.',
      'Boutons : Feux (arrête-toi sur la ligne de start, 3 feux rouges puis vert), Fantôme (choisis qui suivre), Battle (défie un pilote du serveur).',
    ],
  },
  {
    title: 'Comment le drift est noté',
    text: [
      'Pas de chrono : angle, vitesse, ligne et clips, moins les pénalités (tête-à-queue, roues dehors, regrip…).',
      'Une corde se prend avec l’avant de la voiture, une zone extérieure avec l’arrière. Les longues zones se notent sur la longueur parcourue.',
      'Trois modes : Débutant (indulgent), Normal et Compétition (une erreur = run à 0).',
      'La run commence à la ligne de départ et finit à l’arrivée. Retour aux stands : tout repart à zéro.',
    ],
  },
  {
    title: 'Progresser et partager',
    text: [
      'Télémétrie : tes tours, le classement du groupe, la comparaison avec les autres, les battles, le championnat et ton profil avec tes badges.',
      'Galerie : les photos du groupe (F8 en jeu pour une capture) et les livrées des voitures.',
      'Si le jeu plante, le launcher explique pourquoi et peut envoyer le rapport aux admins.',
    ],
  },
];

export function showTour(onDone) {
  let i = 0;
  let finished = false;
  const body = h('div.tour');
  const foot = h('div.tour-foot');
  const ref = modal({
    title: STEPS[0].title,
    body,
    foot,
    onClose: () => {
      if (finished) return;
      finished = true;
      if (onDone) onDone();
    },
  });
  const titleEl = ref.box.querySelector('.modal-head h2');
  const draw = () => {
    const step = STEPS[i];
    const last = i === STEPS.length - 1;
    titleEl.textContent = step.title;
    body.replaceChildren(...step.text.map((t) => h('p', t)), h('div.tour-dots', STEPS.map((_, k) => h(`span${k === i ? '.on' : ''}`))));
    foot.replaceChildren(
      i > 0 ? h('button.btn.btn-ghost', { on: { click: () => { i--; draw(); } } }, 'Précédent') : h('button.btn.btn-ghost', { on: { click: () => ref.close() } }, 'Passer'),
      h('button.btn.btn-primary', { on: { click: () => { if (last) ref.close(); else { i++; draw(); } } } }, last ? 'C’est parti' : 'Suivant'),
    );
  };
  draw();
}
