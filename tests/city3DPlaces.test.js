import test from "node:test";
import assert from "node:assert/strict";
import { buildingFootprintInsidePolygon, createPlaceHoverStrategy, createPointPlaceBuildings, createPolygonPlaceBuildings } from "../src/services/city3DPlaces.js";
import { CITY_BUILDING_FOOTPRINT_SCALE, CITY_BUILDING_HEIGHT_SCALE, classifyPlaceBuilding } from "../src/services/city3DStyle.js";

test("Point 按类型生成小尺度且高度不同的建筑，不使用大头针", () => {
  const shop = createPointPlaceBuildings({ id: "shop-1", points: [[2, 3]], properties: { type: "shop" } })[0];
  const hospital = createPointPlaceBuildings({ id: "hospital-1", points: [[4, 5]], properties: { type: "hospital" } })[0];
  assert.deepEqual([shop.x, shop.z], [2, 3]);
  const originalShopProfile = classifyPlaceBuilding({ properties: { type: "shop" } });
  assert.equal(shop.width, originalShopProfile.width * CITY_BUILDING_FOOTPRINT_SCALE);
  assert.equal(shop.depth, originalShopProfile.depth * CITY_BUILDING_FOOTPRINT_SCALE);
  assert.equal(CITY_BUILDING_FOOTPRINT_SCALE, 0.28);
  assert.ok(hospital.height > shop.height * 3);
  assert.equal(shop.category, "retail");
  assert.equal(hospital.category, "civic");
  assert.ok(shop.height <= 0.8 * 1.1 * CITY_BUILDING_HEIGHT_SCALE);
});

test("Polygon 楼群共享单一区域 hover key 和命中层，Point 保持自身楼体命中", () => {
  const polygon = createPlaceHoverStrategy({ key: "user:area-1", geometryType: "Polygon" });
  const point = createPlaceHoverStrategy({ key: "user:point-1", geometryType: "Point" });
  assert.deepEqual(polygon, { hoverKey: "user:area-1", hitLayer: "polygon", disableBuildingRaycast: true, singleHitLayer: true });
  assert.deepEqual(point, { hoverKey: "user:point-1", hitLayer: "point", disableBuildingRaycast: false, singleHitLayer: false });
});

test("Polygon 学校生成多栋建筑且每个完整占地都在安全范围内", () => {
  const polygon = [[0, 0], [12, 0], [12, 8], [7, 8], [7, 5], [0, 5], [0, 0]];
  const place = { id: "school-area", points: polygon, properties: { type: "school", name: "实验学校" } };
  const buildings = createPolygonPlaceBuildings(place);

  assert.ok(buildings.length >= 3);
  assert.ok(buildings.every((building) => building.category === "campus"));
  // ai coding：渲染屋顶比主体宽深各放大 4%，楼群边界测试必须覆盖完整外檐。
  assert.ok(buildings.every((building) => buildingFootprintInsidePolygon({
    ...building,
    width: building.width * 1.04,
    depth: building.depth * 1.04,
  }, polygon.slice(0, -1))));
  assert.ok(buildings.every((building, index) => buildings.slice(index + 1).every((other) => {
    const horizontalGap = Math.abs(building.x - other.x) - (building.width + other.width) / 2;
    const verticalGap = Math.abs(building.z - other.z) - (building.depth + other.depth) / 2;
    return Math.max(horizontalGap, verticalGap) >= Math.min(building.width, building.depth) * 0.5;
  })));
  assert.deepEqual(createPolygonPlaceBuildings(place).map(({ x, z, height }) => [x, z, height]), buildings.map(({ x, z, height }) => [x, z, height]));
});

test("狭小 Polygon 只保留能完整容纳的建筑", () => {
  const polygon = [[0, 0], [0.7, 0], [0.7, 0.45], [0, 0.45], [0, 0]];
  const buildings = createPolygonPlaceBuildings({ id: "tiny", points: polygon, properties: { type: "residential" } });
  assert.ok(buildings.every((building) => buildingFootprintInsidePolygon(building, polygon.slice(0, -1))));
});
