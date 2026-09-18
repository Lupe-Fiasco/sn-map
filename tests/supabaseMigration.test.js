import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202609170002_upgrade_places_owner_primary_key.sql", import.meta.url);
const createMigrationUrl = new URL("../supabase/migrations/202609170001_create_places.sql", import.meta.url);
const snapshotsMigrationUrl = new URL("../supabase/migrations/202609170003_create_map_snapshots.sql", import.meta.url);
const secureSnapshotsMigrationUrl = new URL("../supabase/migrations/202609170004_secure_public_snapshot_access.sql", import.meta.url);
const approvalMigrationUrl = new URL("../supabase/migrations/202609170005_create_profiles_approval.sql", import.meta.url);

test("places upgrade migration protects ownership and installs the owner-scoped conflict key", async () => {
  const [createSql, sql] = await Promise.all([
    readFile(createMigrationUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  // ai coding：静态守卫覆盖 fresh/no-op、旧 id 主键升级和归属不明时中止这三条关键路径。
  assert.match(createSql, /constraint places_pkey primary key \(owner_id, id\)/);
  assert.match(createSql, /旧表必要列缺失或类型不符/);
  assert.ok(createSql.indexOf("do $$") < createSql.indexOf("create table if not exists"));
  assert.ok(createSql.indexOf("create table if not exists") < createSql.indexOf("alter table public.places enable row level security"));
  assert.match(createSql, /'owner_id', 'uuid'::regtype::oid/);
  assert.match(createSql, /'geometry', 'jsonb'::regtype::oid/);
  assert.match(createSql, /无法对应 auth\.users\.id/);
  assert.match(createSql, /^begin;[\s\S]*commit;\s*$/m);
  assert.match(sql, /primary_key_columns = array\['owner_id', 'id'\]/);
  assert.match(sql, /primary_key_columns = array\['id'\]/);
  assert.match(sql, /owner_id is null/);
  assert.match(sql, /drop constraint/);
  assert.match(sql, /primary key \(owner_id, id\)/);
  assert.match(sql, /不会猜测 owner/);
  assert.ok(sql.indexOf("旧表必要列缺失或类型不符") < sql.indexOf("alter table public.places drop constraint"));
  assert.match(sql, /'longitude', 'double precision'::regtype::oid/);
  assert.match(sql, /owner_id 缺少指向 auth\.users\(id\)/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("snapshot setup migration isolates owner writes", async () => {
  const sql = await readFile(snapshotsMigrationUrl, "utf8");
  assert.match(sql, /owner_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /share_token text not null unique/);
  assert.match(sql, /snapshot jsonb not null/);
  assert.match(sql, /for select to anon, authenticated using \(is_public = true\)/);
  assert.match(sql, /for insert to authenticated with check \(\(select auth\.uid\(\)\) = owner_id\)/);
  assert.match(sql, /for update to authenticated using \(\(select auth\.uid\(\)\) = owner_id\)/);
  assert.match(sql, /for delete to authenticated using \(\(select auth\.uid\(\)\) = owner_id\)/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("secure snapshot migration removes direct public reads and rebuilds an allowlisted response", async () => {
  const sql = await readFile(secureSnapshotsMigrationUrl, "utf8");
  // ai coding：静态守卫确保旧行默认仅 name、RPC 不回传敏感行字段，且 anon 无表级 SELECT。
  assert.match(sql, /public_fields text\[\] not null default array\['name'\]::text\[\]/);
  assert.match(sql, /public_fields <@ array\['name', 'type', 'coordinates', 'notes'\]::text\[\]/);
  assert.match(sql, /drop policy if exists "map_snapshots_select_public"/);
  assert.match(sql, /revoke all on table public\.map_snapshots from anon/);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/);
  assert.match(sql, /where m\.share_token = p_share_token[\s\S]*and m\.is_public = true/);
  assert.match(sql, /jsonb_build_object\([\s\S]*'geometry'[\s\S]*'name'[\s\S]*'type'[\s\S]*'coordinates'[\s\S]*'notes'/);
  assert.match(sql, /snapshot_public_coordinates\(feature\)/);
  assert.match(sql, /grant execute on function public\.get_public_map_snapshot\(text\) to anon, authenticated/);
  assert.doesNotMatch(sql, /grant execute[^;]+service_role/i);
  assert.doesNotMatch(sql, /grant select[^;]+anon/i);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("approval migration installs profiles, non-enumerable admins, trigger, and owner approval RLS", async () => {
  const sql = await readFile(approvalMigrationUrl, "utf8");
  // ai coding：静态守卫确保审核只影响管理端 owner policy，公开快照 RPC 不被替换或收紧。
  assert.match(sql, /create table if not exists public\.profiles/);
  assert.match(sql, /approval_status in \('pending', 'approved', 'rejected'\)/);
  assert.match(sql, /create table if not exists public\.admin_users/);
  assert.match(sql, /create trigger on_auth_user_created_profile after insert on auth\.users/);
  assert.match(sql, /insert into public\.profiles[\s\S]*from auth\.users[\s\S]*on conflict \(id\) do nothing/);
  assert.match(sql, /create or replace function public\.is_admin\(\)[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(sql, /create or replace function public\.is_approved\(\)[\s\S]*is_anonymous = true/);
  assert.match(sql, /revoke all on table public\.profiles, public\.admin_users from public, anon, authenticated/);
  assert.match(sql, /grant update \(approval_status\) on table public\.profiles to authenticated/);
  assert.match(sql, /profiles_select_self_or_admin[\s\S]*public\.is_admin\(\)/);
  assert.match(sql, /places_select_own[\s\S]*public\.is_approved\(\)/);
  assert.match(sql, /map_snapshots_update_own[\s\S]*public\.is_approved\(\)/);
  assert.doesNotMatch(sql, /get_public_map_snapshot|map_snapshots_select_public/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});
