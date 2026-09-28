import { CITY_BUILDING_FOOTPRINT_SCALE, CITY_BUILDING_HEIGHT_SCALE } from "./city3DStyle.js";

const EARTH_METRES_PER_DEGREE = 111_320;

export function createLocalProjection(bounds, targetSize = 160) {
  const centerLongitude = (bounds.west + bounds.east) / 2;
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const longitudeScale = EARTH_METRES_PER_DEGREE * Math.cos((centerLatitude * Math.PI) / 180);
  const widthMetres = (bounds.east - bounds.west) * longitudeScale;
  const heightMetres = (bounds.north - bounds.south) * EARTH_METRES_PER_DEGREE;
  const scale = targetSize / Math.max(widthMetres, heightMetres);

  if (![widthMetres, heightMetres, scale].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("无法建立当前地图的本地坐标系");
  }

  return {
    width: widthMetres * scale,
    height: heightMetres * scale,
    project(coordinate) {
      const [longitude, latitude] = coordinate ?? [];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      const x = (longitude - centerLongitude) * longitudeScale * scale;
      const z = -(latitude - centerLatitude) * EARTH_METRES_PER_DEGREE * scale;
      return [x || 0, z || 0];
    },
  };
}

export function geometryCoordinatePaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function roadKind(feature) {
  const highway = feature.properties?.highway ?? feature.properties?.tags?.highway;
  if (["motorway", "trunk", "motorway_link", "trunk_link"].includes(highway)) return "major";
  if (["primary", "secondary", "primary_link", "secondary_link"].includes(highway)) return "primary";
  return "local";
}

export function createRibbonGeometryData(paths, kind, width, elevation, thickness) {
  const positions = [];
  const hits = [];
  const halfWidth = width / 2;
  const bottomElevation = elevation - thickness;
  if (![halfWidth, elevation, thickness, bottomElevation].every(Number.isFinite) || halfWidth <= 0 || thickness <= 0 || bottomElevation < 0) {
    return { positions, hits };
  }

  // ai coding：道路由单一水平面改为带顶面、底面和四侧面的薄实体；顶面朝上，侧面保证斜视时仍有可见投影，同时不关闭深度测试。
  paths.forEach((path) => {
    if (kind && path.kind !== kind) return;
    path.points.forEach((end, index) => {
      if (!index) return;
      const start = path.points[index - 1];
      if (![...start, ...end].every(Number.isFinite)) return;
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const length = Math.hypot(dx, dz);
      if (!length) return;
      const nx = (-dz / length) * halfWidth;
      const nz = (dx / length) * halfWidth;
      const startLeft = [start[0] + nx, elevation, start[1] + nz];
      const endLeft = [end[0] + nx, elevation, end[1] + nz];
      const startRight = [start[0] - nx, elevation, start[1] - nz];
      const endRight = [end[0] - nx, elevation, end[1] - nz];
      const startLeftBottom = [startLeft[0], bottomElevation, startLeft[2]];
      const endLeftBottom = [endLeft[0], bottomElevation, endLeft[2]];
      const startRightBottom = [startRight[0], bottomElevation, startRight[2]];
      const endRightBottom = [endRight[0], bottomElevation, endRight[2]];
      const triangles = [
        [startLeft, endLeft, startRight], [endLeft, endRight, startRight],
        [startLeftBottom, startRightBottom, endLeftBottom], [endLeftBottom, startRightBottom, endRightBottom],
        [startLeft, startLeftBottom, endLeft], [endLeft, startLeftBottom, endLeftBottom],
        [startRight, endRight, startRightBottom], [endRight, endRightBottom, startRightBottom],
        [startLeft, startRight, startLeftBottom], [startRight, startRightBottom, startLeftBottom],
        [endLeft, endLeftBottom, endRight], [endRight, endLeftBottom, endRightBottom],
      ];
      triangles.forEach((triangle) => {
        positions.push(...triangle.flat());
        hits.push(path);
      });
    });
  });
  return { positions, hits };
}

function simplifyPath(path, maxPoints) {
  if (path.length <= maxPoints) return path;
  const step = Math.ceil((path.length - 1) / (maxPoints - 1));
  const result = path.filter((_, index) => index % step === 0);
  if (result.at(-1) !== path.at(-1)) result.push(path.at(-1));
  return result;
}

export function featureDisplayName(feature, fallback) {
  const properties = feature?.properties ?? {};
  const candidates = [properties.name, properties.title, properties.label, feature?.name, feature?.title, feature?.label];
  const name = candidates.find((value) => typeof value === "string" && value.trim());
  return name ? name.trim() : fallback;
}

