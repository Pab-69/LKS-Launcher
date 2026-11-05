#!/bin/sh
# Toutes les heures : ménage des données passagères (qui est en ligne, direct,
# parties hébergées, runs de plus de 30 jours, propositions de plus de 180 jours).
# Une fois par jour : sauvegarde de la base dans ./backups (KEEP_DAYS jours gardés).
KEEP_DAYS=${KEEP_DAYS:-7}
# Au démarrage : applique le schéma (idempotent) puis dit à l'API de le recharger.
# Absent du dossier monté du mode « lks.sh » : ./lks.sh update le fait déjà.
if [ -f /leaderboard.sql ]; then
  until pg_isready -h db -U postgres -d lks -q; do sleep 2; done
  psql -h db -U postgres -d lks -v ON_ERROR_STOP=1 -qAt -f /leaderboard.sql >/dev/null || echo "schéma non appliqué"
  psql -h db -U postgres -d lks -qAt -c "notify pgrst, 'reload schema'" >/dev/null 2>&1 || true
fi
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
