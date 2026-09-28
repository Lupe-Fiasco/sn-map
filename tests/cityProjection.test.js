import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildingOverlapsUserPlace, createLocalProjection, createProceduralBuildings, createRibbonGeometryData, featureDisplayName, geometryCoordinatePaths, projectRoadPaths, projectUserPlaces } from "../src/services/cityProjection.js";
import { CITY_BUILDING_FOOTPRINT_SCALE, CITY_BUILDING_HEIGHT_SCALE } from "../src/services/city3DStyle.js";

test("本地投影以中心为原点并保持经纬度方向", () => {
  const projection = createLocalProjection({ west: 117, east: 119, south: 33, north: 35 }, 100);
  assert.deepEqual(projection.project([118, 34]), [0, 0]);
  const eastNorth = projection.project([118.1, 34.1]);
  assert.ok(eastNorth[0] > 0);
  assert.ok(eastNorth[1] < 0);
  assert.ok(projection.width <= 100 && projection.height <= 100);
});

test("名称提取优先 properties.name 并兼容 title、label 与兜底", () => {
  assert.equal(featureDisplayName({ properties: { name: "  名称  ", title: "标题", label: "标签" } }, "兜底"), "名称");
  assert.equal(featureDisplayName({ properties: { name: "", title: "道路标题", label: "标签" } }, "兜底"), "道路标题");
  assert.equal(featureDisplayName({ label: "顶层标签" }, "兜底"), "顶层标签");
  assert.equal(featureDisplayName({ properties: {} }, "未命名地点"), "未命名地点");
});

test("用户 Point、LineString、Polygon 独立投影并保留身份信息", () => {
  const projection = createLocalProjection({ west: 0, east: 4, south: 0, north: 4 });
  const projected = projectUserPlaces({
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "point-1", properties: { name: "点位", source: "user" }, geometry: { type: "Point", coordinates: [1, 1] } },
      { type: "Feature", id: "line-1", properties: { title: "线路", type: "river", label: "河道", source: "user" }, geometry: { type: "LineString", coordinates: [[1, 1], [2, 2]] } },
      { type: "Feature", properties: { id: "area-1", label: "区域", source: "user" }, geometry: { type: "Polygon", coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] } },
    ],
  }, projection);

  assert.deepEqual(projected.map(({ id, name, source, geometryType }) => ({ id, name, source, geometryType })), [
    { id: "point-1", name: "点位", source: "user", geometryType: "Point" },
    { id: "line-1", name: "线路", source: "user", geometryType: "LineString" },
    { id: "area-1", name: "区域", source: "user", geometryType: "Polygon" },
  ]);
  assert.equal(projected[0].points.length, 1);
  assert.equal(projected[1].points.length, 2);
  assert.equal(projected[1].properties.type, "river");
  assert.equal(projected[1].properties.label, "河道");
  assert.equal(projected[2].points.length, 4);
});

test("道路投影保留名称，匿名道路使用明确兜底", () => {
  const projection = createLocalProjection({ west: 0, east: 2, south: 0, north: 2 });
  const paths = projectRoadPaths({
    type: "FeatureCollection",
    source: "OSM",
    features: [
      { id: "named", properties: { label: "道路标签", highway: "primary" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { id: "unnamed", properties: { highway: "residential" }, geometry: { type: "LineString", coordinates: [[0, 1], [1, 2]] } },
    ],
  }, projection);
  assert.equal(paths[0].name, "道路标签");
  assert.equal(paths[1].name, "未命名道路");
  assert.equal(paths[0].source, "OSM");
});

test("道路路径兼容 LineString、MultiLineString 与 Polygon", () => {
  assert.equal(geometryCoordinatePaths({ type: "LineString", coordinates: [[0, 0], [1, 1]] }).length, 1);
  assert.equal(geometryCoordinatePaths({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }).length, 2);
  assert.equal(geometryCoordinatePaths({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] }).length, 1);

  const projection = createLocalProjection({ west: 0, east: 2, south: 0, north: 2 });
  const paths = projectRoadPaths({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { highway: "primary" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }],
  }, projection);
  assert.equal(paths[0].kind, "primary");
  assert.equal(paths[0].points.length, 2);
});

test("睢宁实际道路文件可从配置路径解析并投影 LineString/MultiLineString", async () => {
  const config = JSON.parse(await readFile(new URL("../public/data/regions/suining/map-config.json", import.meta.url), "utf8"));
  const roads = JSON.parse(await readFile(new URL(`../public${config.base_roads_path}`, import.meta.url), "utf8"));
  const geometryTypes = roads.features.reduce((counts, feature) => ({
    ...counts,
    [feature.geometry.type]: (counts[feature.geometry.type] ?? 0) + 1,
  }), {});
  const paths = projectRoadPaths(roads, createLocalProjection(config.bounds), { maxPaths: 3000 });

  assert.equal(roads.type, "FeatureCollection");
  assert.ok((geometryTypes.LineString ?? 0) > 0);
  assert.equal(paths.length, roads.features.reduce((count, feature) => count + geometryCoordinatePaths(feature.geometry).length, 0));
  assert.ok(paths.every((path) => path.points.length >= 2 && ["major", "primary", "local"].includes(path.kind)));
});

