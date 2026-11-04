# Serveur du groupe LKS (sur ton serveur)

Ce dossier installe sur **ton serveur** tout ce que le launcher utilisait chez Supabase :
classement et records, battles, notes des runs, direct des soirées, qui est en ligne,
parties hébergées, propositions de voitures et livrées, votes, galerie. Il sert aussi le site
vitrine : soirées et actus à jour, classements, et une page admin pour publier.

Les launchers ne changent rien : ils parlent à ton serveur exactement comme à Supabase.
Tu colles juste une adresse et une clé dans Publication.

---

## 1. Ce que ton serveur garde (et ce qu'il ne garde pas)

**Il ne garde que ce qui sert au groupe.**

| Donnée | Pourquoi | Combien de temps |
|---|---|---|
| Records : nom de pilote, voiture, circuit, temps ou note, données du tour (vitesse, pédales, angle, position sur la piste) | Classements, fantômes, championnats | Tant que le record existe (effaçable à la demande) |
| Battles : noms des deux pilotes, voitures, notes, gagnant | Résultats, tableau des soirées | Idem |
| Notes de chaque run (clips, zones, pénalités) | Onglet Juge, fil des runs | **30 jours**, puis effacées toutes seules |
| Direct des soirées (angle, vitesse, clips) | Juges, page stream | **1 minute** après le dernier envoi |
| Qui est en ligne (nom, état, serveur de jeu rejoint) | « En ligne maintenant », rejoindre en un clic | **15 minutes** après la dernière annonce |
| Parties hébergées (nom, adresses pour rejoindre, ports, circuit) | Liste des parties dans Serveurs | **15 minutes** après l'arrêt de la partie |
| Propositions (nom de l'auteur, message, fichier) et votes | Propositions des membres | **180 jours** |
| Photos de la galerie (nom de l'auteur, légende, image) | Galerie | Jusqu'à ce qu'un admin l'efface |
| Sauvegardes de la base | En cas de panne | **7 jours** |
| Comptes admin du site (nom + empreinte du mot de passe) | Page admin du site | Jusqu'à `./lks.sh remove-admin` (les connexions ne sont gardées qu'en mémoire, 8 h) |

**Il ne garde pas :**

- **aucun Steam ID** : depuis la version 1.17 le launcher ne l'envoie plus du tout. Chaque
  pilote est le nom qu'il a choisi plus un identifiant tiré au hasard par son launcher
  (jamais lisible par les autres). Le serveur **refuse** tout envoi qui ressemble à un Steam ID ;
- **aucune adresse IP des membres** : pas de journal d'accès (ni Caddy, ni l'API, ni le stockage) ;
- **aucun compte, mot de passe, e-mail** ;
- **aucune métadonnée des photos** : position GPS, appareil, date… sont retirées avant l'envoi
  (dans le launcher) et encore une fois à l'arrivée (sur le serveur) ;
- les rapports de plantage ne passent pas par ton serveur (ils vont sur Discord, voir plus bas).

Les données passagères s'effacent toutes seules (le serveur fait le ménage toutes les heures).

---

## 2. Ce qu'il te faut

- Un **serveur Linux** (Debian 12 ou Ubuntu 22.04/24.04), même petit : 1 processeur, 1 à 2 Go
  de mémoire, 20 Go de disque. Un VPS OVH, Hetzner, Scaleway… convient.
- **Docker** : https://docs.docker.com/engine/install/ (avec « docker compose »).
- Un **nom de domaine** (ou un sous-domaine) qui pointe vers l'adresse IP du serveur, par exemple
  `lks.mondomaine.fr` (enregistrement DNS de type A). Sans domaine, un sous-domaine gratuit
  (DuckDNS…) fonctionne aussi. Il est obligatoire : le launcher n'accepte que le HTTPS.
- Les **ports 80 et 443** ouverts vers le serveur (le 80 sert au certificat HTTPS).

---

## 3. Installation

Sur le serveur :

```bash
git clone --depth 1 https://github.com/Pab-69/LKS-Launcher.git
cd LKS-Launcher/server
sudo ./lks.sh install lks.mondomaine.fr
```

Le script :

1. crée le fichier secret `.env` (mots de passe et clé tirés au hasard) ;
2. démarre la base, l'API, le stockage et le HTTPS (certificat Let's Encrypt automatique) ;
3. affiche **l'adresse** et **la clé publique** à coller dans le launcher.

Tu peux les réafficher à tout moment : `./lks.sh key`.

---

## 4. Brancher le launcher

Dans le launcher (admin) : **Publication → Classement et serveur du groupe**.

1. **Adresse du serveur** : `https://lks.mondomaine.fr`
2. **Clé publique (anon)** : la clé affichée par `./lks.sh key`
3. **Tester**, puis **Enregistrer**.

