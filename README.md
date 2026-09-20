# SN Map React

睢宁县与上海市徐汇区用户地点维护地图的 React + Vite 版本。使用 Leaflet 展示 OSM 在线底图、按地区缓存的静态只读道路，并以 Supabase 保存独立用户地点。

```bash
npm install
npm run dev
npm test
npm run build
```

更新全部 OSM 范围与道路数据：`npm run build:map-data`；也可追加 `-- --region suining` 或 `-- --region xuhui`。脚本按地区行政边界配置查询 Overpass 并原子更新 `public/data/regions/<slug>/`；运行时不会请求 Overpass。

当前睢宁道路缓存已成功重建。徐汇区已提供可切换的地区配置与空 seed；本次构建时公共 Overpass 先后返回 429/504，因此 `base-roads.geojson` 保留带 `generation_status` 的空 FeatureCollection，没有伪造道路。服务恢复后运行 `npm run build:map-data -- --region xuhui` 会按 OSM `boundary=administrative + admin_level=6 + name=徐汇区` 关系 bbox 重算范围并生成道路缓存。

## Supabase 初始化

1. 复制 `.env.example` 为 `.env.local` 并填写项目 URL 与 publishable key。
2. 在 Supabase 控制台启用 Authentication 的邮箱密码登录；如需保留兼容模式，同时启用 Anonymous Sign-Ins。按部署域名配置邮箱确认跳转 URL。
3. **先完整备份数据库和两个 Storage bucket**，再按文件名顺序执行 `supabase/migrations/` 的 **001–010**。009 必须在 001–008 全部完成后执行；它会创建全局 `maps`、把既有地点/快照/图片安全回填为 `suining`，并把唯一键、外键、RPC 和新图片路径升级为 owner + map 范围。**010 必须在 009 后执行且可重复执行**，它不改写或删除数据，只替换两个图片 bucket 的 Storage CRUD policy：私有对象读改删必须精确关联 `place_images.storage_path + owner/map/place`，公开副本读改删必须关联同一图片元数据的 `owner/map/place/image`。新版私有对象使用 `owner/map/place/file` 四段路径，公开副本使用 `owner/map/release/place/file` 五段路径；旧睢宁三/四段对象仅在 `place_images` 元数据确定 `map_id=suining` 且 owner/place/image 一致时兼容，不能只凭 owner 路径首段访问。上传仍只允许非匿名且已批准账号或管理员；匿名访客只走公开 bucket URL 与安全 RPC，不能写改删。前置 schema 不符合预期时事务会清晰中止，不猜测或删除远程数据。本仓库不会远程执行 migration。
4. 先注册并完成管理员账号的邮箱确认，再由项目所有者在 **Supabase SQL Editor** 手动执行以下 bootstrap。把占位文本替换为自己的管理员邮箱；不要把真实邮箱或任何凭据写入仓库。该 SQL 只绑定已经存在的 `auth.users.id`，可安全重复执行：

```sql
insert into public.admin_users (user_id)
select id from auth.users
where lower(email)=lower('你的管理员邮箱')
on conflict (user_id) do nothing;
```

执行后退出并重新登录（或点击“重新检查”）。请先确认查询确实匹配预期账号；若账号尚未注册或尚未出现在 `auth.users`，该语句不会插入任何行。

管理页支持 Supabase 邮箱+密码注册、登录和退出，并保留匿名 session 兼容。**邮箱确认与人工审核是两个步骤**。`maps` 是全局只读地区配置，不按 owner 重复；`places` 使用 `(owner_id, map_id, id)`，`map_snapshots` 使用 `(owner_id, map_id)`，图片元数据/对象路径同样包含 map。客户端查询显式携带 owner + map，RLS 继续执行 owner 与审核门禁。注册/登录不会猜测、合并或覆盖匿名 owner 的数据。

