import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202609170002_upgrade_places_owner_primary_key.sql", import.meta.url);
const createMigrationUrl = new URL("../supabase/migrations/202609170001_create_places.sql", import.meta.url);
const snapshotsMigrationUrl = new URL("../supabase/migrations/202609170003_create_map_snapshots.sql", import.meta.url);
const secureSnapshotsMigrationUrl = new URL("../supabase/migrations/202609170004_secure_public_snapshot_access.sql", import.meta.url);
const approvalMigrationUrl = new URL("../supabase/migrations/202609170005_create_profiles_approval.sql", import.meta.url);
const imagesMigrationUrl = new URL("../supabase/migrations/202609170006_create_place_images.sql", import.meta.url);
const hardenedImagesMigrationUrl = new URL("../supabase/migrations/202609180007_harden_published_images.sql", import.meta.url);
const snapshotLevelsMigrationUrl = new URL("../supabase/migrations/202609200008_enforce_snapshot_levels.sql", import.meta.url);
const mapsMigrationUrl = new URL("../supabase/migrations/202609210009_add_maps_multiregion.sql", import.meta.url);
const storageCrudMigrationUrl = new URL("../supabase/migrations/202609220010_harden_storage_map_crud.sql", import.meta.url);

test("storage CRUD migration binds every object operation to map and place metadata", async () => {
  const sql = await readFile(storageCrudMigrationUrl, "utf8");
  const policy = (name) => sql.slice(sql.indexOf(`create policy "${name}"`), sql.indexOf(";", sql.indexOf(`create policy "${name}"`)) + 1);

  // ai coding：静态守卫逐项锁定私有/公开对象的 map、place、image 关联，以及匿名账号写访问禁令。
  for (const operation of ["select", "update", "delete"]) {
    const privateSql = policy(`private_place_images_${operation}_own`);
    assert.match(privateSql, /from public\.place_images image/);
    assert.match(privateSql, /image\.storage_path = name/);
    assert.match(privateSql, /split_part\(name, '\/', 2\) = image\.map_id/);
    assert.match(privateSql, /split_part\(name, '\/', 3\) = image\.place_id/);
    assert.match(privateSql, /image\.map_id = 'suining'/);
    assert.match(privateSql, /is_anonymous/);
    assert.match(privateSql, /public\.is_approved\(\)/);
  }
  for (const operation of ["select", "update", "delete"]) {
    const publicSql = policy(`published_place_images_${operation}_own`);
    assert.match(publicSql, /from public\.place_images image/);
    assert.match(publicSql, /split_part\(name, '\/', 2\) = image\.map_id/);
    assert.match(publicSql, /split_part\(name, '\/', 4\) = image\.place_id/);
    assert.match(publicSql, /split_part\(name, '\/', 5\) = image\.id::text \|\| '\.webp'/);
    assert.match(publicSql, /image\.map_id = 'suining'/);
    assert.match(publicSql, /is_anonymous/);
    assert.doesNotMatch(publicSql, /to anon/);
  }
  assert.match(policy("private_place_images_insert_own"), /from public\.places place[\s\S]*place\.map_id = split_part\(name, '\/', 2\)[\s\S]*place\.id = split_part\(name, '\/', 3\)/);
  const privateDelete = policy("private_place_images_delete_own");
  // ai coding：孤儿补偿例外只存在于 private DELETE，并继续绑定非匿名已审核本人及其 owner/map/place。
  assert.match(privateDelete, /not exists \(select 1 from public\.place_images image where image\.storage_path = name\)/);
  assert.match(privateDelete, /split_part\(name, '\/', 1\) = \(select auth\.uid\(\)\)::text/);
  assert.match(privateDelete, /from public\.places place where place\.owner_id = \(select auth\.uid\(\)\)[\s\S]*place\.map_id = split_part\(name, '\/', 2\)[\s\S]*place\.id = split_part\(name, '\/', 3\)/);
  assert.match(privateDelete, /place\.map_id = 'suining' and place\.id = split_part\(name, '\/', 2\)/);
  assert.match(privateDelete, /split_part\(split_part\(name, '\/', 4\), '\.', 1\) = image\.id::text/);
  for (const operation of ["select", "update"]) assert.doesNotMatch(policy(`private_place_images_${operation}_own`), /not exists \(select 1 from public\.place_images/);
  for (const operation of ["select", "insert", "update", "delete"]) assert.doesNotMatch(policy(`published_place_images_${operation}_own`), /not exists \(select 1 from public\.place_images/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("maps migration backfills existing data and installs owner plus map isolation", async () => {
  const [sql, placeImages] = await Promise.all([
    readFile(mapsMigrationUrl, "utf8"),
    readFile(new URL("../src/services/placeImages.js", import.meta.url), "utf8"),
  ]);
  assert.ok(sql.indexOf("migration 009 已停止") < sql.indexOf("create table public.maps"));
  assert.match(sql, /update public\.places set map_id = 'suining'/);
  assert.match(sql, /primary key \(owner_id, map_id, id\)/);
  assert.match(sql, /primary key \(owner_id, map_id\)/);
  assert.match(sql, /foreign key \(owner_id, map_id, place_id\)/);
  assert.match(sql, /returns table\(title text, published_at timestamptz, map_config jsonb, snapshot jsonb\)/);
  assert.match(sql, /source_image\.map_id=m\.map_id/);
  // ai coding：Storage policy 必须与客户端四/五段路径同步，并通过数据库关系约束 map/place/image，不能只检查 owner 前缀。
  assert.match(placeImages, /`\$\{ownerId\}\/\$\{mapId\}\/\$\{placeId\}\/\$\{id\}\.\$\{extensionFor\(file\.type\)\}`/);
  assert.match(placeImages, /`\$\{ownerId\}\/\$\{mapId\}\/\$\{releaseId\}\/\$\{row\.place_id\}\/\$\{row\.id\}\.webp`/);
  assert.match(sql, /private_place_images_insert_own[\s\S]*p\.map_id=split_part\(name,'\/',2\)[\s\S]*p\.id=split_part\(name,'\/',3\)/);
  assert.match(sql, /p\.map_id='suining' and p\.id=split_part\(name,'\/',2\)/);
  assert.match(sql, /published_place_images_insert_own[\s\S]*source_image\.map_id=split_part\(name,'\/',2\)[\s\S]*source_image\.place_id=split_part\(name,'\/',4\)/);
  assert.match(sql, /is_anonymous'[\s\S]*public\.is_approved\(\)/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

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

test("place images migration installs only rerun-safe foundational image objects", async () => {
  const sql = await readFile(imagesMigrationUrl, "utf8");
  // ai coding：006 禁止覆盖 007 独占的最终 bucket、policy、约束和 RPC。
  assert.match(sql, /create table if not exists public\.place_images/);
  assert.match(sql, /foreign key \(owner_id, place_id\)[\s\S]*references public\.places\(owner_id, id\) on delete cascade/);
  assert.doesNotMatch(sql, /foreign key \(place_id\)/);
  assert.match(sql, /'place-images', 'place-images', false/);
  assert.match(sql, /'published-place-images', 'published-place-images', false, 5242880, array\['image\/webp'\][\s\S]*on conflict \(id\) do nothing/);
  assert.match(sql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.match(sql, /is_anonymous/);
  assert.doesNotMatch(sql, /published_place_images_(select|insert|update|delete)_own/);
  assert.doesNotMatch(sql, /map_snapshots_public_fields_check|get_public_map_snapshot|grant select[^;]+anon/i);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("published image hardening rejects anonymous manifests and rebuilds only verified WebP objects", async () => {
  const sql = await readFile(hardenedImagesMigrationUrl, "utf8");
  // ai coding：007 必须可追加到已执行 006 的环境，历史行默认禁用图片且访客仍无表 SELECT。
  assert.match(sql, /image_manifest_version smallint not null default 0/);
  assert.match(sql, /public_fields <@ array\['name', 'type', 'coordinates', 'notes', 'images'\]/);
  assert.match(sql, /map_snapshots_insert_own[\s\S]*is_anonymous[\s\S]*image_manifest_version = 1/);
  assert.match(sql, /map_snapshots_update_own[\s\S]*is_anonymous[\s\S]*image_manifest_version = 1/);
  assert.match(sql, /allowed_mime_types = array\['image\/webp'\]/);
  assert.match(sql, /published_place_images_insert_own[\s\S]*metadata->>'mimetype'[\s\S]*image\/webp/);
  assert.match(sql, /join public\.place_images source_image/);
  assert.match(sql, /join storage\.objects stored[\s\S]*stored\.bucket_id = 'published-place-images'/);
  assert.match(sql, /split_part\(stored\.name, '\/', 1\) = m\.owner_id::text/);
  assert.match(sql, /split_part\(stored\.name, '\/', 3\) = coalesce/);
  assert.match(sql, /split_part\(stored\.name, '\/', 4\) = \(image->>'id'\) \|\| '\.webp'/);
  assert.match(sql, /'url', '\/storage\/v1\/object\/public\/published-place-images\/' \|\| stored\.name/);
  assert.match(sql, /'notes', feature #> '\{properties,notes\}'[\s\S]*'address', feature #> '\{properties,address\}'[\s\S]*'phone', feature #> '\{properties,phone\}'[\s\S]*'website', feature #> '\{properties,website\}'[\s\S]*'opening_hours', feature #> '\{properties,opening_hours\}'/);
  assert.doesNotMatch(sql, /jsonb_build_object\([^)]*owner_id|jsonb_build_object\([^)]*token/i);
  assert.doesNotMatch(sql, /image->'url'|image->>'url'/);
  assert.doesNotMatch(sql, /grant select[^;]+anon/i);
  assert.doesNotMatch(sql, /service_role/i);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("snapshot level migration blocks legacy snapshot and republication bypasses while allowing atomic upgrades", async () => {
  const sql = await readFile(snapshotLevelsMigrationUrl, "utf8");
  // ai coding：静态守卫锁定 REST 可利用的 snapshot/is_public 路径，同时保留一次性合法升级与取消公开。
  assert.match(sql, /publication_level = 'basic' and public_fields = array\['name', 'type', 'coordinates'\]/);
  assert.match(sql, /publication_level = 'details' and public_fields = array\['name', 'type', 'coordinates', 'notes'\]/);
  assert.match(sql, /publication_level = 'images' and public_fields = array\['name', 'type', 'coordinates', 'notes', 'images'\]/);
  assert.match(sql, /if tg_op = 'INSERT'[\s\S]*new snapshots require a valid publication_level/);
  assert.match(sql, /if new\.publication_level in \('basic', 'details', 'images'\)[\s\S]*public_fields does not match publication_level[\s\S]*return new/);
  assert.match(sql, /old\.publication_level is not null[\s\S]*new\.publication_level is not null/);
  assert.match(sql, /new\.snapshot is distinct from old\.snapshot/);
  assert.match(sql, /new\.public_fields is distinct from old\.public_fields/);
  assert.match(sql, /new\.share_token is distinct from old\.share_token/);
  assert.match(sql, /new\.image_manifest_version is distinct from old\.image_manifest_version/);
  assert.match(sql, /old\.is_public = false and new\.is_public = true/);
  assert.match(sql, /legacy snapshot and public_fields are immutable; republish with a valid level/);
  assert.match(sql, /when p_level is null then array\[\]::text\[\]/);
  assert.match(sql, /snapshot_allowed_public_fields\(m\.publication_level, m\.public_fields\)/);
  assert.match(sql, /join public\.place_images source_image[\s\S]*join storage\.objects stored/);
  assert.doesNotMatch(sql, /grant select[^;]+anon/i);
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
