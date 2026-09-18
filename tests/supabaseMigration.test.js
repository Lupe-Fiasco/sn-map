import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202609170002_upgrade_places_owner_primary_key.sql", import.meta.url);
const createMigrationUrl = new URL("../supabase/migrations/202609170001_create_places.sql", import.meta.url);
const snapshotsMigrationUrl = new URL("../supabase/migrations/202609170003_create_map_snapshots.sql", import.meta.url);

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

test("snapshot migration isolates owner writes and limits public reads", async () => {
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
