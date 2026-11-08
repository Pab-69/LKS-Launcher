#!/bin/bash
# Efface toutes les données d'un pilote (à sa demande) sur le serveur déployé par Coolify
# (docker-compose.coolify.yml). Équivalent de « ./lks.sh forget » du mode autonome.
#   sudo ./forget-coolify.sh "Nom du pilote"
set -euo pipefail
NAME="${1:-}"
[ -n "$NAME" ] || { echo 'Usage : sudo ./forget-coolify.sh "Nom du pilote"' >&2; exit 1; }
DATA="${LKS_DATA:-/opt/lks-server/data}"
DB=$(docker ps --format '{{.Names}}' | grep '^db-' | grep -F "$(docker ps --format '{{.Names}}' | grep -oE '^rest-[a-z0-9]+' | head -1 | sed 's/^rest-//')" | head -1)
[ -n "$DB" ] || { echo "Conteneur de la base introuvable (db-… de l'application LKS)" >&2; exit 1; }
psql_lks() { docker exec -i "$DB" psql -U postgres -d lks -v ON_ERROR_STOP=1 -qAt "$@"; }
remove_files() { # $1 = bucket ; fichiers v1/<uuid>.<ext> lus sur l'entrée
  local file
  while IFS= read -r file; do
    [[ "$file" =~ ^v1/[0-9a-f-]{36}\.(zip|jpg|png|webp)$ ]] || continue
    rm -f "$DATA/storage/$1/$file"
  done
}
printf "select file from public.lks_photos where lower(author) = lower(:'n');\n" | psql_lks -v n="$NAME" | remove_files lks-gallery
printf "select file from public.lks_proposals where lower(author) = lower(:'n') and file <> '';\n" | psql_lks -v n="$NAME" | remove_files lks-proposals
printf "select public.lks_forget(:'n');\n" | psql_lks -v n="$NAME"
echo "Pense aussi : /delier côté Discord si le pilote était lié, et les sauvegardes expirent seules sous 7 jours."