用户地点采用 WGS84 GeoJSON Point/Polygon，坐标顺序为 `[经度, 纬度]`。运行时单一静态来源是 `public/data/regions/<slug>/` 下的 `map-config.json`、`base-roads.geojson` 和 `places.geojson`；根目录旧文件只保留兼容。每个 owner + map 只执行一次对应 seed，徐汇区空 seed 不会导入睢宁数据。localStorage 草稿、seed 标记和同步基线均按 owner + map 隔离；文件句柄只保留到离开当前地图或退出页面为止，返回该地图必须重新选择文件。导出文件名包含 map slug，所选文件绝不会反向覆盖云端。

## 公开只读快照

管理端使用三个固定公开级别：`basic`（名称、类型、代表经纬度与完整 geometry）、`details`（basic + notes/description/address/phone/website/opening_hours 安全白名单字段）、`images`（details + 图片）。类型和经纬度不能单独取消，也不会输出 owner、source、会话、内部路径或 token。服务层只接受这三个 level，数据库也拒绝任意字段组合。快照按 owner + map 独立保存；分享页只通过安全 RPC 获取白名单数据及对应公开 map config，不读取快照表，也不使用管理端当前选择的地区。

已保存地点可上传 JPG/PNG/WebP 实景图片（单张不超过 5MB）。原图保存在私有 `place-images` bucket，只有已审核正式账号或管理员本人可管理，图片不会写入 places/GeoJSON；匿名兼容账号不能读取、上传或选择含图片的第三级。第三级仅在当前正式地点有图片时可选，发布时会用 Canvas/ImageBitmap 将原图重新编码为 WebP（失败不会回退上传原图），再复制到 `published-place-images`；快照只保存图片 id、替代文本和可由服务端校验的公开对象路径，RPC 会对照 owner/place/image 元数据与 bucket 对象重建白名单响应。重新发布会按当前级别替换图片范围，改为较低级别或取消公开会尽力删除旧公开副本；已被浏览器/CDN 缓存或第三方复制的 URL 无法保证绝对收回。浏览器重编码不是可验证的绝对安全边界；如需服务端验证像素转码，应后续增加受信任 Edge Function，且不得在浏览器使用 `service_role`。

**只有依次执行 004–010 migration 后才允许启用多地区带图片公开分享。** 009 在既有安全级别上增加 map 范围并让 RPC 返回对应地区配置，010 收紧两个图片 bucket 的完整 CRUD 且不覆盖 006/007/008 的安全最终状态。历史快照需在管理端明确选择级别并重新发布。分享页在 Auth/profile/admin 初始化之前独立分流，无需登录、不创建匿名会话，也不受账号审核状态影响；页面隐藏全部维护、文件同步和发布功能。客户端只使用 publishable key，禁止配置或暴露 `service_role`。

### 旧版 places 手动升级

旧表必须先完整备份，再由数据库管理员人工整理后运行 migration。必要列及类型必须与新 schema 一致：`owner_id uuid`、`id/name/type text`、`geometry/properties jsonb`、`longitude/latitude double precision`、`updated_at/created_at timestamptz`，且均为 `NOT NULL`。`owner_id` 还必须逐行依据可信业务记录填写为真实的 `auth.users.id`，并建立 `references auth.users(id) on delete cascade`；不得把无法确认归属的历史行统一分给当前用户。

两个 migration 都会在任何表、索引、trigger、RLS 或 policy DDL 前预检旧表。缺列、类型或空值不符、owner 无法对应、`(owner_id, id)` 重复、非预期主键、冲突的 `id` 唯一索引或无法安全迁移的外键都会立即中止；migration 不会猜测 owner、删除数据、覆盖数据或自行修复旧 schema。人工补齐后，应先确认 `owner_id is null` 为 0、每个 owner 均存在于 `auth.users` 且 `(owner_id, id)` 无重复，再按文件名顺序重新执行。

若错误同时报告旧 `id` 主键被其他表外键引用，须人工把引用关系升级为同时包含 `owner_id` 的联合外键后再重试。无法可靠确认行归属或引用关系时，应保留备份并停止升级，由数据库管理员处理。
