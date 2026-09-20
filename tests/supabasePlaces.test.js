import test from "node:test";
import assert from "node:assert/strict";
import { deleteCloudPlace, featureToPlaceRow, fetchCloudPlaces, placeRowToFeature, rowsToCollection, saveCloudPlaceToCollection, seedCloudPlaces } from "../src/services/supabasePlaces.js";

const placeTypes = [{ id: "other" }];

const point = {
  type: "Feature",
  id: "point-1",
  geometry: { type: "Point", coordinates: [118.25, 33.9] },
  properties: { id: "point-1", source: "user", name: "测试点", type: "other", address: "地址", custom: "保留" },
};

test("maps Point GeoJSON to a place row without changing coordinate order", () => {
  const row = featureToPlaceRow(point, "owner-1");
  assert.equal(row.owner_id, "owner-1");
  assert.deepEqual([row.longitude, row.latitude], [118.25, 33.9]);
  assert.deepEqual(row.geometry.coordinates, [118.25, 33.9]);
  assert.equal(row.properties.custom, "保留");
});

test("round-trips Polygon geometry and required properties", () => {
  const polygon = {
    ...point,
    id: "area-1",
    geometry: { type: "Polygon", coordinates: [[[118, 34], [118.2, 34], [118.2, 34.2], [118, 34]]] },
    properties: { ...point.properties, id: "area-1", name: "测试区域" },
  };
  const row = { ...featureToPlaceRow(polygon, "owner-1"), created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
  const restored = placeRowToFeature(row);
  assert.deepEqual(restored.geometry, polygon.geometry);
  assert.equal(restored.id, restored.properties.id);
  assert.equal(restored.properties.source, "user");
  assert.equal(restored.properties.custom, "保留");
  assert.ok(Number.isFinite(restored.properties.longitude));
  assert.equal(rowsToCollection([row], placeTypes).features.length, 1);
});

test("uses the owner-scoped conflict target when two owners seed the same ids", async () => {
  const calls = [];
  const client = {
    from: () => ({
      upsert(payload, options) {
        calls.push({ payload, options });
        return { select: async () => ({ data: payload, error: null }) };
      },
    }),
  };

  await seedCloudPlaces(client, [point], "owner-1");
  await seedCloudPlaces(client, [point], "owner-2");

  assert.deepEqual(calls.map(({ options }) => options), [
    { onConflict: "owner_id,id" },
    { onConflict: "owner_id,id" },
  ]);
  assert.deepEqual(calls.map(({ payload }) => [payload[0].owner_id, payload[0].id]), [
    ["owner-1", "point-1"],
    ["owner-2", "point-1"],
  ]);
});

test("maps reads and deletes to the current owner in addition to RLS", async () => {
  const filters = [];
  const client = { from: () => ({
    select: () => ({ eq(field, value) { filters.push(["read", field, value]); return this; }, order: async () => ({ data: [], error: null }) }),
    delete: () => ({ eq(field, value) { filters.push(["delete", field, value]); return this; }, select: async () => ({ data: [{ id: "point-1" }], error: null }) }),
  }) };
  await fetchCloudPlaces(client, "owner-a");
  await deleteCloudPlace(client, "point-1", "owner-a");
  assert.deepEqual(filters, [
    ["read", "owner_id", "owner-a"],
    ["delete", "owner_id", "owner-a"],
    ["delete", "id", "point-1"],
  ]);
});

test("reports every failed image restore path when the place delete also fails", async () => {
  const uploads = [];
  const imageRows = [
    { storage_path: "owner-a/point-1/one.webp", mime_type: "image/webp" },
    { storage_path: "owner-a/point-1/two.jpg", mime_type: "image/jpeg" },
  ];
  const imageQuery = {
    eq() { return this; },
    then(resolve) { return Promise.resolve(resolve({ data: imageRows, error: null })); },
  };
  const client = {
    from: (table) => table === "place_images" ? { select: () => imageQuery } : {
      delete: () => ({ eq() { return this; }, select: async () => ({ data: null, error: { message: "database unavailable" } }) }),
    },
    storage: { from: () => ({
      list: async () => ({ data: [], error: null }),
      download: async () => ({ data: new Blob(["backup"], { type: "image/webp" }), error: null }),
      remove: async () => ({ error: null }),
      upload: async (path) => {
        uploads.push(path);
        return { error: path.endsWith("one.webp") ? { message: "restore denied" } : null };
      },
    }) },
  };

  await assert.rejects(deleteCloudPlace(client, "point-1", "owner-a"), (error) =>
    /云端删除失败：database unavailable.*地点图片恢复失败：restore denied/.test(error.message)
      && error.pendingCleanupPaths?.[0] === "owner-a/point-1/one.webp");
  assert.deepEqual(uploads, ["owner-a/point-1/one.webp", "owner-a/point-1/two.jpg"]);
});

test("deletes a place row only after its public and private image objects are cleaned", async () => {
  const events = [];
  const imageRows = [{ id: "image-1", storage_path: "owner-a/point-1/image-1.jpg", mime_type: "image/jpeg" }];
  const imageQuery = { eq() { return this; }, then(resolve) { return Promise.resolve(resolve({ data: imageRows, error: null })); } };
  const listTree = {
    "owner-a": [{ name: "release", id: null }],
    "owner-a/release": [{ name: "point-1", id: null }],
    "owner-a/release/point-1": [{ name: "image-1.webp", id: "stored" }],
  };
  const client = {
    from: (table) => table === "place_images" ? { select: () => imageQuery } : {
      delete: () => ({ eq() { return this; }, select: async () => { events.push("place-delete"); return { data: [{ id: "point-1" }], error: null }; } }),
    },
    storage: { from: (bucket) => ({
      list: async (prefix) => ({ data: listTree[prefix] ?? [], error: null }),
      download: async () => ({ data: new Blob([bucket]), error: null }),
      remove: async () => { events.push(`${bucket}-remove`); return { error: null }; },
      upload: async () => ({ error: null }),
    }) },
  };

  await deleteCloudPlace(client, "point-1", "owner-a");
  assert.deepEqual(events, ["published-place-images-remove", "place-images-remove", "place-delete"]);
});

test("does not delete the place or metadata when public image cleanup fails", async () => {
  let placeDeleteCalls = 0;
  const rows = [{ id: "image-1", storage_path: "owner-a/point-1/image-1.jpg", mime_type: "image/jpeg" }];
  const query = { eq() { return this; }, then(resolve) { return Promise.resolve(resolve({ data: rows, error: null })); } };
  const client = {
    from: (table) => table === "place_images" ? { select: () => query } : {
      delete: () => { placeDeleteCalls += 1; return { eq() { return this; }, select: async () => ({ data: [], error: null }) }; },
    },
    storage: { from: (bucket) => ({
      list: async (prefix) => ({ data: prefix === "owner-a" ? [{ name: "release", id: null }] : prefix === "owner-a/release" ? [{ name: "point-1", id: null }] : [{ name: "image-1.webp", id: "stored" }], error: null }),
      download: async () => ({ data: new Blob([bucket]), error: null }),
      remove: async () => ({ error: bucket === "published-place-images" ? { message: "remove denied" } : null }),
      upload: async () => ({ error: null }),
    }) },
  };

  await assert.rejects(deleteCloudPlace(client, "point-1", "owner-a"), (error) =>
    /请重试.*人工清理/.test(error.message)
      && error.pendingCleanupPaths.includes("owner-a/release/point-1/image-1.webp"));
  assert.equal(placeDeleteCalls, 0);
});

test("isolates an invalid cloud row while retaining valid rows", () => {
  const validRow = featureToPlaceRow(point, "owner-1");
  const invalidRow = {
    ...validRow,
    id: "bad-point",
    geometry: { type: "Point", coordinates: [999, 33.9] },
    properties: { ...validRow.properties, id: "bad-point" },
  };
  const issues = [];

  const collection = rowsToCollection([validRow, invalidRow], placeTypes, (issue) => issues.push(issue));

  assert.deepEqual(collection.features.map(({ id }) => id), ["point-1"]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].index, 1);
  assert.match(issues[0].error.message, /WGS84/);
  assert.equal(issues[0].id, "bad-point");
  assert.match(issues[0].reason, /WGS84/);
});

