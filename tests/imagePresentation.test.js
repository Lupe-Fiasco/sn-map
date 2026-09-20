import test from "node:test";
import assert from "node:assert/strict";
import { deleteAfterConfirmation, imageActions, imageCollectionView } from "../src/services/imagePresentation.js";

test("image collection does not report zero until loading has completed", () => {
  assert.deepEqual(imageCollectionView({ loading: true, error: "", images: [] }), { state: "loading", count: null });
  assert.deepEqual(imageCollectionView({ loading: false, error: "读取失败", images: [] }), { state: "error", count: null });
  assert.deepEqual(imageCollectionView({ loading: false, error: "", images: [] }), { state: "empty", count: 0 });
  assert.deepEqual(imageCollectionView({ loading: false, error: "", images: [{ id: "one" }] }), { state: "ready", count: 1 });
});

test("image deletion runs only after confirmation and propagates failures", async () => {
  let calls = 0;
  assert.equal(await deleteAfterConfirmation(false, async () => { calls += 1; }), false);
  assert.equal(calls, 0);
  assert.equal(await deleteAfterConfirmation(true, async () => { calls += 1; }), true);
  assert.equal(calls, 1);
  await assert.rejects(deleteAfterConfirmation(true, async () => { throw new Error("删除失败"); }), /删除失败/);
});

test("public image presentation exposes preview without management actions", () => {
  assert.deepEqual(imageActions("public"), { preview: true, upload: false, delete: false });
  assert.deepEqual(imageActions("private"), { preview: true, upload: true, delete: true });
});