test("道路和用户 LineString 生成有宽度、朝上顶面和非零厚度的带状实体", () => {
  const road = { id: "base-1", kind: "primary", points: [[0, 0], [3, 0]] };
  const userLine = { id: "user-1", kind: "road", points: [[0, 0], [0, 4]] };
  const roadData = createRibbonGeometryData([road], "primary", 0.46, 0.075, 0.05);
  const userData = createRibbonGeometryData([userLine], "road", 0.24, 0.12, 0.065);
  const triangleNormalY = (positions) => {
    const [ax, , az, bx, , bz, cx, , cz] = positions;
    return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  };
  const triangleNormal = (positions, offset) => {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(offset, offset + 9);
    const ab = [bx - ax, by - ay, bz - az];
    const ac = [cx - ax, cy - ay, cz - az];
    return [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  };

  assert.equal(roadData.positions.length, 108);
  assert.equal(userData.positions.length, 108);
  assert.equal(roadData.hits.length, 12);
  assert.equal(userData.hits.length, 12);
  assert.equal(roadData.hits[0], road);
  assert.equal(userData.hits[0], userLine);
  assert.ok(triangleNormalY(roadData.positions) > 0);
  assert.ok(triangleNormalY(userData.positions) > 0);
  const roadHeights = [...new Set(roadData.positions.filter((_, index) => index % 3 === 1))].sort();
  const userHeights = [...new Set(userData.positions.filter((_, index) => index % 3 === 1))].sort();
  assert.ok(Math.abs(roadHeights[0] - 0.025) < 1e-12 && roadHeights[1] === 0.075);
  assert.ok(Math.abs(userHeights[0] - 0.055) < 1e-12 && userHeights[1] === 0.12);
  assert.equal(Math.max(...roadData.positions.filter((_, index) => index % 3 === 2)) - Math.min(...roadData.positions.filter((_, index) => index % 3 === 2)), 0.46);
  const sideNormal = triangleNormal(roadData.positions, 36);
  assert.ok(Math.hypot(...sideNormal) > 0);
  assert.ok(Math.abs(sideNormal[1]) < 1e-12);
});

test("带状实体跳过退化线段，且无效厚度不会生成不可见平面", () => {
  const path = { id: "mixed", kind: "local", points: [[0, 0], [0, 0], [2, 0]] };
  const valid = createRibbonGeometryData([path], "local", 0.28, 0.075, 0.05);

  assert.equal(valid.positions.length, 108);
  assert.equal(valid.hits.length, 12);
  assert.deepEqual(createRibbonGeometryData([path], "local", 0.28, 0.075, 0).positions, []);
  assert.deepEqual(createRibbonGeometryData([path], "local", 0.28, 0.04, 0.05).positions, []);
});

test("程序化建筑避让用户 Point、LineString 与 Polygon", () => {
  const point = { geometryType: "Point", points: [[0, 0]] };
  const line = { geometryType: "LineString", points: [[-8, 5], [8, 5]] };
  const polygon = { geometryType: "Polygon", points: [[-4, -8], [4, -8], [4, -3], [-4, -3], [-4, -8]] };

  assert.equal(buildingOverlapsUserPlace({ x: 0.5, z: 0, width: 2, depth: 2 }, point), true);
  assert.equal(buildingOverlapsUserPlace({ x: 0, z: 5.5, width: 2, depth: 2 }, line), true);
  assert.equal(buildingOverlapsUserPlace({ x: 0, z: -5, width: 2, depth: 2 }, polygon), true);
  assert.equal(buildingOverlapsUserPlace({ x: 20, z: 20, width: 2, depth: 2 }, polygon), false);

  const userPlaces = [point, line, polygon];
  const buildings = createProceduralBuildings({ width: 50, height: 50 }, [], "avoid-user-places", 80, userPlaces);
  assert.ok(buildings.length > 0);
  assert.equal(CITY_BUILDING_FOOTPRINT_SCALE, 0.28);
  assert.ok(buildings.every(({ width, depth }) => width <= 3.6 * CITY_BUILDING_FOOTPRINT_SCALE && depth <= 3.6 * CITY_BUILDING_FOOTPRINT_SCALE));
  assert.ok(buildings.every(({ height }) => height >= 2.4 * CITY_BUILDING_HEIGHT_SCALE && height <= 12.9 * CITY_BUILDING_HEIGHT_SCALE));
  assert.equal(buildings.some((building) => userPlaces.some((place) => buildingOverlapsUserPlace(building, place))), false);
});
