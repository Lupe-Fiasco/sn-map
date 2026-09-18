import { emptyCollection } from "./geojson.js";

export function createShareToken(randomUUID = () => crypto.randomUUID()) {
  return randomUUID().replaceAll("-", "");
}

export function snapshotRow(ownerId, title, collection, shareToken) {
  return {
    owner_id: ownerId,
    share_token: shareToken,
    title: title.trim() || "睢宁地点地图",
    snapshot: structuredClone(collection),
    is_public: true,
  };
}

// ai coding：快照及分享 token 必须与当前 owner 严格匹配，供渲染和复制共用同一判定。
export function snapshotForOwner(snapshot, ownerId) {
  return ownerId && snapshot?.owner_id === ownerId ? snapshot : null;
}

export function shareTokenForOwner(snapshot, ownerId) {
  const current = snapshotForOwner(snapshot, ownerId);
  return current?.is_public && current.share_token ? current.share_token : "";
}

function snapshotError(prefix, error) {
  const missing = error?.code === "42P01" || error?.code === "PGRST205" || /(could not find|relation).+map_snapshots/i.test(error?.message || "");
  return new Error(missing
    ? `${prefix}：公开快照功能尚未初始化，请先执行 migration 003`
    : `${prefix}：${error?.message || "云端请求失败"}`);
}

export async function fetchOwnerSnapshot(client, ownerId) {
  const { data, error } = await client.from("map_snapshots").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw snapshotError("公开状态读取失败", error);
  return data ?? null;
}

export async function publishSnapshot(client, ownerId, title, collection, randomUUID) {
  const existing = await fetchOwnerSnapshot(client, ownerId);
  const token = existing?.share_token || createShareToken(randomUUID);
  // ai coding：仅复制调用时的正式 FeatureCollection；后续地点编辑不会引用或改变已发布 JSON。
  const payload = snapshotRow(ownerId, title, collection, token);
  const { data, error } = await client.from("map_snapshots")
    .upsert(payload, { onConflict: "owner_id" }).select().single();
  if (error || !data) throw snapshotError("公开快照发布失败", error);
  return data;
}

export async function unpublishSnapshot(client, ownerId) {
  const { data, error } = await client.from("map_snapshots").update({ is_public: false })
    .eq("owner_id", ownerId).select().single();
  if (error || !data) throw snapshotError("取消公开失败", error);
  return data;
}

export async function fetchPublicSnapshot(client, token) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token || "")) return null;
  const { data, error } = await client.from("map_snapshots")
    .select("share_token,title,snapshot,updated_at").eq("share_token", token).eq("is_public", true).maybeSingle();
  if (error) throw snapshotError("公开快照读取失败", error);
  return data ?? null;
}

export function emptySnapshotCollection() {
  return emptyCollection();
}
