-- Classement LKS : à exécuter une fois dans Supabase (SQL Editor > New query > Run),
-- ou installé tout seul par le serveur du groupe (dossier server/ du launcher).
--
-- Données gardées : seulement ce qui sert au groupe. Aucun Steam ID, aucune
-- adresse e-mail, aucun compte. Un pilote = le nom qu'il a choisi + un
-- identifiant au hasard créé par son launcher (« player », jamais lisible par
-- les autres). Les données passagères s'effacent toutes seules (voir lks_cleanup).
--
-- Chaque pilote garde une seule entrée par voiture / circuit / tracé / type
-- (meilleur temps, ou meilleure note de drift / tandem sur 100 pour un parcours
-- et un mode donnés : « rules » change quand les admins modifient les clips ou
-- les règles, et finit par -debutant, -normal ou -pro, puis @manche pour un
-- championnat). Les battles ont une ligne par battle (player = b-<id>). Les launchers lisent
-- tout le classement et n'écrivent que via la fonction submit_lap, qui ne
-- remplace un record que par un meilleur. Le script peut être relancé.

create table if not exists public.lks_laps (
  id bigint generated always as identity primary key,
  player text not null,
  driver text not null,
  car text not null,
  track text not null,
  layout text not null default '',
  kind text not null,
  rules text not null default '',
  lap_ms integer,
  score numeric(4, 1),
  samples text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- mise à niveau d'une ancienne version du script
alter table public.lks_laps add column if not exists rules text not null default '';
alter table public.lks_laps drop constraint if exists lks_laps_kind_check;
alter table public.lks_laps add constraint lks_laps_kind_check check (kind in ('time', 'drift', 'tandem', 'battle'));
alter table public.lks_laps alter column score type numeric(4, 1) using least(score, 100);
alter table public.lks_laps drop constraint if exists lks_laps_steam_id_car_track_layout_kind_key;
drop function if exists public.submit_lap(text, text, text, text, text, text, integer, integer, text, jsonb);

-- mise à niveau : les Steam ID des anciennes versions sont remplacés par des
-- identifiants au hasard (la correspondance n'est gardée nulle part)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lks_laps' and column_name = 'steam_id') then
    create temporary table lks_new_ids on commit drop as
      select old, 'p-' || substr(md5(gen_random_uuid()::text), 1, 16) as new
        from (select distinct steam_id as old from public.lks_laps where steam_id not like 'b-%') ids;
    update public.lks_laps l set steam_id = m.new from lks_new_ids m where l.steam_id = m.old;
    alter table public.lks_laps rename column steam_id to player;
  end if;
end $$;

create unique index if not exists lks_laps_entry on public.lks_laps (player, car, track, layout, kind, rules);
create index if not exists lks_laps_board on public.lks_laps (track, layout, kind, rules);

alter table public.lks_laps enable row level security;

drop policy if exists "lecture publique" on public.lks_laps;
create policy "lecture publique" on public.lks_laps for select using (true);

drop function if exists public.submit_lap(text, text, text, text, text, text, integer, numeric, text, jsonb, text);
create or replace function public.submit_lap(
  p_player text, p_driver text, p_car text, p_track text, p_layout text,
  p_kind text, p_lap_ms integer, p_score numeric, p_samples text, p_meta jsonb, p_rules text default ''
) returns text
language plpgsql security definer set search_path = public as $$
declare
  cur public.lks_laps%rowtype;
begin
  if p_kind not in ('time', 'drift', 'tandem', 'battle')
     or coalesce(p_player, '') !~ '^(p-[0-9a-f]{8,32}|b-[A-Za-z0-9_-]{1,30})$'
     or coalesce(length(p_driver), 0) not between 1 and 40
     or coalesce(length(p_car), 0) not between 1 and 80
     or coalesce(length(p_track), 0) not between 1 and 80
     or length(coalesce(p_layout, '')) > 80
     or length(coalesce(p_rules, '')) > 32
     or length(coalesce(p_samples, '')) > 400000 then
    raise exception 'données invalides';
  end if;
  if p_kind = 'time' and (p_lap_ms is null or p_lap_ms < 10000 or p_lap_ms > 3600000) then
    raise exception 'temps invalide';
  end if;
  if p_kind in ('drift', 'tandem', 'battle') and (p_score is null or p_score <= 0 or p_score > 100) then
    raise exception 'note invalide';
  end if;

  select * into cur from public.lks_laps
   where player = p_player and car = p_car and track = p_track
     and layout = coalesce(p_layout, '') and kind = p_kind and rules = coalesce(p_rules, '');
  -- un record égal remplace l'ancien seulement s'il apporte un fantôme
  if found and (
       (p_kind = 'time' and (cur.lap_ms < p_lap_ms or (cur.lap_ms = p_lap_ms and not (p_meta ? 'ghost' and not cur.meta ? 'ghost'))))
    or (p_kind <> 'time' and (cur.score > p_score or (cur.score = round(p_score, 1) and not (p_meta ? 'ghost' and not cur.meta ? 'ghost'))))
  ) then
    return 'record précédent conservé';
  end if;

  insert into public.lks_laps (player, driver, car, track, layout, kind, rules, lap_ms, score, samples, meta)
  values (p_player, p_driver, p_car, p_track, coalesce(p_layout, ''), p_kind, coalesce(p_rules, ''), p_lap_ms, round(p_score, 1), p_samples, coalesce(p_meta, '{}'::jsonb))
  on conflict (player, car, track, layout, kind, rules) do update
    set driver = excluded.driver, lap_ms = excluded.lap_ms, score = excluded.score,
        samples = excluded.samples, meta = excluded.meta, created_at = now();
  return 'nouveau record';
end $$;

revoke all on function public.submit_lap(text, text, text, text, text, text, integer, numeric, text, jsonb, text) from public;
grant execute on function public.submit_lap(text, text, text, text, text, text, integer, numeric, text, jsonb, text) to anon, authenticated;
-- lecture : tout sauf l'identifiant du pilote
revoke select on public.lks_laps from anon, authenticated;
grant select (id, driver, car, track, layout, kind, rules, lap_ms, score, samples, meta, created_at) on public.lks_laps to anon, authenticated;

-- Parties hébergées depuis le launcher (onglet Serveurs) : chaque hôte annonce sa
-- partie toutes les minutes via announce_host ; elle disparaît de la liste 3 min
-- après la dernière annonce, ou tout de suite à l'arrêt (remove_host). Le mot de
-- passe de la partie n'est jamais stocké ici. Seul le launcher qui a créé une
-- annonce (il garde son « secret ») peut la modifier ou la retirer.

create table if not exists public.lks_hosts (
  id text primary key,
  secret text not null,
  name text not null,
  host_driver text not null default '',
  addresses jsonb not null default '[]'::jsonb,
  tcp_port integer not null,
  http_port integer not null,
  has_password boolean not null default false,
  track text not null default '',
  layout text not null default '',
  cars jsonb not null default '[]'::jsonb,
  slots integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.lks_hosts enable row level security;
revoke all on public.lks_hosts from anon, authenticated;
-- lecture : tout sauf le secret, et seulement les parties encore annoncées
create or replace view public.lks_hosts_live with (security_invoker = false) as
  select id, name, host_driver, addresses, tcp_port, http_port, has_password, track, layout, cars, slots, updated_at
    from public.lks_hosts where updated_at > now() - interval '3 minutes';
grant select on public.lks_hosts_live to anon, authenticated;

create or replace function public.announce_host(
  p_id text, p_secret text, p_name text, p_host_driver text, p_addresses jsonb,
  p_tcp_port integer, p_http_port integer, p_has_password boolean,
  p_track text, p_layout text, p_cars jsonb, p_slots integer
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_id), 0) not between 8 and 64
     or coalesce(length(p_secret), 0) not between 16 and 128
     or coalesce(length(p_name), 0) not between 1 and 60
     or length(coalesce(p_host_driver, '')) > 40
     or jsonb_typeof(coalesce(p_addresses, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_addresses, '[]'::jsonb)) > 8
     or length(coalesce(p_addresses, '[]'::jsonb)::text) > 2000
     or p_tcp_port not between 1 and 65535
     or p_http_port not between 1 and 65535
     or length(coalesce(p_track, '')) > 80
     or length(coalesce(p_layout, '')) > 80
     or jsonb_typeof(coalesce(p_cars, '[]'::jsonb)) <> 'array'
     or length(coalesce(p_cars, '[]'::jsonb)::text) > 4000
     or coalesce(p_slots, 0) not between 0 and 64 then
    raise exception 'données invalides';
  end if;
  delete from public.lks_hosts where updated_at < now() - interval '15 minutes';
  insert into public.lks_hosts (id, secret, name, host_driver, addresses, tcp_port, http_port, has_password, track, layout, cars, slots, updated_at)
  values (p_id, p_secret, p_name, coalesce(p_host_driver, ''), coalesce(p_addresses, '[]'::jsonb), p_tcp_port, p_http_port, coalesce(p_has_password, false), coalesce(p_track, ''), coalesce(p_layout, ''), coalesce(p_cars, '[]'::jsonb), coalesce(p_slots, 0), now())
  on conflict (id) do update
    set name = excluded.name, host_driver = excluded.host_driver, addresses = excluded.addresses,
        tcp_port = excluded.tcp_port, http_port = excluded.http_port, has_password = excluded.has_password,
        track = excluded.track, layout = excluded.layout, cars = excluded.cars, slots = excluded.slots, updated_at = now()
    where public.lks_hosts.secret = excluded.secret;
  return 'ok';
end $$;

create or replace function public.remove_host(p_id text, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
begin
  delete from public.lks_hosts where id = p_id and secret = p_secret;
  return 'ok';
end $$;

revoke all on function public.announce_host(text, text, text, text, jsonb, integer, integer, boolean, text, text, jsonb, integer) from public;
grant execute on function public.announce_host(text, text, text, text, jsonb, integer, integer, boolean, text, text, jsonb, integer) to anon, authenticated;
revoke all on function public.remove_host(text, text) from public;
grant execute on function public.remove_host(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Propositions des membres (voitures, livrées, setups) : chaque membre envoie
-- sa proposition depuis le launcher (fichier dans le stockage « lks-proposals »,
-- ou lien de téléchargement pour les gros fichiers). Les admins acceptent ou
-- refusent dans Publication ; la décision est publiée dans le manifeste.
-- 5 propositions par pilote et par jour au plus.

insert into storage.buckets (id, name, public, file_size_limit)
values ('lks-proposals', 'lks-proposals', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "lks proposals upload" on storage.objects;
create policy "lks proposals upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'lks-proposals' and name ~ '^v1/[0-9a-f-]{36}\.zip$');

create table if not exists public.lks_proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('car', 'skin', 'setup')),
  car text not null,
  skin text not null default '',
  track text not null default '',
  title text not null,
  author text not null,
  message text not null default '',
  link text not null default '',
  file text not null default '',
  size bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.lks_proposals enable row level security;
revoke all on public.lks_proposals from anon, authenticated;
create table if not exists public.lks_votes (
  proposal_id uuid not null,
  voter text not null,
  secret text not null,
  value smallint not null check (value in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, voter)
);
alter table public.lks_votes enable row level security;
revoke all on public.lks_votes from anon, authenticated;

drop view if exists public.lks_proposals_list;
create view public.lks_proposals_list with (security_invoker = false) as
  select p.id, p.kind, p.car, p.skin, p.track, p.title, p.author, p.message, p.link, p.file, p.size, p.created_at,
         coalesce((select count(*) from public.lks_votes v where v.proposal_id = p.id and v.value = 1), 0) as up,
         coalesce((select count(*) from public.lks_votes v where v.proposal_id = p.id and v.value = -1), 0) as down
    from public.lks_proposals p where p.created_at > now() - interval '180 days';
grant select on public.lks_proposals_list to anon, authenticated;

alter table public.lks_proposals drop column if exists steam_id;
drop function if exists public.submit_proposal(uuid, text, text, text, text, text, text, text, text, text, text, bigint);
create or replace function public.submit_proposal(
  p_id uuid, p_kind text, p_car text, p_skin text, p_track text, p_title text,
  p_author text, p_message text, p_link text, p_file text, p_size bigint
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('car', 'skin', 'setup')
     or coalesce(p_car, '') !~ '^[A-Za-z0-9_.-]{1,80}$'
     or coalesce(p_skin, '') !~ '^[A-Za-z0-9_. -]{0,80}$'
     or coalesce(p_track, '') !~ '^[A-Za-z0-9_.-]{0,80}$'
     or coalesce(length(p_title), 0) not between 1 and 80
     or coalesce(length(p_author), 0) not between 1 and 40
     or length(coalesce(p_message, '')) > 600
     or (coalesce(p_link, '') <> '' and (p_link !~ '^https://[^ ]{4,}$' or length(p_link) > 400))
     or (coalesce(p_file, '') <> '' and p_file !~ '^v1/[0-9a-f-]{36}\.zip$')
     or (coalesce(p_link, '') = '' and coalesce(p_file, '') = '')
     or coalesce(p_size, 0) not between 0 and 20000000000 then
    raise exception 'données invalides';
  end if;
  if (select count(*) from public.lks_proposals where author = p_author and created_at > now() - interval '1 day') >= 5 then
    raise exception 'trop de propositions aujourd''hui, réessaie demain';
  end if;
  delete from public.lks_proposals where created_at < now() - interval '180 days';
  delete from public.lks_votes v where not exists (select 1 from public.lks_proposals p where p.id = v.proposal_id);
  insert into public.lks_proposals (id, kind, car, skin, track, title, author, message, link, file, size)
  values (p_id, p_kind, p_car, coalesce(p_skin, ''), coalesce(p_track, ''), p_title, p_author, coalesce(p_message, ''), coalesce(p_link, ''), coalesce(p_file, ''), coalesce(p_size, 0));
  return 'ok';
end $$;

revoke all on function public.submit_proposal(uuid, text, text, text, text, text, text, text, text, text, bigint) from public;
grant execute on function public.submit_proposal(uuid, text, text, text, text, text, text, text, text, text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Qui est en ligne : chaque launcher ouvert s'annonce toutes les minutes
-- (pilote, en jeu ou non, serveur rejoint). Visible 3 min après la dernière
-- annonce. Le pilote peut le désactiver dans Paramètres.

create table if not exists public.lks_presence (
  id text primary key,
  secret text not null,
  name text not null,
  state text not null default 'launcher',
  server jsonb not null default '{}'::jsonb,
  car text not null default '',
  track text not null default '',
  layout text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.lks_presence enable row level security;
revoke all on public.lks_presence from anon, authenticated;
create or replace view public.lks_presence_live with (security_invoker = false) as
  select id, name, state, server, car, track, layout, updated_at
    from public.lks_presence where updated_at > now() - interval '3 minutes';
grant select on public.lks_presence_live to anon, authenticated;

create or replace function public.set_presence(
  p_id text, p_secret text, p_name text, p_state text, p_server jsonb, p_car text, p_track text, p_layout text
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_id), 0) not between 8 and 64
     or coalesce(length(p_secret), 0) not between 16 and 128
     or coalesce(length(p_name), 0) not between 1 and 40
     or p_state not in ('launcher', 'solo', 'online', 'hosting')
     or jsonb_typeof(coalesce(p_server, '{}'::jsonb)) <> 'object'
     or length(coalesce(p_server, '{}'::jsonb)::text) > 600
     or length(coalesce(p_car, '')) > 80 or length(coalesce(p_track, '')) > 80 or length(coalesce(p_layout, '')) > 80 then
    raise exception 'données invalides';
  end if;
  delete from public.lks_presence where updated_at < now() - interval '15 minutes';
  insert into public.lks_presence (id, secret, name, state, server, car, track, layout, updated_at)
  values (p_id, p_secret, p_name, p_state, coalesce(p_server, '{}'::jsonb), coalesce(p_car, ''), coalesce(p_track, ''), coalesce(p_layout, ''), now())
  on conflict (id) do update
    set name = excluded.name, state = excluded.state, server = excluded.server, car = excluded.car,
        track = excluded.track, layout = excluded.layout, updated_at = now()
    where public.lks_presence.secret = excluded.secret;
  return 'ok';
end $$;

create or replace function public.remove_presence(p_id text, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
begin
  delete from public.lks_presence where id = p_id and secret = p_secret;
  return 'ok';
end $$;

revoke all on function public.set_presence(text, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.set_presence(text, text, text, text, jsonb, text, text, text) to anon, authenticated;
revoke all on function public.remove_presence(text, text) from public;
grant execute on function public.remove_presence(text, text) to anon, authenticated;

-- Votes des membres sur les propositions (un vote par launcher, modifiable ; 0 = retirer).
create or replace function public.vote_proposal(p_proposal uuid, p_voter text, p_secret text, p_value integer) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_voter), 0) not between 8 and 64 or coalesce(length(p_secret), 0) not between 16 and 128 or p_value not in (-1, 0, 1)
     or not exists (select 1 from public.lks_proposals where id = p_proposal) then
    raise exception 'données invalides';
  end if;
  if p_value = 0 then
    delete from public.lks_votes where proposal_id = p_proposal and voter = p_voter and secret = p_secret;
    return 'ok';
  end if;
  insert into public.lks_votes (proposal_id, voter, secret, value) values (p_proposal, p_voter, p_secret, p_value)
  on conflict (proposal_id, voter) do update set value = excluded.value, updated_at = now()
    where public.lks_votes.secret = excluded.secret;
  return 'ok';
end $$;
revoke all on function public.vote_proposal(uuid, text, text, integer) from public;
grant execute on function public.vote_proposal(uuid, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Galerie : photos envoyées par les membres (stockage « lks-gallery », 10 Mo,
-- JPEG/PNG/WebP). Les admins peuvent en masquer depuis le launcher (manifeste).
-- 10 photos par pilote et par jour au plus.

insert into storage.buckets (id, name, public, file_size_limit)
values ('lks-gallery', 'lks-gallery', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "lks gallery upload" on storage.objects;
create policy "lks gallery upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'lks-gallery' and name ~ '^v1/[0-9a-f-]{36}\.(jpg|png|webp)$');

create table if not exists public.lks_photos (
  id uuid primary key,
  file text not null,
  author text not null,
  caption text not null default '',
  car text not null default '',
  track text not null default '',
  created_at timestamptz not null default now()
);
alter table public.lks_photos enable row level security;
revoke all on public.lks_photos from anon, authenticated;
create or replace view public.lks_photos_list with (security_invoker = false) as
  select id, file, author, caption, car, track, created_at from public.lks_photos order by created_at desc;
grant select on public.lks_photos_list to anon, authenticated;

create or replace function public.add_photo(p_id uuid, p_file text, p_author text, p_caption text, p_car text, p_track text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_file, '') !~ '^v1/[0-9a-f-]{36}\.(jpg|png|webp)$'
     or coalesce(length(p_author), 0) not between 1 and 40
     or length(coalesce(p_caption, '')) > 200
     or length(coalesce(p_car, '')) > 80 or length(coalesce(p_track, '')) > 80 then
    raise exception 'données invalides';
  end if;
  if (select count(*) from public.lks_photos where author = p_author and created_at > now() - interval '1 day') >= 10 then
    raise exception 'trop de photos aujourd''hui, réessaie demain';
  end if;
  insert into public.lks_photos (id, file, author, caption, car, track) values (p_id, p_file, p_author, coalesce(p_caption, ''), coalesce(p_car, ''), coalesce(p_track, ''));
  return 'ok';
end $$;
revoke all on function public.add_photo(uuid, text, text, text, text, text) from public;
grant execute on function public.add_photo(uuid, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notes de toutes les runs (pas seulement les records) : le launcher envoie la
-- note complète à la fin de chaque run (clips, zones, pénalités), pour que les
-- juges et le groupe les voient tout de suite. Gardées 30 jours.

create table if not exists public.lks_runs (
  id uuid primary key,
  driver text not null,
  car text not null default '',
  track text not null,
  layout text not null default '',
  kind text not null check (kind in ('drift', 'tandem')),
  score numeric(4, 1) not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.lks_runs enable row level security;
revoke all on public.lks_runs from anon, authenticated;
create index if not exists lks_runs_recent on public.lks_runs (created_at desc);
create or replace view public.lks_runs_list with (security_invoker = false) as
  select id, driver, car, track, layout, kind, score, detail, created_at from public.lks_runs
   where created_at > now() - interval '30 days';
grant select on public.lks_runs_list to anon, authenticated;

alter table public.lks_runs drop column if exists steam_id;
drop function if exists public.add_run(uuid, text, text, text, text, text, text, numeric, jsonb);
create or replace function public.add_run(
  p_id uuid, p_driver text, p_car text, p_track text, p_layout text, p_kind text, p_score numeric, p_detail jsonb
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_driver), 0) not between 1 and 40
     or coalesce(p_track, '') !~ '^[A-Za-z0-9_.-]{1,80}$' or coalesce(p_layout, '') !~ '^[A-Za-z0-9_.-]{0,80}$'
     or length(coalesce(p_car, '')) > 80 or p_kind not in ('drift', 'tandem')
     or p_score is null or p_score < 0 or p_score > 100
     or jsonb_typeof(coalesce(p_detail, '{}'::jsonb)) <> 'object' or length(coalesce(p_detail, '{}'::jsonb)::text) > 6000 then
    raise exception 'données invalides';
  end if;
  if (select count(*) from public.lks_runs where driver = p_driver and created_at > now() - interval '1 day') >= 400 then
    raise exception 'trop de runs aujourd''hui';
  end if;
  delete from public.lks_runs where created_at < now() - interval '30 days';
  insert into public.lks_runs (id, driver, car, track, layout, kind, score, detail)
  values (p_id, p_driver, coalesce(p_car, ''), p_track, coalesce(p_layout, ''), p_kind, p_score, coalesce(p_detail, '{}'::jsonb))
  on conflict (id) do nothing;
  return 'ok';
end $$;
revoke all on function public.add_run(uuid, text, text, text, text, text, numeric, jsonb) from public;
grant execute on function public.add_run(uuid, text, text, text, text, text, numeric, jsonb) to anon, authenticated;

-- Direct pendant les soirées : angle, vitesse, avancée de la run et clips pris,
-- envoyés toutes les 1 à 2 secondes par les launchers des pilotes en piste.
-- Visible 10 secondes après le dernier envoi.

create table if not exists public.lks_live (
  id text primary key,
  secret text not null,
  name text not null,
  car text not null default '',
  track text not null default '',
  layout text not null default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.lks_live enable row level security;
revoke all on public.lks_live from anon, authenticated;
create or replace view public.lks_live_now with (security_invoker = false) as
  select id, name, car, track, layout, data, updated_at from public.lks_live where updated_at > now() - interval '10 seconds';
grant select on public.lks_live_now to anon, authenticated;

create or replace function public.set_live(p_id text, p_secret text, p_name text, p_car text, p_track text, p_layout text, p_data jsonb) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_id), 0) not between 8 and 64 or coalesce(length(p_secret), 0) not between 16 and 128
     or coalesce(length(p_name), 0) not between 1 and 40
     or length(coalesce(p_car, '')) > 80 or length(coalesce(p_track, '')) > 80 or length(coalesce(p_layout, '')) > 80
     or jsonb_typeof(coalesce(p_data, '{}'::jsonb)) <> 'object' or length(coalesce(p_data, '{}'::jsonb)::text) > 2000 then
    raise exception 'données invalides';
  end if;
  delete from public.lks_live where updated_at < now() - interval '1 minute';
  insert into public.lks_live (id, secret, name, car, track, layout, data, updated_at)
  values (p_id, p_secret, p_name, coalesce(p_car, ''), coalesce(p_track, ''), coalesce(p_layout, ''), coalesce(p_data, '{}'::jsonb), now())
  on conflict (id) do update
    set name = excluded.name, car = excluded.car, track = excluded.track, layout = excluded.layout, data = excluded.data, updated_at = now()
    where public.lks_live.secret = excluded.secret;
  return 'ok';
end $$;
revoke all on function public.set_live(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.set_live(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Battles lancées en jeu : chaque launcher envoie les notes de son pilote
-- (lead et chase, calculées sur son PC qui voit sa voiture parfaitement) et
-- reprend celles de l'adversaire : les deux PC trouvent le même résultat.
-- Seulement le numéro de la battle, les deux noms et les notes. Gardé 7 jours.

create table if not exists public.lks_battle_parts (
  tag text not null,
  driver text not null,
  opponent text not null default '',
  parts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tag, driver)
);
alter table public.lks_battle_parts enable row level security;
revoke all on public.lks_battle_parts from anon, authenticated;
create or replace view public.lks_battle_parts_list with (security_invoker = false) as
  select tag, driver, opponent, parts, created_at from public.lks_battle_parts where created_at > now() - interval '7 days';
grant select on public.lks_battle_parts_list to anon, authenticated;

create or replace function public.add_battle_part(p_tag text, p_driver text, p_opponent text, p_parts jsonb) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_tag, '') !~ '^[A-Za-z0-9_-]{1,24}$' or coalesce(length(p_driver), 0) not between 1 and 40 or length(coalesce(p_opponent, '')) > 40
     or jsonb_typeof(coalesce(p_parts, '{}'::jsonb)) <> 'object' or length(coalesce(p_parts, '{}'::jsonb)::text) > 600 then
    raise exception 'données invalides';
  end if;
  delete from public.lks_battle_parts where created_at < now() - interval '7 days';
  insert into public.lks_battle_parts (tag, driver, opponent, parts) values (p_tag, p_driver, coalesce(p_opponent, ''), p_parts)
  on conflict (tag, driver) do nothing; -- la première note envoyée reste (pas de retouche après coup)
  return 'ok';
end $$;
revoke all on function public.add_battle_part(text, text, text, jsonb) from public;
grant execute on function public.add_battle_part(text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ménage : efface ce qui ne sert plus (les fonctions ci-dessus le font déjà à
-- chaque envoi ; le serveur du groupe l'appelle aussi toutes les heures).
-- Pas accessible aux launchers.
create or replace function public.lks_cleanup() returns text
language plpgsql security definer set search_path = public as $$
begin
  delete from public.lks_live where updated_at < now() - interval '1 minute';
  delete from public.lks_presence where updated_at < now() - interval '15 minutes';
  delete from public.lks_hosts where updated_at < now() - interval '15 minutes';
  delete from public.lks_runs where created_at < now() - interval '30 days';
  delete from public.lks_proposals where created_at < now() - interval '180 days';
  delete from public.lks_votes v where not exists (select 1 from public.lks_proposals p where p.id = v.proposal_id);
  delete from public.lks_battle_parts where created_at < now() - interval '7 days';
  return 'ok';
end $$;
revoke all on function public.lks_cleanup() from public, anon, authenticated;

-- Effacer toutes les données d'un pilote (à sa demande) : à lancer par un admin.
--   select public.lks_forget('Nom du pilote');
create or replace function public.lks_forget(p_driver text) returns text
language plpgsql security definer set search_path = public as $$
declare n integer := 0; k integer;
begin
  delete from public.lks_laps where lower(driver) = lower(p_driver)
     or (kind = 'battle' and (lower(driver) like lower(p_driver) || ' vs %' or lower(driver) like '% vs ' || lower(p_driver)));
  get diagnostics k = row_count; n := n + k;
  delete from public.lks_runs where lower(driver) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  delete from public.lks_presence where lower(name) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  delete from public.lks_live where lower(name) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  delete from public.lks_hosts where lower(host_driver) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  delete from public.lks_proposals where lower(author) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  delete from public.lks_photos where lower(author) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  delete from public.lks_battle_parts where lower(driver) = lower(p_driver) or lower(opponent) = lower(p_driver); get diagnostics k = row_count; n := n + k;
  return n || ' lignes effacées (les fichiers des photos et propositions sont à effacer dans le stockage)';
end $$;
revoke all on function public.lks_forget(text) from public, anon, authenticated;
