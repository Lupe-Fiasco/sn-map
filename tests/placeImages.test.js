import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOwnerPlacePath, cleanupPlaceImagesBeforeDelete, cleanupPublishedImageCopies, cleanupPublishedImages, copyPublishedImages, deletePlaceImage, MAX_IMAGE_BYTES,
  MAX_PUBLIC_IMAGE_DIMENSION, PUBLIC_IMAGE_QUALITY, reencodePublicImage, validateImageFile,
} from "../src/services/placeImages.js";

function placeCleanupClient({ failPublishedRemove = false, failPrivateRemove = false } = {}) {
  const calls = { removed: [], uploads: [] };
  const rows = [{ id: "image-1", storage_path: "owner-a/place-1/image-1.jpg", mime_type: "image/jpeg" }];
  const query = { eq() { return this; }, then(resolve) { return Promise.resolve(resolve({ data: rows, error: null })); } };
  const buckets = {
    "place-images": {
      download: async () => ({ data: new Blob(["private"], { type: "image/jpeg" }), error: null }),
      remove: async (paths) => { calls.removed.push(...paths); return { error: failPrivateRemove ? { message: "private remove failed" } : null }; },
      upload: async (path) => { calls.uploads.push(path); return { error: null }; },
    },
    "published-place-images": {
      list: async (prefix) => ({ data: prefix === "owner-a" ? [{ name: "release", id: null }] : prefix === "owner-a/release" ? [{ name: "place-1", id: null }] : [{ name: "image-1.webp", id: "public-file" }], error: null }),
      download: async () => ({ data: new Blob(["public"], { type: "image/webp" }), error: null }),
      remove: async (paths) => { calls.removed.push(...paths); return { error: failPublishedRemove ? { message: "public remove failed" } : null }; },
      upload: async (path) => { calls.uploads.push(path); return { error: null }; },
    },
  };
  return { client: { from: () => ({ select: () => query }), storage: { from: (name) => buckets[name] } }, calls };
}

test("validates image type and five megabyte limit", () => {
  assert.equal(validateImageFile({ type: "image/webp", size: 1024 }).type, "image/webp");
  assert.throws(() => validateImageFile({ type: "image/gif", size: 1024 }), /JPG、PNG 或 WebP/);
  assert.throws(() => validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES + 1 }), /5MB/);
});

test("requires private paths to match the explicit owner and place", () => {
  assert.equal(assertOwnerPlacePath("owner-a", "place-1", "owner-a/place-1/image.webp"), "owner-a/place-1/image.webp");
  assert.throws(() => assertOwnerPlacePath("owner-a", "place-1", "owner-b/place-1/image.webp"), /不匹配/);
  assert.throws(() => assertOwnerPlacePath("owner-a", "place-1", "owner-a/place-2/image.webp"), /不匹配/);
});

test("public image processing always returns a bounded clean WebP through the injected codec", async () => {
  const source = new Blob(["original-with-metadata"], { type: "image/jpeg" });
  let receivedOptions;
  const clean = await reencodePublicImage(source, async (_blob, options) => {
    receivedOptions = options;
    return new Blob(["clean-pixels"], { type: "image/webp" });
  });
  assert.equal(clean.type, "image/webp");
  assert.deepEqual(receivedOptions, { maxDimension: MAX_PUBLIC_IMAGE_DIMENSION, quality: PUBLIC_IMAGE_QUALITY });
  await assert.rejects(reencodePublicImage(source, async () => source), /未生成安全的 WebP/);
  await assert.rejects(reencodePublicImage(source, async () => { throw new Error("decode failed"); }), /无法安全移除 EXIF\/GPS.*decode failed/);
});

test("copy rollback reports paths when uploaded public files cannot be removed", async () => {
  let uploads = 0;
  const published = {
    upload: async () => ({ error: ++uploads === 2 ? { message: "upload failed" } : null }),
    remove: async () => ({ error: { message: "remove failed" } }),
    getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
  };
  const client = { storage: { from: (bucket) => bucket === "place-images"
    ? { download: async () => ({ data: new Blob(["pixels"], { type: "image/jpeg" }), error: null }) }
    : published } };
  const rows = ["one", "two"].map((id) => ({ id, place_id: "place-1", storage_path: `owner-a/place-1/${id}.jpg`, mime_type: "image/jpeg" }));
  await assert.rejects(
    copyPublishedImages(client, "owner-a", "token", "release", rows, async () => new Blob(["clean"], { type: "image/webp" })),
    (error) => error.pendingCleanupPaths?.[0] === "owner-a/release/place-1/one.webp" && /回滚失败/.test(error.message),
  );
});

test("published cleanup does not swallow remove errors and identifies pending paths", async () => {
  const client = { storage: { from: () => ({
    list: async (prefix) => ({ data: prefix === "owner-a" ? [{ name: "release", id: null }] : [{ id: "file", name: "place-1/image.webp" }], error: null }),
    remove: async () => ({ error: { message: "storage unavailable" } }),
  }) } };
  await assert.rejects(cleanupPublishedImages(client, "owner-a", "token"), (error) =>
    /旧公开图片清理失败/.test(error.message)
      && error.pendingCleanupPaths?.[0] === "owner-a/release/place-1/image.webp");
});

