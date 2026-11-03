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

status() {
  dc ps
  if api_ok; then say "API : OK ($(base_url))"; else say "API : ne répond pas ($(base_url))"; fi
}

update() {
  need
  if [ -d ../.git ]; then git -C .. pull --ff-only; fi
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
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
