# SN Map React

睢宁县用户地点维护地图的 React + Vite 版本。使用 Leaflet 展示 OSM 在线底图、静态只读道路，并以 Supabase 保存独立用户地点。

```bash
npm install
npm run dev
npm test
npm run build
```

更新 OSM 范围与道路数据：`npm run build:map-data`。该命令会访问公共 Overpass API；正常开发无需运行。

## Supabase 初始化

1. 复制 `.env.example` 为 `.env.local` 并填写项目 URL 与 publishable key。
2. 在 Supabase 控制台启用 Authentication 的邮箱密码登录；如需保留兼容模式，同时启用 Anonymous Sign-Ins。按部署域名配置邮箱确认跳转 URL。
3. 按文件名顺序执行 `supabase/migrations/` 中尚未应用的 migration。已执行 004 的环境必须继续执行 `202609170005_create_profiles_approval.sql`；本仓库不会自动执行或修改远程数据库。
4. 先注册并完成管理员账号的邮箱确认，再由项目所有者在 **Supabase SQL Editor** 手动执行以下 bootstrap。把占位文本替换为自己的管理员邮箱；不要把真实邮箱或任何凭据写入仓库。该 SQL 只绑定已经存在的 `auth.users.id`，可安全重复执行：

```sql
insert into public.admin_users (user_id)
select id from auth.users
where lower(email)=lower('你的管理员邮箱')
on conflict (user_id) do nothing;
```

执行后退出并重新登录（或点击“重新检查”）。请先确认查询确实匹配预期账号；若账号尚未注册或尚未出现在 `auth.users`，该语句不会插入任何行。

管理页支持 Supabase 邮箱+密码注册、登录和退出，并保留匿名 session 兼容。**邮箱确认与人工审核是两个步骤**：正式账号确认邮箱后仍默认为 `pending`，只有管理员在面板批准后才能进入管理地图并由 RLS 读写自己的 `places` / `map_snapshots`；拒绝后可由管理员重新批准。管理员身份仅来自 `admin_users`，不按前端邮箱判断。`places` 以 `(owner_id, id)` 为联合主键，客户端显式按当前 `owner_id` 查询，RLS 再次强制只能读写自己的地点。注册/登录不会猜测、合并或覆盖匿名 owner 的数据；当前版本不自动迁移匿名地点，请在切换前导出备份。清空站点存储会丢失匿名 session 并创建新匿名用户，旧匿名数据不会自动迁移或找回。

用户地点采用 WGS84 GeoJSON Point/Polygon，坐标顺序为 `[经度, 纬度]`。数据库约束基础 geometry/properties 结构和代表坐标范围，应用读取时再逐行执行完整 Feature 校验并隔离非法行。Supabase 是主数据源；`public/data/places.geojson` 仅用于首次 seed/fallback 和手动镜像，修改该文件不会更新远程已有记录，远程地点的类型需要用户后续逐条编辑或由管理员执行经核对的独立迁移。localStorage 草稿与同步基线按 owner 隔离。可通过“同步到本地”写回当前完整内存数据，或导出完整文件；所选本地文件绝不会反向覆盖云端。

## 公开只读快照

管理端可把当前已保存的地点集合按“仅地图 / 基础信息 / 详细信息”预设发布，并单独调整类型、经纬度、备注是否公开。名称与 geometry 是公开地图必需内容；快照只写入明确选择的属性，不包含 owner、source、会话或其他私有字段。快照是发布时独立保存的 JSON，之后编辑私有地点不会改变它；再次发布才更新，取消公开后原链接无法读取。分享页只通过数据库安全 RPC 获取服务端白名单重建的数据，不直接读取快照表。

**只有执行 004 migration 后才允许启用公开分享。** 004 会把旧行按“仅地图（名称 + geometry）”处理并撤销访客对表的直接读取；005 只收紧 owner 管理策略，不改变公开 RPC。旧公开快照仍需在管理端重新发布或取消公开，才能明确应用新的公开字段设置。分享页在 Auth/profile/admin 初始化之前独立分流，无需登录、不创建匿名会话，也不受账号审核状态影响；页面隐藏全部维护、文件同步和发布功能。客户端只使用 publishable key，禁止配置或暴露 `service_role`。

### 旧版 places 手动升级

旧表必须先完整备份，再由数据库管理员人工整理后运行 migration。必要列及类型必须与新 schema 一致：`owner_id uuid`、`id/name/type text`、`geometry/properties jsonb`、`longitude/latitude double precision`、`updated_at/created_at timestamptz`，且均为 `NOT NULL`。`owner_id` 还必须逐行依据可信业务记录填写为真实的 `auth.users.id`，并建立 `references auth.users(id) on delete cascade`；不得把无法确认归属的历史行统一分给当前用户。

两个 migration 都会在任何表、索引、trigger、RLS 或 policy DDL 前预检旧表。缺列、类型或空值不符、owner 无法对应、`(owner_id, id)` 重复、非预期主键、冲突的 `id` 唯一索引或无法安全迁移的外键都会立即中止；migration 不会猜测 owner、删除数据、覆盖数据或自行修复旧 schema。人工补齐后，应先确认 `owner_id is null` 为 0、每个 owner 均存在于 `auth.users` 且 `(owner_id, id)` 无重复，再按文件名顺序重新执行。

若错误同时报告旧 `id` 主键被其他表外键引用，须人工把引用关系升级为同时包含 `owner_id` 的联合外键后再重试。无法可靠确认行归属或引用关系时，应保留备份并停止升级，由数据库管理员处理。
