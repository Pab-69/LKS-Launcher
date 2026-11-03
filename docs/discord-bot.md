# Bot Discord LKS : tout ce qu'il faut savoir

Ce document explique où sont les données du groupe, ce que le launcher fait déjà sur Discord et ce que ton bot peut faire en plus. Il ne contient pas de code du bot.

---

## 1. Le principe en 30 secondes

- **Le bot ne fait que lire.** Toutes les données sont écrites par les launchers (et par les admins depuis Publication). Le bot les lit et les affiche sur Discord.
- Il a **deux sources** :
  1. **Le manifeste** : un fichier JSON public sur GitHub, mis à jour par les admins (voitures, circuits, serveurs, actus, soirées, championnats, décisions du juge, propositions acceptées ou refusées).
  2. **Supabase** : la base du classement, alimentée par les launchers (records, battles, notes de chaque run, qui est en ligne, direct des soirées, propositions, votes, galerie, parties hébergées).
- Bonus : chaque **serveur Assetto Corsa** donne son état sur son port HTTP.

---

## 2. Ce que le launcher fait déjà sur Discord (ne pas le refaire)

**Statut Discord (Rich Presence)** sur le profil de chaque pilote : « Dans le launcher », « En solo sur … », « En ligne sur … », avec les boutons « Rejoindre le Discord » et « Télécharger le launcher ». Il utilise l'application Discord dont l'id est dans `manifest.discord.clientId`.

**Messages automatiques (webhooks)** postés par les launchers :

| Salon | Message | Quand |
|---|---|---|
| Actus (`manifest.discord.webhook`) | 📅 nouvelle soirée | un admin crée une soirée |
| Actus | 🏁 record de drift / 🤝 record de tandem | un pilote bat son record (mode normal) |
| Actus | ⚔️ résultat de battle | fin d'une battle |
| Actus | ⚖️ décision du juge | un admin tranche une battle |
| Actus | 📦 nouvelle proposition / ✅ proposition acceptée | un membre propose / un admin accepte |
| Actus | 📸 nouvelle photo | ajout dans la galerie |
| Rapports (`manifest.discord.reportWebhook`) | rapport de plantage | un pilote clique « Envoyer aux admins » |

👉 Si ton bot poste aussi ces infos, il y aura des doublons. Deux choix :
- tu laisses le launcher faire ces messages et ton bot fait le reste (conseillé au début) ;
- ou tu vides les webhooks dans Publication → Discord et c'est le bot qui poste tout (il faudra alors détecter les nouveautés toi-même, voir partie 6).

---

## 3. Source 1 : le manifeste

**Adresse** : `https://github.com/Pab-69/LKS-Launcher/releases/download/content/manifest.json`

- Public, pas besoin de clé. GitHub redirige vers le fichier : suis les redirections.
- Relis-le toutes les **5 minutes** (pas plus souvent). `updatedAt` change à chaque publication : s'il n'a pas changé, rien à faire.

### Les champs utiles

| Champ | Contenu |
|---|---|
| `name`, `motd` | nom du groupe, message du jour |
| `updatedAt` | date de la dernière publication |
| `history[]` | journal des publications (ce qui a changé) |
| `news[]` | actus : `{ title, body, date }` (la plus récente en premier) |
| `servers[]` | serveurs du groupe : `{ name, ip, httpPort }` |
| `cars[]` | voitures : `{ id, name, brand, carClass, skins[], specs, version, size, preview, publishedAt, notes }` |
| `tracks[]` | circuits : `{ id, name, country, layouts[{ id, name, length, pitboxes }], version, size, preview, publishedAt, notes }` |
| `events[]` | soirées : `{ id, title, date, durationMinutes, description, track, layout, cars[], server, battle: { size, mode } }` |
| `championships[]` | championnats : `{ id, name, points[], rounds[] }` (voir partie 5) |
| `judging[]` | décisions du juge : `{ pair, track, layout, date, winner, omt, note, by, at }` |
| `proposals` | décisions sur les propositions : `{ "<id>": { status: accepted\|refused, note, by, at } }` |
| `galleryHidden[]` | ids des photos masquées par les admins (ne pas les afficher) |
| `discord` | `{ clientId, inviteUrl, webhook, reportWebhook }` |
| `leaderboard` | `{ url, anonKey }` : l'adresse et la clé publique de Supabase |
| `drift` | courses de drift publiées par les admins (clips, lignes) |

