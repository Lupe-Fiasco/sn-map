import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadMapConfigs, mapScope, resolveMapViewConfig, validateMapConfig } from "../src/services/maps.js";
import { SUINING_MAIN_CITY_BOUNDS, clipRoadCollection, coordinateInBounds } from "../src/services/geoBounds.js";
import { captureOwnerGeneration, createOwnerGeneration, isOwnerGenerationCurrent, updateOwnerGeneration } from "../src/services/ownerGeneration.js";

const config = (slug) => ({ id: slug, slug, name: slug, bounds: { south: 1, west: 2, north: 3, east: 4 }, center: { lat: 2, lon: 3 }, base_roads_path: `/data/regions/${slug}/base-roads.geojson`, seed_places_path: `/data/regions/${slug}/places.geojson`, is_active: true });

test("validates and loads only region-scoped active map configuration", async () => {
  assert.equal(validateMapConfig(config("suining")).id, "suining");
  assert.throws(() => validateMapConfig({ ...config("xuhui"), seed_places_path: "/data/regions/suining/places.geojson" }), /路径与地区不匹配/);
  const fixtures = { "/data/regions/maps.json": [{ config_path: "/data/regions/suining/map-config.json" }, { config_path: "/data/regions/xuhui/map-config.json" }], "/data/regions/suining/map-config.json": config("suining"), "/data/regions/xuhui/map-config.json": { ...config("xuhui"), is_active: false } };
  assert.deepEqual((await loadMapConfigs(async (url) => fixtures[url])).map(({ id }) => id), ["suining"]);
});

test("map changes invalidate owner operations before stale completions commit", () => {
  const generation = createOwnerGeneration(mapScope("owner-a", "suining"));
  const operation = captureOwnerGeneration(generation);
  updateOwnerGeneration(generation, mapScope("owner-a", "xuhui"));
  assert.equal(isOwnerGenerationCurrent(generation, operation), false);
});

test("睢宁 2D/3D 共用主城区 bounds 和已裁剪道路，徐汇配置不受影响", async () => {
  const suining = validateMapConfig(JSON.parse(await readFile(new URL("../public/data/regions/suining/map-config.json", import.meta.url), "utf8")));
  const xuhui = validateMapConfig(JSON.parse(await readFile(new URL("../public/data/regions/xuhui/map-config.json", import.meta.url), "utf8")));
  const roads = JSON.parse(await readFile(new URL(`../public${suining.base_roads_path}`, import.meta.url), "utf8"));
  const view = resolveMapViewConfig(suining);

  assert.deepEqual(view.bounds, SUINING_MAIN_CITY_BOUNDS);
  assert.deepEqual(suining.main_city_bounds, view.bounds);
  const longitudeRatio = (view.bounds.east - view.bounds.west) / (suining.administrative_bounds.east - suining.administrative_bounds.west);
  const latitudeRatio = (view.bounds.north - view.bounds.south) / (suining.administrative_bounds.north - suining.administrative_bounds.south);
  assert.ok(longitudeRatio < 0.2 && latitudeRatio < 0.2 && longitudeRatio * latitudeRatio < 1 / 3);
  assert.equal(view.baseRoadsPath, "/data/regions/suining/base-roads-main-city.geojson");
  assert.deepEqual(roads.bbox, [view.bounds.west, view.bounds.south, view.bounds.east, view.bounds.north]);
  assert.ok(roads.features.length > 0);
  assert.ok(roads.features.flatMap((feature) => feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates)
    .flat().every((coordinate) => coordinateInBounds(coordinate, view.bounds)));
  assert.deepEqual(xuhui.bounds, { south: 31.055, west: 121.33, north: 31.27, east: 121.525 });
});

test("道路裁剪保留穿越主城区的线段并过滤完全位于范围外的道路", () => {
  const collection = { type: "FeatureCollection", features: [
    { id: "crossing", geometry: { type: "LineString", coordinates: [[117.8, 33.91], [118.1, 33.91]] }, properties: {} },
    { id: "outside", geometry: { type: "LineString", coordinates: [[118.1, 34.1], [118.2, 34.2]] }, properties: {} },
  ] };
  const clipped = clipRoadCollection(collection, SUINING_MAIN_CITY_BOUNDS);
  assert.deepEqual(clipped.features.map(({ id }) => id), ["crossing"]);
  assert.deepEqual(clipped.features[0].geometry.coordinates, [[117.88, 33.91], [118.01, 33.91]]);
});