export function projectRoadPaths(collection, projection, { maxPaths = 6500, maxPointsPerPath = 160 } = {}) {
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("基础道路 GeoJSON 不是有效的 FeatureCollection");
  }
  const major = collection.features.filter((feature) => roadKind(feature) !== "local");
  const local = collection.features.filter((feature) => roadKind(feature) === "local");
  const localStride = Math.max(1, Math.ceil(local.length / Math.max(1, maxPaths - major.length)));
  const selected = [...major, ...local.filter((_, index) => index % localStride === 0)];
  const paths = [];

  // ai coding：道路与用户地点保持完全分离，只将道路几何投影为 Three.js 可稳定处理的局部平面坐标。
  for (const [featureIndex, feature] of selected.entries()) {
    const name = featureDisplayName(feature, "未命名道路");
    const featureId = feature.id ?? feature.properties?.id ?? `road-${featureIndex}`;
    for (const [pathIndex, coordinates] of geometryCoordinatePaths(feature.geometry).entries()) {
      const points = simplifyPath(coordinates, maxPointsPerPath).map(projection.project).filter(Boolean);
      if (points.length >= 2) paths.push({
        id: `${featureId}:${pathIndex}`,
        featureId,
        kind: roadKind(feature),
        name,
        source: feature.properties?.source ?? collection.source ?? "base-road",
        points,
      });
      if (paths.length >= maxPaths) return paths;
    }
  }
  return paths;
}

export function projectUserPlaces(collection, projection, { maxPointsPerPath = 160 } = {}) {
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) return [];
  const places = [];

  // ai coding：用户地点独立投影并保留原 id/source，不进入只读基础道路集合。
  collection.features.forEach((feature, index) => {
    const geometryType = feature?.geometry?.type;
    if (!["Point", "LineString", "Polygon"].includes(geometryType)) return;
    const id = feature.id ?? feature.properties?.id ?? `place-${index}`;
    const common = {
      id,
      key: `user:${id}`,
      name: featureDisplayName(feature, "未命名地点"),
      source: feature.properties?.source ?? "user",
      geometryType,
      properties: { ...(feature.properties ?? {}) },
      type: feature.type,
      label: feature.label,
      title: feature.title,
    };
    if (geometryType === "Point") {
      const point = projection.project(feature.geometry.coordinates);
      if (point) places.push({ ...common, points: [point] });
      return;
    }
    const coordinates = geometryType === "Polygon" ? feature.geometry.coordinates?.[0] : feature.geometry.coordinates;
    const points = simplifyPath(Array.isArray(coordinates) ? coordinates : [], maxPointsPerPath)
      .map(projection.project)
      .filter(Boolean);
    const minimum = geometryType === "Polygon" ? 3 : 2;
    if (new Set(points.map(([x, z]) => `${x},${z}`)).size >= minimum) places.push({ ...common, points });
  });
  return places;
}

function seededRandom(seedText) {
  let seed = 2166136261;
  for (const character of seedText) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceToSegmentSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const ratio = lengthSquared
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared))
    : 0;
  const offsetX = point[0] - (start[0] + ratio * dx);
  const offsetZ = point[1] - (start[1] + ratio * dz);
  return offsetX * offsetX + offsetZ * offsetZ;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, z] = polygon[index];
    const [previousX, previousZ] = polygon[previous];
    if ((z > point[1]) !== (previousZ > point[1])
      && point[0] < ((previousX - x) * (point[1] - z)) / (previousZ - z) + x) inside = !inside;
  }
  return inside;
}

export function buildingOverlapsUserPlace(building, place, padding = 0.75) {
  const center = [building.x, building.z];
  const radiusSquared = (Math.hypot(building.width, building.depth) / 2 + padding) ** 2;
  const points = Array.isArray(place?.points) ? place.points : [];
  if (!points.length) return false;
  if (place.geometryType === "Point") return distanceToSegmentSquared(center, points[0], points[0]) <= radiusSquared;
  if (place.geometryType === "Polygon" && pointInPolygon(center, points)) return true;
  const segmentPoints = place.geometryType === "Polygon" && points.at(-1) !== points[0] ? [...points, points[0]] : points;
  return segmentPoints.some((point, index) => (
    index > 0 && distanceToSegmentSquared(center, segmentPoints[index - 1], point) <= radiusSquared
  ));
}

export function createProceduralBuildings(projection, roadPaths, seedText, count = 180, userPlaces = []) {
  const random = seededRandom(seedText);
  const buildings = [];
  const margin = 4;
  const maxAttempts = count * 12;

  // ai coding：建筑同时避让道路和用户点、线、面范围，保证用户地点可见且可命中 hover。
  for (let attempt = 0; attempt < maxAttempts && buildings.length < count; attempt += 1) {
    const width = (1.35 + random() * 2.25) * CITY_BUILDING_FOOTPRINT_SCALE;
    const depth = (1.35 + random() * 2.25) * CITY_BUILDING_FOOTPRINT_SCALE;
    const x = (random() - 0.5) * Math.max(1, projection.width - margin * 2);
    const z = (random() - 0.5) * Math.max(1, projection.height - margin * 2);
    const clearanceSquared = (Math.hypot(width, depth) * 0.54 + 0.42) ** 2;
    const blocksRoad = roadPaths.some(({ points }) => points.some((point, index) => (
      index > 0 && distanceToSegmentSquared([x, z], points[index - 1], point) < clearanceSquared
    )));
    const candidate = { x, z, width, depth };
    if (blocksRoad || userPlaces.some((place) => buildingOverlapsUserPlace(candidate, place))) continue;
    const height = (2.4 + random() ** 1.8 * 10.5) * CITY_BUILDING_HEIGHT_SCALE;
    const number = buildings.length + 1;
    buildings.push({ id: `procedural-building-${number}`, name: `简化建筑 ${number}`, x, z, width, depth, height, shade: random() });
  }
  return buildings;
}
