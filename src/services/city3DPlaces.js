import { CITY_BUILDING_FOOTPRINT_SCALE, classifyPlaceBuilding } from "./city3DStyle.js";

function seededUnit(text) {
  let value = 2166136261;
  for (const character of String(text)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, z] = polygon[index];
    const [previousX, previousZ] = polygon[previous];
    if ((z > point[1]) !== (previousZ > point[1])
      && point[0] < ((previousX - x) * (point[1] - z)) / (previousZ - z) + x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dz);
}

function boundaryClearance(point, polygon) {
  return Math.min(...polygon.map((end, index) => distanceToSegment(point, polygon[(index || polygon.length) - 1], end)));
}

export function buildingFootprintInsidePolygon(building, polygon) {
  const halfWidth = building.width / 2;
  const halfDepth = building.depth / 2;
  const corners = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]]
    .map(([x, z]) => [building.x + x, building.z + z]);
  return corners.every((corner) => pointInPolygon(corner, polygon));
}

export function createPointPlaceBuildings(place) {
  const profile = classifyPlaceBuilding(place);
  const [x, z] = place.points[0];
  const variation = 0.9 + seededUnit(place.id) * 0.2;
  return [{
    id: `${place.id}:building-1`, x, z,
    width: profile.width * CITY_BUILDING_FOOTPRINT_SCALE,
    depth: profile.depth * CITY_BUILDING_FOOTPRINT_SCALE,
    height: profile.height * variation,
    color: profile.color, roof: profile.roof, category: profile.category, tier: profile.tier,
  }];
}

export function createPolygonPlaceBuildings(place) {
  const profile = classifyPlaceBuilding(place);
  const polygon = place.points.at(-1)?.[0] === place.points[0]?.[0] && place.points.at(-1)?.[1] === place.points[0]?.[1]
    ? place.points.slice(0, -1) : place.points;
  if (polygon.length < 3) return [];
  const xs = polygon.map(([x]) => x);
  const zs = polygon.map(([, z]) => z);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const target = Math.max(2, profile.groupCount);
  const shortSide = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const footprintWidth = profile.width * CITY_BUILDING_FOOTPRINT_SCALE;
  const footprintDepth = profile.depth * CITY_BUILDING_FOOTPRINT_SCALE;
  const groupScaleCap = shortSide / (Math.min(footprintWidth, footprintDepth) * (Math.sqrt(target) + 1.5));
  const candidates = [];
  const grid = Math.max(8, Math.ceil(Math.sqrt(target * 7)));
  for (let row = 1; row < grid; row += 1) {
    for (let column = 1; column < grid; column += 1) {
      candidates.push([
        bounds.minX + ((bounds.maxX - bounds.minX) * column) / grid,
        bounds.minZ + ((bounds.maxZ - bounds.minZ) * row) / grid,
      ]);
    }
  }
  candidates.sort((a, b) => seededUnit(`${place.id}:${a[0]}:${a[1]}`) - seededUnit(`${place.id}:${b[0]}:${b[1]}`));
  const buildings = [];
  for (const [x, z] of candidates) {
    if (buildings.length >= target || !pointInPolygon([x, z], polygon)) continue;
    const clearance = boundaryClearance([x, z], polygon) * 0.82;
    const desiredRadius = Math.hypot(footprintWidth, footprintDepth) / 2;
    const scale = Math.min(1, clearance / desiredRadius, groupScaleCap);
    if (scale < 0.05) continue;
    const width = footprintWidth * scale;
    const depth = footprintDepth * scale;
    // ai coding：楼群按缩小后的楼体再留出接近一栋楼宽的空地，避免 Polygon 内重新挤成连续块。
    const gap = Math.min(Math.max(width, depth) * 0.85, shortSide / (Math.sqrt(target) + 3));
    if (buildings.some((item) => Math.abs(item.x - x) < (item.width + width) / 2 + gap && Math.abs(item.z - z) < (item.depth + depth) / 2 + gap)) continue;
    const number = buildings.length + 1;
    const building = {
      id: `${place.id}:building-${number}`, x, z, width, depth,
      height: profile.height * Math.max(0.45, Math.sqrt(scale)) * (0.82 + seededUnit(`${place.id}:height:${number}`) * 0.36),
      color: profile.color, roof: profile.roof, category: profile.category, tier: profile.tier,
    };
    if (buildingFootprintInsidePolygon(building, polygon)) buildings.push(building);
  }
  return buildings;
}

// ai coding：Polygon 仅由一个区域命中面负责 hover；可见面和所有楼体禁用 raycast，避免楼间切换触发竞争的 out/over。
export function createPlaceHoverStrategy(place) {
  return Object.freeze({
    hoverKey: place.key,
    hitLayer: place.geometryType === "Polygon" ? "polygon" : place.geometryType.toLowerCase(),
    disableBuildingRaycast: place.geometryType === "Polygon",
    singleHitLayer: place.geometryType === "Polygon",
  });
}