C'est tout : les membres reçoivent la nouvelle adresse avec le manifeste (dans les 5 minutes).
Ils n'ont rien à faire. Il leur faut le launcher **1.17 ou plus récent** (mise à jour automatique) :
les anciennes versions, qui envoyaient le Steam ID, sont refusées par le serveur.

La clé publique n'est pas un secret : elle est dans le manifeste et permet seulement ce que fait
le launcher (lire le classement, envoyer ses runs…). Le secret, c'est le fichier `.env` :
ne le partage jamais et ne le mets jamais sur GitHub.

---

## 4 bis. Le site vitrine : soirées, actus et classements

Le site vitrine gagne trois choses, toutes servies par ce serveur :

- **accueil** : les prochaines soirées et les dernières actus, toujours à jour (plus besoin de
  reconstruire le site) ;
- **Classements** (`classement.html`) : drift, tandem et chrono par circuit, mode et voiture, et
  le classement des championnats (même calcul que dans le launcher) ;
- **Admin** (`admin.html`, lien en bas de page) : créer, modifier ou retirer une soirée (circuit,
  voitures imposées, serveur, battle top 4/8/16), publier ou retirer une actu.
  Ça arrive dans tous les launchers dans les 5 minutes, exactement comme depuis l'onglet
  Publication. Les nouvelles soirées et actus sont annoncées sur Discord (case à décocher pour
  une actu).

### À faire une fois

```bash
cd LKS-Launcher/server
./lks.sh update                                   # récupère cette version
./lks.sh github-token                             # jeton GitHub pour publier (voir ci-dessous)
./lks.sh add-admin Pab                            # un compte par admin (mot de passe demandé)
./lks.sh site https://lks-syndicate.fr            # l'adresse de ton site vitrine
./lks.sh site-build /var/www/lks-syndicate        # reconstruit le site dans son dossier
```

