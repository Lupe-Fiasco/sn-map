export const PRIVATE_IMAGE_BUCKET = "place-images";
export const PUBLISHED_IMAGE_BUCKET = "published-place-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PUBLIC_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PUBLIC_IMAGE_DIMENSION = 2560;
export const PUBLIC_IMAGE_QUALITY = 0.86;
export const MAX_PUBLIC_SOURCE_PIXELS = 40_000_000;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function validateImageFile(file) {
  if (!file || !ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("仅支持 JPG、PNG 或 WebP 图片。");
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("图片文件为空或无法读取。");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 5MB。");
  return file;
}

export function assertOwnerPlacePath(ownerId, mapId, placeId, path) {
  if (path === undefined) { path = placeId; placeId = mapId; mapId = "suining"; }
  if (![ownerId, mapId, placeId].every((value) => typeof value === "string" && SAFE_SEGMENT.test(value))) throw new Error("图片归属信息无效。");
  const scoped = typeof path === "string" && path.startsWith(`${ownerId}/${mapId}/${placeId}/`) && path.split("/").length === 4;
  const legacySuining = mapId === "suining" && typeof path === "string" && path.startsWith(`${ownerId}/${placeId}/`) && path.split("/").length === 3;
  if (!scoped && !legacySuining) throw new Error("图片存储路径与当前地图或地点不匹配。");
  return path;
}

function extensionFor(type) {
  return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
}

function imageError(prefix, error) {
  const missing = ["42P01", "PGRST204", "PGRST205"].includes(error?.code) || /place_images/i.test(error?.message || "");
  return new Error(missing ? `${prefix}：实景图片功能尚未初始化，请先执行 migration 006` : `${prefix}：${error?.message || "云端请求失败"}`);
}

function cleanupError(prefix, error, paths) {
  const result = imageError(prefix, error);
  result.pendingCleanupPaths = [...paths];
  result.message += paths.length ? `；请重试，持续失败请人工清理：${paths.join("、")}` : "；请重试，持续失败请人工检查图片存储";
  return result;
}

// ai coding：公开副本只能使用解码后重新编码的 WebP；codec 可注入，使元数据剥离规则无需真实浏览器即可测试。
export async function reencodePublicImage(blob, codec = browserPublicImageCodec) {
  if (!blob || !ALLOWED_IMAGE_TYPES.has(blob.type)) throw new Error("公开图片处理失败：原图格式无效。");
  let output;
  try {
    output = await codec(blob, { maxDimension: MAX_PUBLIC_IMAGE_DIMENSION, quality: PUBLIC_IMAGE_QUALITY });
  } catch (error) {
    throw new Error(`公开图片处理失败，无法安全移除 EXIF/GPS 元数据：${error?.message || "重新编码失败"}`);
  }
  if (!output || output.type !== "image/webp" || !Number.isFinite(output.size) || output.size <= 0) {
    throw new Error("公开图片处理失败：未生成安全的 WebP 副本。");
  }
  if (output.size > MAX_PUBLIC_IMAGE_BYTES) throw new Error("公开图片处理失败：重新编码后的图片超过 5MB。请降低原图尺寸后重试。");
  return output;
}

export async function browserPublicImageCodec(blob, { maxDimension, quality }) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("当前浏览器不支持安全图片重新编码");
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    if (bitmap.width * bitmap.height > MAX_PUBLIC_SOURCE_PIXELS) throw new Error("图片解码尺寸超过 4000 万像素");
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建图片画布");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("浏览器未能生成 WebP")),
      "image/webp",
      quality,
    ));
  } finally {
    bitmap.close();
  }
}

export async function fetchPlaceImages(client, ownerId, mapId, placeId, signedSeconds = 600) {
  const { data, error } = await client.from("place_images").select("*").eq("owner_id", ownerId).eq("map_id", mapId).eq("place_id", placeId).order("sort_order").order("created_at");
  if (error) throw imageError("图片读取失败", error);
  return Promise.all((data ?? []).map(async (row) => {
    assertOwnerPlacePath(ownerId, mapId, placeId, row.storage_path);
    const { data: signed, error: signedError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).createSignedUrl(row.storage_path, signedSeconds);
    if (signedError || !signed?.signedUrl) throw imageError("图片预览生成失败", signedError);
    return { ...row, previewUrl: signed.signedUrl };
  }));
}

