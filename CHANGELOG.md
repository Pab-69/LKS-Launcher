# Journal des versions

## 1.27.0

- **Replay d'un passage** (Télémétrie → Détail) : « Rejouer » fait rouler la voiture sur la carte (orientée comme dans le jeu), avec la vitesse et l'angle, en ×1, ×2 ou ×4, et les courbes qui suivent. « Contre » : rejoue en même temps un autre passage du circuit (le tien, un passage importé ou un des meilleurs du classement).
- **Mode spectateur** (Compétition → Spectateur) : sans être en jeu, la carte du circuit avec tous les pilotes en piste (position, angle), leur progression dans la run et les notes qui tombent en direct. Pendant une soirée, la page suit son circuit.
- **Défi de la semaine** (Compétition) : chaque lundi, un défi tiré au sort, le même pour tout le monde (un circuit du groupe, une notation, une note à atteindre). Qui l'a réussi, ta meilleure note de la semaine, et deux nouveaux badges (« Défi relevé », « Habitué des défis »).
- **Objectif de catégorie** (Télémétrie → Profil) : ce qu'il te manque pour monter (« une seule run à 81,4 suffit ») et les circuits où tu as le plus à gagner face au meilleur de ta catégorie.
- **Progression par circuit** (Profil) : moyenne et meilleure note de chaque semaine (12 semaines), et les clips que tu rates le plus souvent. Gardée même après la purge de fin de session.
- **Signaler une note** (Détail) : si une note te paraît fausse, envoie le passage et ton explication aux admins (salon des rapports) ; ils l'importent et corrigent le parcours.
- **Bot Discord** (dossier `bot/`) : rôles et annonces de catégorie, `/defi` avec résultat posté tout seul, bouton « Je viens » sur les soirées (inscrits mentionnés 1 h avant), `/comparer`, pilote de la semaine dans le récap, fils sous les records, `/parcours` (image du tracé avec les clips).

## 1.26.0

- **Parcours officiels des nouveaux circuits**, relevés sur le marquage CFD de chaque piste (pastilles de clip peintes au sol, zones peintes, poteaux, panneaux) :
  - **Val d'Argenton 2023 et 2024** : 5 clips et 2 zones (intérieur de l'épingle, intérieur du virage à droite). Start sur la ligne « départ » (feux), début du drift aux panneaux « attack zone », arrivée sur la ligne « arrivée ». Le couloir suit les traces de pneus de la piste.
  - **Charade (CFD 2025)** : 7 clips et la zone extérieure de la grande épingle. Start entre les panneaux « départ », drift aux panneaux « attack », arrivée entre les panneaux « arrivée ».
  - **Croix-en-Ternois (CFD 2025)** : la zone extérieure de la grande courbe et 6 clips. Start aux panneaux « départ » (feux), drift sur la ligne peinte à l'entrée de la zone, arrivée au panneau « arrivée ».
  - **Val de Vienne (CFD 2022)** : 11 clips. Start sous le portique CFD, drift sur la ligne peinte « attack », arrivée sur la ligne peinte.
- Sur chaque parcours, la **ligne de référence** est la plus fluide possible en passant par tous les clips et toutes les zones, sans sortir de la route.
- Les runs déjà faites sur ces circuits sont re-notées toutes seules avec le nouveau parcours.

## 1.25.0

- **Plus de classement chrono** : les classements (launcher et site) et la comparaison ne gardent que le drift et le tandem. Les temps au tour ne sont plus envoyés au classement partagé.
- **Les photos du launcher sont les voitures du groupe** : l'accueil, le Garage, la boutique et les autres grandes images montrent maintenant les voitures publiées (l'aperçu fait à la publication, en haute définition), les plus récentes d'abord, avec leur nom, la marque, la puissance et le poids. Une voiture publiée apparaît toute seule. Les anciennes photos ne servent plus que s'il n'y a aucune voiture avec un aperçu.

## 1.24.1

