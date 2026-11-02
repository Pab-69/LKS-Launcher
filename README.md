# LKS Launcher — Lowkey Syndicate

Launcher Assetto Corsa du **Lowkey Syndicate** (dans l'esprit de Content Manager) :

- **Contenu LKS toujours à jour** : les voitures et circuits publiés par les admins s'installent et se mettent à jour tout seuls chez tous les membres (vérifié au démarrage puis toutes les 5 min).
- **Solo** : entraînement, course contre l'IA ou hotlap, avec choix de la voiture, de la livrée, du circuit et du tracé, de l'heure, de la météo, des températures, du grip, des aides et des dégâts.
- **Serveurs** : liste des serveurs LKS avec joueurs et ping en direct, choix d'une voiture libre et connexion en un clic. Le launcher vérifie aussi qu'il ne manque pas de contenu pour le serveur.
- **Publication (admins)** : on coche ses voitures et circuits modifiés, on clique sur « Publier », et tout le monde reçoit la nouvelle version.
- **Graphismes en 1 clic** : installe le Custom Shaders Patch officiel et applique un préréglage adapté à ta carte graphique (Performance, Équilibré, Qualité, Ultra).
- **Mise à jour automatique du launcher** via les releases GitHub.

---

## Pour les membres

1. Télécharger `LKS-Launcher-Setup-x.y.z.exe` dans les [Releases](https://github.com/pab-69/lks-launcher/releases) et l'installer.
2. Au premier lancement, le launcher détecte Assetto Corsa (Steam) et ton pseudo Steam. Vérifie-les dans **Paramètres**.
3. Le contenu LKS se télécharge tout seul. Pour tout lancer à la main : **Contenu → Tout synchroniser**.
4. **Steam doit être ouvert** pour lancer le jeu.

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
PC de l'admin                       GitHub (dépôt lks-content, release "content")       PC des membres
content/cars/lks_e36  ──Publier──▶  car-lks_e36-<version>.zip + manifest.json  ──▶  Synchro automatique
```

- La « version » d'une voiture ou d'un circuit est une empreinte (sha256) de **tous ses fichiers**. Dès que tu modifies un fichier (physique, livrée, son…), la version change.
- Les membres comparent leur version à celle du manifeste. Si elle diffère, le dossier est retéléchargé, vérifié (sha256) puis remplacé d'un coup : pas de mélange entre l'ancienne et la nouvelle version, et les fichiers supprimés disparaissent aussi.
- Comme tout le monde a exactement les mêmes fichiers, les checksums des serveurs passent.

### Mise en place (une seule fois)

1. Crée un dépôt GitHub **public** `pab-69/lks-content` avec au moins un fichier (un README suffit).
   Les membres téléchargent depuis ce dépôt sans compte, c'est pourquoi il doit être public.
2. Crée un token GitHub *fine-grained* : GitHub → Settings → Developer settings → Fine-grained tokens.
   Donne-lui accès **uniquement** au dépôt `lks-content`, avec la permission **Contents : Read and write**.
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

- `lks.config.json` : URL du manifeste et dépôt de contenu intégrés dans le launcher (par défaut `pab-69/lks-content`).
- `package.json` → `build.publish` : dépôt où sont publiées les versions du launcher (par défaut `pab-69/lks-launcher`). **Ce dépôt doit être public** pour que la mise à jour automatique marche chez les membres.

### Changer les voitures de la vitrine

Les photos affichées sur l'accueil (diaporama et « Le Garage ») et pendant le jeu sont dans `src/renderer/img/cars/`, et leur liste est dans `src/renderer/showcase.js`. Pour les changer sans sortir une nouvelle version du launcher, on peut aussi ajouter au manifeste un champ `"showcase": [{ "image": "https://…", "title": "…", "subtitle": "…" }]`.

### Sortir une nouvelle version du launcher

1. Change `version` dans `package.json` (ex. `1.0.1`).
2. `git tag v1.0.1 && git push --tags`
3. GitHub Actions construit l'installeur Windows et publie la release. Les launchers déjà installés se mettent à jour tout seuls.

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
