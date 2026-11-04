#!/usr/bin/env bash
# Serveur du groupe LKS : installation et entretien. Voir README.md.
#
#   ./lks.sh install [domaine]   première installation (crée .env, démarre tout)
#   ./lks.sh key                 adresse et clé à coller dans le launcher
#   ./lks.sh status              état des services + test de l'API
#   ./lks.sh start | stop | restart
#   ./lks.sh update              nouvelle version (git pull, images, script SQL)
#   ./lks.sh backup              sauvegarde maintenant (dans ./backups)
#   ./lks.sh restore <fichier>   remet une sauvegarde (efface la base actuelle)
#   ./lks.sh forget "<pilote>"   efface toutes les données d'un pilote (à sa demande)
#   ./lks.sh delete-photo <id>   efface une photo de la galerie (fichier compris)
#   ./lks.sh import-supabase <url> <clé>   reprend les records et la galerie d'un projet Supabase
#   ./lks.sh add-admin <nom>     ajoute (ou change le mot de passe d') un admin du site
#   ./lks.sh remove-admin <nom>  retire un admin du site
#   ./lks.sh admins              liste les admins du site
#   ./lks.sh github-token        règle le jeton GitHub (publier soirées et actus depuis le site)
#   ./lks.sh site <adresse>      adresse du site vitrine autorisée (ex. https://lks-syndicate.fr)
#   ./lks.sh site-build <dossier>  reconstruit le site vitrine dans ce dossier (ex. /var/www/lks)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }
die() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }
dc() { docker compose "$@"; }
psql_lks() { dc exec -T db psql -U postgres -d lks -v ON_ERROR_STOP=1 -qAt "$@"; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

need() {
  command -v docker >/dev/null || die "Docker n'est pas installé (https://docs.docker.com/engine/install/)"
  docker compose version >/dev/null 2>&1 || die "il faut « docker compose » (Docker 24 ou plus récent)"
  command -v openssl >/dev/null || die "il faut openssl (apt install openssl)"
}

base_url() {
  local d
  d=$(env_get DOMAIN)
  case "$d" in
    http://*|https://*) printf '%s' "$d" ;;
    :*) printf 'http://127.0.0.1:%s' "$(env_get HTTP_PORT)" ;;
    *) printf 'https://%s' "$d" ;;
  esac
}

api_ok() {
  curl -fsS -m 10 "$(base_url)/rest/v1/lks_runs_list?select=id&limit=1" -H "apikey: $(env_get ANON_KEY)" -H "Authorization: Bearer $(env_get ANON_KEY)" >/dev/null 2>&1
}

show_key() {
  say ""
  say "À coller dans le launcher (Publication → Classement et serveur du groupe) :"
  say "  Adresse du serveur  : $(base_url)"
  say "  Clé publique (anon) : $(env_get ANON_KEY)"
  say ""
  say "Cette clé est publique (elle est dans le manifeste du launcher) : elle permet"
  say "seulement ce que fait le launcher. Ne partage jamais le fichier .env."
}

install() {
  need
  if [ ! -f .env ]; then
    local domain="${1:-${LKS_DOMAIN:-}}"
    if [ -z "$domain" ]; then
      read -rp "Nom de domaine du serveur (ex. lks.mondomaine.fr) : " domain
    fi
    [ -n "$domain" ] || die "il faut un nom de domaine qui pointe vers ce serveur"
    local jwt header payload sig
    jwt=$(openssl rand -hex 32)
    header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
    payload=$(printf '{"role":"anon","iss":"lks"}' | b64url)
    sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$jwt" -binary | b64url)
    umask 077
    cat > .env <<EOF
# Fichier secret : ne le partage pas, ne le mets pas sur GitHub.
DOMAIN=$domain
HTTP_PORT=${HTTP_PORT:-80}
HTTPS_PORT=${HTTPS_PORT:-443}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTHENTICATOR_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$jwt
ANON_KEY=$header.$payload.$sig
STORAGE_MAX_GB=20
BACKUP_DAYS=7
EOF
    umask 022
    say "Fichier .env créé (mots de passe et clé tirés au hasard)."
  fi
  mkdir -p data/db data/storage data/caddy backups
  chown 1000:1000 data/storage 2>/dev/null || true
  admins_file
  dc up -d
  say "Démarrage… (le premier certificat HTTPS peut prendre une minute)"
  for _ in $(seq 1 60); do
    if api_ok; then
      say "Serveur prêt."
      show_key
      return 0
    fi
    sleep 3
  done
  say "Le serveur ne répond pas encore sur $(base_url)."
  say "Vérifie que le domaine pointe vers ce serveur et que les ports 80 et 443 sont ouverts,"
  say "puis : ./lks.sh status"
}