**Noms à afficher** : les tables contiennent des ids (`lks_bmw_m2`, `cfd_calmont_2023`). Pour un joli nom, cherche l'id dans `cars[]` / `tracks[]` (et `layouts[]` pour le tracé). Si le nom du tracé commence par le nom du circuit, n'affiche que le tracé (le launcher fait pareil).

**Soirée « en cours »** (même règle que le launcher) : de **30 min avant** `date` jusqu'à `date + durationMinutes` (120 min si vide).

---

## 4. Source 2 : Supabase

### Se connecter

- Adresse et clé : `manifest.leaderboard.url` et `manifest.leaderboard.anonKey` (aussi visibles dans le launcher : Publication → Classement).
- Chaque requête : `GET {url}/rest/v1/{vue}?{filtres}` avec les en-têtes
  `apikey: {anonKey}` et `Authorization: Bearer {anonKey}`.
- Filtres (syntaxe PostgREST) : `track=eq.cfd_calmont_2023`, `created_at=gte.2026-11-01T00:00:00Z`, `rules=like.*-normal`, `order=score.desc`, `limit=10`, `select=driver,score`.
- Fichiers publics (photos) : `{url}/storage/v1/object/public/{bucket}/{file}`.

⚠️ Utilise **uniquement la clé anon** (publique, lecture seule). Ne mets **jamais** la clé `service_role` de Supabase ni un token GitHub dans le bot.

### Les tables et vues lisibles

| Vue | Ce qu'il y a | Gardé |
|---|---|---|
| `lks_laps` | records (temps, drift, tandem) et battles | toujours |
| `lks_runs_list` | la note de **chaque** run | 30 jours |
| `lks_live_now` | le direct des soirées | 10 secondes |
| `lks_presence_live` | qui a le launcher ouvert / roule | 3 minutes |
| `lks_hosts_live` | parties hébergées depuis le launcher | 3 minutes |
| `lks_proposals_list` | propositions de voitures, livrées, setups + votes | 180 jours |
| `lks_photos_list` | galerie | toujours |

#### `lks_laps` : records et battles

