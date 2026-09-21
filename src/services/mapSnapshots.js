import { emptyCollection, getGeometryRepresentativeCoordinate } from "./geojson.js";
import { cleanupPublishedImages, copyPublishedImages, fetchImagesForPlaces } from "./placeImages.js";

export const SNAPSHOT_PRESETS = {
  basic: { type: true, coordinates: true, description: false, images: false },
  details: { type: true, coordinates: true, description: true, images: false },
  images: { type: true, coordinates: true, description: true, images: true },
};

export const SNAPSHOT_LEVEL_LABELS = {
  basic: "地图+类型+经纬度",
  details: "地图+类型+经纬度+备注等其他信息",
  images: "地图+类型+经纬度+备注等其他信息+实景图片",
};

const LEVEL_PUBLIC_FIELDS = {
  basic: ["name", "type", "coordinates"],
  details: ["name", "type", "coordinates", "notes"],
  images: ["name", "type", "coordinates", "notes", "images"],
};

const PUBLIC_SNAPSHOT_VERSION = 3;
const DETAIL_PROPERTIES = ["notes", "description", "address", "phone", "website", "opening_hours"];

export function selectedFields(fields = {}) {
  const source = fields && typeof fields === "object" ? fields : {};
  return {
    type: source.type === true,
    coordinates: source.coordinates === true,
    description: source.description === true,
    images: source.images === true,
  };
}

export function publicationFields(level) {
  // ai coding：发布参数只能是三个固定 level；对象、旧级别名和未知值一律拒绝，禁止静默降级发布。
  if (!Object.hasOwn(SNAPSHOT_PRESETS, level)) throw new TypeError("公开展示级别无效");
  return { ...SNAPSHOT_PRESETS[level] };
}

export function publicationLevel(fields) {
  const selected = selectedFields(fields);
  return Object.entries(SNAPSHOT_PRESETS).find(([, candidate]) =>
    Object.keys(candidate).every((field) => candidate[field] === selected[field]))?.[0] ?? null;
}

export function publicFields(level) {
  publicationFields(level);
  return [...LEVEL_PUBLIC_FIELDS[level]];
}

export function sanitizePublishedImages(images) {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => typeof image?.id === "string" && /^https:\/\//.test(image?.url || "")
    ? [{ id: image.id, url: image.url, alt_text: typeof image.alt_text === "string" ? image.alt_text.slice(0, 160) : "" }]
    : []);
}

function snapshotImageManifest(images) {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => typeof image?.id === "string" && typeof image?.public_path === "string"
    ? [{ id: image.id, public_path: image.public_path, alt_text: typeof image.alt_text === "string" ? image.alt_text.slice(0, 160) : "" }]
    : []);
}

// ai coding：公开快照采用白名单重建 Feature，geometry 与稳定 id/name 必留，其余私有属性绝不透传。
export function createPublicSnapshot(collection, fields = SNAPSHOT_PRESETS.basic, imagesByPlace = {}) {
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
            : getGeometryRepresentativeCoordinate(feature.geometry));
        if (Number.isFinite(coordinates?.[0]) && Number.isFinite(coordinates?.[1])) {
          properties.longitude = coordinates[0];
          properties.latitude = coordinates[1];
        }
      }
      if (disclosure.description) {
        for (const field of DETAIL_PROPERTIES) {
          if (typeof feature.properties[field] === "string") properties[field] = feature.properties[field];
        }
      }
      if (disclosure.images) {
        // ai coding：持久化快照只记录可由 007 RPC 校验的对象路径；不再接受或保存客户端提供的外部 URL。
        const images = snapshotImageManifest(imagesByPlace[feature.id]);
        if (images.length) properties.images = images;
      }
      return {
        type: "Feature",
        id: feature.id,
        geometry: { type: feature.geometry.type, coordinates: structuredClone(feature.geometry.coordinates) },
        properties,
      };
    }),
  };
}