# admins du site : un « nom:empreinte » par ligne, lisible seulement par le service admin
admins_file() {
  [ -f admins ] || : > admins
  chown 1000:1000 admins 2>/dev/null || true
  chmod 600 admins
}

env_set() {
  # $1 = clé, $2 = valeur (remplace la ligne, ou l'ajoute)
  local tmp
  tmp=$(mktemp)
  grep -vE "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

add_admin() {
  local name="${1:-}" p1 p2 line tmp
  [[ "$name" =~ ^[A-Za-z0-9_.-]{2,40}$ ]] || die "./lks.sh add-admin <nom> (lettres, chiffres, . _ -)"
  read -rsp "Mot de passe pour $name (10 caractères ou plus) : " p1; echo
  read -rsp "Encore une fois : " p2; echo
  [ "$p1" = "$p2" ] || die "les deux mots de passe sont différents"
  [ "${#p1}" -ge 10 ] || die "10 caractères au moins"
  line=$(printf '%s' "$p1" | docker run --rm -i -v "$PWD/admin/server.js:/app/server.js:ro" -v "$PWD/../src/main/telemetry/championship.js:/app/championship.js:ro" node:22-alpine node /app/server.js hash "$name")
  admins_file
  tmp=$(mktemp)
  grep -viE "^$name:" admins > "$tmp" || true
  printf '%s\n' "$line" >> "$tmp"
  cat "$tmp" > admins
  rm -f "$tmp"
  say "Admin « $name » enregistré (le mot de passe n'est gardé que sous forme d'empreinte)."
}

remove_admin() {
  local name="${1:-}" tmp
  [ -n "$name" ] || die "./lks.sh remove-admin <nom>"
  admins_file
  tmp=$(mktemp)
  grep -viE "^$name:" admins > "$tmp" || true
  cat "$tmp" > admins
  rm -f "$tmp"
  say "Admin « $name » retiré."
}

github_token() {
  local t
  say "Jeton GitHub « fine-grained » : github.com → Settings → Developer settings → Personal access tokens"
  say "→ Fine-grained tokens → Generate. Dépôt : seulement LKS-Launcher. Permission : Contents = Read and write."
  read -rsp "Colle le jeton : " t; echo
  [[ "$t" =~ ^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$ ]] || die "ça ne ressemble pas à un jeton GitHub"
  env_set GITHUB_TOKEN "$t"
  dc up -d admin
  say "Jeton enregistré dans .env (jamais envoyé au navigateur)."
}

site_origin() {
  local o="${1:-}"
  [[ "$o" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "./lks.sh site https://mon-site.fr (sans / à la fin)"
  local cur
  cur=$(env_get SITE_ORIGINS || true)
  case ",$cur," in *",$o,"*) ;; *) env_set SITE_ORIGINS "${cur:+$cur,}$o" ;; esac
  dc up -d admin
  say "Le site $o peut maintenant utiliser la page admin."
}

site_build() {
  local dir="${1:-}"
  [ -n "$dir" ] || die "./lks.sh site-build <dossier du site> (ex. /var/www/lks)"
  mkdir -p "$dir"
  dir=$(cd "$dir" && pwd)
  case "$dir" in /|/root|/home|/home/*[!/]*/..|"$HOME") die "dossier refusé : $dir" ;; esac
  if [ -n "$(ls -A "$dir")" ] && [ ! -f "$dir/index.html" ]; then
    die "$dir n'est pas vide et ne contient pas de site (index.html) : choisis le dossier du site"
  fi
  local url=""
  if [ -f .env ]; then url=$(base_url); fi
  docker run --rm -e LKS_SERVER_URL="$url" -v "$PWD/..:/repo:ro" -v "$dir:/out" -w /repo node:22-alpine node tools/build-site.js /out/.lks-build
  # remplace le contenu du site d'un coup (les visiteurs ne voient jamais un site à moitié copié)
  find "$dir" -mindepth 1 -maxdepth 1 ! -name .lks-build -exec rm -rf {} +
  cp -a "$dir/.lks-build/." "$dir/"
  rm -rf "$dir/.lks-build"
  say "Site reconstruit dans $dir (soirées, actus et classements se mettent à jour tout seuls ensuite)."
}