test("rejects cloud rows whose raw required properties do not match columns", () => {
  const validRow = featureToPlaceRow(point, "owner-1");
  const invalidRows = [
    { ...validRow, properties: { ...validRow.properties, id: "old-id" } },
    { ...validRow, id: "bad-source", properties: { ...validRow.properties, id: "bad-source", source: "import" } },
    { ...validRow, id: "bad-name", properties: { ...validRow.properties, id: "bad-name", name: "旧名称" } },
    { ...validRow, id: "bad-type", properties: { ...validRow.properties, id: "bad-type", type: "legacy" } },
  ];
  const issues = [];

  const collection = rowsToCollection([validRow, ...invalidRows], placeTypes, (issue) => issues.push(issue));

  assert.deepEqual(collection.features.map(({ id }) => id), ["point-1"]);
  assert.equal(issues.length, 4);
  assert.match(issues[0].reason, /properties\.id/);
  assert.match(issues[1].reason, /properties\.source/);
  assert.match(issues[2].reason, /properties\.name/);
  assert.match(issues[3].reason, /properties\.type/);
  assert.throws(() => placeRowToFeature(invalidRows[0]), /properties\.id/);
});

test("uses the owner-scoped conflict target for saves and leaves caller state unchanged on failure", async () => {
  const collection = { type: "FeatureCollection", features: [structuredClone(point)] };
  const before = structuredClone(collection);
  let conflictTarget;
  const client = {
    from: () => ({
      upsert(_payload, options) {
        conflictTarget = options;
        return {
          select: () => ({
            single: async () => ({ data: null, error: { message: "network down" } }),
          }),
        };
      },
    }),
  };

  await assert.rejects(saveCloudPlaceToCollection(client, collection, point, "owner-1"), /云端保存失败：network down/);
  assert.deepEqual(conflictTarget, { onConflict: "owner_id,id" });
  assert.deepEqual(collection, before);
});