export function snapshotDisclosure(snapshot, row = null) {
  const disclosure = snapshot?.publicDisclosure;
  if (!disclosure || typeof disclosure !== "object") return null;
  if ([2, PUBLIC_SNAPSHOT_VERSION].includes(disclosure.version)) return selectedFields(disclosure.fields);
  if (disclosure.version !== 1) return null;

  // ai coding：v1 只用于兼容显示，并按数据库行优先恢复原选择；绝不把缺失或未知字段推断成更大的公开范围。
  if (Object.hasOwn(SNAPSHOT_PRESETS, row?.publication_level)) {
    return publicationFields(row.publication_level);
  }
  if (Array.isArray(row?.public_fields)) {
    const fields = new Set(row.public_fields);
    return selectedFields({
      type: fields.has("type"),
      coordinates: fields.has("coordinates"),
      description: fields.has("notes"),
      images: fields.has("images"),
    });
  }
  return disclosure.fields && typeof disclosure.fields === "object"
    ? selectedFields(disclosure.fields)
    : null;
}

export function snapshotNeedsRepublish(snapshot) {
  return snapshot?.publicDisclosure?.version === 1;
}

// 旧快照没有用户确认记录，只向界面交付名称、id 和 geometry；重新发布后才按明确范围展示详情。
export function sanitizePublicSnapshot(snapshot) {
  const disclosure = snapshotDisclosure(snapshot) ?? {};
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
    notes: typeof properties.notes === "string" ? properties.notes : "",
    address: typeof properties.address === "string" ? properties.address : "",
    phone: typeof properties.phone === "string" ? properties.phone : "",
    website: typeof properties.website === "string" ? properties.website : "",
    opening_hours: typeof properties.opening_hours === "string" ? properties.opening_hours : "",
    images: sanitizePublishedImages(properties.images),
  };
}

export function createShareToken(randomUUID = () => crypto.randomUUID()) {
  return randomUUID().replaceAll("-", "");
}

export function snapshotRow(ownerId, title, collection, shareToken, level = "basic", imagesByPlace = {}, mapId = "suining") {
  const fields = publicationFields(level);
  return {
    owner_id: ownerId,
    map_id: mapId,
    share_token: shareToken,
    title: title.trim() || "睢宁地点地图",
    snapshot: createPublicSnapshot(collection, fields, imagesByPlace),
    public_fields: publicFields(level),
    publication_level: level,
    image_manifest_version: selectedFields(fields).images ? 1 : 0,
    is_public: true,
  };
}

// ai coding：快照及分享 token 必须与当前 owner 严格匹配，供渲染和复制共用同一判定。
export function snapshotForOwner(snapshot, ownerId, mapId) {
  return ownerId && snapshot?.owner_id === ownerId && (!mapId || snapshot.map_id === mapId) ? snapshot : null;
}

export function shareTokenForOwner(snapshot, ownerId, mapId) {
  const current = snapshotForOwner(snapshot, ownerId, mapId);
  return current?.is_public && current.share_token ? current.share_token : "";
}

