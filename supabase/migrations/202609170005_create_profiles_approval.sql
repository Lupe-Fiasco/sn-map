-- Adds formal-account approval and administrator review. Run after migrations 001-004.
-- Administrator membership is bootstrapped manually in the Supabase SQL Editor; no identity is embedded here.

begin;

do $$
declare
  places_oid regclass := to_regclass('public.places');
  snapshots_oid regclass := to_regclass('public.map_snapshots');
begin
  if places_oid is null then
    raise exception '审核 migration 前置检查失败：public.places 不存在，请先按顺序执行 migration 001-002。';
  end if;
  if snapshots_oid is null then
    raise exception '审核 migration 前置检查失败：public.map_snapshots 不存在，请先按顺序执行 migration 003-004。';
  end if;
  if not exists (
    select 1 from pg_attribute where attrelid = snapshots_oid
      and attname = 'public_fields' and not attisdropped
  ) then
    raise exception '审核 migration 前置检查失败：安全快照结构不存在，请先按顺序执行 migration 003-004。';
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  approval_status text not null default 'pending'
    constraint profiles_approval_status_check check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.set_profiles_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute function public.set_profiles_updated_at();

-- ai coding：触发器只复制 auth.users 的稳定 id/email，新账号一律 pending；backfill 不覆盖已有审核结论。
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, approval_status)
  values (new.id, new.email, 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, email, approval_status, created_at, updated_at)
select id, email, 'pending', created_at, coalesce(updated_at, created_at, now())
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
revoke all on table public.profiles, public.admin_users from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (approval_status) on table public.profiles to authenticated;

-- ai coding：两个布尔 definer 不接受目标 user id，调用者只能检查自己的 JWT，且无法枚举管理员表。
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
    or exists (select 1 from auth.users where id = (select auth.uid()) and is_anonymous = true)
    or exists (select 1 from public.profiles where id = (select auth.uid()) and approval_status = 'approved')
  );
$$;

revoke all on function public.is_admin(), public.is_approved() from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_approved() to authenticated;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select public.is_admin()));
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

-- No direct admin_users policy or grant: membership is changed only by trusted SQL/bootstrap.

drop policy if exists "places_select_own" on public.places;
create policy "places_select_own" on public.places for select to authenticated
using ((select auth.uid()) = owner_id and (select public.is_approved()));
drop policy if exists "places_insert_own" on public.places;
create policy "places_insert_own" on public.places for insert to authenticated
with check ((select auth.uid()) = owner_id and (select public.is_approved()));
drop policy if exists "places_update_own" on public.places;
create policy "places_update_own" on public.places for update to authenticated
using ((select auth.uid()) = owner_id and (select public.is_approved()))
with check ((select auth.uid()) = owner_id and (select public.is_approved()));
drop policy if exists "places_delete_own" on public.places;
create policy "places_delete_own" on public.places for delete to authenticated
using ((select auth.uid()) = owner_id and (select public.is_approved()));

drop policy if exists "map_snapshots_select_own" on public.map_snapshots;
create policy "map_snapshots_select_own" on public.map_snapshots for select to authenticated
using ((select auth.uid()) = owner_id and (select public.is_approved()));
drop policy if exists "map_snapshots_insert_own" on public.map_snapshots;
create policy "map_snapshots_insert_own" on public.map_snapshots for insert to authenticated
with check ((select auth.uid()) = owner_id and (select public.is_approved()));
drop policy if exists "map_snapshots_update_own" on public.map_snapshots;
create policy "map_snapshots_update_own" on public.map_snapshots for update to authenticated
using ((select auth.uid()) = owner_id and (select public.is_approved()))
with check ((select auth.uid()) = owner_id and (select public.is_approved()));
drop policy if exists "map_snapshots_delete_own" on public.map_snapshots;
create policy "map_snapshots_delete_own" on public.map_snapshots for delete to authenticated
using ((select auth.uid()) = owner_id and (select public.is_approved()));

commit;
