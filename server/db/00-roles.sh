#!/bin/sh
# Premier démarrage de la base : les rôles utilisés par l'API (comme sur Supabase).
#   anon          : ce que peuvent faire les launchers (lire, et écrire via les fonctions)
#   authenticator : le compte de connexion de l'API, qui prend le rôle anon
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
create role anon nologin;
create role authenticated nologin;
create role authenticator login noinherit password '$AUTHENTICATOR_PASSWORD';
grant anon, authenticated to authenticator;
grant usage on schema public to anon, authenticated;

-- le script du classement prévoit aussi le stockage de Supabase : ici les
-- fichiers sont gérés par le service « storage », ces tables restent vides
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
SQL
