import test from "node:test";
import assert from "node:assert/strict";
import {
  createPublicSnapshot, createShareToken, fetchPublicSnapshot, publicPlaceDetails,
  publicationFields, publicationLevel, publicFields, publishSnapshot, sanitizePublicSnapshot, selectedFields, shareTokenForOwner, snapshotDisclosure, snapshotForOwner, snapshotNeedsRepublish, unpublishSnapshot,
  snapshotRow, SNAPSHOT_PRESETS,
} from "../src/services/mapSnapshots.js";

const point = {
  type: "Feature", id: "a", geometry: { type: "Point", coordinates: [117.9, 33.9] },
  properties: { id: "a", name: "测试点", type: "school", description: "内部备注", address: "测试路 1 号", phone: "123", website: "https://example.test", opening_hours: "08:00-18:00", source: "user", owner_id: "secret" },
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
  assert.deepEqual(row.public_fields, ["name", "type", "coordinates"]);
  assert.deepEqual(row.snapshot.features[0].geometry.coordinates, [117.9, 33.9]);
  assert.equal(row.is_public, true);
});

test("maps the three fixed levels to an incremental public field whitelist", () => {
  assert.deepEqual(publicFields("basic"), ["name", "type", "coordinates"]);
  assert.deepEqual(publicFields("details"), ["name", "type", "coordinates", "notes"]);
  assert.deepEqual(publicFields("images"), ["name", "type", "coordinates", "notes", "images"]);
  assert.deepEqual(snapshotRow("owner-a", "地图", collection, "a".repeat(32), "basic").public_fields,
    ["name", "type", "coordinates"]);
  assert.equal(snapshotRow("owner-a", "地图", collection, "a".repeat(32), "details").publication_level, "details");
});

test("service accepts only the three exact publication levels", () => {
  assert.deepEqual(publicationFields("basic"), SNAPSHOT_PRESETS.basic);
  assert.deepEqual(publicationFields("details"), SNAPSHOT_PRESETS.details);
  assert.deepEqual(publicationFields("images"), SNAPSHOT_PRESETS.images);
  assert.throws(() => publicationFields("unknown"), /级别无效/);
  assert.throws(() => publicationFields({ images: true }), /级别无效/);
});

