-- Chicken Tinder schema. Run once in the Supabase SQL editor.
-- Then set the admin passcode (see bottom of file).

create extension if not exists pgcrypto with schema extensions;

-- Tables ---------------------------------------------------------------

create table if not exists public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  cuisine    text not null default '' check (char_length(cuisine) <= 40),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- A round freezes a shuffled lineup so both players see the same order.
create table if not exists public.rounds (
  id         uuid primary key default gen_random_uuid(),
  lineup     uuid[] not null,
  status     text not null default 'open' check (status in ('open', 'matched')),
  match_id   uuid references public.restaurants(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.swipes (
  round_id      uuid not null references public.rounds(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  player        text not null check (player in ('joobacca', 'jd')),
  liked         boolean not null,
  created_at    timestamptz not null default now(),
  primary key (round_id, restaurant_id, player)
);

-- The passcode hash lives outside the API-exposed schema.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.admin (
  id            boolean primary key default true check (id),
  passcode_hash text not null
);

-- Row level security: everyone with the link can read, nobody writes
-- directly. All writes go through the functions below.

alter table public.restaurants enable row level security;
alter table public.rounds      enable row level security;
alter table public.swipes      enable row level security;

drop policy if exists "read restaurants" on public.restaurants;
drop policy if exists "read rounds" on public.rounds;
drop policy if exists "read swipes" on public.swipes;
create policy "read restaurants" on public.restaurants for select to anon, authenticated using (true);
create policy "read rounds"      on public.rounds      for select to anon, authenticated using (true);
create policy "read swipes"      on public.swipes      for select to anon, authenticated using (true);

-- Admin ----------------------------------------------------------------

create or replace function private.check_passcode(passcode text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.admin a
    where a.passcode_hash = extensions.crypt(passcode, a.passcode_hash)
  ) then
    raise exception 'Wrong passcode' using errcode = '28P01';
  end if;
end $$;

create or replace function public.admin_verify(passcode text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_passcode(passcode);
  return true;
end $$;

create or replace function public.admin_save_restaurant(
  passcode text, rid uuid, rname text, rcuisine text, ractive boolean
) returns public.restaurants language plpgsql security definer set search_path = '' as $$
declare r public.restaurants;
begin
  perform private.check_passcode(passcode);
  if rid is null then
    insert into public.restaurants (name, cuisine, active)
    values (trim(rname), trim(coalesce(rcuisine, '')), coalesce(ractive, true))
    returning * into r;
  else
    update public.restaurants
       set name = trim(rname), cuisine = trim(coalesce(rcuisine, '')), active = coalesce(ractive, true)
     where id = rid
    returning * into r;
  end if;
  return r;
end $$;

create or replace function public.admin_delete_restaurant(passcode text, rid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_passcode(passcode);
  delete from public.restaurants where id = rid;
end $$;

-- Play -----------------------------------------------------------------

create or replace function public.new_round()
returns public.rounds language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  r public.rounds;
begin
  select array_agg(id order by random()) into ids
    from public.restaurants where active;
  if ids is null then
    raise exception 'No active restaurants on the list';
  end if;
  insert into public.rounds (lineup) values (ids) returning * into r;
  return r;
end $$;

-- Records a swipe. A match is any restaurant both players liked; the
-- client works those out from the swipes, so rounds never close early.
create or replace function public.swipe(
  p_round uuid, p_restaurant uuid, p_player text, p_liked boolean
) returns public.rounds language plpgsql security definer set search_path = '' as $$
declare r public.rounds;
begin
  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Round not found';
  end if;
  if not (p_restaurant = any (r.lineup)) then
    return r;
  end if;

  insert into public.swipes (round_id, restaurant_id, player, liked)
  values (p_round, p_restaurant, p_player, p_liked)
  on conflict do nothing;
  return r;
end $$;

revoke all on function private.check_passcode(text) from public, anon, authenticated;
grant execute on function public.admin_verify(text) to anon, authenticated;
grant execute on function public.admin_save_restaurant(text, uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_delete_restaurant(text, uuid) to anon, authenticated;
grant execute on function public.new_round() to anon, authenticated;
grant execute on function public.swipe(uuid, uuid, text, boolean) to anon, authenticated;

-- Live updates ----------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.restaurants, public.rounds, public.swipes;
exception when duplicate_object then null;
end $$;

-- Admin passcode ----------------------------------------------------------
-- Run this separately, with your own passcode, and don't commit it:
--
--   insert into private.admin (passcode_hash)
--   values (extensions.crypt('your-passcode-here', extensions.gen_salt('bf')))
--   on conflict (id) do update set passcode_hash = excluded.passcode_hash;