status() {
  dc ps
  if api_ok; then say "API : OK ($(base_url))"; else say "API : ne répond pas ($(base_url))"; fi
}

update() {
  need
  if [ -d ../.git ]; then git -C .. pull --ff-only; fi
  admins_file
  dc pull
  dc up -d
  psql_lks -f /docker-entrypoint-initdb.d/10-leaderboard.sql >/dev/null
  psql_lks -c "notify pgrst, 'reload schema'" >/dev/null
  say "À jour."
}

backup() {
  mkdir -p backups
  local f
  f="backups/lks-manuel-$(date +%F-%H%M).sql.gz"
  dc exec -T db pg_dump -U postgres -d lks | gzip > "$f"
  say "Sauvegarde : $f (et le dossier data/storage pour les fichiers)"
}

restore() {
  local f="${1:-}"
  [ -f "$f" ] || die "fichier introuvable : $f"
  read -rp "La base actuelle sera remplacée par $f. Continuer ? (oui/non) " ok
  [ "$ok" = "oui" ] || die "annulé"
  dc stop rest ops
  dc exec -T db psql -U postgres -d postgres -q -c 'drop database if exists lks' -c 'create database lks'
  gunzip -c "$f" | dc exec -T db psql -U postgres -d lks -q >/dev/null
  dc start rest ops
  say "Sauvegarde remise."
}

remove_files() {
  # $1 = bucket, puis la liste des fichiers (v1/<uuid>.<ext>), un par ligne
  local bucket="$1" file
  while IFS= read -r file; do
    [[ "$file" =~ ^v1/[0-9a-f-]{36}\.(zip|jpg|png|webp)$ ]] || continue
    rm -f "data/storage/$bucket/$file"
  done
}

forget() {
  local name="${1:-}"
  [ -n "$name" ] || die "donne le nom du pilote : ./lks.sh forget \"Nom\""
  printf "select file from public.lks_photos where lower(author) = lower(:'n');\n" | psql_lks -v n="$name" | remove_files lks-gallery
  printf "select file from public.lks_proposals where lower(author) = lower(:'n') and file <> '';\n" | psql_lks -v n="$name" | remove_files lks-proposals
  printf "select public.lks_forget(:'n');\n" | psql_lks -v n="$name"
  say "Pense aussi aux sauvegardes : elles disparaissent d'elles-mêmes au bout de $(env_get BACKUP_DAYS) jours."
}

delete_photo() {
  local id="${1:-}"
  [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || die "donne l'identifiant de la photo (visible dans le launcher, menu de la photo)"
  printf "delete from public.lks_photos where id = :'i' returning file;\n" | psql_lks -v i="$id" | remove_files lks-gallery
  say "Photo effacée."
}

import_supabase() {
  local url="${1:-}" key="${2:-}"
  [ -n "$url" ] && [ -n "$key" ] || die "./lks.sh import-supabase https://xxxx.supabase.co <clé anon>"
  local tmp
  tmp=$(mktemp)
  docker run --rm --user 1000:1000 -v "$PWD/tools/import-supabase.mjs:/t/import-supabase.mjs:ro" -v "$PWD/../src/main/imagemeta.js:/t/imagemeta.cjs:ro" -v "$PWD/data/storage:/data" node:22-alpine node /t/import-supabase.mjs "$url" "$key" > "$tmp"
  psql_lks < "$tmp" >/dev/null
  rm -f "$tmp"
  say "Import terminé : records, battles et galerie (sans aucun Steam ID)."
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  install) install "$@" ;;
  key) show_key ;;
  status) status ;;
  start) dc up -d ;;
  stop) dc stop ;;
  restart) dc restart ;;
  update) update ;;
  backup) backup ;;
  restore) restore "$@" ;;
  forget) forget "$@" ;;
  delete-photo) delete_photo "$@" ;;
  import-supabase) import_supabase "$@" ;;
  add-admin) add_admin "$@" ;;
  remove-admin) remove_admin "$@" ;;
  admins) admins_file; cut -d: -f1 admins ;;
  github-token) github_token ;;
  site) site_origin "$@" ;;
  site-build) site_build "$@" ;;
  *) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
