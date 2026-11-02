-- Classement LKS : à exécuter une fois dans Supabase (SQL Editor > New query > Run).
-- Chaque pilote garde une seule entrée par voiture / circuit / tracé / type
-- (meilleur temps ou meilleur score de drift). Les launchers lisent tout le
-- classement et n'écrivent que via la fonction submit_lap, qui ne remplace un
-- record que par un meilleur.

create table if not exists public.lks_laps (
  id bigint generated always as identity primary key,
  steam_id text not null,
  driver text not null,
  car text not null,
  track text not null,
  layout text not null default '',
  kind text not null check (kind in ('time', 'drift')),
  lap_ms integer,
  score integer,
  samples text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (steam_id, car, track, layout, kind)
);

create index if not exists lks_laps_board on public.lks_laps (track, layout, kind);

alter table public.lks_laps enable row level security;

drop policy if exists "lecture publique" on public.lks_laps;
create policy "lecture publique" on public.lks_laps for select using (true);

create or replace function public.submit_lap(
  p_steam_id text, p_driver text, p_car text, p_track text, p_layout text,
  p_kind text, p_lap_ms integer, p_score integer, p_samples text, p_meta jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  cur public.lks_laps%rowtype;
begin
  if p_kind not in ('time', 'drift')
     or coalesce(length(p_steam_id), 0) not between 1 and 32
     or coalesce(length(p_driver), 0) not between 1 and 40
     or coalesce(length(p_car), 0) not between 1 and 80
     or coalesce(length(p_track), 0) not between 1 and 80
     or length(coalesce(p_layout, '')) > 80
     or length(coalesce(p_samples, '')) > 400000 then
    raise exception 'données invalides';
  end if;
  if p_kind = 'time' and (p_lap_ms is null or p_lap_ms < 10000 or p_lap_ms > 3600000) then
    raise exception 'temps invalide';
  end if;
  if p_kind = 'drift' and (p_score is null or p_score < 1 or p_score > 10000000) then
    raise exception 'score invalide';
  end if;

  select * into cur from public.lks_laps
   where steam_id = p_steam_id and car = p_car and track = p_track
     and layout = coalesce(p_layout, '') and kind = p_kind;
  if found and ((p_kind = 'time' and cur.lap_ms <= p_lap_ms) or (p_kind = 'drift' and cur.score >= p_score)) then
    return 'record précédent conservé';
  end if;

  insert into public.lks_laps (steam_id, driver, car, track, layout, kind, lap_ms, score, samples, meta)
  values (p_steam_id, p_driver, p_car, p_track, coalesce(p_layout, ''), p_kind, p_lap_ms, p_score, p_samples, coalesce(p_meta, '{}'::jsonb))
  on conflict (steam_id, car, track, layout, kind) do update
    set driver = excluded.driver, lap_ms = excluded.lap_ms, score = excluded.score,
        samples = excluded.samples, meta = excluded.meta, created_at = now();
  return 'nouveau record';
end $$;

revoke all on function public.submit_lap(text, text, text, text, text, text, integer, integer, text, jsonb) from public;
grant execute on function public.submit_lap(text, text, text, text, text, text, integer, integer, text, jsonb) to anon, authenticated;
grant select on public.lks_laps to anon, authenticated;
