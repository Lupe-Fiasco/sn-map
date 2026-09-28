import test from "node:test";
import assert from "node:assert/strict";
import { placesForScope } from "../src/services/mapPlaceIsolation.js";

test("地区切换首帧不会把旧 map 的地点暴露给新视图", () => {
  const oldCollection = {
    type: "FeatureCollection",
    features: [{ id: "old-map-place" }],
  };
  const loadedState = { scope: "owner-1:map-a", collection: oldCollection };

  assert.equal(placesForScope(loadedState, "owner-1:map-a"), oldCollection);
  assert.deepEqual(placesForScope(loadedState, "owner-1:map-b"), {
    type: "FeatureCollection",
    features: [],
  });
});

test("新地区完成加载后只返回该 scope 的地点", () => {
  const nextCollection = {
    type: "FeatureCollection",
    features: [{ id: "new-map-place" }],
  };
  assert.equal(
    placesForScope({ scope: "owner-1:map-b", collection: nextCollection }, "owner-1:map-b"),
    nextCollection,
  );
  assert.equal(
    placesForScope({ scope: "owner-2:map-b", collection: nextCollection }, "owner-1:map-b").features.length,
    0,
  );
});
