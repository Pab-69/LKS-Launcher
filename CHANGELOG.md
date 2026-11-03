# Journal des versions

## 1.12.3

- **Nouvelle ligne de référence sur Calmont et Biķernieki** : une ligne de drift fluide, sans cassure, qui passe au centre de chaque clip et suit les longues zones sur toute leur longueur (dont toute la boucle de Biķernieki le long du mur extérieur). Elle est calculée pour avoir le moins de courbure possible tout en restant sur la route.
- Les runs déjà faites sur ces deux circuits sont notées à nouveau avec cette ligne.

## 1.12.2

- **Ligne de start et ligne de départ séparées** :
  - la **ligne de start** est l'endroit où tu t'arrêtes pour les feux (Calmont : la ligne peinte en haut, là où le jeu te place ; Biķernieki : le couloir de cônes) ;
  - la **ligne de départ** est l'endroit où la run et la note commencent (Calmont : la ligne peinte avant le premier clip ; Biķernieki : la ligne jaune en travers, au début des lignes jaunes).
  - Les feux ne se lancent que sur la ligne de start. Les deux lignes et l'arrivée s'affichent sur la carte et sur la piste.
- **Biķernieki : le dernier clip fait toute la boucle**, le long du mur extérieur, d'une ligne jaune en travers à l'autre. La ligne de référence suit maintenant le mur dans la boucle.
- Le fantôme garde 20 secondes avant la ligne de départ : il rejoue le départ arrêté depuis la ligne de start.
- Appli en jeu 2.2.

## 1.12.1

- **Clips de Calmont et Biķernieki repris du marquage au sol** : ce sont maintenant exactement les clips peints sur la piste, plus des clips calculés.
  - Calmont : les 2 cadres et les 3 longues zones peintes le long des bords ; le départ et l'arrivée sont les lignes peintes en travers de la route.
  - Biķernieki : les 4 zones à la craie entre deux piquets, le repère jaune et la ligne en travers à l'entrée de la boucle ; l'arrivée est la ligne jaune à la sortie de la boucle.
- Les longues zones comptent sur toute leur longueur (avant, un clip était toujours un cercle).
- La ligne de référence passe par tous les clips.
- Appli en jeu 2.1 (mise à jour automatique au lancement du jeu).

## 1.12.0

- **Clips refaits sur Calmont et Biķernieki**  : chaque circuit a été analysé (murs, bords de route, portes de chrono, traces de pneus) pour placer les cordes, les zones extérieures et une ligne de drift. Ce sont les **parcours officiels** : ils remplacent le tracé automatique. Biķernieki suit les 9 zones de jugement VDC (Pie Ozola, Elkonis, Ģenerālis, Tilts…). Un parcours publié par les admins reste prioritaire.
- **Runs de la porte de départ à l'arrivée** : sur ces circuits, une run commence en passant la porte de départ et finit à l'arrivée. Avant, Calmont n'enregistrait rien (pas de ligne IA).
- **Retour aux stands = remise à zéro** : la run (ou le tour) en cours est annulée, les clips repartent à zéro, dans le launcher et dans l'appli en jeu.
- **Feux de départ** : bouton « Feux » dans l'appli en jeu. Arrête-toi avant la porte, 3 feux rouges puis vert. Bouger avant le vert = faux départ. Fenêtre « LKS Feux » pour les voir en grand.
- **Choisir son fantôme en jeu** : bouton « Fantôme » dans l'appli, avec les meilleures runs du circuit (les tiennes et celles du classement). Une run faite avec les feux rejoue aussi le départ arrêté : le fantôme part au vert avec toi.
- **Battles en jeu** : bouton « Battle », choisis un pilote du serveur. Il accepte, vous vous arrêtez avant la porte, les feux partent en même temps chez les deux. Run 1 puis run 2 avec les rôles inversés, et le résultat s'affiche dans le jeu.
- **Les autres pilotes sur ta télémétrie** : en direct, la carte montre les pilotes autour de toi, avec leur distance, leur vitesse et leur angle.
- Clips affichés sur la piste dans le jeu (désactivable).
- Tracé automatique des autres circuits corrigé : les clips se plaçaient parfois du mauvais côté de la route.
- L'appli en jeu passe en version 2.0. Elle se met à jour toute seule au lancement du jeu.

