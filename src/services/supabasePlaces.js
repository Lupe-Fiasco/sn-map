import { emptyCollection, getPolygonRepresentativeCoordinate, validatePlaces } from "./geojson.js";
import { cleanupPlaceImagesBeforeDelete } from "./placeImages.js";

export function featureToPlaceRow(feature, ownerId) {
  const properties = structuredClone(feature.properties ?? {});
  const [longitude, latitude] = feature.geometry.type === "Point"
    ? feature.geometry.coordinates
    : (Number.isFinite(properties.longitude) && Number.isFinite(properties.latitude)
      ? [properties.longitude, properties.latitude]
      : getPolygonRepresentativeCoordinate(feature.geometry));

  return {
    id: String(feature.id),
    owner_id: ownerId,
    name: properties.name,
    type: properties.type,
    geometry: structuredClone(feature.geometry),
    longitude,
    latitude,
    properties,
  };
}

export function placeRowToFeature(row) {
  validatePlaceRowMetadata(row);
  return {
    type: "Feature",
    id: String(row.id),
    geometry: structuredClone(row.geometry),
    properties: {
      ...(structuredClone(row.properties) ?? {}),
      id: String(row.id),
      source: "user",
      name: row.name,
      type: row.type,
      ...(Number.isFinite(row.longitude) ? { longitude: row.longitude } : {}),
      ...(Number.isFinite(row.latitude) ? { latitude: row.latitude } : {}),
      ...(row.created_at ? { createdAt: row.created_at } : {}),
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    },
  };
}

function validatePlaceRowMetadata(row) {
  if (!row || typeof row !== "object") throw new Error("云端地点行必须是对象");
  if (typeof row.id !== "string" || !row.id.trim()) throw new Error("云端地点缺少有效 id");
  if (!row.properties || typeof row.properties !== "object" || Array.isArray(row.properties)) throw new Error(`云端地点 ${row.id} 的 properties 必须是对象`);
  if (row.properties.id !== row.id) throw new Error(`云端地点 ${row.id} 的 properties.id 与顶层 id 不一致`);
  if (row.properties.source !== "user") throw new Error(`云端地点 ${row.id} 的 properties.source 必须是 user`);
  if (row.properties.name !== row.name) throw new Error(`云端地点 ${row.id} 的 properties.name 与 name 字段不一致`);
  if (row.properties.type !== row.type) throw new Error(`云端地点 ${row.id} 的 properties.type 与 type 字段不一致`);
}

function validatePlaceRow(row, placeTypes) {
  validatePlaceRowMetadata(row);

  // ai coding：先用数据库原始必需字段构造待校验视图，绝不以列值修补 properties 后再放行坏数据。
  validatePlaces({
    ...emptyCollection(),
    features: [{
      type: "Feature",
      id: row.id,
      geometry: structuredClone(row.geometry),
      properties: structuredClone(row.properties),
    }],
  }, placeTypes);
}

export function rowsToCollection(rows, placeTypes, onInvalidRow = () => {}) {
  const features = [];
  const ids = new Set();
  rows.forEach((row, index) => {
    try {
      validatePlaceRow(row, placeTypes);
      const feature = placeRowToFeature(row);
      if (ids.has(feature.id)) throw new Error(`地点 id 重复：${feature.id}`);
      ids.add(feature.id);
      features.push(feature);
    } catch (error) {
      // ai coding：云端行逐条转换并复用 GeoJSON 约束校验，坏行只被隔离和报告，不拖垮同一 owner 的合法数据。
      const normalizedError = error instanceof Error ? error : new Error("云端地点格式无效");
      onInvalidRow({ index, id: typeof row?.id === "string" ? row.id : null, reason: normalizedError.message, error: normalizedError });
    }
  });
  return { ...emptyCollection(), features };
}

export async function ensureAnonymousSession(client) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error(`匿名会话读取失败：${sessionError.message}`);
  if (sessionData.session?.user?.id) return sessionData.session;

  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session?.user?.id) throw new Error(`匿名登录失败：${error?.message || "未返回有效会话"}`);
  return data.session;
}

export async function fetchCloudPlaces(client, ownerId) {
  // ai coding：显式 owner 过滤与 RLS 双重约束，避免账号切换时错误映射其他用户行。
  const { data, error } = await client.from("places").select("*").eq("owner_id", ownerId).order("created_at", { ascending: true });
  if (error) throw new Error(`云端地点读取失败：${error.message}`);
  return data ?? [];
}

export async function seedCloudPlaces(client, features, ownerId) {
  if (!features.length) return [];
  // ai coding：静态 id 只在 owner 内唯一；重复 seed 更新该 owner 的行，不会与其他匿名 owner 冲突。
  const { data, error } = await client.from("places")
    .upsert(features.map((feature) => featureToPlaceRow(feature, ownerId)), { onConflict: "owner_id,id" })
    .select();
  if (error) throw new Error(`首次云端导入失败：${error.message}`);
  return data ?? [];
}

export async function saveCloudPlace(client, feature, ownerId) {
  const { data, error } = await client.from("places")
    .upsert(featureToPlaceRow(feature, ownerId), { onConflict: "owner_id,id" })
    .select()
    .single();
  if (error || !data) throw new Error(`云端保存失败：${error?.message || "未返回保存结果"}`);
  return placeRowToFeature(data);
}

export async function saveCloudPlaceToCollection(client, collection, feature, ownerId, existingId) {
  // ai coding：先等待云端保存成功，再生成新的集合；失败时不触碰调用方持有的正式集合。
  const savedFeature = await saveCloudPlace(client, feature, ownerId);
  const features = existingId
    ? collection.features.map((item) => item.id === existingId ? savedFeature : item)
    : [...collection.features, savedFeature];
  return { feature: savedFeature, collection: { ...collection, features } };
}

export async function deleteCloudPlace(client, id, ownerId) {
  // ai coding：数据库行删除前清理该 owner/place 的公开副本与私有原图；失败时保留地点和图片元数据。
  const restoreImages = await cleanupPlaceImagesBeforeDelete(client, ownerId, id);
  const { data, error } = await client.from("places").delete().eq("owner_id", ownerId).eq("id", id).select("id");
  if (error || !data?.length) {
    const deleteMessage = error ? `云端删除失败：${error.message}` : "云端删除失败：地点不存在或无权删除";
    try {
      await restoreImages();
    } catch (restoreError) {
      // ai coding：数据库删除与图片恢复双重失败时保留原始失败语义，并暴露需要人工处理的对象路径。
      const failure = new Error(`${deleteMessage}；${restoreError.message || "地点图片恢复失败"}`);
      failure.pendingCleanupPaths = restoreError.pendingCleanupPaths ?? [];
      throw failure;
    }
    throw new Error(deleteMessage);
  }
}
