import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createInitialPlaceFormValues, resolveShapeGeometry } from "../src/services/placeFormState.js";

test("new point, line and area form state never dereferences a missing feature geometry", () => {
  assert.equal(resolveShapeGeometry(null, null), null);
  assert.deepEqual(createInitialPlaceFormValues(null, [117.9, 33.9], "Point"), {
    name: "", type: "", longitude: "117.9", latitude: "33.9", address: "", phone: "", description: "",
  });
  for (const geometry of [
    { type: "LineString", coordinates: [[117.9, 33.9], [118, 34]] },
    { type: "Polygon", coordinates: [[[117.9, 33.9], [118, 33.9], [118, 34], [117.9, 33.9]]] },
  ]) {
    assert.equal(resolveShapeGeometry(undefined, geometry), geometry);
    assert.equal(createInitialPlaceFormValues(undefined, undefined, geometry.type).type, geometry.type === "LineString" ? "road" : "");
  }
  assert.equal(resolveShapeGeometry({ geometry: null }, undefined), null);
  assert.doesNotThrow(() => createInitialPlaceFormValues({ properties: null, geometry: null }, null, "Point"));
});

test("the form is isolated by an error boundary so malformed form state cannot clear the app root", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const boundary = await readFile(new URL("../src/components/FormErrorBoundary.jsx", import.meta.url), "utf8");
  assert.match(app, /<FormErrorBoundary[\s\S]*<PlaceForm[\s\S]*<\/FormErrorBoundary>/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /role="alert"/);
});

test("MapView initialization only follows map configuration while read-only updates in place", async () => {
  const source = await readFile(new URL("../src/components/MapView.jsx", import.meta.url), "utf8");
  const dependencyList = source.match(/初始化仅由真实地图配置驱动[\s\S]*?\}, \[([^\]]+)\]\);/)?.[1] ?? "";
  assert.match(dependencyList, /mapId/);
  assert.match(dependencyList, /bounds\?\.south/);
  assert.match(dependencyList, /baseRoadsPath/);
  assert.doesNotMatch(dependencyList, /readOnly|lineDrawing|areaDrawing|drawCoordinates|onRoadStatus/);
  assert.match(source, /interactionRef\.current\.lineDrawing/);
  assert.match(source, /callbacksRef\.current\.onRoadStatus/);
  assert.match(source, /layerControl\.addOverlay\(placesLayer, readOnly \? "快照地点（只读）" : "用户地点"\);[\s\S]*?\}, \[readOnly\]\);/);
});
