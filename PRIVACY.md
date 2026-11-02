# Politique de confidentialité / Privacy policy

*LKS Launcher — Lowkey Syndicate*

## En bref

- Pas de compte, pas de publicité, **aucune statistique d'utilisation**.
- La télémétrie de conduite (tes tours) reste sur ton PC. Seuls tes records partent au classement du groupe, si les admins l'ont activé et si tu le laisses activé.
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
| **Classement partagé** (projet Supabase du groupe), seulement si les admins l'ont configuré | Quand tu bats ton record sur une voiture et un circuit, et pour afficher le classement | Ton nom de pilote, ton Steam ID, la voiture, le circuit, ton temps ou ton score de drift et les données du tour (vitesse, pédales, rapport, angle, position sur la piste). Désactivable : Télémétrie → Outils → « Envoyer mes records au classement » ([politique de Supabase](https://supabase.com/privacy)) |
| **Tableau de bord sur téléphone**, sur ton réseau local uniquement | Seulement si tu l'actives | Les données de conduite en direct, servies par ton PC aux appareils de ton réseau |
| **Liens de dons / boutique** | Seulement quand l'utilisateur clique sur un lien | Le lien s'ouvre dans le navigateur. Le launcher ne traite aucun paiement. |

Les services tiers ont leurs propres politiques de confidentialité : [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement), acstuff.club (Custom Shaders Patch), et celle des services de dons choisis par l'administrateur.

## Données stockées sur l'ordinateur

- Réglages du launcher (nom de pilote, nationalité, Steam ID, dossier du jeu, préréglages) dans `%APPDATA%/LKS Launcher`.
- Réglages du jeu et du CSP dans `Documents/Assetto Corsa/cfg`, avec une sauvegarde des fichiers d'origine.
- Tes tours enregistrés (télémétrie) dans `%APPDATA%/LKS Launcher/telemetry`. Un tour exporté (`.lkslap`) contient ton nom, ton Steam ID et les données du tour.

Les **codes d'invitation** d'une partie hébergée contiennent l'adresse de ton PC (ou de ton réseau virtuel) et le mot de passe de la partie : ne les partage qu'avec les personnes que tu invites.

Désinstaller le launcher (Paramètres Windows → Applications) le supprime. Le dossier `%APPDATA%/LKS Launcher` peut être effacé à la main.

---

## Privacy policy (English)

LKS Launcher has **no usage analytics or advertising** and does not collect personal data. Driving telemetry (your laps) stays on your PC; only your personal bests (driver name, Steam ID, car, track, time or drift score, lap data) are sent to the group's own Supabase leaderboard, if the admins set one up and you keep the option enabled. It only connects to: GitHub (content manifest, content downloads, launcher updates), the official Custom Shaders Patch website `acstuff.club` (only when the user installs it), and the Assetto Corsa game servers chosen by the group or the user (the user's Steam ID is sent to the chosen server to join it, as the game itself does). Admins additionally use the GitHub API with their own token, stored encrypted locally. Donation and shop links open in the user's web browser only when clicked. Settings are stored locally in `%APPDATA%/LKS Launcher` and `Documents/Assetto Corsa/cfg`.
