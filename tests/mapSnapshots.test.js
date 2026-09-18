import test from "node:test";
import assert from "node:assert/strict";
import { createShareToken, fetchPublicSnapshot, publishSnapshot, shareTokenForOwner, snapshotForOwner, snapshotRow } from "../src/services/mapSnapshots.js";

const collection = { type: "FeatureCollection", features: [{ type: "Feature", id: "a" }] };

test("creates URL-safe tokens and clones the published collection", () => {
  assert.equal(createShareToken(() => "12345678-1234-1234-1234-123456789abc"), "12345678123412341234123456789abc");
  const row = snapshotRow("owner-a", " 地图 ", collection, "a".repeat(32));
  collection.features[0].id = "changed";
  assert.equal(row.owner_id, "owner-a");
  assert.equal(row.title, "地图");
  assert.equal(row.snapshot.features[0].id, "a");
  assert.equal(row.is_public, true);
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

test("public reads require a valid token and is_public=true", async () => {
  const filters = [];
  const query = { eq(field, value) { filters.push([field, value]); return this; }, maybeSingle: async () => ({ data: null, error: null }) };
  const client = { from: () => ({ select: () => query }) };
  assert.equal(await fetchPublicSnapshot(client, "invalid"), null);
  await fetchPublicSnapshot(client, "t".repeat(32));
  assert.deepEqual(filters, [["share_token", "t".repeat(32)], ["is_public", true]]);
});

test("reports a missing migration without crashing", async () => {
  const query = { eq() { return this; }, maybeSingle: async () => ({ data: null, error: { code: "PGRST205", message: "missing" } }) };
  await assert.rejects(fetchPublicSnapshot({ from: () => ({ select: () => query }) }, "t".repeat(32)), /migration 003/);
});