test("deleting one image reports its still-public copies when storage removal fails", async () => {
  const tree = {
    "owner-a": [{ name: "token", id: null }],
    "owner-a/token": [{ name: "release", id: null }],
    "owner-a/token/release": [{ name: "place-1", id: null }],
    "owner-a/token/release/place-1": [{ name: "image-1.webp", id: "file" }],
  };
  const client = { storage: { from: () => ({
    list: async (prefix) => ({ data: tree[prefix] ?? [], error: null }),
    remove: async () => ({ error: { message: "remove denied" } }),
  }) } };
  await assert.rejects(cleanupPublishedImageCopies(client, "owner-a", "place-1", "image-1"), (error) =>
    /公开图片副本删除失败/.test(error.message)
      && error.pendingCleanupPaths?.[0] === "owner-a/token/release/place-1/image-1.webp");
});

function singleDeleteClient({ failPrivateRestore = false, failPublishedRestore = false } = {}) {
  const calls = { removed: [], uploads: [] };
  const tree = {
    "owner-a": [{ name: "release", id: null }],
    "owner-a/release": [{ name: "place-1", id: null }],
    "owner-a/release/place-1": [{ name: "image-1.webp", id: "public-file" }],
  };
  const buckets = {
    "place-images": {
      download: async () => ({ data: new Blob(["private"], { type: "image/jpeg" }), error: null }),
      remove: async (paths) => { calls.removed.push(...paths); return { error: null }; },
      upload: async (path) => { calls.uploads.push(path); return { error: failPrivateRestore ? { message: "private restore failed" } : null }; },
    },
    "published-place-images": {
      list: async (prefix) => ({ data: tree[prefix] ?? [], error: null }),
      download: async () => ({ data: new Blob(["public"], { type: "image/webp" }), error: null }),
      remove: async (paths) => { calls.removed.push(...paths); return { error: null }; },
      upload: async (path) => { calls.uploads.push(path); return { error: failPublishedRestore ? { message: "public restore failed" } : null }; },
    },
  };
  const metadataDelete = { eq() { return this; }, select: async () => ({ data: null, error: { message: "metadata delete failed" } }) };
  return {
    client: {
      from: () => ({ delete: () => metadataDelete }),
      storage: { from: (name) => buckets[name] },
    },
    calls,
  };
}

test("metadata delete failure restores both the private original and published copies", async () => {
  const { client, calls } = singleDeleteClient();
  await assert.rejects(
    deletePlaceImage(client, "owner-a", "place-1", { id: "image-1", storage_path: "owner-a/place-1/image-1.jpg", mime_type: "image/jpeg" }),
    /图片信息删除失败：metadata delete failed/,
  );
  assert.deepEqual(calls.removed, ["owner-a/place-1/image-1.jpg", "owner-a/release/place-1/image-1.webp"]);
  assert.deepEqual(calls.uploads, ["owner-a/place-1/image-1.jpg", "owner-a/release/place-1/image-1.webp"]);
});

test("metadata delete failure exposes every copy that could not be restored", async () => {
  const { client, calls } = singleDeleteClient({ failPrivateRestore: true, failPublishedRestore: true });
  await assert.rejects(
    deletePlaceImage(client, "owner-a", "place-1", { id: "image-1", storage_path: "owner-a/place-1/image-1.jpg", mime_type: "image/jpeg" }),
    (error) => /metadata delete failed.*图片恢复失败.*private restore failed.*public restore failed/.test(error.message)
      && error.pendingCleanupPaths.includes("owner-a/place-1/image-1.jpg")
      && error.pendingCleanupPaths.includes("owner-a/release/place-1/image-1.webp")
      && error.restoreFailures.length === 2,
  );
  assert.equal(calls.uploads.length, 2);
});

test("place cleanup removes public copies before private originals and returns a working restore", async () => {
  const { client, calls } = placeCleanupClient();
  const restore = await cleanupPlaceImagesBeforeDelete(client, "owner-a", "place-1");
  assert.deepEqual(calls.removed, ["owner-a/release/place-1/image-1.webp", "owner-a/place-1/image-1.jpg"]);
  await restore();
  assert.deepEqual(calls.uploads.sort(), ["owner-a/place-1/image-1.jpg", "owner-a/release/place-1/image-1.webp"].sort());
});

test("place cleanup keeps database deletion blocked and reports paths after public or private removal failures", async () => {
  for (const options of [{ failPublishedRemove: true }, { failPrivateRemove: true }]) {
    const { client } = placeCleanupClient(options);
    await assert.rejects(cleanupPlaceImagesBeforeDelete(client, "owner-a", "place-1"), (error) =>
      /地点(公开|私有)图片清理失败/.test(error.message)
        && error.pendingCleanupPaths.includes("owner-a/release/place-1/image-1.webp")
        && error.pendingCleanupPaths.includes("owner-a/place-1/image-1.jpg"));
  }
});