// ai coding：文件与元数据分步写入时执行补偿删除，浏览器只使用当前 session 和 publishable key。
export async function uploadPlaceImage(client, ownerId, mapId, placeId, file, randomUUID = () => crypto.randomUUID()) {
  validateImageFile(file);
  const id = randomUUID();
  const path = `${ownerId}/${mapId}/${placeId}/${id}.${extensionFor(file.type)}`;
  assertOwnerPlacePath(ownerId, mapId, placeId, path);
  const { error: uploadError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw imageError("图片上传失败", uploadError);
  const row = { id, owner_id: ownerId, map_id: mapId, place_id: placeId, storage_path: path, mime_type: file.type, size_bytes: file.size, alt_text: file.name.replace(/\.[^.]+$/, "").slice(0, 160), sort_order: 0 };
  const { data, error } = await client.from("place_images").insert(row).select().single();
  if (error || !data) {
    const { error: rollbackError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).remove([path]);
    if (rollbackError) throw imageError("图片信息保存失败，且上传文件清理失败", rollbackError);
    throw imageError("图片信息保存失败", error);
  }
  return data;
}

export async function updatePlaceImageAlt(client, ownerId, mapId, placeId, imageId, altText) {
  const { data, error } = await client.from("place_images").update({ alt_text: altText.trim().slice(0, 160) })
    .eq("owner_id", ownerId).eq("map_id", mapId).eq("place_id", placeId).eq("id", imageId).select().single();
  if (error || !data) throw imageError("图片说明保存失败", error);
  return data;
}

export async function deletePlaceImage(client, ownerId, mapId, placeId, image) {
  const legacyCall = image === undefined;
  if (legacyCall) { image = placeId; placeId = mapId; mapId = "suining"; }
  assertOwnerPlacePath(ownerId, mapId, placeId, image.storage_path);
  const privateBucket = client.storage.from(PRIVATE_IMAGE_BUCKET);
  const publishedBucket = client.storage.from(PUBLISHED_IMAGE_BUCKET);
  const publishedPaths = await publishedImagePaths(client, ownerId, mapId, placeId, image.id, legacyCall);
  const backups = [];
  const { data: original, error: downloadError } = await privateBucket.download(image.storage_path);
  if (downloadError || !original) throw imageError("图片删除准备失败", downloadError);
  backups.push({ bucket: privateBucket, path: image.storage_path, blob: original, contentType: image.mime_type });
  for (const path of publishedPaths) {
    const { data: published, error: publishedDownloadError } = await publishedBucket.download(path);
    if (publishedDownloadError || !published) throw cleanupError("公开图片副本删除准备失败", publishedDownloadError, publishedPaths);
    backups.push({ bucket: publishedBucket, path, blob: published, contentType: published.type || "image/webp" });
  }

  const restoreAfterFailure = async (prefix, operationError) => {
    const failed = [];
    for (const backup of backups) {
      const { error: restoreError } = await backup.bucket.upload(backup.path, backup.blob, { contentType: backup.contentType, upsert: true });
      if (restoreError) failed.push({ path: backup.path, message: restoreError.message || "云端请求失败" });
    }
    if (!failed.length) throw imageError(prefix, operationError);
    // ai coding：单图删除的补偿同时恢复私有原图和全部公开副本，并明确暴露每个恢复失败路径，避免 UI 误报成功。
    const failure = imageError(prefix, operationError);
    failure.pendingCleanupPaths = failed.map(({ path }) => path);
    failure.restoreFailures = failed;
    failure.message += `；图片恢复失败，请重试，持续失败请人工处理：${failed.map(({ path, message }) => `${path}（${message}）`).join("、")}`;
    throw failure;
  };

  const { error: privateRemoveError } = await privateBucket.remove([image.storage_path]);
  if (privateRemoveError) await restoreAfterFailure("图片文件删除失败", privateRemoveError);
  if (publishedPaths.length) {
    const { error: publishedRemoveError } = await publishedBucket.remove(publishedPaths);
    if (publishedRemoveError) await restoreAfterFailure("公开图片副本删除失败", publishedRemoveError);
  }
  const { data, error } = await client.from("place_images").delete().eq("owner_id", ownerId).eq("map_id", mapId).eq("place_id", placeId).eq("id", image.id).select("id");
  if (error || !data?.length) await restoreAfterFailure("图片信息删除失败", error);
}

export async function cleanupPrivatePlaceImages(client, ownerId, mapId, placeId) {
  if (!client.storage) return async () => {};
  const { data, error } = await client.from("place_images").select("storage_path,mime_type").eq("owner_id", ownerId).eq("map_id", mapId).eq("place_id", placeId);
  if (error) throw imageError("地点图片清理失败", error);
  const paths = (data ?? []).map((row) => assertOwnerPlacePath(ownerId, mapId, placeId, row.storage_path));
  const backups = [];
  for (const row of data ?? []) {
    const { data: blob, error: downloadError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).download(row.storage_path);
    if (downloadError || !blob) throw imageError("地点图片清理准备失败", downloadError);
    backups.push({ path: row.storage_path, blob, mimeType: row.mime_type });
  }
  if (paths.length) {
    const { error: removeError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).remove(paths);
    if (removeError) throw imageError("地点图片清理失败", removeError);
  }
  return async () => {
    const failedPaths = [];
    let firstError;
    // ai coding：地点删除补偿逐个检查上传结果并继续尝试其余文件，失败路径必须交还上层处理。
    for (const backup of backups) {
      const { error: restoreError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).upload(backup.path, backup.blob, { contentType: backup.mimeType, upsert: true });
      if (restoreError) {
        firstError ??= restoreError;
        failedPaths.push(backup.path);
      }
    }
    if (failedPaths.length) throw cleanupError("地点图片恢复失败", firstError, failedPaths);
  };
}

// ai coding：地点删除先按 owner/place 读取元数据并备份、清理全部公开副本和私有原图；任一步失败都保留数据库行并暴露待处理路径。
export async function cleanupPlaceImagesBeforeDelete(client, ownerId, mapId, placeId, legacyPaths = false) {
  if (placeId === undefined) { placeId = mapId; mapId = "suining"; legacyPaths = true; }
  if (!client.storage) return async () => {};
  let query = client.from("place_images").select("id,storage_path,mime_type").eq("owner_id", ownerId);
  if (!legacyPaths) query = query.eq("map_id", mapId);
  const { data, error } = await query.eq("place_id", placeId);
  if (error) throw cleanupError("地点图片元数据读取失败", error, []);
  const rows = data ?? [];
  if (!rows.length) return async () => {};

  const privatePaths = rows.map((row) => legacyPaths ? row.storage_path : assertOwnerPlacePath(ownerId, mapId, placeId, row.storage_path));
  const imageIds = new Set(rows.map((row) => String(row.id)));
  const publishedPaths = (await listPublishedPaths(client, legacyPaths ? ownerId : `${ownerId}/${mapId}`)).filter((path) => {
    const segments = path.split("/");
    const filename = segments.at(-1) ?? "";
    return segments.at(-2) === placeId && imageIds.has(filename.replace(/\.[^.]+$/, ""));
  });
  const privateBucket = client.storage.from(PRIVATE_IMAGE_BUCKET);
  const publishedBucket = client.storage.from(PUBLISHED_IMAGE_BUCKET);
  const backups = [];

  for (const row of rows) {
    const { data: blob, error: downloadError } = await privateBucket.download(row.storage_path);
    if (downloadError || !blob) throw cleanupError("地点私有图片清理准备失败", downloadError, [...publishedPaths, ...privatePaths]);
    backups.push({ bucket: privateBucket, path: row.storage_path, blob, contentType: row.mime_type });
  }
  for (const path of publishedPaths) {
    const { data: blob, error: downloadError } = await publishedBucket.download(path);
    if (downloadError || !blob) throw cleanupError("地点公开图片清理准备失败", downloadError, [...publishedPaths, ...privatePaths]);
    backups.push({ bucket: publishedBucket, path, blob, contentType: blob.type || "image/webp" });
  }

  const restore = async () => {
    const failedPaths = [];
    let firstError;
    for (const backup of backups) {
      const { error: restoreError } = await backup.bucket.upload(backup.path, backup.blob, { contentType: backup.contentType, upsert: true });
      if (restoreError) {
        firstError ??= restoreError;
        failedPaths.push(backup.path);
      }
    }
    if (failedPaths.length) throw cleanupError("地点图片恢复失败", firstError, failedPaths);
  };
  const removeOrRestore = async (bucket, paths, prefix) => {
    if (!paths.length) return;
    const { error: removeError } = await bucket.remove(paths);
    if (!removeError) return;
    try {
      await restore();
    } catch (restoreError) {
      const failure = new Error(`${prefix}：${removeError.message || "云端请求失败"}；${restoreError.message}`);
      failure.pendingCleanupPaths = restoreError.pendingCleanupPaths;
      throw failure;
    }
    throw cleanupError(prefix, removeError, [...publishedPaths, ...privatePaths]);
  };

  await removeOrRestore(publishedBucket, publishedPaths, "地点公开图片清理失败");
  await removeOrRestore(privateBucket, privatePaths, "地点私有图片清理失败");
  return restore;
}

export async function fetchImagesForPlaces(client, ownerId, mapId, placeIds) {
  const legacyCall = placeIds === undefined;
  if (legacyCall) { placeIds = mapId; mapId = "suining"; }
  if (!placeIds.length) return [];
  let query = client.from("place_images").select("*").eq("owner_id", ownerId);
  if (!legacyCall) query = query.eq("map_id", mapId);
  const { data, error } = await query.in("place_id", placeIds).order("sort_order").order("created_at");
  if (error) throw imageError("发布图片读取失败", error);
  return (data ?? []).map((row) => ({ ...row, storage_path: legacyCall ? assertOwnerPlacePath(ownerId, row.place_id, row.storage_path) : assertOwnerPlacePath(ownerId, mapId, row.place_id, row.storage_path) }));
}

export async function copyPublishedImages(client, ownerId, mapId, _token, releaseId, rows, codec = browserPublicImageCodec) {
  const legacyCall = Array.isArray(releaseId);
  if (legacyCall) { codec = rows ?? browserPublicImageCodec; rows = releaseId; releaseId = _token; _token = mapId; mapId = "suining"; }
  const imagesByPlace = {};
  const uploadedPaths = [];
  try {
    for (const row of rows) {
      const { data: blob, error: downloadError } = await client.storage.from(PRIVATE_IMAGE_BUCKET).download(row.storage_path);
      if (downloadError || !blob) throw imageError("公开图片副本下载失败", downloadError);
      const cleanBlob = await reencodePublicImage(blob, codec);
      const publicPath = legacyCall ? `${ownerId}/${releaseId}/${row.place_id}/${row.id}.webp` : `${ownerId}/${mapId}/${releaseId}/${row.place_id}/${row.id}.webp`;
      const { error: uploadError } = await client.storage.from(PUBLISHED_IMAGE_BUCKET).upload(publicPath, cleanBlob, { contentType: "image/webp", upsert: false });
      if (uploadError) throw imageError("公开图片副本上传失败", uploadError);
      uploadedPaths.push(publicPath);
      (imagesByPlace[row.place_id] ??= []).push({ id: row.id, public_path: publicPath, alt_text: row.alt_text || "" });
    }
    return { imagesByPlace, uploadedPaths };
  } catch (error) {
    if (uploadedPaths.length) {
      const { error: rollbackError } = await client.storage.from(PUBLISHED_IMAGE_BUCKET).remove(uploadedPaths);
      if (rollbackError) throw cleanupError(`${error.message}；已上传公开副本回滚失败`, rollbackError, uploadedPaths);
    }
    throw error;
  }
}

async function listPublishedPaths(client, prefix, depth = 0) {
  const { data, error } = await client.storage.from(PUBLISHED_IMAGE_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw cleanupError("旧公开图片清理失败", error, [prefix]);
  const paths = [];
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id || depth >= 3) paths.push(path);
    else paths.push(...await listPublishedPaths(client, path, depth + 1));
  }
  return paths;
}

