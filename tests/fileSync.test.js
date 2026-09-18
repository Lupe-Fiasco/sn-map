import test from "node:test";
import assert from "node:assert/strict";
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

test("recognizes errors that require selecting a file again", () => {
  for (const name of ["NotAllowedError", "SecurityError", "NotFoundError", "InvalidStateError"])
    assert.equal(isFileHandleUnavailable({ name }), true);
  assert.equal(isFileHandleUnavailable({ name: "QuotaExceededError" }), false);
});