- **Jeton GitHub** : sur github.com → Settings → Developer settings → Personal access tokens →
  Fine-grained tokens → Generate new token. Dépôt : seulement `LKS-Launcher`. Permission :
  **Contents : Read and write** (rien d'autre). Il reste dans `.env` sur le serveur, il n'est
  jamais envoyé au navigateur.
- **Admins** : `./lks.sh add-admin <nom>` (aussi pour changer un mot de passe),
  `./lks.sh remove-admin <nom>`, `./lks.sh admins` pour la liste. Les mots de passe ne sont gardés
  que sous forme d'empreinte. Après 5 mauvais mots de passe, le compte est bloqué 15 minutes.
  La connexion dure 8 heures.
- **Le site** : `site-build` remplace le contenu du dossier donné par la nouvelle version du site
  (garde le même dossier que celui que ton serveur web sert déjà). Relance-le après une mise à
  jour du launcher ou un changement de logo/photos ; pour les soirées, actus et classements, ce
  n'est pas nécessaire.

Le site appelle ce serveur depuis le navigateur : seule l'adresse donnée à `./lks.sh site` peut
utiliser la page admin.

## 5. Reprendre les données de Supabase (facultatif)

Si le groupe utilisait Supabase avant :

```bash
./lks.sh import-supabase https://xxxx.supabase.co <clé anon de Supabase>
```

Ça reprend les **records, les battles et la galerie**, sans aucun Steam ID (chaque pilote reçoit
un identifiant au hasard). Les runs (gardées 30 jours), qui est en ligne et le direct ne sont pas
repris. Les **propositions en attente** non plus : traite-les avant de changer.

Ensuite, quand tout marche sur ton serveur, tu peux supprimer le projet Supabase
(Supabase → Project Settings → General → Delete project) : plus aucune donnée n'y restera.

---

## 6. Entretien

Lance-les depuis le dossier `LKS-Launcher/server` (avec `sudo` si ton utilisateur n'est pas dans le groupe docker).

| Commande | Ce qu'elle fait |
|---|---|
| `./lks.sh status` | état des services et test de l'API |
| `./lks.sh key` | adresse et clé à coller dans le launcher |
| `./lks.sh update` | nouvelle version : récupère le code, les images et met la base à jour |
| `./lks.sh backup` | sauvegarde maintenant (dans `backups/`) |
| `./lks.sh restore backups/<fichier>` | remet une sauvegarde (remplace la base actuelle) |
| `./lks.sh forget "Nom du pilote"` | efface **toutes** les données d'un pilote (records, runs, photos, propositions…) |
| `./lks.sh delete-photo <id>` | efface une photo de la galerie (fichier compris) |
| `./lks.sh add-admin <nom>` / `remove-admin <nom>` / `admins` | comptes admin du site |
| `./lks.sh site-build <dossier>` | reconstruit le site vitrine |
| `./lks.sh stop` / `start` / `restart` | arrêter / démarrer / redémarrer |

**Après chaque nouvelle version du launcher** qui annonce « relancez le script du serveur » :
`./lks.sh update`.

**Sauvegardes** : une par jour dans `backups/`, gardées 7 jours (modifiable : `BACKUP_DAYS`
dans `.env`). Les fichiers (photos, propositions) sont dans `data/storage/`. Pour être tranquille,
copie de temps en temps ces deux dossiers ailleurs que sur le serveur.

**Un membre demande d'effacer ses données** : `./lks.sh forget "Son nom de pilote"`.
Les sauvegardes qui le contiennent disparaissent d'elles-mêmes au bout de 7 jours.

---

## 7. Sécurité (à faire une fois)

- Pare-feu : n'ouvre que SSH, 80 et 443. Avec ufw :
  `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`.
  La base de données n'est **jamais** ouverte sur internet (elle reste dans le réseau Docker).
- Mises à jour automatiques du système : `apt install unattended-upgrades`.
- Connexion SSH par clé plutôt que par mot de passe.
- Le stockage est limité à 20 Go (`STORAGE_MAX_GB` dans `.env`) et à 120 envois de fichiers par
  heure pour tout le groupe, pour qu'on ne puisse pas remplir ton disque.

---

## 8. Ce qui n'est pas sur ton serveur

- Le **contenu** (voitures, circuits, manifeste, soirées, championnats) reste publié sur GitHub,
  comme avant.
- Les **messages Discord** (annonces, rapports de plantage) partent des launchers vers les
  webhooks de ton Discord. Les rapports de plantage sont nettoyés avant l'envoi : Steam ID, nom
  de session Windows, adresses IP et e-mails sont masqués.
- Si tu héberges aussi des **serveurs Assetto Corsa** sur la même machine : le jeu envoie le
  Steam ID et l'adresse IP de chaque joueur au serveur AC, et le serveur AC les écrit dans ses
  journaux. Ça ne dépend pas du launcher : pense à ne pas garder ces journaux (ou à les vider
  régulièrement).

---

## 9. Ton bot Discord sur le même serveur

Le bot lit l'API exactement comme décrit dans `docs/discord-bot.md`, avec l'adresse
`https://lks.mondomaine.fr` et la clé publique. S'il tourne dans Docker sur le même serveur, il
peut aussi passer par le réseau interne (`docker network connect lks_default <conteneur du bot>`) :
API sur `http://rest:3000/<vue>` (sans `/rest/v1`), fichiers sur `http://storage:8080`.
Si le bot garde lui-même des données (lien compte Discord ↔ nom de pilote), applique-lui la même
règle : seulement le nécessaire.

---

## 10. Responsabilité : ce qu'il faut savoir

En hébergeant ces données, c'est toi qui en es responsable (RGPD : tu es le « responsable de
traitement »). Ce serveur est fait pour que ce soit le plus léger possible : pas d'identifiant
réel, pas d'IP, pas de compte, des durées courtes et un effacement en une commande.
Il reste quelques gestes simples :

- **prévenir les membres** de ce qui est gardé (le texte ci-dessous, à épingler sur Discord) ;
- **effacer** les données d'un membre qui le demande (`./lks.sh forget`) ;
- **effacer** une photo ou une proposition qui pose problème (`./lks.sh delete-photo`) ;
- garder le serveur à jour et le fichier `.env` secret.

Ce n'est pas un avis juridique ; pour un doute précis, la CNIL a un guide pour les associations
et les petits services : https://www.cnil.fr

### Texte à épingler sur Discord

> **Données du launcher LKS**
> Le serveur du groupe garde seulement ce qui sert aux classements et aux soirées : ton nom de
> pilote, tes records et leurs données de conduite, les notes de tes runs (30 jours), ta présence
> en ligne (15 min), tes propositions (180 jours) et les photos que tu envoies.
> Aucun Steam ID, aucune adresse IP, aucun compte ni e-mail. Les photos sont envoyées sans leurs
> métadonnées (GPS…).
> Tu peux tout couper dans le launcher : Paramètres (« Me montrer en ligne aux membres »,
> « Partager mon direct pendant les soirées ») et Télémétrie → Outils (« Partager mes runs avec
> le groupe »).
> Pour tout effacer : demande à un admin.

---

## Dépannage

- **`./lks.sh install` dit que le serveur ne répond pas** : vérifie que le domaine pointe bien vers
  l'IP du serveur (`ping lks.mondomaine.fr`) et que les ports 80 et 443 sont ouverts, puis
  `docker compose logs caddy`.
- **Le launcher dit « pas encore installé »** : `./lks.sh update` (le script de la base n'est pas
  à jour).
- **« Stockage du groupe plein »** : augmente `STORAGE_MAX_GB` dans `.env` puis `./lks.sh restart`,
  ou efface des photos.
- **Voir ce qui tourne** : `./lks.sh status`, `docker compose logs <service>`
  (services : `caddy`, `rest`, `storage`, `db`, `ops`).
