import { isTypeAllowedForGeometry } from "./placeTypes.js";

export const emptyCollection = () => ({ type: "FeatureCollection", name: "user-maintained-places", features: [] });

export function validatePosition(position, context = "地点") {
  if (!Array.isArray(position) || position.length !== 2) throw new Error(`${context}坐标无效`);
  const [longitude, latitude] = position;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error(`${context}经纬度必须是有限数值`);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error(`${context}经纬度超出 WGS84 有效范围`);
}

function validatePolygon(coordinates, context) {
  if (!Array.isArray(coordinates) || coordinates.length !== 1 || !Array.isArray(coordinates[0])) throw new Error(`${context}必须是仅含一个外环的 Polygon`);
  const ring = coordinates[0];
  if (ring.length < 4) throw new Error(`${context}的多边形至少需要 3 个顶点并闭合`);
  ring.forEach((position) => validatePosition(position, context));
  const first = ring[0]; const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error(`${context}的多边形外环未闭合`);
  const distinct = new Set(ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`));
  if (distinct.size < 3) throw new Error(`${context}的多边形至少需要 3 个不同顶点`);
}

function validateLineString(coordinates, context) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error(`${context}的线至少需要 2 个顶点`);
  coordinates.forEach((position) => validatePosition(position, context));
  const distinct = new Set(coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`));
  if (distinct.size < 2) throw new Error(`${context}的线至少需要 2 个不同顶点`);
  // ai coding：LineString 必须保持开放，拒绝首尾相同的闭合路径进入内存、云端或公开快照链路。
  const first = coordinates[0]; const last = coordinates.at(-1);
  if (first[0] === last[0] && first[1] === last[1]) throw new Error(`${context}的线不能闭合`);
}

export function validateLineStringGeometry(geometry, context = "线") {
  if (geometry?.type !== "LineString") throw new Error(`${context}必须是 LineString`);
  validateLineString(geometry.coordinates, context);
  return geometry;
}

export function validatePolygonGeometry(geometry, context = "区域") {
  if (geometry?.type !== "Polygon") throw new Error(`${context}必须是 Polygon`);
  validatePolygon(geometry.coordinates, context);
  return geometry;
}

export function createPolygonDraftGeometry(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 1) throw new Error("区域编辑草稿缺少顶点");
  const openRing = vertices.map((position) => {
    validatePosition(position, "区域编辑草稿");
    return [position[0], position[1]];
  });
  // ai coding：编辑态只保存一份开放顶点序列，每次派生标准闭合环，避免首尾控制点产生冗余状态。
  if (openRing.length > 1 && openRing[0][0] === openRing.at(-1)[0] && openRing[0][1] === openRing.at(-1)[1]) openRing.pop();
  return { type: "Polygon", coordinates: [[...openRing, [...openRing[0]]]] };
}

export function insertPolygonVertex(geometry, segmentIndex, position) {
  const ring = geometry?.type === "Polygon" ? geometry.coordinates?.[0] : null;
  if (!Array.isArray(ring) || ring.length < 2) throw new Error("待编辑区域外环无效");
  validatePosition(position, "新顶点");
  const vertices = ring.slice(0, -1).map(([longitude, latitude]) => [longitude, latitude]);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= vertices.length) throw new Error("区域边索引无效");
  vertices.splice(segmentIndex + 1, 0, [position[0], position[1]]);
  return createPolygonDraftGeometry(vertices);
}

