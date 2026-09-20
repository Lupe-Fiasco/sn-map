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
3. 按文件名顺序执行 `supabase/migrations/` 的 **001–008**。006 只提供图片基础对象，007 加固图片 RPC/RLS，008 强制公开级别；三者缺一不可。已执行 007 的环境必须继续执行 `202609200008_enforce_snapshot_levels.sql`，本仓库不会自动修改远程数据库。008 会把无法精确对应 `basic` / `details` / `images` 的旧快照保留为字段不可变、不可伪造的 legacy 状态；未升级时 RPC 只返回名称与 geometry 安全基线。legacy 公开快照必须在管理端一次性选择合法级别重新发布，或取消公开，不能直接替换快照后沿用旧字段组合。
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

管理端使用三个固定公开级别：`basic`（名称、类型、代表经纬度与完整 geometry）、`details`（basic + notes/description/address/phone/website/opening_hours 安全白名单字段）、`images`（details + 图片）。类型和经纬度不能单独取消，也不会输出 owner、source、会话、内部路径或 token。服务层只接受这三个 level，数据库也拒绝任意字段组合。快照是发布时独立保存的 JSON；legacy 公开快照在重新发布前仅返回名称与 geometry，必须选择合法级别重新发布或取消公开，不能继续更新旧 snapshot 后重新开启公开。取消公开后原链接无法读取。分享页只通过数据库安全 RPC 获取服务端白名单重建的数据，不直接读取快照表。

已保存地点可上传 JPG/PNG/WebP 实景图片（单张不超过 5MB）。原图保存在私有 `place-images` bucket，只有已审核正式账号或管理员本人可管理，图片不会写入 places/GeoJSON；匿名兼容账号不能读取、上传或选择含图片的第三级。第三级仅在当前正式地点有图片时可选，发布时会用 Canvas/ImageBitmap 将原图重新编码为 WebP（失败不会回退上传原图），再复制到 `published-place-images`；快照只保存图片 id、替代文本和可由服务端校验的公开对象路径，RPC 会对照 owner/place/image 元数据与 bucket 对象重建白名单响应。重新发布会按当前级别替换图片范围，改为较低级别或取消公开会尽力删除旧公开副本；已被浏览器/CDN 缓存或第三方复制的 URL 无法保证绝对收回。浏览器重编码不是可验证的绝对安全边界；如需服务端验证像素转码，应后续增加受信任 Edge Function，且不得在浏览器使用 `service_role`。

**只有依次执行 004–008 migration 后才允许启用带图片的公开分享。** 004 会把旧行按“仅地图（名称 + geometry）”处理并撤销访客对表的直接读取；005 收紧 owner 管理策略；006 创建图片表/bucket；007 保持图片 RPC/RLS 安全；008 阻止直接 REST/API 写入非法 level、字段组合或伪造 legacy。历史快照需在管理端明确选择级别并重新发布。分享页在 Auth/profile/admin 初始化之前独立分流，无需登录、不创建匿名会话，也不受账号审核状态影响；页面隐藏全部维护、文件同步和发布功能。客户端只使用 publishable key，禁止配置或暴露 `service_role`。

### 旧版 places 手动升级

旧表必须先完整备份，再由数据库管理员人工整理后运行 migration。必要列及类型必须与新 schema 一致：`owner_id uuid`、`id/name/type text`、`geometry/properties jsonb`、`longitude/latitude double precision`、`updated_at/created_at timestamptz`，且均为 `NOT NULL`。`owner_id` 还必须逐行依据可信业务记录填写为真实的 `auth.users.id`，并建立 `references auth.users(id) on delete cascade`；不得把无法确认归属的历史行统一分给当前用户。

两个 migration 都会在任何表、索引、trigger、RLS 或 policy DDL 前预检旧表。缺列、类型或空值不符、owner 无法对应、`(owner_id, id)` 重复、非预期主键、冲突的 `id` 唯一索引或无法安全迁移的外键都会立即中止；migration 不会猜测 owner、删除数据、覆盖数据或自行修复旧 schema。人工补齐后，应先确认 `owner_id is null` 为 0、每个 owner 均存在于 `auth.users` 且 `(owner_id, id)` 无重复，再按文件名顺序重新执行。

若错误同时报告旧 `id` 主键被其他表外键引用，须人工把引用关系升级为同时包含 `owner_id` 的联合外键后再重试。无法可靠确认行归属或引用关系时，应保留备份并停止升级，由数据库管理员处理。
