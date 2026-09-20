export const DRAFT_KEY = "sn-map.places-draft.v1";
export const SYNC_BASELINE_KEY = "sn-map.places-sync-baseline.v1";
export const CLOUD_SEED_KEY_PREFIX = "sn-map.supabase-seeded.v1.";
export const LEGACY_MIGRATED_KEY = "sn-map.places-legacy-migrated.v1";

function ownerKey(key, ownerId, mapId = "suining") {
  if (!ownerId || !mapId) throw new Error("本地数据缺少 owner 或 map 标识");
  return `${key}.${ownerId}.${mapId}`;
}

export function readDraft(ownerId, storage = localStorage, mapId = "suining") {
  // ai coding：草稿与文件同步基线按 Supabase owner + map 双重分区。
  const value = storage.getItem(ownerKey(DRAFT_KEY, ownerId, mapId));
  return value ? JSON.parse(value) : null;
}

export function writeDraft(ownerId, places, storage = localStorage, mapId = "suining") {
  storage.setItem(ownerKey(DRAFT_KEY, ownerId, mapId), JSON.stringify(places));
}

export function readSyncBaseline(ownerId, storage = localStorage, mapId = "suining") {
  const value = storage.getItem(ownerKey(SYNC_BASELINE_KEY, ownerId, mapId));
  return value ? JSON.parse(value) : null;
}

export function writeSyncBaseline(ownerId, places, storage = localStorage, mapId = "suining") {
  storage.setItem(ownerKey(SYNC_BASELINE_KEY, ownerId, mapId), JSON.stringify(places));
}

export function migrateLegacyPlacesStorage(ownerId, storage = localStorage) {
  if (!ownerId || storage.getItem(LEGACY_MIGRATED_KEY)) return false;
  const legacyDraft = storage.getItem(DRAFT_KEY);
  const legacyBaseline = storage.getItem(SYNC_BASELINE_KEY);

  // ai coding：无 owner 的旧数据只能由本浏览器遇到的第一个真实 owner 一次性认领，随后永久关闭全局回退。
  if (legacyDraft !== null && storage.getItem(ownerKey(DRAFT_KEY, ownerId, "suining")) === null)
    storage.setItem(ownerKey(DRAFT_KEY, ownerId, "suining"), legacyDraft);
  if (legacyBaseline !== null && storage.getItem(ownerKey(SYNC_BASELINE_KEY, ownerId, "suining")) === null)
    storage.setItem(ownerKey(SYNC_BASELINE_KEY, ownerId, "suining"), legacyBaseline);
  storage.removeItem(DRAFT_KEY);
  storage.removeItem(SYNC_BASELINE_KEY);
  storage.setItem(LEGACY_MIGRATED_KEY, ownerId);
  return true;
}

export function hasSeededCloud(ownerId, storage = localStorage, mapId = "suining") {
  return storage.getItem(`${CLOUD_SEED_KEY_PREFIX}${ownerId}.${mapId}`) === "true";
}

export function markCloudSeeded(ownerId, storage = localStorage, mapId = "suining") {
  storage.setItem(`${CLOUD_SEED_KEY_PREFIX}${ownerId}.${mapId}`, "true");
}