function snapshotError(prefix, error) {
  if (/publication_level|enforce_map_snapshot_level/i.test(error?.message || "")) {
    return new Error(`${prefix}：固定公开级别尚未初始化，请先执行 migration 008`);
  }
  if (/image_manifest_version/i.test(error?.message || "")) {
    return new Error(`${prefix}：公开图片安全更新尚未初始化，请先执行 migration 007`);
  }
  const missing = ["42P01", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(error?.code)
    || /(could not find|relation).+(map_snapshots|get_public_map_snapshot|public_fields)/i.test(error?.message || "");
  return new Error(missing
    ? `${prefix}：安全公开快照功能尚未初始化，请先执行 migration 004`
    : `${prefix}：${error?.message || "云端请求失败"}`);
}

export async function fetchOwnerSnapshot(client, ownerId, mapId) {
  let query = client.from("map_snapshots").select("*").eq("owner_id", ownerId);
  if (mapId) query = query.eq("map_id", mapId);
  const { data, error } = await query.maybeSingle();
  if (error) throw snapshotError("公开状态读取失败", error);
  return data ?? null;
}

export async function publishSnapshot(client, ownerId, title, collection, level = "basic", access = {}, randomUUID = () => crypto.randomUUID(), mapId = "suining") {
  const explicitMap = arguments.length >= 8;
  const disclosure = publicationFields(level);
  if (level === "images" && access.images !== true) throw new Error("当前账号不能发布实景图片");
  const existing = await fetchOwnerSnapshot(client, ownerId, explicitMap ? mapId : undefined);
  const token = existing?.share_token || createShareToken(randomUUID);
  // ai coding：图片能力由已审核账号状态单独授权；调用方即使伪造 fields.images，也不会触发私有图片查询或复制。
  const releaseId = randomUUID().replaceAll("-", "");
  let published = { imagesByPlace: {}, uploadedPaths: [] };
  if (disclosure.images) {
    const placeIds = collection.features.map((feature) => String(feature.id));
    const rows = explicitMap ? await fetchImagesForPlaces(client, ownerId, mapId, placeIds) : await fetchImagesForPlaces(client, ownerId, placeIds);
    const publishImages = typeof access.copyImages === "function" ? access.copyImages : copyPublishedImages;
    published = explicitMap ? await publishImages(client, ownerId, mapId, token, releaseId, rows) : await publishImages(client, ownerId, token, releaseId, rows);
  }
  // ai coding：仅复制调用时的正式 FeatureCollection；后续地点编辑不会引用或改变已发布 JSON。
  const payload = snapshotRow(ownerId, title, collection, token, level, published.imagesByPlace, mapId);
  const { data, error } = await client.from("map_snapshots")
    .upsert(payload, { onConflict: explicitMap ? "owner_id,map_id" : "owner_id" }).select().single();
  if (error || !data) {
    if (published.uploadedPaths.length) {
      const { error: rollbackError } = await client.storage.from("published-place-images").remove(published.uploadedPaths);
      if (rollbackError) {
        const failure = snapshotError("公开快照发布失败", error);
        failure.message = `${failure.message}；公开图片回滚失败：${rollbackError.message || "云端请求失败"}`;
        failure.pendingCleanupPaths = published.uploadedPaths;
        throw failure;
      }
    }
    throw snapshotError("公开快照发布失败", error);
  }
  // ai coding：新快照成功后再清理旧 release；失败只产生清理提示，不把已提交的新快照误报为发布失败。
  try { explicitMap ? await cleanupPublishedImages(client, ownerId, mapId, token, disclosure.images ? releaseId : "") : await cleanupPublishedImages(client, ownerId, token, disclosure.images ? releaseId : ""); }
  catch (cleanupError) { return { ...data, cleanupWarning: cleanupError.message, pendingCleanupPaths: cleanupError.pendingCleanupPaths ?? [] }; }
  return data;
}

export async function unpublishSnapshot(client, ownerId, mapId = "suining") {
  const explicitMap = arguments.length >= 3;
  const existing = await fetchOwnerSnapshot(client, ownerId, explicitMap ? mapId : undefined);
  let query = client.from("map_snapshots").update({ is_public: false }).eq("owner_id", ownerId);
  if (explicitMap) query = query.eq("map_id", mapId);
  const { data, error } = await query.select().single();
  if (error || !data) throw snapshotError("取消公开失败", error);
  try { explicitMap ? await cleanupPublishedImages(client, ownerId, mapId, existing?.share_token) : await cleanupPublishedImages(client, ownerId, existing?.share_token); }
  catch (cleanupError) { return { ...data, cleanupWarning: `${cleanupError.message}；公开已撤销，但旧 URL 的缓存或既有副本无法绝对收回。`, pendingCleanupPaths: cleanupError.pendingCleanupPaths ?? [] }; }
  return data;
}

export async function fetchPublicSnapshot(client, token) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token || "")) return null;
  // ai coding：访客只能调用服务端白名单重建 RPC，客户端不再直接读取 map_snapshots 或接收原始 JSON。
  const { data, error } = await client.rpc("get_public_map_snapshot", { p_share_token: token }).maybeSingle();
  if (error) throw snapshotError("公开快照读取失败", error);
  if (!data?.snapshot?.features) return data ?? null;
  // RPC 只返回受控 Storage 相对地址；域名取自已配置的 Supabase 客户端，而非快照输入。
  const snapshot = structuredClone(data.snapshot);
  for (const feature of snapshot.features) {
    if (!Array.isArray(feature?.properties?.images)) continue;
    feature.properties.images = feature.properties.images.flatMap((image) => {
      if (typeof image?.url !== "string" || !image.url.startsWith("/storage/v1/object/public/published-place-images/")) return [];
      try {
        return [{ id: image.id, url: new URL(image.url, client.supabaseUrl).href, alt_text: image.alt_text || "" }];
      } catch { return []; }
    });
  }
  return { ...data, snapshot };
}

export function emptySnapshotCollection() {
  return emptyCollection();
}
