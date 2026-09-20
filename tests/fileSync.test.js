import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  forgetSessionFileHandle,
  getSessionFileHandle,
  isFileHandleUnavailable,
  rememberSessionFileHandle,
  writePlacesFile,
} from "../src/services/fileSync.js";

const places = { type: "FeatureCollection", features: [{ id: "one" }] };
function harness(confirm = true) {
  const events = [];
  const writable = { async write(value) { events.push(["write", value]); }, async close() { events.push(["close"]); }, async abort() { events.push(["abort"]); } };
  const handle = { name: "places.geojson", async createWritable() { events.push(["createWritable"]); return writable; } };
  return { events, handle, pickFile: async () => { events.push(["picker"]); return [handle]; }, confirmWrite: () => { events.push(["confirm"]); return confirm; } };
}

test("first selection opens writable before confirmation and writes current snapshot", async () => {
  const h = harness(); const result = await writePlacesFile({ places, fileHandle: null, pickFile: h.pickFile, confirmWrite: h.confirmWrite });
  assert.deepEqual(h.events.map(([name]) => name), ["picker", "createWritable", "confirm", "write", "close"]);
  assert.match(h.events.find(([name]) => name === "write")[1], /"id": "one"/); assert.equal(result.fileHandle, h.handle);
});

test("cancel aborts and does not retain a newly selected handle", async () => {
  const h = harness(false); const result = await writePlacesFile({ places, fileHandle: null, pickFile: h.pickFile, confirmWrite: h.confirmWrite });
  assert.deepEqual(h.events.map(([name]) => name), ["picker", "createWritable", "confirm", "abort"]); assert.equal(result.fileHandle, null);
});

test("an existing handle writes directly without reading or picking", async () => {
  const h = harness(); await writePlacesFile({ places, fileHandle: h.handle, pickFile: h.pickFile, confirmWrite: h.confirmWrite });
  assert.deepEqual(h.events.map(([name]) => name), ["createWritable", "write", "close"]);
});

test("session handle survives callers until explicitly forgotten", () => {
  const h = harness();
  forgetSessionFileHandle();
  rememberSessionFileHandle(h.handle);
  assert.equal(getSessionFileHandle(), h.handle);
  forgetSessionFileHandle();
  assert.equal(getSessionFileHandle(), null);
});

test("session handles are map scoped and targeted cleanup requires reselection", () => {
  const suining = harness().handle; const xuhui = harness().handle;
  forgetSessionFileHandle();
  rememberSessionFileHandle(suining, "suining");
  rememberSessionFileHandle(xuhui, "xuhui");
  forgetSessionFileHandle("suining");
  assert.equal(getSessionFileHandle("suining"), null);
  assert.equal(getSessionFileHandle("xuhui"), xuhui);
  forgetSessionFileHandle();
});

test("leaving a map invalidates sync and forgets that map's session handle", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  // ai coding：静态守卫锁定地图 effect cleanup，避免以后只在 owner 切换时清理句柄。
  assert.match(app, /useEffect\(\(\) => \(\) => \{[\s\S]*syncRunRef\.current \+= 1;[\s\S]*forgetSessionFileHandle\(mapId\);[\s\S]*\}, \[mapId\]\)/);
});

test("recognizes errors that require selecting a file again", () => {
  for (const name of ["NotAllowedError", "SecurityError", "NotFoundError", "InvalidStateError"])
    assert.equal(isFileHandleUnavailable({ name }), true);
  assert.equal(isFileHandleUnavailable({ name: "QuotaExceededError" }), false);
});
