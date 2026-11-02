// Voitures du Syndicate mises en avant dans l'interface (accueil, écran de jeu).
// Le manifeste peut fournir sa propre liste via "showcase": [{ image, title, subtitle }].
export const SHOWCASE = [
  { image: 'img/cars/bmw-m2.jpg', title: 'BMW M2', subtitle: 'Pablo · #17 · Livrée Syndicate', position: 'center 55%' },
  { image: 'img/cars/supra-a90.jpg', title: 'Toyota GR Supra', subtitle: 'Livrée Lowkey Syndicate · Bleu nuit', position: 'center 60%' },
  { image: 'img/cars/silvia-s15.jpg', title: 'Nissan Silvia S15', subtitle: 'Drift Team · Toile d’araignée', position: 'center 55%' },
];

export function showcaseFrom(manifest) {
  const list = manifest && Array.isArray(manifest.showcase) ? manifest.showcase.filter((s) => s && s.image) : [];
  return list.length ? list : SHOWCASE;
}

export function randomShowcase() {
  return SHOWCASE[Math.floor(Math.random() * SHOWCASE.length)];
}