- Télémétrie → Profil : si le serveur du groupe n'a pas encore la mise à jour des catégories, le launcher le dit (« un admin doit lancer ./lks.sh update ») au lieu d'afficher tout le monde Débutant sans explication.

## 1.24.0

- **Plus personne ne disparaît du classement quand un parcours change.** Quand un admin modifie un clip ou une règle, les notes changent de version. Avant, le classement ne montrait que les pilotes ayant roulé depuis la modification. Maintenant :
  - les records d'avant restent affichés, en gris, avec la mention « ancien parcours » ;
  - dès qu'un pilote ouvre son launcher, ses runs gardées sur son PC sont re-notées avec le nouveau parcours et renvoyées : il revient dans le classement normal, même sans rouler.
  - Pareil sur le site.
- **Classement : « Ma catégorie » ou « Tous »** : un bouton pour voir tous les pilotes, avec la catégorie de chacun à côté du nom.

## 1.23.0

- **Launcher sécurisé : seuls les vrais admins voient et utilisent l'admin.** Avant, enregistrer n'importe quel texte comme token suffisait pour voir les pages admin (Parcours, Juge, création de championnats, Publication). Maintenant le launcher demande à GitHub si le token peut vraiment écrire sur le dépôt du groupe : sinon les pages admin restent cachées, et toute action admin est refusée par le launcher lui-même, même appelée en contournant l'interface. Un token d'un autre dépôt ne donne aucun droit. Réglages → Accès admin indique si l'accès est vérifié ou refusé, et pourquoi.
- **Catégories calculées avec toutes les données déjà sur le serveur** : à la mise à jour du serveur, chaque pilote reçoit sa catégorie d'après ses runs et ses records déjà enregistrés (moyenne de ses 5 meilleures notes, au moins 3), au lieu de repartir de Débutant. Ensuite, la catégorie évolue à chaque run comme avant.
- **Admins** : serveur du groupe → `./lks.sh update` (le calcul se fait une fois, tout seul). `./lks.sh categories` le relance quand vous voulez. Sur Supabase → relancez le script.

## 1.22.0

