-- Classement LKS : à exécuter une fois dans Supabase (SQL Editor > New query > Run).
-- Chaque pilote garde une seule entrée par voiture / circuit / tracé / type
-- (meilleur temps, ou meilleure note de drift / tandem sur 100 pour un parcours
-- et un mode donnés : « rules » change quand les admins modifient les clips ou
-- les règles, et finit par -debutant, -normal ou -pro, puis @manche pour un
-- championnat). Les battles ont une ligne par battle (steam_id = b-<id>). Les launchers lisent
-- tout le classement et n'écrivent que via la fonction submit_lap, qui ne
-- remplace un record que par un meilleur. Le script peut être relancé.

create table if not exists public.lks_laps (
  id bigint generated always as identity primary key,
  steam_id text not null,
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

create unique index if not exists lks_laps_entry on public.lks_laps (steam_id, car, track, layout, kind, rules);
create index if not exists lks_laps_board on public.lks_laps (track, layout, kind, rules);

alter table public.lks_laps enable row level security;

drop policy if exists "lecture publique" on public.lks_laps;
create policy "lecture publique" on public.lks_laps for select using (true);

create or replace function public.submit_lap(
  p_steam_id text, p_driver text, p_car text, p_track text, p_layout text,
  p_kind text, p_lap_ms integer, p_score numeric, p_samples text, p_meta jsonb, p_rules text default ''
) returns text
language plpgsql security definer set search_path = public as $$
declare
  cur public.lks_laps%rowtype;
begin
  if p_kind not in ('time', 'drift', 'tandem', 'battle')
     or coalesce(length(p_steam_id), 0) not between 1 and 32
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
   where steam_id = p_steam_id and car = p_car and track = p_track
     and layout = coalesce(p_layout, '') and kind = p_kind and rules = coalesce(p_rules, '');
  -- un record égal remplace l'ancien seulement s'il apporte un fantôme
  if found and (
       (p_kind = 'time' and (cur.lap_ms < p_lap_ms or (cur.lap_ms = p_lap_ms and not (p_meta ? 'ghost' and not cur.meta ? 'ghost'))))
    or (p_kind <> 'time' and (cur.score > p_score or (cur.score = round(p_score, 1) and not (p_meta ? 'ghost' and not cur.meta ? 'ghost'))))
  ) then
    return 'record précédent conservé';
  end if;

  insert into public.lks_laps (steam_id, driver, car, track, layout, kind, rules, lap_ms, score, samples, meta)
  values (p_steam_id, p_driver, p_car, p_track, coalesce(p_layout, ''), p_kind, coalesce(p_rules, ''), p_lap_ms, round(p_score, 1), p_samples, coalesce(p_meta, '{}'::jsonb))
  on conflict (steam_id, car, track, layout, kind, rules) do update
    set driver = excluded.driver, lap_ms = excluded.lap_ms, score = excluded.score,
        samples = excluded.samples, meta = excluded.meta, created_at = now();
  return 'nouveau record';
end $$;

revoke all on function public.submit_lap(text, text, text, text, text, text, integer, numeric, text, jsonb, text) from public;
grant execute on function public.submit_lap(text, text, text, text, text, text, integer, numeric, text, jsonb, text) to anon, authenticated;
grant select on public.lks_laps to anon, authenticated;

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
  delete from public.lks_hosts where updated_at < now() - interval '1 day';
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
  steam_id text not null default '',
  message text not null default '',
  link text not null default '',
  file text not null default '',
  size bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.lks_proposals enable row level security;
revoke all on public.lks_proposals from anon, authenticated;
create or replace view public.lks_proposals_list with (security_invoker = false) as
  select id, kind, car, skin, track, title, author, message, link, file, size, created_at
    from public.lks_proposals where created_at > now() - interval '180 days';
grant select on public.lks_proposals_list to anon, authenticated;

create or replace function public.submit_proposal(
  p_id uuid, p_kind text, p_car text, p_skin text, p_track text, p_title text,
  p_author text, p_steam_id text, p_message text, p_link text, p_file text, p_size bigint
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('car', 'skin', 'setup')
     or coalesce(p_car, '') !~ '^[A-Za-z0-9_.-]{1,80}$'
     or coalesce(p_skin, '') !~ '^[A-Za-z0-9_. -]{0,80}$'
     or coalesce(p_track, '') !~ '^[A-Za-z0-9_.-]{0,80}$'
     or coalesce(length(p_title), 0) not between 1 and 80
     or coalesce(length(p_author), 0) not between 1 and 40
     or length(coalesce(p_steam_id, '')) > 32
     or length(coalesce(p_message, '')) > 600
     or (coalesce(p_link, '') <> '' and (p_link !~ '^https://[^ ]{4,}$' or length(p_link) > 400))
     or (coalesce(p_file, '') <> '' and p_file !~ '^v1/[0-9a-f-]{36}\.zip$')
     or (coalesce(p_link, '') = '' and coalesce(p_file, '') = '')
     or coalesce(p_size, 0) not between 0 and 20000000000 then
    raise exception 'données invalides';
  end if;
  if (select count(*) from public.lks_proposals
       where (steam_id = coalesce(p_steam_id, '') and coalesce(p_steam_id, '') <> '' or author = p_author)
         and created_at > now() - interval '1 day') >= 5 then
    raise exception 'trop de propositions aujourd''hui, réessaie demain';
  end if;
  insert into public.lks_proposals (id, kind, car, skin, track, title, author, steam_id, message, link, file, size)
  values (p_id, p_kind, p_car, coalesce(p_skin, ''), coalesce(p_track, ''), p_title, p_author, coalesce(p_steam_id, ''), coalesce(p_message, ''), coalesce(p_link, ''), coalesce(p_file, ''), coalesce(p_size, 0));
  return 'ok';
end $$;

revoke all on function public.submit_proposal(uuid, text, text, text, text, text, text, text, text, text, text, bigint) from public;
grant execute on function public.submit_proposal(uuid, text, text, text, text, text, text, text, text, text, text, bigint) to anon, authenticated;

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
  delete from public.lks_presence where updated_at < now() - interval '1 day';
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
