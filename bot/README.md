# Bot Discord — Lowkey Syndicate

Fait partie du dépôt du launcher (dossier `bot/`) : il évolue avec le launcher, le site et le serveur du groupe.

Le bot **ne fait que lire** les données LKS (le manifeste GitHub + le serveur du groupe, avec la clé publique
du manifeste) et les affiche sur Discord. Aucun Steam ID : le serveur n'en garde pas. Il ne refait pas ce que le launcher poste déjà (nouvelle soirée, records,
battles, décisions du juge, propositions, photos) : pas de doublons.

## 1. Créer le bot sur Discord
1. Va sur https://discord.com/developers/applications → **New Application** → nomme-la « Lowkey Syndicate ».
2. Onglet **Bot** :
   - **Reset Token** → copie le token (garde-le secret, jamais sur GitHub).
   - Active **Server Members Intent** (obligatoire pour les messages de bienvenue).
3. Onglet **OAuth2 → URL Generator** : coche `bot` et `applications.commands`, puis les permissions
   `Manage Roles`, `Manage Channels`, `Manage Events`, `Kick Members`, `Ban Members`, `Moderate Members`,
   `Manage Messages`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`.
   Ouvre l'URL générée pour inviter le bot sur ton serveur.
4. Dans le serveur : **Paramètres → Rôles**, place le rôle du bot **au-dessus** des rôles qu'il doit gérer
   (rôle auto, rôle « En piste », membres à modérer).

## 2. Configurer
1. Copie `.env.example` en `.env` et remplis `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.
2. Dans Discord : **Paramètres utilisateur → Avancés → Mode développeur** pour pouvoir copier les IDs (clic droit → Copier l'identifiant).
3. Remplis `config.json`. **Laisser une valeur vide désactive la fonction correspondante.**

### Serveur Discord
| Clé | Rôle |
|---|---|
| `brand.color` / `brand.logoUrl` | Couleur et logo des embeds |
| `welcome.channelId` | Salon des messages de bienvenue |
| `welcome.autoRoleId` | Rôle donné automatiquement aux nouveaux |
| `welcome.message` | Texte (`{user}`, `{username}`, `{count}` sont remplacés) |
| `tickets.categoryId` / `staffRoleId` / `logChannelId` | Catégorie des tickets, rôle du staff, salon de logs |
| `updates.channelId` / `pingRoleId` | Salon et rôle pour `/update` |
| `moderation.logChannelId` | Salon de logs de modération |

### LKS
| Clé | Rôle |
|---|---|
| `lks.manifestUrl` | Adresse du manifeste (déjà remplie) |
| `lks.launcherUrl` | Lien de téléchargement du launcher (déjà rempli) |
| `lks.channels.reminders` | Rappels de soirée (la veille et 1 h avant) |
| `lks.channels.live` | Tableau « en piste » pendant les soirées (un seul message modifié toutes les 12 s) |
| `lks.channels.newContent` | Annonce des nouvelles voitures / nouveaux circuits |
| `lks.channels.recap` | Récap de la semaine automatique |
| `lks.channels.serverAlerts` | « Ça roule sur … » quand un serveur passe de 0 à 1 joueur |
| `lks.soireePingRoleId` | Rôle mentionné dans les rappels de soirée |
| `lks.enPisteRoleId` | Rôle donné aux membres liés (`/lier`) qui roulent en ce moment |
| `lks.scheduledEvents` | `true` : crée un « événement Discord » pour chaque soirée |
| `lks.recap.weekday` / `hour` | Jour (0 = dimanche, 1 = lundi…) et heure de Paris du récap |

## 3. Lancer
```bash
npm install
npm run deploy   # enregistre les commandes slash (à refaire après chaque ajout/modif de commande)
npm start        # démarre le bot
```
Le bot doit tourner en permanence (voir « Hébergement » plus bas).
Il garde ses données (liens pilote ↔ Discord, rappels déjà envoyés…) dans le dossier `data/` : ne le supprime pas.

## Commandes
### LKS (pour tout le monde)
- `/launcher` — lien de téléchargement
- `/soiree` — la prochaine soirée (ou celle en cours)
- `/contenu [voiture] [circuit]` — voitures et circuits du groupe, ou la fiche de l'un d'eux
- `/classement circuit [categorie] [type] [tous] [voiture]` — top 10 drift / tandem d'une catégorie (Débutant, Amateur, Pro), comme dans le launcher ; `tous` montre tous les pilotes avec leur catégorie
- `/record pilote` — meilleurs scores d'un pilote
- `/derniere-run pilote` — dernière note avec les clips ✅/❌
- `/qui-roule` — qui a le launcher ouvert, où et avec quoi
- `/serveurs` — serveurs du groupe (joueurs, circuit, voitures) + parties hébergées
- `/battles [circuit]` — derniers résultats (décision du juge comprise)
- `/championnat [nom]` — classement général et prochaine manche
- `/propositions [statut]` — propositions avec 👍 / 👎
- `/photo` — une photo au hasard de la galerie
- `/recap` — récap des 7 derniers jours
- `/lier pilote`, `/delier`, `/moi [membre]` — lier son compte Discord à son pilote et voir sa fiche (catégorie, records, dernière run)

### Staff
- `/update` — publier un changelog du launcher
- `/ticket-panel` — publier le bouton « Ouvrir un ticket »
- `/ban`, `/unban`, `/kick`, `/mute`, `/unmute`, `/clear` — modération
- `/lier pilote membre:` — lier un autre membre (permission « Gérer les rôles »)

## Messages automatiques
| Tâche | Fréquence |
|---|---|
| Rappels de soirée + événements Discord | toutes les 60 s |
| Tableau « en piste » (seulement pendant une soirée) | toutes les 12 s |
| Rôle « En piste » | toutes les 60 s |
| Alerte serveur 0 → 1 joueur (max 1 / 30 min par serveur) | toutes les 45 s |
| Nouveau contenu | toutes les 5 min |
| Récap de la semaine | lundi 10 h (configurable) |

## Ajouter une fonctionnalité
- **Commande** : fichier dans `src/commands/<dossier>/` qui exporte `{ data, execute, autocomplete? }`.
- **Bouton / formulaire** : fichier dans `src/components/` qui exporte `{ customId, execute }`.
- **Événement** : fichier dans `src/events/` qui exporte `{ name, execute }`.
- **Tâche automatique** : fichier dans `src/tasks/` qui exporte `{ name, intervalMs, run(client) }`.
- **Données LKS** : `src/lks/` (manifeste, serveur du groupe, serveurs AC, classements, catégories, championnats).

Tout est chargé automatiquement. `npm run check` vérifie que tout se charge sans lancer le bot.

## Hébergement (Coolify)
Déployé par Coolify depuis le dépôt **LKS-Launcher** :
- **Base directory** : `/bot` (le Dockerfile est dans ce dossier) ;
- variables d'environnement : `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` ;
- volume persistant : `/app/data`.

Après une modification d'une commande (nom, options), relance `npm run deploy` une fois (ou la commande équivalente dans Coolify)
pour que Discord affiche les nouvelles options. Ne jamais committer `.env`.

Chaque modification du dossier `bot/` est vérifiée sur GitHub (`npm run check`, workflow « Bot Discord »).