- **Clips mesurés au centimètre par l'appli en jeu (3.1)** : à chaque image, l'appli mesure la distance exacte entre le clip et le vrai pare-chocs de ta voiture (avant pour une corde, arrière pour une zone extérieure), avec les dimensions réelles de la voiture. Le launcher note les clips avec ces mesures au lieu de les estimer depuis le centre de la voiture. Les zones longues sont mesurées mètre par mètre, même à faible nombre d'images par seconde. Le détail d'un passage indique si ses clips ont été mesurés en jeu.
- **Éditeur de parcours précis** (admins, Télémétrie → Parcours) :
  - carte zoomable à la molette (jusqu'au centimètre), on se déplace en glissant, échelle et position du pointeur (distance au bord de route et à la ligne) ;
  - **bords de la route** dessinés depuis la ligne IA du circuit ;
  - chaque clip est un **point** ou une **zone** (début → fin, points ajoutables pour suivre une courbe), à sa vraie taille ; on le déplace à la souris, Maj pour le coller au bord de route, bouton « Au bord », Suppr pour le retirer ; clic sur son numéro pour zoomer dessus ;
  - **ligne à suivre ajustée à la main** : onglet « Ligne », attrape la ligne et tire, les points autour suivent selon la taille du pinceau ; Lisser, Annuler (Ctrl+Z), Repartir de la ligne d'origine. Partie d'une run, la vitesse de référence de cette run est gardée.

## 1.21.0

- **Site : page Pilotes** : tous les pilotes rangés par catégorie (Pro, Amateur, Débutant) avec leur moyenne, et une recherche. Clique un pilote : sa catégorie et ce qu'il faut pour monter, ses records par circuit, ses dernières runs (avec les runs à 0) et ses battles.
- **Site : détail d'un passage** : clique une ligne d'un classement ou un record. La note détaillée (angle, vitesse, ligne et clips, pénalités), chaque clip avec sa couverture et sa note de zone, le tracé coloré selon l'angle, et les courbes (angle, vitesse, gaz, frein, volant, rapport). Survole une courbe : la valeur s'affiche et le point apparaît sur le tracé.
- **Site : classements par catégorie** : chaque pilote a son badge de catégorie ; le choix « Pilotes » montre ceux de la catégorie choisie, ou tous.
- **Site : battles** : les dernières battles du circuit choisi (scores lead / chase, vainqueur, one more time).
- **Admins** : serveur du groupe → `./lks.sh update` puis `./lks.sh site-build` pour mettre le site à jour.

## 1.20.0

- **Nouvelle appli en jeu (3.0), au style du launcher** : fond sombre, rouge LKS, peu de texte. En haut, quatre onglets : Run, Battle, Fantôme, réglages.
  - **Run** : l'angle en grand avec une barre, le chrono de la run, l'écart avec le fantôme ou le leader, une pastille par clip (verte quand il est touché).
  - **Note plus discrète** : après la run, la note et trois petites barres (angle, vitesse, ligne) pendant 25 s, puis une seule ligne « Dernière note ». Le détail des clips et des zones s'ouvre avec « Détails ». Ta catégorie s'affiche à côté du logo.
- **Battle avec bouton « Prêt »** : après le défi accepté, chaque pilote se place sur la ligne de start et clique **Prêt**. Les feux partent seulement quand les deux sont prêts (pastilles « Toi » et l'adversaire). Si tu bouges après avoir cliqué, tu n'es plus prêt jusqu'à te replacer. Même chose avant la deuxième run (rôles inversés).
- La carte de la battle reste en haut de l'appli tant qu'elle dure, quel que soit l'onglet.

## 1.19.0

- **Vraies catégories : Débutant, Amateur, Pro.** Chaque pilote a sa catégorie, attribuée automatiquement selon ses notes (moyenne de ses 5 meilleures runs, au moins 3 runs) : 75 et plus → catégorie au-dessus, moins de 35 → catégorie en dessous. Un nouveau pilote commence Débutant.
- **Notation selon la catégorie** : tes runs sont notées avec les règles de ta catégorie (dans le jeu, sur le serveur et dans le launcher). Télémétrie → Profil montre ta catégorie, ta moyenne et ce qu'il faut pour monter.
- **Classements par catégorie** : le choix « Catégorie » montre les pilotes de cette catégorie, notés comme elle.
- **Réglages par circuit** (admins, Télémétrie → Parcours) :
  - poids de la note par catégorie (angle, vitesse, ligne et clips) ;
  - objectifs par zone : angle et vitesse visés à chaque clip (pour Amateur, adaptés pour Débutant et Pro). Sans objectif, la zone garde l'objectif général ;
  - pénalités par catégorie (comme avant).
- **Manches par catégorie** : une manche peut être ouverte à tous (avec la notation choisie) ou réservée à une catégorie (seuls ses pilotes comptent, notés comme elle). Dans le launcher et sur le site.
- **Purge sur le serveur** : après un jour, seule la meilleure run de chaque pilote par circuit et par type reste ; tout est effacé après un an. Les battles et leurs runs restent.
- Site : catégories Débutant / Amateur / Pro dans les classements et les championnats.
- **Admins** : serveur du groupe → `./lks.sh update` ; sur Supabase → relancez le script (Publication → Classement → Copier le script).

## 1.18.0

- **Nouveau menu « Compétition »** : championnats (saisons, manches, tableaux), battles et juge ont leur propre page. La télémétrie garde : En direct, Passages, Classements, Comparer, Profil, Outils.
- **Clique sur un passage** (dans Passages ou Classements) : toutes ses infos s'affichent avec les courbes (angle, vitesse, gaz, frein, volant, rapport, écart avec le leader en tandem), la note détaillée, chaque clip avec sa note de zone, les pénalités et la carte. Survole une courbe : le point s'affiche sur la carte.
- **En direct** : grande carte à droite, et la note détaillée de ton dernier passage (barres, clips, zones, pénalités) avec un bouton vers toutes ses courbes.
- **Fin de session** : à la fermeture du jeu, seul ton meilleur passage par voiture et circuit reste sur ton PC (meilleur temps et meilleure note dans chaque mode), plus les runs des battles. Désactivable : Télémétrie → Outils → « Garder tous mes passages ».

## 1.17.5

- **Télémétrie en multi sur Calmont** (et tout circuit avec un tracé) : en ligne, le jeu donne le nom du tracé en minuscules (« calmont » au lieu de « Calmont »). Le launcher ne trouvait plus le parcours officiel : aucune run enregistrée, rien en direct, alors qu'en solo tout marchait. Le tracé est maintenant reconnu quelle que soit la casse, et les runs faites en ligne sont rangées avec celles du solo (mêmes records, même classement).
- Appli en jeu 2.5 : même correction pour les clips, les portes, les fantômes et les tandems en ligne.

## 1.17.4

- **Calmont : runs enregistrées même en passant à côté de la porte** : la porte de départ peinte fait environ 12 m de large, la route 15 m. En passant le départ près du bord, la run ne démarrait jamais (rien en direct, aucun tour enregistré). Le départ et l'arrivée sont maintenant aussi détectés le long de la ligne du parcours, sur toute la largeur de la route. Vaut pour tous les parcours avec portes.
- Télémétrie → En direct : bouton **Copier le diagnostic** (circuit, parcours, position, passages de la porte, remises à zéro). À envoyer si une run ne s'enregistre pas.
- Les erreurs de lecture de la télémétrie sont gardées dans le journal du launcher.

## 1.17.3

- **Battles réparées** (appli en jeu 2.4) :
  - sur un serveur AC classique, certains messages entre les deux appli (départ des feux, acceptation, fin de run) étaient refusés par le serveur et jamais renvoyés : le chaser ne voyait pas les feux, sa run ne comptait pas, et la battle restait bloquée. Les messages passent maintenant par une file d'attente et sont renvoyés jusqu'à ce qu'ils partent ;
  - si un signal se perd quand même, la run compte dès la ligne de départ ;
  - deux battles en même temps sur un serveur ne peuvent plus se mélanger (numéro de battle unique) ;
  - le launcher gardait mal le numéro de la battle : le résultat n'apparaissait pas dans le jeu.
- **Même résultat sur les deux PC** : chaque PC voit sa voiture parfaitement et l'autre moins bien (réseau), et donnait un peu l'avantage à son pilote. Maintenant, chaque launcher envoie les notes de son pilote au serveur du groupe et prend celles de l'adversaire : les deux trouvent exactement le même résultat, et une seule battle est enregistrée. Sans réponse de l'autre dans les 90 s, le résultat est estimé sur ton PC comme avant.
- **Admins** : serveur du groupe → `./lks.sh update` ; sur Supabase → relancez le script (Publication → Classement → Copier le script).

## 1.17.2

- **Saisons** : chaque championnat peut être rangé dans une saison (« Saison 2026 »). Le launcher l'affiche et permet de la régler dans l'éditeur de championnat.
- **Site vitrine** : les admins créent et modifient les championnats depuis la page Admin (nom, saison, points, manches avec circuit, format, mode, dates, tableau, ordre). La page Classements propose le choix de la saison.

## 1.17.1

- **Site vitrine** (admins avec le serveur du groupe) : page **Admin** pour créer, modifier ou retirer les soirées et publier les actus depuis le navigateur ; page **Classements** (drift, tandem, chrono, championnats) ; soirées et actus toujours à jour sur l'accueil. Mise en place : `server/README.md`, partie « Le site vitrine ».
- Publication depuis le launcher : le manifeste est relu juste avant chaque envoi, pour ne jamais effacer ce qui vient d'être publié depuis le site ou par un autre admin.

## 1.17.0

- **Ton Steam ID ne part plus nulle part** (sauf vers les serveurs de jeu que tu rejoins, le jeu l'exige). Pour le classement, les runs et les propositions, le launcher utilise ton nom de pilote et un identifiant tiré au hasard.
- **Photos de la galerie sans leurs métadonnées** : position GPS, appareil, date… sont retirées avant l'envoi.
- **Rapports de plantage nettoyés** avant l'envoi aux admins : Steam ID, nom de session Windows, adresses IP et e-mails masqués.
- Un tour exporté (`.lkslap`) ne contient plus ton Steam ID.
- **Admins : le serveur du groupe peut tourner chez vous**. Le dossier `server` (sur GitHub) installe tout en une commande sur un serveur Linux avec Docker : classement, runs, direct, présence, propositions, galerie, HTTPS, ménage automatique, sauvegardes. Il ne garde aucun Steam ID ni aucune adresse IP. Notice : `server/README.md`.
- **Admins qui restent sur Supabase : relancez le script** (Publication → Classement → Copier le script). Les Steam ID déjà enregistrés sont remplacés par des identifiants au hasard.
- Les données passagères s'effacent toutes seules : présence 15 min, direct 1 min, parties hébergées 15 min après l'arrêt, runs 30 jours, propositions 180 jours.

## 1.16.1

- **Carte de la télémétrie dans le bon sens** : elle est maintenant orientée comme la carte du jeu (avant, elle était à l'envers).
- **3 nouveaux circuits avec clips officiels**, relevés sur le marquage au sol de chaque circuit :
  - **Kart Volan** : 7 clips (5 cadres, l'arc de l'épingle et le losange). Ligne de start et arrivée sur la ligne peinte, ligne de départ sur le trait blanc en bas à gauche.
  - **PGE Narodowy** : 3 zones peintes le long des murs et 3 clips de corde (dont 2 avec les pneus). Ligne de start sous l'arche, ligne de départ peinte en bas à gauche.
  - **Englishtown** : 3 zones peintes et 2 clips (avec les poteaux). Ligne de start au départ A→B, ligne de départ sur les 3 traits de la voie de droite, arrivée A→B.
- Chaque circuit a sa ligne de référence fluide qui passe par tous les clips.
- Un tracé qui repasse au même endroit (PGE) ne termine plus la run trop tôt.

## 1.16.0

- **La note de chaque run est partagée**, plus seulement les records : note, clips (✓ ou ✗, % des zones longues), note par zone et pénalités. Elle arrive chez les autres quelques secondes après la fin de la run.
- **Le direct pendant les soirées** : de 30 min avant une soirée du calendrier jusqu'à sa fin, le launcher de chaque pilote partage toutes les 1 à 2 secondes son angle, sa vitesse, l'avancée de sa run et les clips déjà pris.
- **Onglet Juge** (admins, dans Télémétrie) : tous les pilotes en piste en direct, et les notes de toutes les dernières runs avec le détail. Pas besoin d'être en jeu ni sur le serveur.
- Paramètres : « Partager mon direct pendant les soirées » se coupe à part. « Partager mes runs avec le groupe » (Télémétrie → Outils) coupe tout le partage.
- **Admins : relancez le script du classement dans Supabase** (Publication → Classement → Copier le script).

## 1.15.0

- **Battle des soirées** : en créant une soirée, les admins choisissent « Battle : top 4, 8 ou 16 ». Les qualifs se font en solo pendant la soirée, puis le tableau des meilleurs se remplit tout seul (Télémétrie → Championnat « Soirées LKS »).
- **Décision du juge** : dans l'onglet Battles, un admin peut trancher une battle (« X gagne » ou « one more time ») avec une raison. La décision compte partout, championnat compris, et elle est annoncée sur Discord.
- **Page pour le stream (OBS)** : la battle en cours, ton angle et ta vitesse, ta dernière note avec les clips, et les qualifs ou le tableau de la soirée, sur fond transparent. L'adresse est dans Télémétrie → Outils (il faut activer le tableau de bord).
- **Votes** : les membres votent 👍 ou 👎 sur les propositions de voitures, livrées et setups.
- **Badges** dans le Profil : première run, 50 runs, notes de 60, 75 et 90, tous les clips, tandems, victoires en battle, circuits, fidélité…
- **Galerie** (nouveau menu) : les photos du groupe (ajoute les tiennes, F8 en jeu pour une capture) et toutes les livrées des voitures LKS.
- **Présentation du launcher** au premier lancement, en quelques écrans. Tu peux la revoir dans Paramètres.
- **Admins : relancez le script du classement dans Supabase** (Publication → Classement → Copier le script) pour activer les votes et la galerie.

## 1.14.0

- **Propose ta voiture, ta livrée ou tes setups** : Contenu → Propositions. Tu choisis ce que tu proposes et le launcher envoie le dossier (50 Mo maximum, sinon tu colles un lien Drive, Mega ou Discord). Tu vois la réponse des admins dans la même page.
- **Admins : accepter ou refuser** dans la même page. « Tester » installe la proposition sur ton PC pour l'essayer en jeu. « Accepter » la publie pour tout le groupe. « Refuser » demande une raison que le membre verra.
- **En ligne maintenant** sur l'Accueil : qui a le launcher ouvert, qui roule et sur quel serveur, qui héberge. Le bouton « Rejoindre » t'emmène directement sur son serveur. Tu peux te cacher dans Paramètres.
- **Soirées** : les admins choisissent le circuit et les voitures. L'Accueil les affiche avec un bouton « Préparer », et tout s'installe tout seul 1 h avant.
- **Discord** : les admins collent deux webhooks (Publication → Discord).
  - Salon des annonces : les nouvelles soirées, les records, les battles et les propositions y sont postés automatiquement. Chacun peut couper l'annonce de ses records et battles dans Paramètres.
  - Salon des admins : quand le jeu plante, le bouton « Envoyer aux admins » y envoie le rapport.
- **Profil** dans Télémétrie : tes runs, tes minutes en glisse, ta progression semaine par semaine, tes records par circuit et tes dernières battles.
- **Admins : relancez le script du classement dans Supabase** (Publication → Classement → Copier le script) pour activer les propositions et « En ligne maintenant ».

## 1.13.0

- **Clips jugés comme en compétition** : une corde se prend avec l'**avant** de la voiture, une zone extérieure avec l'**arrière**. Le launcher apprend tout seul l'orientation de la voiture dans le jeu. Les anciens tours restent jugés avec le centre de la voiture.
- **Zones longues notées sur la longueur** : la note dépend de la part de la zone parcourue en glisse (par exemple 80 % de la boucle de Biķernieki). Il faut au moins 20 % de la zone pour qu'elle compte.
- **Note par zone** : chaque portion autour d'un clip a sa note sur 100 (angle, vitesse, ligne, clip, pénalités). Visible dans « Comparer » et dans le jeu.
- **La note dans le jeu juste après la run** : note, angle, vitesse, ligne, pénalités, chaque clip (✓ ou ✗, % des zones longues) et la note de chaque zone. Bouton « Note » de l'appli pour la revoir.
- **Résumé tandem dans le jeu** : écart moyen avec l'autre voiture et écart à chaque clip, dès la fin de la run ; puis la note du chase quand le launcher l'a calculée.
- **Admins : « Ligne des meilleures runs »** dans Parcours drift. Le launcher fait la moyenne des meilleures runs notées sur le parcours (une par pilote, les meilleures comptent plus) et la propose comme ligne de référence. Publie le parcours pour l'utiliser.
- Appli en jeu 2.3.

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
