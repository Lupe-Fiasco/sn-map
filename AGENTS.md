# SN Map React 项目约定

## 项目目的与边界

本项目是睢宁县地图数据维护工具的 React 版本。原生项目位于 `C:\Users\Administrator\Desktop\sn-map`，只能作为兼容性参考，**禁止修改、删除或移动**。Supabase 是用户地点的主数据源，正式邮箱账号及兼容匿名账号均由 owner_id + RLS 隔离；允许绘制用户 Polygon 区域，但不加入任意独立线或曲线绘制。

## 技术栈与目录

- React 18 + Vite，JavaScript（不使用 TypeScript）
- Tailwind CSS v3/PostCSS；Leaflet + OSM 在线瓦片
- `src/components/`：视图组件；`src/hooks/`：React 状态；`src/services/`：可独立测试的数据、Supabase、存储及文件逻辑
- `public/data/`：运行时静态数据；`scripts/`：OSM 数据构建；`tests/`：Node 原生测试

## 常用命令

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
npm run build:map-data
```

`build:map-data` 使用 Node 18+ 原生 `fetch` 请求 Overpass，更新 `public/data/map-bounds.json` 与 `base-roads.geojson`。只在需要人工更新 OSM 数据时运行，避免频繁请求公共服务。

## 数据约定

- 所有坐标为 WGS84（EPSG:4326）；GeoJSON 坐标严格使用 `[经度, 纬度]`。
- 用户地点是 `FeatureCollection` 中的 `Point` 或仅含一个闭合外环的 `Polygon`，均须带稳定顶层 `id` 和同值 `properties.id`；类型必须存在于 `place-types.json`，`properties.source` 为 `user`。Polygon 至少有 3 个不同顶点，不支持洞、多面或独立线/曲线。
- `base-roads.geojson` 是只读 OSM 线图层；用户地点以 Supabase `public.places` 为主数据，`places.geojson` 仅为初始化来源及手动同步镜像。不得混合 base/user 数据，也不得让页面修改道路层。
- 云端保存成功后才更新正式内存集合；`localStorage` 草稿/回退镜像与文件同步基线必须按 owner_id 分区，并使用按用户区分的初始化标记防止重复 seed。云端不可用时当前 owner 的有效草稿优先于静态文件，绝不跨账号复用。
- 首次“同步到本地”选择文件后，必须在用户激活仍有效时立即 `createWritable()`，随后确认并覆盖写入点击时的完整快照；绝不读取所选文件覆盖当前数据。成功写入才更新同步基线。文件句柄仅保留在当前页面会话。
- 导出始终下载当前完整 `places.geojson`。暂不提供恢复初始文件功能。
- 正式邮箱账号和匿名 Supabase session 均由浏览器持久化；注册/登录不自动迁移匿名 owner 数据。清空浏览器站点存储会创建新的匿名用户，原匿名用户的数据不会自动迁移。
- 正式邮箱账号须先确认邮箱、再由 `admin_users` 中的管理员人工批准；pending/rejected 不得进入管理端，且 places/map_snapshots owner RLS 同步执行审核门禁。匿名兼容账号继续可用。管理员只通过数据库 user_id bootstrap，禁止在代码或 migration 写入管理员邮箱。
- `map_snapshots` 保存用户发布时的完整正式 FeatureCollection；私有地点编辑不自动更新快照。公开分享页只读 `is_public=true` 数据，不初始化匿名登录，不展示任何管理操作；本地文件仍只是当前私有地点的手动镜像。

<!-- ai coding -->
## 部署镜像同步

- 主开发项目是 `C:\Users\Administrator\Desktop\demo\sn-map-react`（GitLab）；部署镜像是 `C:\Users\Administrator\Desktop\sn-map-public`（GitHub/Vercel）。
- 每次业务代码、配置、静态数据或文档改动，默认同时将本次相关文件同步到部署镜像。
- 同步前先分别检查两个目录的 `git status` 和 `git diff`，避免覆盖部署镜像项目已有的独立改动；只同步本次相关文件。
- 不复制或覆盖两边各自的 `.git`、`.env.local`、`node_modules`、`dist` 和部署专属配置；除非用户明确要求，不自动执行 `commit` 或 `push`。
- 同步完成后，分别验证两个项目必要的测试和构建状态。

## 验证约定

默认先运行 `npm test` 和 `npm run build`，并做静态检查。默认不使用 chrome-devtools；仅当存在无法由代码、测试或构建判断的用户可见问题时再使用浏览器工具。桌面 Web 是当前验证范围。
<!-- ai coding -->
仅验证桌面 Web；禁止切换或模拟移动端视口，不做移动端验收，除非用户明确要求。


 ## 标注 AI 改动 
 每次修改代码时，在核心改动处的注释前补充“ai coding”字样（不需要每处改动都加，仅在关键/核心改动处标注即可）。