export function validatePlaces(data, placeTypes, { validateContainedReferences = true } = {}) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("不是有效的 GeoJSON FeatureCollection");
  const configuredTypes = new Set(placeTypes.map(({ id }) => id));
  const ids = new Set();
  data.features.forEach((feature, index) => {
    const context = `第 ${index + 1} 个地点`;
    if (feature?.type !== "Feature" || !["Point", "LineString", "Polygon"].includes(feature?.geometry?.type)) throw new Error(`${context}必须是 Point、LineString 或 Polygon Feature`);
    // ai coding：原始 Feature 必须自行携带一致的双层 id 和 user 来源，禁止依赖后续标准化修补非法数据。
    const hasFeatureId = Object.hasOwn(feature, "id");
    const hasPropertyId = Object.hasOwn(feature.properties ?? {}, "id");
    const featureId = hasFeatureId ? String(feature.id ?? "").trim() : "";
    const propertyId = hasPropertyId ? String(feature.properties.id ?? "").trim() : "";
    if (!featureId || !propertyId) throw new Error(`${context}缺少稳定唯一 id`);
    if (feature.id !== feature.properties.id) throw new Error(`${context}的顶层 id 与 properties.id 不一致`);
    const id = featureId;
    if (!id || ids.has(id)) throw new Error(`${context}${id ? "的 id 重复" : "缺少稳定唯一 id"}`);
    ids.add(id);
    if (feature.geometry.type === "Point") validatePosition(feature.geometry.coordinates, context);
    else if (feature.geometry.type === "LineString") validateLineString(feature.geometry.coordinates, context);
    else validatePolygon(feature.geometry.coordinates, context);
    if (!String(feature.properties?.name ?? "").trim()) throw new Error(`${context}缺少 name`);
    if (typeof feature.properties?.type !== "string" || !configuredTypes.has(feature.properties.type)) throw new Error(`${context}的 type 未在 place-types.json 中配置`);
    // ai coding：类型合法性同时受 geometry 约束，避免 Point/Polygon 冒用线类型或新 LineString 回退到普通点类型。
    if (!isTypeAllowedForGeometry(feature.properties.type, feature.geometry.type)) throw new Error(`${context}的 type 不适用于 ${feature.geometry.type}`);
    if (feature.properties.source !== "user") throw new Error(`${context}的 source 必须是 user`);
  });
  // ai coding：一个集合代表同一 owner + map；线只能引用集合内已经存在的 Point，且关系 id 去重。
  const featuresById = new Map(data.features.map((feature) => [String(feature.id), feature]));
  data.features.forEach((feature, index) => {
    const contained = feature.properties?.contained_place_ids;
    if (contained === undefined) return;
    if (feature.geometry.type !== "LineString" || !Array.isArray(contained)) throw new Error(`第 ${index + 1} 个地点的 contained_place_ids 仅允许用于 LineString`);
    if (contained.some((id) => typeof id !== "string" || !id.trim()) || new Set(contained).size !== contained.length) throw new Error(`第 ${index + 1} 个地点的 contained_place_ids 必须是无重复的有效 id`);
    if (validateContainedReferences && contained.some((id) => featuresById.get(id)?.geometry?.type !== "Point")) throw new Error(`第 ${index + 1} 个地点只能包含当前地图中已存在的 Point 地点`);
  });
  return data;
}