test("public snapshot presets retain geometry and only selected properties", () => {
  const basic = createPublicSnapshot(collection, SNAPSHOT_PRESETS.basic);
  assert.deepEqual(basic.features[0].properties, { id: "a", name: "测试点", type: "school", longitude: 117.9, latitude: 33.9 });
  assert.equal(Object.hasOwn(basic.features[0].properties, "description"), false);
  assert.equal(basic.features[1].properties.longitude, 117.6);
  assert.deepEqual(basic.features[1].geometry, polygon.geometry);

  const detailed = createPublicSnapshot(collection, SNAPSHOT_PRESETS.details);
  assert.equal(detailed.features[0].properties.description, "内部备注");
  assert.equal(detailed.features[0].properties.address, "测试路 1 号");
  assert.equal(detailed.features[0].properties.phone, "123");
  assert.equal(detailed.features[0].properties.website, "https://example.test");
  assert.equal(detailed.features[0].properties.opening_hours, "08:00-18:00");
  assert.equal(detailed.features[1].properties.description, "区域备注");
  assert.equal(JSON.stringify(detailed).includes("secret"), false);
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

test("fixed levels never allow type or coordinates to be removed", () => {
  assert.equal(publicationLevel(SNAPSHOT_PRESETS.basic), "basic");
  const snapshot = createPublicSnapshot(collection, publicationFields("basic"));
  assert.equal(snapshot.features.every((feature) => feature.properties.type && Number.isFinite(feature.properties.longitude) && Number.isFinite(feature.properties.latitude)), true);
});

test("empty disclosure states are null-safe and keep the basic form default available", () => {
  assert.deepEqual(selectedFields(null), { type: false, coordinates: false, description: false, images: false });
  assert.equal(publicationLevel(null), null);
  assert.equal(snapshotDisclosure(null), null);
  assert.equal(snapshotDisclosure(undefined), null);
  assert.equal(snapshotDisclosure({}), null);
  assert.equal(publicationLevel(snapshotDisclosure(null) ?? SNAPSHOT_PRESETS.basic), "basic");
});

test("version 1 snapshots prefer row metadata and otherwise infer without widening fields", () => {
  const legacy = createPublicSnapshot(collection, SNAPSHOT_PRESETS.basic);
  legacy.publicDisclosure = { version: 1, fields: SNAPSHOT_PRESETS.basic };
  const row = {
    snapshot: legacy,
    publication_level: "details",
    public_fields: ["name", "type", "coordinates", "notes"],
  };
  assert.equal(publicationLevel(snapshotDisclosure(legacy, row)), "details");
  assert.equal(snapshotNeedsRepublish(legacy), true);

  const inferred = snapshotDisclosure(legacy, {
    public_fields: ["name", "type", "coordinates", "notes"],
  });
  assert.equal(publicationLevel(inferred), "details");
  assert.equal(publicationLevel(snapshotDisclosure(legacy, {
    public_fields: ["name", "type", "coordinates"],
  })), "basic");
  assert.equal(publicationLevel(snapshotDisclosure(legacy, {
    public_fields: ["name", "type", "coordinates", "notes", "images"],
  })), "images");
  const narrow = snapshotDisclosure(legacy, { public_fields: ["name", "type"] });
  assert.deepEqual(narrow, { type: true, coordinates: false, description: false, images: false });
  assert.equal(publicationLevel(narrow), null);
});

test("public details use only published fields and legacy snapshots default to map-only", () => {
  const published = createPublicSnapshot(collection, SNAPSHOT_PRESETS.details);
  assert.deepEqual(publicPlaceDetails(published.features[0], [{ id: "school", name: "学校" }]), {
    name: "测试点", type: "学校", coordinates: "117.900000, 33.900000", description: "内部备注", notes: "", address: "测试路 1 号", phone: "123", website: "https://example.test", opening_hours: "08:00-18:00", images: [],
  });
  const basic = createPublicSnapshot(collection, SNAPSHOT_PRESETS.basic);
  assert.equal(publicPlaceDetails(basic.features[1], [{ id: "park", name: "公园" }]).coordinates, "117.600000, 33.400000");
  const legacy = sanitizePublicSnapshot(collection);
  assert.deepEqual(publicPlaceDetails(legacy.features[0]), { name: "测试点", type: "", coordinates: "", description: "", notes: "", address: "", phone: "", website: "", opening_hours: "", images: [] });
});

test("reading a historical snapshot never expands its original disclosure", () => {
  const historical = createPublicSnapshot(collection, { type: true, coordinates: false, description: false, images: false });
  historical.publicDisclosure.version = 2;
  const sanitized = sanitizePublicSnapshot(historical);
  assert.equal(sanitized.features[0].properties.type, "school");
  assert.equal(Object.hasOwn(sanitized.features[0].properties, "longitude"), false);
  assert.equal(Object.hasOwn(sanitized.features[0].properties, "description"), false);
  assert.equal(publicationLevel(snapshotDisclosure(historical)), null);
});

test("publishes allowlisted images for Point and Polygon only when explicitly selected", () => {
  const images = {
    a: [{ id: "image-a", public_path: "owner/release/a/image-a.webp", alt_text: "校门", url: "https://evil.example/a.webp" }],
    b: [{ id: "image-b", public_path: "owner/release/b/image-b.webp", alt_text: "公园区域", owner_id: "secret" }],
  };
  const hidden = createPublicSnapshot(collection, SNAPSHOT_PRESETS.details, images);
  assert.equal(hidden.features.some((feature) => Object.hasOwn(feature.properties, "images")), false);
  const shown = createPublicSnapshot(collection, SNAPSHOT_PRESETS.images, images);
  assert.deepEqual(shown.features[0].properties.images, [{ id: "image-a", public_path: "owner/release/a/image-a.webp", alt_text: "校门" }]);
  assert.deepEqual(shown.features[1].properties.images, [{ id: "image-b", public_path: "owner/release/b/image-b.webp", alt_text: "公园区域" }]);
  assert.equal(JSON.stringify(shown).includes("evil.example"), false);
  assert.equal(JSON.stringify(shown).includes("storage_path"), false);
  assert.equal(JSON.stringify(shown).includes("owner_id"), false);
  assert.deepEqual(publicFields("images"), ["name", "type", "coordinates", "notes", "images"]);
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
  assert.equal(publicationLevel(snapshotDisclosure(snapshotForOwner(previousSnapshot, "owner-b")?.snapshot) ?? SNAPSHOT_PRESETS.basic), "basic");
});

test("republishes a legacy row through one complete legal level upgrade", async () => {
  const calls = [];
  const client = { from: () => ({
    select: () => ({ eq: (_field, owner) => ({ maybeSingle: async () => ({ data: { owner_id: owner, share_token: "x".repeat(32), publication_level: null, public_fields: ["name", "notes"] }, error: null }) }) }),
    upsert: (payload, options) => { calls.push({ payload, options }); return { select: () => ({ single: async () => ({ data: payload, error: null }) }) }; },
  }) };
  const row = await publishSnapshot(client, "owner-a", "地图", collection);
  assert.equal(row.share_token, "x".repeat(32));
  assert.equal(calls[0].payload.owner_id, "owner-a");
  assert.equal(calls[0].payload.publication_level, "basic");
  assert.deepEqual(calls[0].payload.public_fields, ["name", "type", "coordinates"]);
  assert.equal(calls[0].payload.is_public, true);
  assert.equal(calls[0].payload.snapshot.type, "FeatureCollection");
  assert.deepEqual(calls[0].options, { onConflict: "owner_id" });
});

test("anonymous or unapproved callers cannot publish images", async () => {
  const sources = [];
  const client = { from: (source) => {
    sources.push(source);
    if (source === "place_images") throw new Error("private images must not be queried");
    return {
      select: () => ({ eq: (_field, owner) => ({ maybeSingle: async () => ({ data: { owner_id: owner, share_token: "x".repeat(32) }, error: null }) }) }),
      upsert: (payload) => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }),
    };
  } };
  await assert.rejects(publishSnapshot(client, "owner-a", "地图", collection, "images"), /不能发布实景图片/);
  await assert.rejects(publishSnapshot(client, "owner-a", "地图", collection, { images: true }, { images: true }), /级别无效/);
  assert.deepEqual(sources, []);
});

