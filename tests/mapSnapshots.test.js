import test from "node:test";
import assert from "node:assert/strict";
import {
  createPublicSnapshot, createShareToken, fetchPublicSnapshot, publicPlaceDetails,
  publicFields, publishSnapshot, sanitizePublicSnapshot, shareTokenForOwner, snapshotForOwner,
  snapshotRow, SNAPSHOT_PRESETS,
} from "../src/services/mapSnapshots.js";

const point = {
  type: "Feature", id: "a", geometry: { type: "Point", coordinates: [117.9, 33.9] },
  properties: { id: "a", name: "测试点", type: "school", description: "内部备注", source: "user", owner_id: "secret" },
};
const polygon = {
  type: "Feature", id: "b", geometry: { type: "Polygon", coordinates: [[[117, 33], [118, 33], [118, 34], [117, 33]]] },
  properties: { id: "b", name: "测试区域", type: "park", longitude: 117.6, latitude: 33.4, description: "区域备注", source: "user" },
};
const collection = { type: "FeatureCollection", features: [point, polygon] };

test("creates URL-safe tokens and clones the published collection", () => {
  assert.equal(createShareToken(() => "12345678-1234-1234-1234-123456789abc"), "12345678123412341234123456789abc");
  const input = structuredClone(collection);
  const row = snapshotRow("owner-a", " 地图 ", input, "a".repeat(32));
  input.features[0].geometry.coordinates[0] = 0;
  assert.equal(row.owner_id, "owner-a");
  assert.equal(row.title, "地图");
  assert.equal(row.snapshot.features[0].id, "a");
  assert.deepEqual(row.public_fields, ["name"]);
  assert.deepEqual(row.snapshot.features[0].geometry.coordinates, [117.9, 33.9]);
  assert.equal(row.is_public, true);
});

test("records only the selected public field whitelist", () => {
  assert.deepEqual(publicFields(SNAPSHOT_PRESETS.map), ["name"]);
  assert.deepEqual(publicFields({ type: true, coordinates: false, description: true }), ["name", "type", "notes"]);
  assert.deepEqual(snapshotRow("owner-a", "地图", collection, "a".repeat(32), SNAPSHOT_PRESETS.basic).public_fields,
    ["name", "type", "coordinates"]);
});

test("public snapshot presets retain geometry and only selected properties", () => {
  const mapOnly = createPublicSnapshot(collection, SNAPSHOT_PRESETS.map);
  assert.deepEqual(Object.keys(mapOnly.features[0].properties).sort(), ["id", "name"]);
  assert.deepEqual(mapOnly.features[1].geometry, polygon.geometry);
  assert.equal(JSON.stringify(mapOnly).includes("secret"), false);
  assert.equal(JSON.stringify(mapOnly).includes("内部备注"), false);

  const basic = createPublicSnapshot(collection, SNAPSHOT_PRESETS.basic);
  assert.deepEqual(basic.features[0].properties, { id: "a", name: "测试点", type: "school", longitude: 117.9, latitude: 33.9 });
  assert.equal(Object.hasOwn(basic.features[0].properties, "description"), false);
  assert.equal(basic.features[1].properties.longitude, 117.6);
  assert.deepEqual(basic.features[1].geometry, polygon.geometry);

  const detailed = createPublicSnapshot(collection, SNAPSHOT_PRESETS.detailed);
  assert.equal(detailed.features[0].properties.description, "内部备注");
  assert.equal(detailed.features[1].properties.description, "区域备注");
});

test("published Polygon coordinates fall back to the representative center", () => {
  const withoutCenter = structuredClone(polygon);
  delete withoutCenter.properties.longitude;
  delete withoutCenter.properties.latitude;
  const snapshot = createPublicSnapshot({ type: "FeatureCollection", features: [withoutCenter] }, SNAPSHOT_PRESETS.basic);
  assert.ok(Number.isFinite(snapshot.features[0].properties.longitude));
  assert.ok(Number.isFinite(snapshot.features[0].properties.latitude));
  assert.deepEqual(
    [snapshot.features[0].properties.longitude, snapshot.features[0].properties.latitude],
    [117.66666666666667, 33.333333333333336],
  );
});

test("custom disclosure excludes unchecked type, coordinates, and description", () => {
  const snapshot = createPublicSnapshot(collection, { type: false, coordinates: false, description: false });
  for (const feature of snapshot.features) {
    assert.equal(Object.hasOwn(feature.properties, "type"), false);
    assert.equal(Object.hasOwn(feature.properties, "longitude"), false);
    assert.equal(Object.hasOwn(feature.properties, "latitude"), false);
    assert.equal(Object.hasOwn(feature.properties, "description"), false);
  }
});

test("public details use only published fields and legacy snapshots default to map-only", () => {
  const published = createPublicSnapshot(collection, { type: true, coordinates: false, description: true });
  assert.deepEqual(publicPlaceDetails(published.features[0], [{ id: "school", name: "学校" }]), {
    name: "测试点", type: "学校", coordinates: "", description: "内部备注",
  });
  const basic = createPublicSnapshot(collection, SNAPSHOT_PRESETS.basic);
  assert.equal(publicPlaceDetails(basic.features[1], [{ id: "park", name: "公园" }]).coordinates, "117.600000, 33.400000");
  const legacy = sanitizePublicSnapshot(collection);
  assert.deepEqual(publicPlaceDetails(legacy.features[0]), { name: "测试点", type: "", coordinates: "", description: "" });
});

test("owner switching hides the previous owner's snapshot and prevents using its share token", () => {
  const previousSnapshot = {
    owner_id: "owner-a",
    share_token: "a".repeat(32),
    is_public: true,
  };

  assert.equal(snapshotForOwner(previousSnapshot, "owner-a"), previousSnapshot);
  assert.equal(shareTokenForOwner(previousSnapshot, "owner-a"), "a".repeat(32));
  assert.equal(snapshotForOwner(previousSnapshot, "owner-b"), null);
  assert.equal(shareTokenForOwner(previousSnapshot, "owner-b"), "");
  assert.equal(shareTokenForOwner(previousSnapshot, null), "");
});

test("publishes with an owner-scoped upsert and retains an existing token", async () => {
  const calls = [];
  const client = { from: () => ({
    select: () => ({ eq: (_field, owner) => ({ maybeSingle: async () => ({ data: { owner_id: owner, share_token: "x".repeat(32) }, error: null }) }) }),
    upsert: (payload, options) => { calls.push({ payload, options }); return { select: () => ({ single: async () => ({ data: payload, error: null }) }) }; },
  }) };
  const row = await publishSnapshot(client, "owner-a", "地图", collection);
  assert.equal(row.share_token, "x".repeat(32));
  assert.equal(calls[0].payload.owner_id, "owner-a");
  assert.deepEqual(calls[0].options, { onConflict: "owner_id" });
});

test("public reads use only the secure RPC and reject invalid or unknown tokens", async () => {
  const calls = [];
  const query = { maybeSingle: async () => ({ data: null, error: null }) };
  const client = { rpc(name, parameters) { calls.push([name, parameters]); return query; } };
  assert.equal(await fetchPublicSnapshot(client, "invalid"), null);
  assert.equal(await fetchPublicSnapshot(client, "t".repeat(32)), null);
  assert.deepEqual(calls, [["get_public_map_snapshot", { p_share_token: "t".repeat(32) }]]);
});

test("reports a missing migration without crashing", async () => {
  const query = { maybeSingle: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) };
  await assert.rejects(fetchPublicSnapshot({ rpc: () => query }, "t".repeat(32)), /migration 004/);
});
