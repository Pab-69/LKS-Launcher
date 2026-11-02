# Journal des versions

## 1.8.0

- **Battle tandem** : deux runs avec les rôles inversés, un passage chacun devant.
  - Chaque pilote a (note en lead + note en chase) / 2.
  - Trop serré : one more time.
  - L'appli en jeu enregistre les deux runs, celle où tu suis et celle où tu es devant. La battle est jugée toute seule (onglet Battles).
- **Championnat** : des manches en solo drift, en tandem ou en battle.
  - Les battles se jouent en tableau à élimination (top 4, 8 ou 16) après des qualifs en solo.
  - Points par place et classement général.
  - Les admins le créent dans l'onglet Championnat.
- Correction : une run où tu es devant n'envoie plus rien au classement à la place de l'autre pilote.
- Appli en jeu 1.3 : réinstalle-la dans Outils.
- Pour les admins : relance le script SQL du classement.

## 1.7.0

- **Tandem** : ton chase est noté sur 100.
  - Proximité : 35 points.
  - Angle copié sur le leader : 25 points.
  - Ligne du leader : 20 points.
  - Ton drift : 20 points.
  - Pénalités : contact, dépassement, leader perdu.
  - C'est l'appli en jeu qui enregistre la run, car elle voit la voiture devant toi.
- **Trois modes**, chacun avec son classement :
  - Débutant : plus tolérant.
  - Normal.
  - Compétition : une faute peut mettre la run à 0.
- **Règles sur mesure par circuit** (onglet Parcours drift). Pour chaque faute : ignorée, points en moins ou run à 0.
  - Roues dehors (1 à 4).
  - Regrip.
  - Drift dans le mauvais sens.
  - Tête-à-queue.
  - Clip raté.
  - Contact, dépassement et leader perdu en tandem.
  - Plus l'angle visé, la tolérance de ligne et la taille des clips.
- **Clips automatiques** : le launcher lit la ligne IA de chaque circuit installé et place lui-même la ligne et les clips (corde à l'apex, mur à l'entrée). Les admins peuvent les ajuster puis publier.
- Pour les admins : relance le script SQL du classement (Publication → Classement → Copier le script).

## 1.6.0

- **Drift noté comme en compétition**, sans chrono : note sur 100.
  - Angle : 35 points.
  - Vitesse : 30 points.
  - Ligne et clips : 35 points.
  - Pénalités : tête-à-queue, redressement, sortie de piste.
- **Clips** : les admins les placent sur la carte de chaque circuit (onglet Télémétrie → Parcours drift), avec une run de référence pour la ligne.
- En direct, sur le téléphone et dans l'appli en jeu : clips validés pendant la run.
- Comparer en mode drift : détail de la note, clip par clip, et courbe d'angle.
- Classement drift : détail de la note pour chaque pilote.
- Pour les admins : si le classement est déjà configuré, relance le script SQL (Publication → Classement → Copier le script).

## 1.5.0

- **Télémétrie** (nouvel onglet) : chaque tour est enregistré (vitesse, pédales, rapport, angle, trajectoire).
- **En direct** : vitesse, rapport, angle de drift, écart avec ton meilleur tour, carte.
- **Classement** au chrono ou au drift, par circuit et par voiture, partagé entre tous les pilotes.
- **Comparer** deux tours, les tiens ou ceux d'un autre pilote : courbes, écart et carte.
- Export et import de tours (`.lkslap`).
- Appli en jeu (avec le CSP) : angle, score de drift et écart en direct.
- Tableau de bord sur téléphone, sur le même Wi-Fi.
- SimHub et Crew Chief : lancement avec le jeu s'ils sont installés.
- Pour les admins : réglage du classement dans Publication.

## 1.4.1

- Textes plus simples dans tout le launcher.

## 1.4.0

- **VPN** pour jouer quand la box ne peut pas ouvrir ses ports (IP partagée, 4G, 5G) :
  - ZeroTier : installation et connexion en un clic ;
  - Radmin VPN : connexion guidée.
- Code d'invitation pour le VPN.
- « Rejoindre avec un code » propose de se connecter au VPN si besoin.

## 1.3.0

- **Héberger une partie** (nouvel onglet) : lance gratuitement ta propre partie depuis ton PC, avec le serveur inclus dans Assetto Corsa. Choix du circuit, des voitures, des places, du mode libre ou course, de la météo et du mot de passe.
- Ouverture automatique des ports de ta box (UPnP), refermés à l'arrêt.
- **Codes d'invitation** pour internet, Radmin VPN, ZeroTier, Tailscale, Hamachi ou le réseau local.
- **Rejoindre avec un code** dans l'onglet Serveurs : la partie privée est mémorisée avec son mot de passe.
- Discord affiche « Héberge une partie » pendant que ton serveur tourne.
- Correction : après avoir ajouté un serveur, ses détails s'affichent tout de suite.

## 1.2.0

- **Events** : le prochain event apparaît sur l'accueil avec un compte à rebours. Une notification arrive 15 min avant, puis au départ, et le bouton « Rejoindre » mène directement au serveur.
- **Sessions rapides** : des sessions solo prêtes à lancer depuis l'accueil.
- **Setups partagés** : les réglages des voitures LKS sont installés automatiquement, à côté des tiens, sans jamais les écraser.
- **Discord** : ton statut Discord affiche ta session (voiture, piste, solo ou en ligne), avec un bouton pour rejoindre le Discord. Désactivable dans les Paramètres.
- Pour les admins : historique des publications, et réglages des events, sessions, setups et Discord dans Publication.

## 1.1.1

- Correction : la page Solo ne plante plus au premier lancement, quand le dossier d'Assetto Corsa n'est pas encore configuré.
- Les copies du launcher installées sans l'installeur officiel n'affichent plus d'erreur de mise à jour.

## 1.1.0

- **Mises à jour en un clic** : quand une nouvelle version est prête, un bandeau propose « Redémarrer et mettre à jour ». Elle s'installe en silence, sans repasser par l'installeur. Elle s'installe aussi toute seule à la fermeture du launcher.
- **Quoi de neuf** : cette fenêtre s'affiche après chaque mise à jour.
- **Identité visuelle** : le logo et la vitrine sont maintenant publiés par les admins et téléchargés par le launcher (Publication → Identité visuelle).
- Le contenu du groupe est hébergé dans la release « content » du dépôt du launcher. Les anciens réglages sont migrés automatiquement.
- Le code du launcher passe sous licence libre GPL-3.0. Le nom, le logo et les visuels restent la propriété de l'association.
- Nouvelle icône.

## 1.0.0

- Première version : synchro des voitures et circuits, solo, serveurs, graphismes en 1 clic (Custom Shaders Patch), pages Soutenir et Boutique, thème gothique.
