import test from "node:test";
import assert from "node:assert/strict";
import { canFinishLine, drawingContextAction, finishAreaDrawing, finishLineDrawing } from "../src/services/lineDrawing.js";

test("line drawing finishes only with two distinct vertices and remains open", () => {
  assert.equal(canFinishLine([[118, 34], [118, 34]]), false);
  assert.match(finishLineDrawing([[118, 34]]).message, /至少绘制 2 个不同顶点/);
  const result = finishLineDrawing([[118, 34], [118.1, 34.1]]);
  assert.deepEqual(result.geometry, { type: "LineString", coordinates: [[118, 34], [118.1, 34.1]] });
  assert.notDeepEqual(result.geometry.coordinates[0], result.geometry.coordinates.at(-1));
  const accidentallyClosed = finishLineDrawing([[118, 34], [118.1, 34.1], [118, 34]]);
  assert.deepEqual(accidentallyClosed.geometry.coordinates, [[118, 34], [118.1, 34.1]]);
});

test("right click always prevents the browser menu and shares the finish rule", () => {
  assert.deepEqual(drawingContextAction({ button: 0, coordinates: [] }), { preventDefault: false, finish: false, message: "" });
  const invalid = drawingContextAction({ button: 2, coordinates: [[118, 34]] });
  assert.equal(invalid.preventDefault, true); assert.equal(invalid.finish, false); assert.match(invalid.message, /至少绘制 2 个/);
  const valid = drawingContextAction({ button: 2, coordinates: [[118, 34], [118.1, 34.1]] });
  assert.equal(valid.preventDefault, true); assert.equal(valid.finish, true); assert.equal(valid.geometry.type, "LineString");
});

test("area right click prevents the menu and completes only after three distinct vertices", () => {
  const coordinates = [[118, 34], [118.1, 34], [118.1, 34.1]];
  const rejected = drawingContextAction({ button: 2, mode: "area", coordinates: coordinates.slice(0, 2) });
  assert.equal(rejected.preventDefault, true); assert.equal(rejected.finish, false); assert.match(rejected.message, /至少需要 3 个点/);

  const completed = drawingContextAction({ button: 2, mode: "area", coordinates });
  assert.equal(completed.preventDefault, true); assert.equal(completed.finish, true);
  assert.deepEqual(completed.geometry, finishAreaDrawing(coordinates).geometry);
  assert.deepEqual(completed.geometry.coordinates[0].at(-1), coordinates[0]);
});

test("ordinary map context menus are not intercepted", () => {
  assert.deepEqual(drawingContextAction({ button: 2, mode: "browse", coordinates: [] }), { preventDefault: false, finish: false, message: "" });
});
