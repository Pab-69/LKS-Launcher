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
  if found and ((p_kind = 'time' and cur.lap_ms <= p_lap_ms) or (p_kind <> 'time' and cur.score >= p_score)) then
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
