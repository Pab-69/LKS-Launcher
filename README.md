# LKS Launcher — Lowkey Syndicate

Launcher Assetto Corsa du **Lowkey Syndicate** (dans l'esprit de Content Manager) :

- **Contenu LKS toujours à jour** : les voitures et circuits publiés par les admins s'installent et se mettent à jour tout seuls chez tous les membres (vérifié au démarrage puis toutes les 5 min).
- **Solo** : entraînement, course contre l'IA ou hotlap, avec choix de la voiture, de la livrée, du circuit et du tracé, de l'heure, de la météo, des températures, du grip, des aides et des dégâts.
- **Serveurs** : liste des serveurs LKS avec joueurs et ping en direct, choix d'une voiture libre et connexion en un clic. Le launcher vérifie aussi qu'il ne manque pas de contenu pour le serveur.
- **Publication (admins)** : on coche ses voitures et circuits modifiés, on clique sur « Publier », et tout le monde reçoit la nouvelle version.
- **Graphismes en 1 clic** : installe le Custom Shaders Patch officiel et applique un préréglage adapté à ta carte graphique (Performance, Équilibré, Qualité, Ultra).
- **Soutenir** : page de dons (PayPal, Ko-fi, Tipeee…) avec objectif du mois, entièrement gérée depuis l'onglet Publication.
- **Boutique** : page « Bientôt disponible », qui s'ouvre sur ta boutique dès que tu l'actives dans Publication.
- **Héberger une partie** gratuitement depuis son PC, avec le serveur inclus dans Assetto Corsa : ouverture automatique des ports de la box, codes d'invitation, compatible Radmin VPN, ZeroTier et Tailscale.
- **Events** : calendrier des soirées, compte à rebours sur l'accueil, notification 15 min avant et bouton « Rejoindre ».
- **Sessions rapides** : sessions solo prêtes à lancer depuis l'accueil.
- **Setups partagés** : les réglages des voitures LKS arrivent chez chacun, à côté de ses propres setups (préfixe `LKS_`), sans jamais rien écraser.
- **Discord Rich Presence** : « Joue à Lowkey Syndicate — Drift sur Haruna en BMW M2 », avec des boutons pour rejoindre le Discord et télécharger le launcher.
- **Historique des publications** : qui a publié quoi, et quand (pratique avec plusieurs admins).
- **Site vitrine** sur GitHub Pages, généré automatiquement.
- **Mise à jour automatique du launcher** via les releases GitHub.

**Lien de téléchargement permanent**, à partager partout : https://github.com/Pab-69/LKS-Launcher/releases/latest/download/LKS-Launcher-Setup.exe

> **About (English):** LKS Launcher is a free and open source (GPL-3.0) launcher for the racing game Assetto Corsa, made for the Lowkey Syndicate community. It keeps the group's cars and tracks in sync, starts single-player sessions, joins the group's servers, installs the official Custom Shaders Patch with optimized graphics presets, and lets admins publish content updates. Windows installer: see [Releases](https://github.com/Pab-69/LKS-Launcher/releases).

---

## Pour les membres

1. Télécharger `LKS-Launcher-Setup-x.y.z.exe` dans les [Releases](https://github.com/pab-69/lks-launcher/releases) et l'installer. Si Windows affiche « Windows a protégé votre ordinateur », cliquer sur **Informations complémentaires → Exécuter quand même** (l'installeur n'est pas encore signé, voir plus bas).
2. Au premier lancement, le launcher détecte Assetto Corsa (Steam) et ton pseudo Steam. Vérifie-les dans **Paramètres**.
3. Le contenu LKS se télécharge tout seul. Pour tout lancer à la main : **Contenu → Tout synchroniser**.
4. **Steam doit être ouvert** pour lancer le jeu.
5. **Plus besoin de retélécharger l'installeur** : le launcher se met à jour tout seul. Il vérifie au démarrage puis toutes les 30 minutes, et ne télécharge que les parties qui ont changé. Quand une version est prête, un bandeau propose **« Redémarrer et mettre à jour »** (quelques secondes, sans avertissement Windows). Sinon, elle s'installe à la fermeture du launcher. Une fenêtre « Quoi de neuf » résume ensuite les nouveautés.

Si tu as déjà des voitures LKS installées à la main, le launcher compare les fichiers au premier démarrage et ne retélécharge que ce qui est différent.

### Graphismes (Custom Shaders Patch)

Onglet **Graphismes** → **Tout configurer pour moi**. Le launcher :

1. télécharge le **Custom Shaders Patch** (CSP) depuis son site officiel [acstuff.club/patch](https://acstuff.club/patch/), exactement comme Content Manager. Rien n'est hébergé par LKS, et seules les versions publiques gratuites sont utilisées ;
2. détecte ta carte graphique et ton écran, puis applique le préréglage conseillé :

| Préréglage | Pour qui | Points clés |
| --- | --- | --- |
| Performance | PC portable, carte graphique intégrée | Météo dynamique, ombres 2048, upscaling AMD FSR |
| Équilibré | La plupart des PC de jeu | TAA + netteté AMD, réflexions SSLR, ombres 4096 |
| Qualité | RTX 2070 / 3060 Ti / RX 6700 et plus | Occlusion ambiante, rayons volumétriques, ombres des phares, MSAA 4x |
| Ultra | RTX 3080 / 4070 et plus, RX 6800 et plus | Réflexions Hi-Z, ombres des nuages, herbe avec ombres, détails lointains |

Les réglages sont écrits dans `Documents/Assetto Corsa/cfg/video.ini` et `cfg/extension/*.ini`, au même endroit que Content Manager. Seules les options gérées par le préréglage sont modifiées : le mode caméra (VR, triple écran), la limite d'images par seconde et tes autres réglages sont conservés. Les fichiers d'origine sont sauvegardés une première fois et le bouton **Restaurer mes réglages d'origine** les remet en place. Tout reste modifiable en jeu dans le menu du CSP.

Le CSP a besoin du *Visual C++ Redistributable (x86)* de Microsoft. Le launcher vérifie s'il est installé et donne le lien de téléchargement s'il manque.

Côté admins, l'onglet Publication permet d'imposer une **version de CSP** à tout le groupe, utile si un serveur exige une version précise. Sinon, chacun reçoit la version recommandée par acstuff.

---

## Pour les admins : distribuer le contenu

### Comment ça marche

```
PC de l'admin                       GitHub (release "content" du dépôt)                 PC des membres
content/cars/lks_e36  ──Publier──▶  car-lks_e36-<version>.zip + manifest.json  ──▶  Synchro automatique
```

- La « version » d'une voiture ou d'un circuit est une empreinte (sha256) de **tous ses fichiers**. Dès que tu modifies un fichier (physique, livrée, son…), la version change.
- Les membres comparent leur version à celle du manifeste. Si elle diffère, le dossier est retéléchargé, vérifié (sha256) puis remplacé d'un coup : pas de mélange entre l'ancienne et la nouvelle version, et les fichiers supprimés disparaissent aussi.
- Comme tout le monde a exactement les mêmes fichiers, les checksums des serveurs passent.

### Mise en place (une seule fois)

Le contenu est hébergé dans la release **`content`** de ce dépôt. C'est une pré-version : elle n'est jamais prise pour une version du launcher. Les membres la téléchargent sans compte.

1. Crée un token GitHub *fine-grained* : GitHub → Settings → Developer settings → Fine-grained tokens.
2. Donne-lui accès **uniquement** au dépôt `Pab-69/LKS-Launcher`, avec la permission **Contents : Read and write**.
3. Dans le launcher : **Paramètres → Accès admin**, colle le token et clique sur **Enregistrer** (il est chiffré sur ton PC), puis **Tester l'accès**.
4. L'onglet **Publication** apparaît.

### Publier / mettre à jour une voiture ou un circuit

1. Modifie ta voiture dans ton dossier `assettocorsa/content/cars/...` comme d'habitude.
2. **Publication** → coche la voiture (le bouton « Détecter les modifs » montre ce qui a changé) → **Publier**.
3. C'est tout : les launchers des membres la mettent à jour dans les 5 minutes, ou tout de suite s'ils cliquent sur « Actualiser ».

Dans le même onglet, tu peux aussi gérer la **liste des serveurs LKS** (IP + port HTTP), les **actus** et le **message du jour** affichés sur l'accueil.

> Le contenu officiel Kunos (`ks_…`) n'est jamais publié, car tout le monde l'a déjà.

En ligne de commande (pratique pour les gros packs) :

```bash
GITHUB_TOKEN=github_pat_xxx npm run publish-content -- --ac "C:\...\assettocorsa" car:lks_bmw_e36 track:lks_touge
```

### Héberger une partie entre potes (gratuit)

Onglet **Héberger** : choisis le circuit, les voitures autorisées, le nombre de places, le mode (libre ou course), la météo et le mot de passe, puis **Lancer et rejoindre**. Le launcher :

1. prépare le serveur officiel inclus avec le jeu (`assettocorsa/server/acServer.exe`) : configuration et fichiers de contenu nécessaires ;
2. ouvre automatiquement les ports de la box (UPnP : TCP/UDP 9600 et TCP 8081), puis les referme à l'arrêt ;
3. affiche un **code d'invitation** par réseau : internet via la box, Radmin VPN, ZeroTier, Tailscale, Hamachi ou réseau local. Les potes le collent dans *Serveurs → Rejoindre avec un code*. Le code contient l'adresse et le mot de passe.

Si personne n'arrive à se connecter :

- **Pare-feu Windows** : au premier lancement, autorise « acServer » sur les réseaux privés et publics.
- **Box** : active l'UPnP. Avec une IP partagée, la 4G ou la 5G, l'ouverture des ports ne suffit pas.
- **Réseau virtuel gratuit** : installez tous Radmin VPN ou ZeroTier et rejoignez le même réseau. Le launcher affiche alors un code pour ce réseau.

#### VPN (quand l'ouverture des ports ne marche pas)

Avec une IP partagée, la 4G ou la 5G, la box ne peut pas ouvrir de ports. Tout le monde passe alors par un réseau privé commun, configuré une fois par un admin dans **Publication → VPN** :

| | ZeroTier | Radmin VPN |
| --- | --- | --- |
| Prix | Gratuit (offre « Personal ») | Gratuit |
| Limite | 10 appareils, 1 réseau | Pas de limite gênante |
| Côté membre | **Un clic** dans le launcher : installation officielle et connexion (autorisation administrateur Windows) | Installation et connexion guidées : nom et mot de passe du réseau à copier |
| Compte | Seulement pour l'admin (my.zerotier.com) | Aucun |

Pour ZeroTier, passe le réseau en « Public » et colle les règles proposées par le launcher : seuls les ports du jeu passent par le réseau, les PC des membres restent invisibles les uns pour les autres.

Le launcher détecte la connexion au VPN et ajoute un code d'invitation pour ce réseau. Quand les ports de la box n'ont pas pu s'ouvrir, la carte VPN est mise en avant. Si un pote colle un code VPN sans être connecté au VPN, le launcher lui propose de le rejoindre.

Le PC de l'hôte doit rester allumé pendant la partie. L'hôte peut jouer en même temps : le serveur consomme très peu.

### Events, sessions, setups, Discord

Tout se gère dans l'onglet **Publication** :

- **Calendrier des events** : titre, date, serveur, durée et description. Les membres voient le prochain event avec un compte à rebours et reçoivent une notification Windows 15 min avant, puis au départ.
- **Sessions solo** : dans l'onglet **Solo**, règle une session puis clique sur **Partager**. Elle apparaît sur l'accueil de tout le monde. Les sessions se suppriment dans Publication.
- **Setups partagés** : enregistre tes setups dans le jeu, coche les voitures dans Publication, puis clique sur **Publier les setups**.
- **Discord** : crée une application nommée « Lowkey Syndicate » sur [discord.com/developers/applications](https://discord.com/developers/applications), puis colle son *Application ID* et le lien d'invitation de ton serveur. Chaque membre peut désactiver son statut Discord dans les Paramètres.
- **Historique** : chaque publication est enregistrée avec le compte GitHub de l'admin.
- **Bot Discord** : le code est dans [`bot/`](bot) (classements, records, catégories, soirées, direct, récap, tickets, modération). Installation et commandes : [bot/README.md](bot/README.md).

### Télémétrie et classement

Chaque tour complet est enregistré sur le PC du pilote (onglet **Télémétrie**) : en direct, liste des tours, classement, comparaison entre deux tours, export/import `.lkslap`, appli en jeu (CSP) et tableau de bord sur téléphone. SimHub et Crew Chief sont détectés et peuvent se lancer avec le jeu.

Pour un **classement partagé** entre tous les membres (gratuit) :

1. Crée un projet sur [supabase.com](https://supabase.com/dashboard/new).
2. Dans **SQL Editor**, colle le contenu de [`docs/leaderboard.sql`](docs/leaderboard.sql) (ou **Publication → Classement → Copier le script**) et lance-le.
3. Dans **Project Settings → API**, copie l'URL du projet et la clé *anon public*, colle-les dans **Publication → Classement**, puis **Enregistrer**.

Le même script active la liste des parties hébergées depuis le launcher (onglet **Serveurs**) : à relancer après une mise à jour du launcher qui le demande.

Chaque pilote garde une seule entrée par voiture, circuit et type (chrono ou drift). La base ne la remplace que par un meilleur résultat. Sans Supabase, le classement montre les tours du PC et ceux importés.

#### Notation du drift

Au drift, le chrono ne compte pas. Chaque run reçoit une note sur 100 :

| Critère | Points | Calcul |
| --- | --- | --- |
| Angle | 35 | Angle moyen sur la partie notée (40° de moyenne = note max) |
| Vitesse | 30 | Vitesse moyenne comparée à la run de référence |
| Ligne et clips | 35 | Clips pris en glisse (plus on est près, plus ça rapporte) et écart avec la ligne de référence |
| Pénalités | − | Tête-à-queue −20, redressement en pleine glisse −3, sortie de piste −5 |

**Modes** : chaque run est notée dans les trois modes à la fois (Débutant, Normal, Compétition), avec un classement par mode. Les règles se changent par circuit dans **Parcours drift → Règles** : pour chaque faute (roues dehors, regrip, drift dans le mauvais sens, tête-à-queue, clip raté, contact, dépassement, leader perdu), choisir *Ignoré*, *Points en moins* ou *Run à 0*.

**Tandem** : l'appli en jeu (CSP) enregistre la run quand une voiture roule devant toi (moins de 35 m), car la télémétrie standard du jeu ne voit que ta voiture. Le launcher importe la run et note le chase : proximité 35, angle copié 25, ligne du leader 20, drift 20, moins les pénalités.

**Parcours officiels** : les circuits du groupe ont un parcours relevé sur le circuit lui-même (`src/main/telemetry/courses/`, outil `tools/track-analysis/`) : limites de piste exactes (contour de la surface « piste valide », à 10 cm près), clips au centre du marquage peint au sol, départ / début du drift / arrivée sur les lignes peintes, et une ligne de référence qui passe par chaque clip (centre du clip, milieu de la bande d'une zone), la plus fluide possible et dans les limites.

**Catégories** (Débutant, Amateur, Pro) : chaque pilote est noté dans la notation de sa catégorie, et la catégorie se joue sur la moyenne de ses 20 dernières runs, les 0 compris (au moins 10 runs). À l'installation, elle est calculée avec toutes les notes déjà marquées (runs et records). 85 ou plus de moyenne dans la notation de sa catégorie : catégorie au-dessus ; moins de 60 : catégorie en dessous ; 10 runs de répit après un changement. Le serveur du groupe tient la fenêtre de chaque pilote (`lks_category_push`, `docs/leaderboard.sql`).

**Clips automatiques** : si un circuit installé a une ligne IA (`ai/fast_lane.ai`), le launcher en tire la ligne de référence et place une corde à l'apex et un mur à l'entrée de chaque virage serré. Ce tracé sert tant qu'aucun parcours n'est publié.

**Battle en jeu** : onglet Battle de l'appli, défie un pilote ; une fois accepté, les deux se placent sur la ligne de start et cliquent **Prêt**, puis les feux partent en même temps chez les deux. Deux runs, les rôles s'inversent.

**Battle** : quand deux pilotes font deux runs l'un derrière l'autre en inversant les rôles (moins de 20 min d'écart, même circuit), le launcher juge la battle. Chaque pilote a (note en lead + note en chase) / 2. Si l'écart est sous le seuil du mode (Débutant 1, Normal 2, Compétition 3 points), c'est *one more time*. L'appli en jeu enregistre la run où tu suis et celle où tu es devant, donc un seul PC a la battle complète.

**Championnat** (onglet Championnat, créé par les admins) : une liste de manches avec circuit, format (solo drift, tandem ou battle), mode et dates. En solo et en tandem, c'est la meilleure note de chaque pilote pendant la manche qui compte. En battle, il y a des qualifs en solo pendant la manche, puis un tableau à élimination (1 contre N, 2 contre N-1…), gagné par la dernière battle sans one more time. Les points se donnent par place (25, 18, 15… modifiables) et s'additionnent au classement général. Avec le classement partagé, les résultats d'une manche sont envoyés avec ses propres règles (`version@manche`). Sans lui, le championnat se calcule avec les tours présents sur le PC.

**Fantôme** : l'appli en jeu enregistre chaque tour complet (position et orientation de la voiture, 20 fois par seconde). Le launcher le range avec le tour et le partage avec le record. Le bouton **Fantôme** (Tours ou Classement) écrit ce tour dans `apps/lua/LKS/ghost.json`. Au prochain passage de la ligne, une voiture translucide le rejoue (avance réglable, attente si tu décroches). Le fantôme est dessiné avec la forme de ta voiture et n'a pas de collisions.

Les admins placent les clips dans **Télémétrie → Parcours drift** : choisir une run propre (elle donne la ligne et la vitesse de référence), régler le départ et l'arrivée, cliquer sur la carte pour poser les clips (intérieur : la corde, extérieur : le mur), puis **Publier**. Quand un parcours change, les runs sont notées à nouveau et le classement drift de ce circuit repart avec les nouvelles règles. Sans clips, seuls l'angle et la vitesse comptent.

### Site vitrine (GitHub Pages)

Le site présente le groupe et le launcher : logo, vitrine, actus, bouton de téléchargement, liens Discord et dons. Il est reconstruit à chaque release et chaque nuit, à partir du contenu publié. Le logo n'est jamais ajouté au code.

Mise en route, une seule fois :

1. *Settings → Pages* → *Source* : **GitHub Actions**.
2. *Settings → Secrets and variables → Actions → Variables* : crée `SITE_ENABLED` = `true`.
3. *Actions → Site vitrine → Run workflow*. Le site est ensuite en ligne sur https://pab-69.github.io/LKS-Launcher/

### Serveurs

Pour chaque serveur, il faut renseigner l'**IP** et le **port HTTP** (`HTTP_PORT` dans `server_cfg.ini`, souvent 8081). Le launcher interroge `/INFO` pour les joueurs et `/JSON|<steamid>` pour les places libres. Ça marche avec le serveur officiel et avec AssettoServer.

---

## Développement

```bash
npm install
npm start          # lance le launcher
npm test           # tests (synchro complète publication → membres, race.ini, zip, etc.)
npm run dist       # construit l'installeur Windows dans dist/ (à faire sous Windows)
```

### Avant la première release

- `lks.config.json` : URL du manifeste et dépôt de contenu intégrés dans le launcher (par défaut la release `content` de `Pab-69/LKS-Launcher`).
- `package.json` → `build.publish` : dépôt où sont publiées les versions du launcher (par défaut `pab-69/lks-launcher`). **Ce dépôt doit être public** pour que la mise à jour automatique marche chez les membres.

### Changer les voitures de la vitrine

Modifie le dossier de l'identité visuelle (photos + `showcase.json`) et republie-le depuis *Publication → Identité visuelle* (voir plus bas). Tous les launchers se mettent à jour, sans nouvelle version.

### Sortir une nouvelle version du launcher

1. Change `version` dans `package.json` (ex. `1.0.1`), ajoute la section correspondante dans [`CHANGELOG.md`](CHANGELOG.md) (elle sert de notes de version et de fenêtre « Quoi de neuf »), puis pousse sur `main`.
2. Onglet *Actions* → *Build & release* → *Run workflow*, case **release** cochée. Pousser un tag `v1.0.1` depuis ton PC fait la même chose.
3. GitHub Actions construit l'installeur Windows, le signe si la signature est configurée, puis publie la release. Les launchers déjà installés se mettent à jour tout seuls.

### Construire l'installeur

- **Sans release** : onglet *Actions* du dépôt → *Build & release* → *Run workflow*. L'installeur `LKS-Launcher-Setup-x.y.z.exe` est téléchargeable dans les *Artifacts* du run.
- **Avec release** (les membres reçoivent la mise à jour) : même chose avec la case **release** cochée, ou un tag `vX.Y.Z` (voir plus haut).

### Signer l'installeur (message « Windows a protégé votre ordinateur »)

Windows SmartScreen affiche ce message pour tout `.exe` téléchargé qui n'est pas signé par un éditeur dont l'identité a été vérifiée. Un certificat **auto-signé ne sert à rien** : Windows ne lui fait pas confiance, sauf à l'installer à la main sur chaque PC, ce qui est à déconseiller. Il faut un certificat délivré à ton nom (ou à celui d'une structure) après vérification d'identité. Personne d'autre ne peut l'obtenir à ta place.

Options, de la moins chère à la plus chère :

| Option | Coût indicatif | Remarques |
| --- | --- | --- |
| **Azure Trusted Signing** (Microsoft) | ~10 $/mois | Le plus simple avec GitHub Actions. Vérifier les conditions d'éligibilité (pays, ancienneté) sur la page Microsoft. |
| **SignPath Foundation** | gratuit | Seulement pour les projets open source (dépôt public + licence libre). |
| **Certificat OV** (Certum, Sectigo…) | ~100–400 €/an | Livré sur clé USB ou HSM cloud. Certum propose une offre « Open Source » moins chère. |
| **Certificat EV** | ~300–600 €/an | Ne supprime plus automatiquement l'avertissement depuis 2024 : la réputation se construit avec les téléchargements. |
| **Microsoft Store** | gratuit (compte développeur individuel) | Microsoft signe l'application, pas d'avertissement ; demande un empaquetage MSIX et des mises à jour par le Store. |

Même signé, un tout nouveau certificat peut encore déclencher SmartScreen pendant quelques jours, le temps qu'il gagne en réputation.

Le workflow est déjà prêt à signer : ajoute les secrets dans *Settings → Secrets and variables → Actions* :

- SignPath : voir la section suivante ;
- certificat `.pfx` : `WIN_CSC_LINK` (le fichier encodé en base64) et `WIN_CSC_KEY_PASSWORD` ;
- Azure Trusted Signing : secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` et variables `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER`.

En attendant, les membres font **« Informations complémentaires → Exécuter quand même »** une seule fois. Les mises à jour suivantes s'installent ensuite toutes seules, sans repasser par ce message.

### Signature gratuite avec SignPath Foundation

Le launcher est un logiciel libre (GPL-3.0), sans logo ni visuel propriétaire dans l'installeur : il remplit donc les conditions de [SignPath Foundation](https://signpath.org/terms). Le dépôt est prêt : [politique de confidentialité](PRIVACY.md), section « Code signing policy » ci-dessous, configuration d'artefact dans [`.signpath/artifact-configuration.xml`](.signpath/artifact-configuration.xml) et étapes de signature dans le workflow.

Ce qu'il reste à faire, et que toi seul peux faire :

1. **Activer la double authentification** sur ton compte GitHub. SignPath l'exige pour tous les membres de l'équipe.
2. **Postuler** sur [signpath.org/apply](https://signpath.org/apply) avec l'adresse du dépôt. La réponse prend en général quelques jours à quelques semaines.
3. Une fois accepté, dans SignPath :
   - activer la double authentification sur ton compte SignPath ;
   - dans le projet (slug `lks-launcher`), coller le contenu de `.signpath/artifact-configuration.xml` comme configuration d'artefact par défaut ;
   - relier le projet au dépôt GitHub (*Trusted Build System* « GitHub.com ») et vérifier que la politique de signature s'appelle `release-signing`, avec toi comme approbateur ;
   - créer un jeton d'API pour un utilisateur CI qui a le droit de soumettre des demandes de signature.
4. Dans GitHub (*Settings → Secrets and variables → Actions*) :
   - **secret** `SIGNPATH_API_TOKEN` : le jeton d'API ;
   - **variable** `SIGNPATH_ORGANIZATION_ID` : l'identifiant de l'organisation SignPath ;
   - variables facultatives `SIGNPATH_PROJECT_SLUG` (par défaut `lks-launcher`), `SIGNPATH_POLICY_SLUG` (par défaut `release-signing`) et `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`.
5. Ajouter la **variable** `WIN_PUBLISHER_NAME` avec le nom exact du signataire du certificat (pour SignPath Foundation : `SignPath Foundation`). Le launcher exigera alors ce signataire pour ses mises à jour. Retirer aussi l'acceptation des mises à jour non signées dans `src/main/main.js` (commentaire `TODO` dans `setupUpdater`).
6. Lancer *Run workflow* avec **release** cochée, puis **approuver la demande dans SignPath**. Chaque release doit être approuvée à la main ; le workflow attend jusqu'à 2 h. L'installeur signé est ensuite publié, et `latest.yml` est recalculé pour que la mise à jour automatique accepte le fichier signé.

### Identité visuelle (logo, vitrine)

Le logo, l'icône de fenêtre et les photos de la vitrine **ne sont pas dans ce dépôt** : ils appartiennent à l'association. Un admin les publie depuis le launcher (onglet *Publication → Identité visuelle → Publier depuis un dossier…*) en choisissant un dossier qui contient :

| Fichier | Rôle |
| --- | --- |
| `logo.png` | logo principal (obligatoire) |
| `logo-wide.png` | logo horizontal de la barre de titre |
| `icon.png` | icône de la fenêtre (carrée) |
| `showcase.json` + photos `.jpg` | voitures de la vitrine : `[{ "image": "bmw-m2.jpg", "title": "BMW M2", "subtitle": "…" }]` |

Chaque launcher les télécharge et les garde en cache. Tant que rien n'est publié, il affiche un thème neutre.

### Licence

Le **code** est un logiciel libre sous licence [GPL-3.0](LICENSE). Chacun peut l'utiliser et le modifier, mais toute version redistribuée doit rester sous GPL-3.0, avec son code source. Les **noms, le logo et les visuels** du Lowkey Syndicate ne sont pas couverts par cette licence : voir [TRADEMARKS.md](TRADEMARKS.md). Les polices sont sous SIL Open Font License (voir `src/renderer/fonts/`).

## Politique de signature de code / Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

> Candidature en cours : tant qu'elle n'a pas été acceptée, les installeurs publiés ne sont pas signés. *(Application pending: releases are unsigned until it is approved.)*

- Committers and reviewers: [Pab-69](https://github.com/Pab-69)
- Approvers: [Pab-69](https://github.com/Pab-69)
- Privacy policy: see [PRIVACY.md](PRIVACY.md). The launcher has no telemetry; it only contacts the services listed there (GitHub for content, branding and updates, the official Custom Shaders Patch site when the user installs it, and the game servers the user chooses).

### Architecture

| Fichier | Rôle |
| --- | --- |
| `src/main/sync.js` | Manifeste, comparaison des versions, téléchargement reprenable + sha256, installation atomique |
| `src/main/publisher.js` / `github.js` | Publication admin vers les releases GitHub, nettoyage des anciennes archives |
| `src/main/launch.js` | Génération de `race.ini` / `assists.ini`, lancement de `acs.exe`, résultats (`race_out.json`) |
| `src/main/servers.js` | Requêtes `/INFO` et `/JSON` des serveurs AC |
| `src/main/csp.js` / `graphics.js` | Installation du CSP officiel, préréglages graphiques, sauvegarde / restauration |
| `src/main/acContent.js` | Lecture des voitures, livrées, circuits, tracés et météos installés |
| `src/main/paths.js` | Détection de Steam, d'Assetto Corsa et du compte Steam |
| `src/renderer/` | Interface (HTML/CSS/JS, sans framework) |

Les données du launcher (`settings.json`, `installed.json`, cache du manifeste) se trouvent dans `%APPDATA%/LKS Launcher`.
