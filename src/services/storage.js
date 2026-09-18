export const DRAFT_KEY = "sn-map.places-draft.v1";
export const SYNC_BASELINE_KEY = "sn-map.places-sync-baseline.v1";
export const CLOUD_SEED_KEY_PREFIX = "sn-map.supabase-seeded.v1.";
export const LEGACY_MIGRATED_KEY = "sn-map.places-legacy-migrated.v1";

function ownerKey(key, ownerId) {
  if (!ownerId) throw new Error("本地数据缺少 owner 标识");
  return `${key}.${ownerId}`;
}

export function readDraft(ownerId, storage = localStorage) {
  // ai coding：草稿与文件同步基线按 Supabase owner 分区，切换账号时不会读到其他用户的本地镜像。
  const value = storage.getItem(ownerKey(DRAFT_KEY, ownerId));
  return value ? JSON.parse(value) : null;
}

export function writeDraft(ownerId, places, storage = localStorage) {
  storage.setItem(ownerKey(DRAFT_KEY, ownerId), JSON.stringify(places));
}

export function readSyncBaseline(ownerId, storage = localStorage) {
  const value = storage.getItem(ownerKey(SYNC_BASELINE_KEY, ownerId));
  return value ? JSON.parse(value) : null;
}

export function writeSyncBaseline(ownerId, places, storage = localStorage) {
  storage.setItem(ownerKey(SYNC_BASELINE_KEY, ownerId), JSON.stringify(places));
}

export function migrateLegacyPlacesStorage(ownerId, storage = localStorage) {
  if (!ownerId || storage.getItem(LEGACY_MIGRATED_KEY)) return false;
  const legacyDraft = storage.getItem(DRAFT_KEY);
  const legacyBaseline = storage.getItem(SYNC_BASELINE_KEY);

  // ai coding：无 owner 的旧数据只能由本浏览器遇到的第一个真实 owner 一次性认领，随后永久关闭全局回退。
  if (legacyDraft !== null && storage.getItem(ownerKey(DRAFT_KEY, ownerId)) === null)
    storage.setItem(ownerKey(DRAFT_KEY, ownerId), legacyDraft);
  if (legacyBaseline !== null && storage.getItem(ownerKey(SYNC_BASELINE_KEY, ownerId)) === null)
    storage.setItem(ownerKey(SYNC_BASELINE_KEY, ownerId), legacyBaseline);
  storage.removeItem(DRAFT_KEY);
  storage.removeItem(SYNC_BASELINE_KEY);
  storage.setItem(LEGACY_MIGRATED_KEY, ownerId);
  return true;
}

export function hasSeededCloud(ownerId, storage = localStorage) {
  return storage.getItem(`${CLOUD_SEED_KEY_PREFIX}${ownerId}`) === "true";
}

export function markCloudSeeded(ownerId, storage = localStorage) {
  storage.setItem(`${CLOUD_SEED_KEY_PREFIX}${ownerId}`, "true");
}