Colonnes : `id, steam_id, driver, car, track, layout, kind, rules, lap_ms, score, meta, created_at` (évite `samples`, c'est gros).

- `kind` : `time` (chrono, `lap_ms`), `drift` ou `tandem` (`score` sur 100), `battle`.
- **Une seule ligne par pilote** et par voiture / circuit / tracé / type / `rules` : c'est son meilleur.
- `rules` (drift, tandem, battle) = `{version}-{mode}` avec `mode` = `debutant`, `normal` ou `pro`. La `version` (8 caractères) change quand les admins modifient les clips ou la ligne : **ne compare que des lignes avec la même `rules`**. Pour un classement « actuel », prends la version la plus récente (celle dont la ligne la plus récente a le `created_at` le plus grand).
- Manche de championnat : `rules` = `{version}-{mode}@{idDeLaManche}`. Classement général du circuit : exclus les `rules` qui contiennent `@`.
- `meta` : `{ lapMs, topSpeed, date, mode, drift: {…détail de la note…} }` ou `{ tandem: {…}, lead: { name, car } }`.
- **Battles** (`kind = battle`) : `steam_id` = `b-{id}`, `driver` = « A vs B », et dans `meta.battle` : `{ id, date, pair, cars, runs, result: { drivers: [{ name, total }], winner, omt } }`.
  - **Décision du juge** : si une entrée de `manifest.judging` a le même `pair` (les 2 noms en minuscules, triés, joints par `|`), le même circuit/tracé et une `date` à ± 5 min, c'est elle qui compte : `winner` (ou `omt: true` = one more time) et `note`.

#### `lks_runs_list` : la note de chaque run

Colonnes : `id, driver, car, track, layout, kind (drift|tandem), score, detail, created_at`.

`detail` : `angle, speed, line, penalty, avgAngle, avgSpeed, zeroed, clips[{ name, hit, cover }], zones[{ name, score }], penalties[]`, et en tandem `lead, proximity, avgGap`.

#### `lks_live_now` : le direct (pendant les soirées seulement)

Colonnes : `id, name, car, track, layout, data, updated_at`.
`data` : `angle, speed, inRun, d` (avancée de la run de 0 à 1), `ms` (temps de la run), `hit / total` (clips pris), `clips[]` (1 pris, 0 raté), `x, z`.
Rafraîchi toutes les 1-2 s par les launchers. Une ligne disparaît 10 s après la dernière mise à jour.

#### `lks_presence_live` : qui est là

Colonnes : `id, name, state, server, car, track, layout, updated_at`.
`state` : `launcher` (juste ouvert), `solo`, `online` (sur un serveur), `hosting` (héberge une partie).
`server` : `{ name, ip, port, httpPort }` ou `{ name, hostId }` (partie hébergée, voir `lks_hosts_live`).
Mis à jour toutes les 60 s. Seulement les pilotes qui ont laissé « Me montrer en ligne aux membres » activé (Paramètres).

#### `lks_hosts_live` : parties hébergées

Colonnes : `id, name, host_driver, addresses, tcp_port, http_port, has_password, track, layout, cars, slots, updated_at`.

#### `lks_proposals_list` : propositions

Colonnes : `id, kind (car|skin|setup), car, skin, track, title, author, message, link, file, size, created_at, up, down`.
- Téléchargement : `{url}/storage/v1/object/public/lks-proposals/{file}` si `file`, sinon `link`.
- Statut : `manifest.proposals[id].status` (`accepted`, `refused`, sinon en attente) et la raison dans `note`.

#### `lks_photos_list` : galerie

Colonnes : `id, file, author, caption, car, track, created_at`.
Image : `{url}/storage/v1/object/public/lks-gallery/{file}`. Ne montre pas les ids présents dans `manifest.galleryHidden`.

### Bonus : l'état d'un serveur AC

`GET http://{ip}:{httpPort}/INFO` (port HTTP du serveur, 8081 par défaut) renvoie un JSON : nom, circuit, voitures, nombre de joueurs (`clients` / `maxclients`). Pas de clé. Interroge-le au plus toutes les 30 s.

---

## 5. Championnats (si tu veux le classement dans Discord)

Dans `manifest.championships[]` : `{ id, name, points[], rounds[] }`, chaque manche : `{ id, name, track, layout, kind (drift|tandem|battle), mode, start, end, bracket }`.

- **État d'une manche** : à venir avant `start`, en cours entre `start` et `end`, terminée après.
- **Résultats d'une manche drift / tandem** : lignes de `lks_laps` avec ce `track` / `layout` / `kind` et `rules=like.*@{idManche}` ; on classe par `score` décroissant.
- **Manche battle** : les qualifs sont des runs de drift (`kind = drift`, `rules like *@{idManche}`), puis les battles (`kind = battle`, même `rules`) remplissent le tableau (top `bracket`).
- **Points** : la place N reçoit `points[N-1]` (par défaut 25, 18, 15, 12, 10, 8, 6, 4, 2, 1).
- **Général** : somme des points de toutes les manches ; en cas d'égalité, le plus de victoires, puis le plus de podiums.
- La « Soirée LKS » crée toute seule un championnat `soiree` avec une manche battle par soirée.

---

## 6. Idées de fonctionnalités

### Commandes (slash commands)

| Commande | Ce qu'elle montre | Données |
|---|---|---|
| `/classement circuit [voiture] [mode]` | top 10 drift (ou tandem, ou chrono) | `lks_laps` |
| `/record pilote` | les meilleurs scores d'un pilote | `lks_laps` (`driver=ilike.*nom*`) |
| `/derniere-run pilote` | sa dernière note avec les clips ✓/✗ | `lks_runs_list` |
| `/qui-roule` | qui est en ligne, où, avec quelle voiture + bouton rejoindre | `lks_presence_live` |
| `/serveurs` | serveurs du groupe avec joueurs, circuit, voitures | `manifest.servers` + `/INFO` + `lks_hosts_live` |
| `/soiree` | la prochaine soirée : date, circuit, voitures, battle | `manifest.events` |
| `/battles [circuit]` | derniers résultats de battle (décision du juge comprise) | `lks_laps` kind battle + `manifest.judging` |
| `/championnat` | classement général et prochaine manche | partie 5 |
| `/propositions` | propositions en attente avec 👍 / 👎 | `lks_proposals_list` + `manifest.proposals` |
| `/contenu` | voitures et circuits du groupe, liens vers le launcher | `manifest.cars`, `manifest.tracks` |
| `/photo` | une photo au hasard de la galerie | `lks_photos_list` |
| `/launcher` | lien de téléchargement | `https://github.com/Pab-69/LKS-Launcher/releases/latest` |

### Messages automatiques

- **Rappels de soirée** : la veille et 1 h avant (avec circuit, voitures, serveur). Le launcher, lui, n'annonce que la création.
- **Événement Discord** : créer un « événement programmé » pour chaque soirée (les membres cliquent « Intéressé »).
- **Tableau « en piste » pendant les soirées** : un seul message que le bot **modifie** toutes les 10-15 s (pas un nouveau message à chaque fois) : pilote, voiture, angle, clips pris, run en cours. Source : `lks_live_now`.
- **Rôle « En piste »** donné automatiquement aux membres présents dans `lks_presence_live` (il faut lier le nom du pilote à son compte Discord, voir plus bas).
- **Récap de la semaine** (ex. lundi 10 h) : meilleures notes de la semaine, pilote le plus actif, nouveaux records, battles. Source : `lks_runs_list` et `lks_laps` (`created_at` des 7 derniers jours).
- **Nouveau contenu** : comparer `manifest.cars` / `tracks` avec la lecture précédente (nouvel `id` ou nouvelle `version`) et annoncer « Nouvelle voiture : … ».
- **Tableau de battle** de la soirée en image (ou en texte) mis à jour après chaque battle.
- **Serveur vide / plein** : alerte quand un serveur passe de 0 à 1 joueur (« Ça roule sur … »).

### Lier un membre Discord à son pilote

Les données ne contiennent que le **nom du pilote** (et un SteamID dans `lks_laps.steam_id`). Simple : une commande `/lier nom-du-pilote` que le bot garde dans sa propre petite base (fichier JSON ou SQLite). Ça sert pour `/moi`, les rôles et les mentions (« bravo @… pour ton record »).

---

## 7. Mettre en place le bot côté Discord

1. https://discord.com/developers/applications → **New Application** (tu peux aussi réutiliser l'application du statut Discord, celle de `manifest.discord.clientId`).
2. Onglet **Bot** → **Reset Token** → garde le token **secret** (fichier `.env`, jamais sur GitHub).
3. **Intents** : pour des commandes slash et des messages postés par le bot, aucun intent « privilégié » n'est nécessaire. Il faut **Server Members** seulement si tu donnes des rôles automatiquement à partir des membres.
4. Onglet **OAuth2 → URL Generator** : scopes `bot` et `applications.commands`. Permissions : Envoyer des messages, Intégrer des liens, Joindre des fichiers, Lire l'historique, + Gérer les rôles (rôle « En piste »), + Gérer les événements (soirées).
5. Ouvre l'URL générée et ajoute le bot au serveur LKS.

---

## 8. Côté technique

- **Langage** : `discord.js` v14 (Node.js 18 ou plus, comme le launcher) ou `discord.py` 2.x (Python). Les deux gèrent les commandes slash, les boutons et les embeds.
- **Hébergement** : le bot doit tourner **tout le temps** : un petit VPS (OVH, Hetzner…), un Raspberry Pi, ou un hébergeur de bots. Pas besoin de base de données au début (sauf pour `/lier`).
- **Fréquences de lecture conseillées** :
  - manifeste : 5 min ;
  - présence : 60 s ; direct (soirée seulement) : 5-10 s ;
  - classements : à la demande (commande) avec un cache de 1-2 min ;
  - serveurs AC (`/INFO`) : 30-60 s.
- **Limites Discord** : environ 5 messages par 5 s dans un même salon ; modifie un message existant plutôt que d'en poster un nouveau ; une interaction (commande) doit répondre en moins de 3 s (sinon répondre « en cours… » puis compléter).
- **Heure** : les dates sont en UTC (ISO). Affiche-les en heure de Paris, ou avec le format Discord `<t:TIMESTAMP:F>` / `<t:TIMESTAMP:R>` qui s'affiche dans l'heure de chacun.
- **Textes** : en français, courts et simples, comme dans le launcher.
- **Si Supabase répond 404** sur une vue : le script SQL n'a pas été relancé (Publication → Classement → Copier le script, puis exécuter dans Supabase).

---

## 9. Ordre conseillé

1. Bot qui répond à `/launcher` et `/soiree` (manifeste seulement).
2. `/classement`, `/record`, `/derniere-run` (Supabase).
3. `/qui-roule` et `/serveurs`.
4. Rappels de soirée + événement Discord.
5. Tableau « en piste » pendant les soirées.
6. `/battles`, `/championnat`, récap de la semaine.
7. `/lier` + rôles + mentions.
