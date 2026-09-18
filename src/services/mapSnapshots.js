import { emptyCollection, getPolygonRepresentativeCoordinate } from "./geojson.js";

export const SNAPSHOT_PRESETS = {
  map: { type: false, coordinates: false, description: false },
  basic: { type: true, coordinates: true, description: false },
  detailed: { type: true, coordinates: true, description: true },
};

const PUBLIC_SNAPSHOT_VERSION = 1;

function selectedFields(fields = SNAPSHOT_PRESETS.map) {
  return {
    type: fields.type === true,
    coordinates: fields.coordinates === true,
    description: fields.description === true,
  };
}

export function publicFields(fields) {
  const disclosure = selectedFields(fields);
  return ["name", ...(disclosure.type ? ["type"] : []), ...(disclosure.coordinates ? ["coordinates"] : []), ...(disclosure.description ? ["notes"] : [])];
}

// ai coding：公开快照采用白名单重建 Feature，geometry 与稳定 id/name 必留，其余私有属性绝不透传。
export function createPublicSnapshot(collection, fields) {
  const disclosure = selectedFields(fields);
  return {
    type: "FeatureCollection",
    name: "public-places",
    publicDisclosure: { version: PUBLIC_SNAPSHOT_VERSION, fields: disclosure },
    features: collection.features.map((feature) => {
      const properties = { id: feature.id, name: feature.properties.name };
      if (disclosure.type && typeof feature.properties.type === "string") properties.type = feature.properties.type;
      if (disclosure.coordinates) {
        const coordinates = feature.geometry.type === "Point"
          ? feature.geometry.coordinates
          : (Number.isFinite(feature.properties.longitude) && Number.isFinite(feature.properties.latitude)
            ? [feature.properties.longitude, feature.properties.latitude]
            : getPolygonRepresentativeCoordinate(feature.geometry));
        if (Number.isFinite(coordinates?.[0]) && Number.isFinite(coordinates?.[1])) {
          properties.longitude = coordinates[0];
          properties.latitude = coordinates[1];
        }
      }
      if (disclosure.description && typeof feature.properties.description === "string") properties.description = feature.properties.description;
      return {
        type: "Feature",
        id: feature.id,
        geometry: { type: feature.geometry.type, coordinates: structuredClone(feature.geometry.coordinates) },
        properties,
      };
    }),
  };
}

export function snapshotDisclosure(snapshot) {
  return snapshot?.publicDisclosure?.version === PUBLIC_SNAPSHOT_VERSION
    ? selectedFields(snapshot.publicDisclosure.fields)
    : null;
}

// 旧快照没有用户确认记录，只向界面交付名称、id 和 geometry；重新发布后才按明确范围展示详情。
export function sanitizePublicSnapshot(snapshot) {
  const disclosure = snapshotDisclosure(snapshot) ?? SNAPSHOT_PRESETS.map;
  return createPublicSnapshot(snapshot, disclosure);
}

export function publicPlaceDetails(feature, placeTypes = []) {
  const properties = feature.properties ?? {};
  const type = typeof properties.type === "string" ? placeTypes.find((item) => item.id === properties.type) : null;
  const hasCoordinates = Number.isFinite(properties.longitude) && Number.isFinite(properties.latitude);
  return {
    name: properties.name,
    type: type?.name || (typeof properties.type === "string" ? properties.type : ""),
    coordinates: hasCoordinates ? `${properties.longitude.toFixed(6)}, ${properties.latitude.toFixed(6)}` : "",
    description: typeof properties.description === "string" ? properties.description : "",
  };
}

export function createShareToken(randomUUID = () => crypto.randomUUID()) {
  return randomUUID().replaceAll("-", "");
}

export function snapshotRow(ownerId, title, collection, shareToken, fields) {
  return {
    owner_id: ownerId,
    share_token: shareToken,
    title: title.trim() || "睢宁地点地图",
    snapshot: createPublicSnapshot(collection, fields),
    public_fields: publicFields(fields),
    is_public: true,
  };
}

// ai coding：快照及分享 token 必须与当前 owner 严格匹配，供渲染和复制共用同一判定。
export function snapshotForOwner(snapshot, ownerId) {
  return ownerId && snapshot?.owner_id === ownerId ? snapshot : null;
}

export function shareTokenForOwner(snapshot, ownerId) {
  const current = snapshotForOwner(snapshot, ownerId);
  return current?.is_public && current.share_token ? current.share_token : "";
}

function snapshotError(prefix, error) {
  const missing = ["42P01", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(error?.code)
    || /(could not find|relation).+(map_snapshots|get_public_map_snapshot|public_fields)/i.test(error?.message || "");
  return new Error(missing
    ? `${prefix}：安全公开快照功能尚未初始化，请先执行 migration 004`
    : `${prefix}：${error?.message || "云端请求失败"}`);
}

export async function fetchOwnerSnapshot(client, ownerId) {
  const { data, error } = await client.from("map_snapshots").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw snapshotError("公开状态读取失败", error);
  return data ?? null;
}

export async function publishSnapshot(client, ownerId, title, collection, fields, randomUUID) {
  const existing = await fetchOwnerSnapshot(client, ownerId);
  const token = existing?.share_token || createShareToken(randomUUID);
  // ai coding：仅复制调用时的正式 FeatureCollection；后续地点编辑不会引用或改变已发布 JSON。
  const payload = snapshotRow(ownerId, title, collection, token, fields);
  const { data, error } = await client.from("map_snapshots")
    .upsert(payload, { onConflict: "owner_id" }).select().single();
  if (error || !data) throw snapshotError("公开快照发布失败", error);
  return data;
}

export async function unpublishSnapshot(client, ownerId) {
  const { data, error } = await client.from("map_snapshots").update({ is_public: false })
    .eq("owner_id", ownerId).select().single();
  if (error || !data) throw snapshotError("取消公开失败", error);
  return data;
}

export async function fetchPublicSnapshot(client, token) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token || "")) return null;
  // ai coding：访客只能调用服务端白名单重建 RPC，客户端不再直接读取 map_snapshots 或接收原始 JSON。
  const { data, error } = await client.rpc("get_public_map_snapshot", { p_share_token: token }).maybeSingle();
  if (error) throw snapshotError("公开快照读取失败", error);
  return data ?? null;
}

export function emptySnapshotCollection() {
  return emptyCollection();
}
