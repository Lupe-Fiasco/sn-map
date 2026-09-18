import test from "node:test";
import assert from "node:assert/strict";
import { DRAFT_KEY, LEGACY_MIGRATED_KEY, SYNC_BASELINE_KEY, migrateLegacyPlacesStorage, readDraft, readSyncBaseline, writeDraft, writeSyncBaseline } from "../src/services/storage.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("keeps drafts and sync baselines isolated by owner", () => {
  const storage = memoryStorage();
  const ownerA = { type: "FeatureCollection", features: [{ id: "a" }] };
  const ownerB = { type: "FeatureCollection", features: [{ id: "b" }] };
  writeDraft("owner-a", ownerA, storage); writeDraft("owner-b", ownerB, storage);
  writeSyncBaseline("owner-a", ownerB, storage); writeSyncBaseline("owner-b", ownerA, storage);
  assert.deepEqual(readDraft("owner-a", storage), ownerA);
  assert.deepEqual(readDraft("owner-b", storage), ownerB);
  assert.deepEqual(readSyncBaseline("owner-a", storage), ownerB);
  assert.deepEqual(readSyncBaseline("owner-b", storage), ownerA);
  assert.throws(() => readDraft("", storage), /owner/);
});

test("legacy draft and baseline are claimed once by the first owner", () => {
  const storage = memoryStorage();
  const legacyDraft = { type: "FeatureCollection", features: [{ id: "legacy" }] };
  const legacyBaseline = { type: "FeatureCollection", features: [] };
  storage.setItem(DRAFT_KEY, JSON.stringify(legacyDraft));
  storage.setItem(SYNC_BASELINE_KEY, JSON.stringify(legacyBaseline));

  assert.equal(migrateLegacyPlacesStorage("owner-a", storage), true);
  assert.deepEqual(readDraft("owner-a", storage), legacyDraft);
  assert.deepEqual(readSyncBaseline("owner-a", storage), legacyBaseline);
  assert.equal(storage.getItem(DRAFT_KEY), null);
  assert.equal(storage.getItem(SYNC_BASELINE_KEY), null);
  assert.equal(storage.getItem(LEGACY_MIGRATED_KEY), "owner-a");

  storage.setItem(DRAFT_KEY, JSON.stringify({ type: "FeatureCollection", features: [{ id: "late" }] }));
  assert.equal(migrateLegacyPlacesStorage("owner-b", storage), false);
  assert.equal(readDraft("owner-b", storage), null);
});
