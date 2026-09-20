const PATH_PREFIX = "/data/regions/";

export function validateMapConfig(value) {
  if (!value || typeof value !== "object") throw new Error("地图配置必须是对象");
  const { id, slug, name, bounds, center, base_roads_path: roads, seed_places_path: seed } = value;
  if (![id, slug, name, roads, seed].every((item) => typeof item === "string" && item.trim())) throw new Error("地图配置缺少必要字段");
  if (id !== slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error("地图 id/slug 无效");
  if (![bounds?.south, bounds?.west, bounds?.north, bounds?.east, center?.lat, center?.lon].every(Number.isFinite)
    || bounds.south >= bounds.north || bounds.west >= bounds.east
    || center.lat < bounds.south || center.lat > bounds.north || center.lon < bounds.west || center.lon > bounds.east) {
    throw new Error(`${name}的地图范围无效`);
  }
  const expected = `${PATH_PREFIX}${slug}/`;
  if (![roads, seed].every((path) => path.startsWith(expected) && !path.includes(".."))) throw new Error(`${name}的数据路径与地区不匹配`);
  return { ...value, bounds: { ...bounds }, center: { ...center } };
}

export async function loadMapConfigs(fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}) {
  const index = await fetchJson(`${PATH_PREFIX}maps.json`);
  if (!Array.isArray(index) || !index.length) throw new Error("地图列表为空");
  const maps = await Promise.all(index.map(async (entry) => validateMapConfig(await fetchJson(entry.config_path))));
  if (new Set(maps.map(({ id }) => id)).size !== maps.length) throw new Error("地图 id 重复");
  return maps.filter(({ is_active: active }) => active !== false);
}

export function mapScope(ownerId, mapId) {
  if (!ownerId || !mapId) throw new Error("数据缺少 owner 或 map 标识");
  return `${ownerId}:${mapId}`;
}