test("snapshot upsert failure reports public files left behind when rollback removal fails", async () => {
  const paths = ["owner-a/token/release/place/image.webp"];
  const client = {
    from: (source) => source === "place_images" ? {
      select: () => ({ eq: () => ({ in: () => ({ order() { return this; }, then(resolve) { return Promise.resolve(resolve({ data: [], error: null })); } }) }) }),
    } : {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "upsert failed" } }) }) }),
    },
    storage: { from: () => ({ remove: async () => ({ error: { message: "remove failed" } }) }) },
  };
  await assert.rejects(
    publishSnapshot(client, "owner-a", "地图", collection, "images", {
      images: true,
      copyImages: async () => ({ imagesByPlace: {}, uploadedPaths: paths }),
    }),
    (error) => /upsert failed.*回滚失败.*remove failed/.test(error.message) && error.pendingCleanupPaths === paths,
  );
});

test("unpublishing a legacy row changes only is_public before cleanup", async () => {
  const calls = [];
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: "owner-a", share_token: "token", publication_level: null, public_fields: ["name", "notes"] }, error: null }) }) }),
      update: (payload) => { calls.push(payload); return { eq: () => ({ select: () => ({ single: async () => ({ data: { owner_id: "owner-a", is_public: false }, error: null }) }) }) }; },
    }),
    storage: { from: () => ({
      list: async () => ({ data: [{ id: "file", name: "release/place/image.webp" }], error: null }),
      remove: async () => ({ error: { message: "remove failed" } }),
    }) },
  };
  const row = await unpublishSnapshot(client, "owner-a");
  assert.deepEqual(calls, [{ is_public: false }]);
  assert.equal(row.is_public, false);
  assert.match(row.cleanupWarning, /公开已撤销.*无法绝对收回/);
  assert.deepEqual(row.pendingCleanupPaths, ["owner-a/release/place/image.webp"]);
});

test("public reads use only the secure RPC and reject invalid or unknown tokens", async () => {
  const calls = [];
  const query = { maybeSingle: async () => ({ data: null, error: null }) };
  const client = { rpc(name, parameters) { calls.push([name, parameters]); return query; } };
  assert.equal(await fetchPublicSnapshot(client, "invalid"), null);
  assert.equal(await fetchPublicSnapshot(client, "t".repeat(32)), null);
  assert.deepEqual(calls, [["get_public_map_snapshot", { p_share_token: "t".repeat(32) }]]);
});

test("public reads resolve only RPC-built published bucket paths against the configured Supabase host", async () => {
  const data = { snapshot: { type: "FeatureCollection", features: [{ properties: { images: [
    { id: "safe", url: "/storage/v1/object/public/published-place-images/owner/release/place/safe.webp", alt_text: "安全图片" },
    { id: "external", url: "https://evil.example/image.webp" },
  ] } }] } };
  const client = {
    supabaseUrl: "https://project.supabase.co",
    rpc: () => ({ maybeSingle: async () => ({ data, error: null }) }),
  };
  const result = await fetchPublicSnapshot(client, "t".repeat(32));
  assert.deepEqual(result.snapshot.features[0].properties.images, [{
    id: "safe", url: "https://project.supabase.co/storage/v1/object/public/published-place-images/owner/release/place/safe.webp", alt_text: "安全图片",
  }]);
});

test("public reads retain only the RPC-provided matching map configuration", async () => {
  const mapConfig = { id: "xuhui", slug: "xuhui", name: "上海市徐汇区", bounds: {}, center: {}, base_roads_path: "/data/regions/xuhui/base-roads.geojson", seed_places_path: "/data/regions/xuhui/places.geojson", is_active: true };
  const client = { supabaseUrl: "https://project.supabase.co", rpc: () => ({ maybeSingle: async () => ({ data: { map_config: mapConfig, snapshot: { features: [] } }, error: null }) }) };
  assert.deepEqual((await fetchPublicSnapshot(client, "t".repeat(32))).map_config, mapConfig);
});

test("reports a missing migration without crashing", async () => {
  const query = { maybeSingle: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) };
  await assert.rejects(fetchPublicSnapshot({ rpc: () => query }, "t".repeat(32)), /migration 004/);
});