export async function cleanupPublishedImages(client, ownerId, mapId, token, keepRelease = "") {
  const legacyCall = arguments.length < 5;
  if (legacyCall) { keepRelease = token ?? ""; token = mapId; mapId = "suining"; }
  if (!client.storage || !ownerId || !mapId || !token) return;
  const prefix = legacyCall ? ownerId : `${ownerId}/${mapId}`;
  const scopedPaths = await listPublishedPaths(client, prefix);
  const legacyPaths = !legacyCall && mapId === "suining"
    ? (await listPublishedPaths(client, ownerId)).filter((path) => path.split("/").length === 4)
    : [];
  const paths = [...new Set([...scopedPaths, ...legacyPaths])];
  const remove = keepRelease ? paths.filter((path) => !path.startsWith(`${prefix}/${keepRelease}/`)) : paths;
  if (remove.length) {
    const { error } = await client.storage.from(PUBLISHED_IMAGE_BUCKET).remove(remove);
    if (error) throw cleanupError("旧公开图片清理失败", error, remove);
  }
}

export async function cleanupPublishedImageCopies(client, ownerId, mapId, placeId, imageId) {
  const legacyCall = imageId === undefined;
  if (legacyCall) { imageId = placeId; placeId = mapId; mapId = "suining"; }
  if (!client.storage) return;
  const remove = await publishedImagePaths(client, ownerId, mapId, placeId, imageId, legacyCall);
  if (!remove.length) return;
  const { error } = await client.storage.from(PUBLISHED_IMAGE_BUCKET).remove(remove);
  if (error) throw cleanupError("公开图片副本删除失败", error, remove);
}

async function publishedImagePaths(client, ownerId, mapId, placeId, imageId, legacy = false) {
  const scoped = await listPublishedPaths(client, legacy ? ownerId : `${ownerId}/${mapId}`);
  const legacyPaths = !legacy && mapId === "suining"
    ? (await listPublishedPaths(client, ownerId)).filter((path) => path.split("/").length === 4)
    : [];
  const paths = [...new Set([...scoped, ...legacyPaths])];
  const suffix = `/${placeId}/${imageId}`;
  return paths.filter((path) => path.slice(0, path.lastIndexOf(".")).endsWith(suffix));
}
