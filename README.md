# LKS Launcher — Lowkey Syndicate

Launcher Assetto Corsa du **Lowkey Syndicate** (dans l'esprit de Content Manager) :

- **Contenu LKS toujours à jour** : les voitures et circuits publiés par les admins s'installent et se mettent à jour tout seuls chez tous les membres (vérifié au démarrage puis toutes les 5 min).
- **Solo** : entraînement, course contre l'IA ou hotlap, avec choix de la voiture, de la livrée, du circuit et du tracé, de l'heure, de la météo, des températures, du grip, des aides et des dégâts.
- **Serveurs** : liste des serveurs LKS avec joueurs et ping en direct, choix d'une voiture libre et connexion en un clic. Le launcher vérifie aussi qu'il ne manque pas de contenu pour le serveur.
- **Publication (admins)** : on coche ses voitures et circuits modifiés, on clique sur « Publier », et tout le monde reçoit la nouvelle version.
- **Graphismes en 1 clic** : installe le Custom Shaders Patch officiel et applique un préréglage adapté à ta carte graphique (Performance, Équilibré, Qualité, Ultra).
- **Soutenir** : page de dons (PayPal, Ko-fi, Tipeee…) avec objectif du mois, entièrement gérée depuis l'onglet Publication.
- **Boutique** : page « Bientôt disponible », qui s'ouvre sur ta boutique dès que tu l'actives dans Publication.
- **Mise à jour automatique du launcher** via les releases GitHub.

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
5. Lancer *Run workflow* avec **release** cochée, puis **approuver la demande dans SignPath**. Chaque release doit être approuvée à la main ; le workflow attend jusqu'à 2 h. L'installeur signé est ensuite publié, et `latest.yml` est recalculé pour que la mise à jour automatique accepte le fichier signé.

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