export function normalizeCollection(data) {
  return {
    ...data,
    type: "FeatureCollection",
    name: data.name || "user-maintained-places",
    features: data.features,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function getUnsyncedChanges(current, baseline) {
  const currentById = new Map(current.features.map((feature) => [String(feature.id), feature]));
  const baselineById = new Map(baseline.features.map((feature) => [String(feature.id), feature]));
  const changedIds = new Set();
  new Set([...currentById.keys(), ...baselineById.keys()]).forEach((id) => {
    if (!currentById.has(id) || !baselineById.has(id) || canonicalJson(currentById.get(id)) !== canonicalJson(baselineById.get(id))) changedIds.add(id);
  });
  return { count: changedIds.size, currentIds: new Set([...changedIds].filter((id) => currentById.has(id))) };
}

export function getSaveSummary(total, unsyncedCount) {
  return unsyncedCount
    ? `当前共有${total}个用户自定义地点，${unsyncedCount}个地点未保存至本地文件`
    : `当前共有${total}个用户自定义地点`;
}

export function getPolygonRepresentativeCoordinate(geometry) {
  const ring = geometry?.type === "Polygon" ? geometry.coordinates?.[0] : null;
  if (!Array.isArray(ring) || ring.length < 4) throw new Error("无法计算无效区域的代表坐标");
  validatePolygon(geometry.coordinates, "区域");
  const vertices = ring.slice(0, -1);
  const [originLongitude, originLatitude] = vertices[0];
  let crossSum = 0; let longitudeSum = 0; let latitudeSum = 0;
  vertices.forEach(([longitude, latitude], index) => {
    const [nextLongitude, nextLatitude] = vertices[(index + 1) % vertices.length];
    const x = longitude - originLongitude; const y = latitude - originLatitude;
    const nextX = nextLongitude - originLongitude; const nextY = nextLatitude - originLatitude;
    const cross = x * nextY - nextX * y;
    crossSum += cross;
    longitudeSum += (x + nextX) * cross;
    latitudeSum += (y + nextY) * cross;
  });
  // ai coding：优先使用 Polygon 面积质心；退化外环回退到顶点平均值，始终保持 [经度, 纬度]。
  const centroid = Math.abs(crossSum) > Number.EPSILON
    ? [originLongitude + longitudeSum / (3 * crossSum), originLatitude + latitudeSum / (3 * crossSum)]
    : null;
  const average = [
    vertices.reduce((sum, [longitude]) => sum + longitude, 0) / vertices.length,
    vertices.reduce((sum, [, latitude]) => sum + latitude, 0) / vertices.length,
  ];
  const longitudes = vertices.map(([longitude]) => longitude); const latitudes = vertices.map(([, latitude]) => latitude);
  const centroidIsNear = centroid?.every(Number.isFinite)
    && centroid[0] >= Math.min(...longitudes) && centroid[0] <= Math.max(...longitudes)
    && centroid[1] >= Math.min(...latitudes) && centroid[1] <= Math.max(...latitudes);
  const coordinate = centroidIsNear ? centroid : average;
  validatePosition(coordinate, "区域代表");
  return coordinate;
}

export function getLineStringRepresentativeCoordinate(geometry) {
  validateLineStringGeometry(geometry);
  const coordinate = [
    geometry.coordinates.reduce((sum, [longitude]) => sum + longitude, 0) / geometry.coordinates.length,
    geometry.coordinates.reduce((sum, [, latitude]) => sum + latitude, 0) / geometry.coordinates.length,
  ];
  validatePosition(coordinate, "线代表");
  return coordinate;
}

export function getGeometryRepresentativeCoordinate(geometry) {
  if (geometry?.type === "Point") { validatePosition(geometry.coordinates); return geometry.coordinates.slice(0, 2); }
  if (geometry?.type === "LineString") return getLineStringRepresentativeCoordinate(geometry);
  return getPolygonRepresentativeCoordinate(geometry);
}

export function createPlace(values, existing) {
  const now = new Date().toISOString();
  const id = existing?.id ?? globalThis.crypto?.randomUUID?.() ?? `place-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // ai coding：新增 Point 没有 existing；只有编辑既有非 Point 要素时才沿用其 geometry，避免读取 null.geometry。
  const geometry = values.geometry ?? (existing?.geometry && existing.geometry.type !== "Point" ? existing.geometry : { type: "Point", coordinates: [values.longitude, values.latitude] });
  const geometryChanged = !existing || canonicalJson(existing.geometry) !== canonicalJson(geometry);
  const representative = geometry.type !== "Point" && geometryChanged ? getGeometryRepresentativeCoordinate(geometry) : null;
  return {
    type: "Feature", id,
    // ai coding：区域沿用标准 GeoJSON 闭合外环；编辑地点信息时保持原有几何不变。
    geometry,
    properties: {
      ...(existing?.properties ?? {}), id, source: "user", name: values.name, type: values.type,
      address: values.address, phone: values.phone, description: values.description,
      ...(representative ? { longitude: representative[0], latitude: representative[1] } : {}),
      ...(geometry.type === "LineString" ? { contained_place_ids: [...new Set(values.contained_place_ids ?? existing?.properties?.contained_place_ids ?? [])] } : {}),
      createdAt: existing?.properties.createdAt ?? now, updatedAt: now,
    },
  };
}