## 1.11.0

- **Parties visibles dans le launcher** : une partie lancée depuis Héberger apparaît dans **Serveurs** pour tous les membres (« Partie LKS », avec le nom de l'hôte), et se rejoint en un clic : le launcher essaie toutes les adresses de l'hôte (internet, VPN, réseau local) et prend celle qui répond. Elle disparaît de la liste à l'arrêt du serveur.
- Les parties ne s'inscrivent plus dans la liste publique d'Assetto Corsa, qui refusait les serveurs et les faisait s'arrêter.
- Admins : relancez le script du classement dans Supabase (Publication → Classement → Copier le script) pour activer la liste des parties.

## 1.10.2

- Nouveaux réglages par défaut pour rouler en Solo : embrayage auto, talon-pointe auto et pénalités désactivés, antipatinage sur Off. Ces réglages passent aussi sur ces valeurs chez ceux qui avaient encore les anciens réglages par défaut. Le changement ne se fait qu'une fois : tu peux les réactiver ensuite.

## 1.10.1

- Hébergement : quand la liste publique du jeu refuse ton serveur (« trop de tentatives d'inscription »), Assetto Corsa le coupait au bout de quelques secondes, et chaque redémarrage aggravait le refus. Le launcher reconnaît maintenant cette cause et relance le serveur **hors de la liste publique** : les codes d'invitation marchent toujours. L'option est décochée pour la prochaine fois.
- Diagnostic : les ports s'affichent aussi quand le serveur est arrêté.

## 1.10.0

- Hébergement plus fiable :
  - **fermer le launcher ne coupe plus la partie sans prévenir** : tu peux réduire le launcher, le serveur continue ;
  - si le serveur s'arrête tout seul, il **redémarre automatiquement** avec les mêmes réglages (3 fois au plus en 15 minutes) ;
  - la page Héberger affiche alors la cause probable et la fin du journal du serveur, et le diagnostic l'inclut ;
  - les ports ouverts à la main sont retenus : plus besoin de recliquer à chaque lancement.

## 1.9.9

- Hébergement :
  - deux nouvelles façons de demander l'ouverture des ports aux box qui répondent « erreur 501 » ;
  - si ça ne marche toujours pas, le launcher reconnaît ta box (Freebox, Bbox, Livebox, SFR) et indique où ouvrir les ports à la main, avec un lien vers son interface ;
  - nouveau bouton « J'ai ouvert les ports à la main » : il crée le code d'invitation internet, avec ton adresse publique ;
  - la carte réseau virtuelle de VirtualBox n'est plus prise pour ton réseau.
- Correction : la vérification du pare-feu Windows échouait sur certains PC.

## 1.9.8

- Héberger : bouton « Copier le diagnostic ». Il copie ce que le launcher a essayé avec ta box (cartes réseau, réponses UPnP, ports, adresse publique), l'état du pare-feu Windows et le journal du serveur. À envoyer quand l'hébergement ne marche pas.

## 1.9.7

- **Contenu du groupe uniquement** : Solo, Héberger et Rejoindre un serveur n'acceptent plus que les voitures et circuits publiés sur le launcher. Les admins peuvent lever cette limite dans Publication → Contenu autorisé, par exemple pour tester une voiture avant de la publier.
- **Hébergement, ouverture des ports (UPnP)** :
  - la box est cherchée sur toutes les cartes réseau (ZeroTier, Radmin VPN ou Hyper-V la cachaient souvent), et aussi directement à ses adresses habituelles ;
  - si une TV ou un NAS répond avant la box, il est ignoré ;
  - un port resté ouvert d'une session précédente est refermé puis rouvert ;
  - les refus de la box sont expliqués simplement.
- Si la box refuse, le launcher affiche les ports à ouvrir à la main (protocole, port, adresse de ton PC), avec un bouton « Réessayer ».
- **Pare-feu Windows** : le launcher vérifie qu'il laisse passer le serveur. Sinon, le bouton « Autoriser le serveur » corrige tout, avec une seule demande Windows. C'est souvent bloqué après un clic sur « Annuler » au premier lancement, ou quand ton réseau est en « Public ».

## 1.9.6

- Pendant le jeu, le launcher n'est plus bloqué par l'écran « Assetto Corsa en cours ».
  - Au lancement, choisis « Télémétrie en direct » ou « Utiliser le launcher ».
  - Ton choix est retenu pour les prochaines sessions. Tu peux le changer dans Paramètres.
- Une petite barre en haut rappelle que le jeu tourne, avec un raccourci vers la télémétrie en direct.

## 1.9.5

- **Correction importante** : le launcher pouvait se fermer d'un coup dès que le jeu démarrait vraiment (surtout avec le Custom Shaders Patch). La lecture de la télémétrie utilisait un accès mémoire interdit par Electron, qui arrête alors tout le programme. Les données du jeu sont maintenant copiées de façon sûre.
- Quand le jeu ne trouve pas un circuit alors que le CSP est désactivé, le launcher te dit que le circuit en a sûrement besoin, avec un bouton « Réactiver le CSP ».

## 1.9.4

- Correction : certains circuits ne se lançaient plus (« TRACK NOT FOUND », par exemple Calmont). La 1.9.2 prenait pour un tracé des dossiers que le jeu ne reconnaît pas. Les tracés sont repris comme le jeu et Content Manager les voient. Les tracés complets passent en premier.
- Diagnostic des plantages : les avertissements sans gravité du CSP ne cachent plus la vraie erreur du jeu, et un ancien journal du CSP n'est plus lu.
- Si le jeu plante la carte graphique, le launcher se relance au lieu de rester planté. Après deux plantages de ce genre, il passe en mode compatibilité de l'affichage (réglable dans Paramètres → Avancé).
- Le launcher garde un petit journal de ses propres soucis, ajouté au rapport de plantage.

## 1.9.3

- Correction : les mises à jour automatiques étaient refusées (« n'est pas signé numériquement »). Le launcher exigeait une signature que nos installeurs n'ont pas encore. En attendant la signature, une mise à jour non signée est acceptée. Elle est toujours vérifiée par son empreinte publiée avec la version.
- **Si ta mise à jour a échoué, installe cette version à la main une fois** (Paramètres → « Télécharger l'installeur »). Les suivantes s'installeront de nouveau toutes seules.

## 1.9.2

- Correction : certains circuits faisaient planter le jeu au chargement (par exemple Brooklyn Park). Le launcher lançait un tracé « vide » qui n'existe pas. Les tracés viennent maintenant des fichiers que le jeu charge vraiment, même quand les fichiers d'affichage du circuit sont mal écrits.
- Avant de lancer, le launcher vérifie que le tracé est complet. Sinon, il propose un autre tracé au lieu de laisser le jeu planter.
- Diagnostic des plantages plus précis : il reconnaît les plantages au chargement du circuit, de la voiture ou de l'affichage, et ignore les lignes sans intérêt.

## 1.9.1

- Correction : le jeu pouvait s'ouvrir puis planter juste après. Avec la mise à l'échelle de Windows (125 %, 150 %…), les réglages graphiques pouvaient écrire une résolution d'écran impossible (par exemple 2561 × 1440).
  - La résolution est maintenant calée sur un vrai mode d'écran.
  - Elle est corrigée toute seule avant chaque lancement.
  - Une résolution qui marche déjà n'est plus jamais modifiée.
- Si le jeu se ferme juste après le lancement, le launcher lit les journaux du jeu et du CSP et dit quoi faire. Il propose aussi de copier un rapport à envoyer.

## 1.9.0

- **Fantôme** : une voiture translucide rejoue un tour pour que tu la suives.
  - Ça peut être ton tour ou celui d'un autre pilote du classement.
  - Choisis le tour avec le bouton « Fantôme » dans Tours ou Classement.
  - Le fantôme part quand tu passes la ligne de départ.
  - Dans l'appli en jeu : l'afficher ou le masquer, régler son avance (0 à 2 s) et le mode « Attente », où il ralentit quand tu es loin derrière.
- L'appli en jeu enregistre chaque tour complet pour le fantôme. Le fantôme est partagé avec ton record.
- L'appli en jeu tourne même fenêtre fermée (tandem, clips, fantôme).
- Appli en jeu 1.4 : réinstalle-la dans Outils.
- Pour les admins : relance le script SQL du classement.

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
