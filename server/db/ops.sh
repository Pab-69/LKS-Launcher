#!/bin/sh
# Toutes les heures : ménage des données passagères (qui est en ligne, direct,
# parties hébergées, runs de plus de 30 jours, propositions de plus de 180 jours).
# Une fois par jour : sauvegarde de la base dans ./backups (KEEP_DAYS jours gardés).
KEEP_DAYS=${KEEP_DAYS:-7}
while true; do
  psql -h db -U postgres -d lks -qAt -c 'select public.lks_cleanup()' >/dev/null 2>&1 || echo "ménage impossible (la base démarre ?)"
  today=$(date +%F)
  if [ ! -f "/backups/lks-$today.sql.gz" ]; then
    if pg_dump -h db -U postgres -d lks | gzip > "/backups/lks-$today.sql.gz.part"; then
      mv "/backups/lks-$today.sql.gz.part" "/backups/lks-$today.sql.gz"
    else
      rm -f "/backups/lks-$today.sql.gz.part"
      echo "sauvegarde impossible"
    fi
  fi
  find /backups -name 'lks-*.sql.gz' -mtime +"$KEEP_DAYS" -exec rm -f {} \;
  sleep 3600
done
