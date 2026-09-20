import test from "node:test";
import assert from "node:assert/strict";
import { loadMapConfigs, mapScope, validateMapConfig } from "../src/services/maps.js";
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
