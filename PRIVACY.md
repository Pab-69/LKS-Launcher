# Politique de confidentialité / Privacy policy

*LKS Launcher — Lowkey Syndicate*

## En bref

- Pas de compte, pas de publicité, **aucune statistique d'utilisation**.
- La télémétrie de conduite (tes tours) reste sur ton PC. Tes records et la note de tes runs partent au serveur du groupe, si les admins l'ont activé et si tu le laisses activé.
- **Ton Steam ID ne quitte jamais ton PC**, sauf vers les serveurs de jeu que tu rejoins (le jeu l'exige). Le serveur du groupe ne le reçoit pas : il te connaît par ton nom de pilote et un identifiant tiré au hasard par ton launcher.
- Le launcher ne collecte pas de données personnelles et ne les envoie à aucun service d'analyse.
- Il contacte seulement les services décrits ci-dessous, pour faire ce que l'utilisateur ou l'administrateur du groupe lui demande.

## Connexions réseau

| Service | Quand | Ce qui est envoyé |
| --- | --- | --- |
| **GitHub** (`github.com`, `objects.githubusercontent.com`, `api.github.com`) | Au démarrage puis toutes les 5 minutes (manifeste du contenu), lors des téléchargements de voitures, de circuits et de l'identité visuelle (logo, photos), et pour les mises à jour du launcher | Requêtes de téléchargement standard (adresse IP, version du navigateur intégré). Aucune donnée personnelle. |
| **Site officiel du Custom Shaders Patch** (`acstuff.club`) | Seulement quand l'utilisateur ouvre l'onglet Graphismes ou installe le CSP | Requêtes de téléchargement standard |
| **Serveurs de jeu Assetto Corsa** choisis par le groupe ou ajoutés par l'utilisateur | Dans l'onglet Serveurs et pour rejoindre une partie | Le **Steam ID** de l'utilisateur, envoyé au serveur choisi pour connaître les places libres et se connecter, comme le font le jeu et Content Manager |
| **API GitHub, uniquement pour les administrateurs** | Quand un administrateur publie du contenu | Les fichiers publiés et le jeton GitHub de l'administrateur, chiffré sur son PC |
| **Ta box internet (UPnP)**, sur ton réseau local uniquement | Quand tu héberges une partie avec l'ouverture automatique des ports activée | Demandes d'ouverture et de fermeture des ports du serveur, et lecture de l'adresse IP publique |
| **ZeroTier** (`download.zerotier.com` et le réseau ZeroTier), seulement si le groupe l'utilise | Quand tu cliques sur « Installer ZeroTier » ou « Rejoindre le VPN » | Téléchargement de l'installeur officiel. Ensuite, le logiciel ZeroTier relie ton PC au réseau privé du groupe ([politique de ZeroTier](https://www.zerotier.com/privacy/)) |
| **Serveur du groupe** (serveur des admins, ou projet Supabase du groupe), seulement si les admins l'ont configuré | Quand tu bats un record, à la fin de chaque run, pendant les soirées, toutes les minutes quand le launcher est ouvert, et pour afficher classements, galerie et propositions | Toujours **sans Steam ID ni adresse e-mail**. **Records** : ton nom de pilote, un identifiant tiré au hasard par ton launcher, la voiture, le circuit, ton temps ou ta note et les données du tour (vitesse, pédales, rapport, angle, position sur la piste ; fantôme et trajectoire du leader en tandem ; noms, voitures et notes des deux pilotes pour une battle). **Notes des runs** (gardées 30 jours). **Direct des soirées** (angle, vitesse, clips ; effacé 1 min après). **Présence** : nom, état, serveur de jeu rejoint (effacée 15 min après). **Partie hébergée** : nom, adresses pour la rejoindre, ports, circuit (effacée 15 min après l'arrêt). **Propositions** (180 jours) et **photos** que tu envoies, sans leurs métadonnées (GPS, appareil…). Désactivable : Paramètres (« Me montrer en ligne aux membres », « Partager mon direct pendant les soirées ») et Télémétrie → Outils (« Partager mes runs avec le groupe »). Pour tout effacer : demande à un admin |
| **Discord du groupe** (webhooks réglés par les admins) | Annonces (records, battles, propositions, photos, soirées) et, seulement si tu cliques « Envoyer aux admins », un rapport de plantage | Ton nom de pilote et l'annonce. Le rapport de plantage est nettoyé avant l'envoi : Steam ID, nom de session Windows, adresses IP et e-mails sont masqués ([politique de Discord](https://discord.com/privacy)) |
| **Tableau de bord sur téléphone**, sur ton réseau local uniquement | Seulement si tu l'actives | Les données de conduite en direct, servies par ton PC aux appareils de ton réseau |
| **Liens de dons / boutique** | Seulement quand l'utilisateur clique sur un lien | Le lien s'ouvre dans le navigateur. Le launcher ne traite aucun paiement. |

Les services tiers ont leurs propres politiques de confidentialité : [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement), acstuff.club (Custom Shaders Patch), et celle des services de dons choisis par l'administrateur.

## Données stockées sur l'ordinateur

- Réglages du launcher (nom de pilote, nationalité, Steam ID, dossier du jeu, préréglages) dans `%APPDATA%/LKS Launcher`.
- Réglages du jeu et du CSP dans `Documents/Assetto Corsa/cfg`, avec une sauvegarde des fichiers d'origine.
- Tes tours enregistrés (télémétrie) dans `%APPDATA%/LKS Launcher/telemetry`. Les runs tandem passent d'abord par le dossier de l'appli en jeu (`apps/lua/LKS/runs`), puis le launcher les importe et les efface. Un tour exporté (`.lkslap`) contient ton nom et les données du tour (pas ton Steam ID).

Les **codes d'invitation** d'une partie hébergée contiennent l'adresse de ton PC (ou de ton réseau virtuel) et le mot de passe de la partie : ne les partage qu'avec les personnes que tu invites.

Désinstaller le launcher (Paramètres Windows → Applications) le supprime. Le dossier `%APPDATA%/LKS Launcher` peut être effacé à la main.

---

## Privacy policy (English)

LKS Launcher has **no usage analytics or advertising** and does not collect personal data. Driving telemetry (your laps) stays on your PC; your personal bests and run scores (driver name, a random id made by your launcher, car, track, time or score, lap data) are sent to the group's own server (or Supabase project), if the admins set one up and you keep the option enabled. **Your Steam ID is never sent to the group's server**; it only goes to the game servers you join, as the game requires. Gallery photos are sent without their metadata (GPS, camera…), and crash reports sent to the admins' Discord have Steam IDs, Windows account names, IP and e-mail addresses masked. It only connects to: GitHub (content manifest, content downloads, launcher updates), the official Custom Shaders Patch website `acstuff.club` (only when the user installs it), and the Assetto Corsa game servers chosen by the group or the user (the user's Steam ID is sent to the chosen server to join it, as the game itself does). Admins additionally use the GitHub API with their own token, stored encrypted locally. Donation and shop links open in the user's web browser only when clicked. Settings are stored locally in `%APPDATA%/LKS Launcher` and `Documents/Assetto Corsa/cfg`.
