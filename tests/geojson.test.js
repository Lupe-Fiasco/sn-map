import test from "node:test";
import assert from "node:assert/strict";
import { createPlace, createPolygonDraftGeometry, getLineStringRepresentativeCoordinate, getPolygonRepresentativeCoordinate, getSaveSummary, getUnsyncedChanges, insertPolygonVertex, normalizeCollection, validatePlaces, validatePolygonGeometry } from "../src/services/geojson.js";

const types = [{ id: "other", name: "其他", color: "#65736f" }, { id: "road", name: "道路", color: "#315f8c" }];
const feature = (id, name = id, coordinates = [118, 34]) => ({ type: "Feature", id, geometry: { type: "Point", coordinates }, properties: { id, source: "user", name, type: "other" } });
const collection = (...features) => ({ type: "FeatureCollection", features });
const polygon = (id, ring = [[118, 34], [118.1, 34], [118.1, 34.1], [118, 34]]) => ({ ...feature(id), geometry: { type: "Polygon", coordinates: [ring] } });
const line = (id, coordinates = [[118, 34], [118.2, 34.1]]) => ({ ...feature(id), geometry: { type: "LineString", coordinates }, properties: { ...feature(id).properties, type: "road" } });

test("validates and normalizes compatible user Point GeoJSON", () => {
  const data = collection(feature("a"));
  assert.equal(normalizeCollection(validatePlaces(data, types)).features[0].properties.source, "user");
  assert.throws(() => validatePlaces(collection(feature("a"), feature("a")), types), /id 重复/);
  assert.throws(() => validatePlaces(collection({ ...feature("b"), geometry: { type: "Point", coordinates: [200, 34] } }), types), /WGS84/);
  const edited = createPlace({ name: "已编辑", type: "other", address: "", phone: "", description: "", longitude: 119, latitude: 35 }, feature("point"));
  assert.deepEqual(edited.geometry.coordinates, [119, 35]);
});

test("creates and edits Point, LineString and Polygon without reading a missing feature", () => {
  const values = { name: "新地点", type: "other", address: "", phone: "", description: "", longitude: 117.95, latitude: 33.91 };
  // ai coding：覆盖真实新增点回归路径：existing 为 null 且 values 不含 geometry。
  let point;
  assert.doesNotThrow(() => { point = createPlace(values, null); });
  assert.deepEqual(point.geometry, { type: "Point", coordinates: [117.95, 33.91] });
  assert.deepEqual(createPlace({ ...values, longitude: 118, latitude: 34 }, point).geometry.coordinates, [118, 34]);

  for (const existing of [line("line-edit"), polygon("area-edit")]) {
    const created = createPlace({ ...values, type: existing.properties.type, geometry: existing.geometry }, null);
    assert.deepEqual(created.geometry, existing.geometry);
    const edited = createPlace({ ...values, type: existing.properties.type }, existing);
    assert.deepEqual(edited.geometry, existing.geometry);
    assert.equal(edited.id, existing.id);
  }
});

test("validates open LineString places, representative coordinates and contained Points", () => {
  const point = feature("point-a", "已有点");
  const linked = { ...line("line-a"), properties: { ...line("line-a").properties, contained_place_ids: [point.id] } };
  assert.doesNotThrow(() => validatePlaces(collection(point, linked), types));
  assert.deepEqual(getLineStringRepresentativeCoordinate(linked.geometry), [118.1, 34.05]);
  const created = createPlace({ name: "线", type: "road", address: "", phone: "", description: "", geometry: linked.geometry, contained_place_ids: [point.id] });
  assert.equal(created.geometry.type, "LineString");
  assert.deepEqual(created.properties.contained_place_ids, [point.id]);
  assert.deepEqual([created.properties.longitude, created.properties.latitude], [118.1, 34.05]);
  assert.throws(() => validatePlaces(collection(line("few", [[118, 34]])), types), /2 个顶点/);
  assert.throws(() => validatePlaces(collection(line("same", [[118, 34], [118, 34]])), types), /2 个不同顶点/);
  assert.throws(() => validatePlaces(collection(line("closed", [[118, 34], [118.1, 34.1], [118, 34]])), types), /线不能闭合/);
  assert.throws(() => validatePlaces(collection(line("range", [[118, 34], [181, 34]])), types), /WGS84/);
  assert.throws(() => validatePlaces(collection(linked), types), /当前地图.*Point/);
  assert.throws(() => validatePlaces(collection(point, { ...linked, properties: { ...linked.properties, contained_place_ids: [point.id, point.id] } }), types), /无重复/);
  assert.throws(() => validatePlaces(collection(point, { ...polygon("area"), properties: { ...polygon("area").properties, contained_place_ids: [point.id] } }), types), /仅允许用于 LineString/);
});

test("validates Polygon outer rings and preserves them through place creation", () => {
  const data = normalizeCollection(validatePlaces(collection(polygon("area")), types));
  const created = createPlace({ name: "区域", type: "other", address: "", phone: "", description: "", geometry: data.features[0].geometry });
  assert.equal(created.geometry.type, "Polygon");
  assert.deepEqual(created.geometry.coordinates, data.features[0].geometry.coordinates);
  assert.equal(created.id, created.properties.id); assert.equal(created.properties.source, "user");
  assert.deepEqual([created.properties.longitude, created.properties.latitude], getPolygonRepresentativeCoordinate(created.geometry));
  assert.ok(Number.isFinite(created.properties.longitude)); assert.ok(Number.isFinite(created.properties.latitude));
  assert.throws(() => validatePlaces(collection(polygon("open", [[118, 34], [118.1, 34], [118.1, 34.1], [118, 34.1]])), types), /未闭合/);
  assert.throws(() => validatePlaces(collection(polygon("few", [[118, 34], [118.1, 34], [118, 34], [118, 34]])), types), /3 个不同顶点/);
  assert.throws(() => validatePlaces(collection({ ...polygon("hole"), geometry: { type: "Polygon", coordinates: [polygon("a").geometry.coordinates[0], polygon("b").geometry.coordinates[0]] } }), types), /一个外环/);
  assert.deepEqual(validatePlaces(JSON.parse(JSON.stringify(collection(created))), types).features[0].geometry, created.geometry);
});

test("computes Polygon representative coordinates and preserves them on metadata-only edits", () => {
  const geometry = { type: "Polygon", coordinates: [[[118, 34], [118.2, 34], [118.2, 34.2], [118, 34.2], [118, 34]]] };
  const coordinate = getPolygonRepresentativeCoordinate(geometry);
  assert.ok(Math.abs(coordinate[0] - 118.1) < 1e-10);
  assert.ok(Math.abs(coordinate[1] - 34.1) < 1e-10);
  const tiny = { type: "Polygon", coordinates: [[[118, 34], [118.000001, 34], [118.000001, 34.000001], [118, 34.000001], [118, 34]]] };
  const tinyCoordinate = getPolygonRepresentativeCoordinate(tiny);
  assert.ok(Math.abs(tinyCoordinate[0] - 118.0000005) < 1e-12);
  assert.ok(Math.abs(tinyCoordinate[1] - 34.0000005) < 1e-12);
  const created = createPlace({ name: "区域", type: "other", address: "", phone: "", description: "", geometry });
  const existing = { ...created, properties: { ...created.properties, longitude: 118.123, latitude: 34.123 } };
  const edited = createPlace({ name: "改名", type: "other", address: "", phone: "", description: "", geometry: structuredClone(geometry) }, existing);
  assert.equal(edited.properties.longitude, 118.123);
  assert.equal(edited.properties.latitude, 34.123);
});

test("creates closed Polygon drafts, inserts on the selected edge and validates only on save", () => {
  const original = polygon("area").geometry;
  const inserted = insertPolygonVertex(original, 1, [118.1, 34.05]);
  assert.deepEqual(inserted.coordinates[0], [[118, 34], [118.1, 34], [118.1, 34.05], [118.1, 34.1], [118, 34]]);
  assert.deepEqual(original.coordinates[0], [[118, 34], [118.1, 34], [118.1, 34.1], [118, 34]]);

  // ai coding：拖拽期间允许形成暂时无效但仍闭合的草稿，正式保存校验会拒绝少于 3 个不同顶点。
  const invalidDraft = createPolygonDraftGeometry([[118, 34], [118, 34], [118.1, 34.1]]);
  assert.deepEqual(invalidDraft.coordinates[0][0], invalidDraft.coordinates[0].at(-1));
  assert.throws(() => validatePolygonGeometry(invalidDraft), /3 个不同顶点/);
});

test("recomputes Polygon representative metadata after geometry editing", () => {
  const existing = createPlace({ name: "区域", type: "other", address: "地址", phone: "", description: "", geometry: polygon("area").geometry });
  const geometry = createPolygonDraftGeometry([[118, 34], [118.2, 34], [118.2, 34.2], [118, 34.2]]);
  const edited = createPlace({ name: existing.properties.name, type: existing.properties.type, address: existing.properties.address, phone: "", description: "", geometry }, existing);
  assert.equal(edited.id, existing.id);
  assert.equal(edited.properties.id, existing.properties.id);
  assert.deepEqual([edited.properties.longitude, edited.properties.latitude], getPolygonRepresentativeCoordinate(geometry));
});

for (const [label, makeFeature] of [["Point", feature], ["LineString", line], ["Polygon", polygon]]) {
  test(`rejects invalid ${label} id and source metadata`, () => {
    const valid = makeFeature(`${label.toLowerCase()}-valid`);
    const withoutTopId = { ...valid }; delete withoutTopId.id;
    const withoutPropertyId = { ...valid, properties: { ...valid.properties } }; delete withoutPropertyId.properties.id;

    // ai coding：Point 与 Polygon 均必须在校验入口拒绝缺失、不一致的 id 及非 user 来源。
    assert.throws(() => validatePlaces(collection(withoutTopId), types), /缺少稳定唯一 id/);
    assert.throws(() => validatePlaces(collection(withoutPropertyId), types), /缺少稳定唯一 id/);
    assert.throws(() => validatePlaces(collection({ ...valid, properties: { ...valid.properties, id: "different" } }), types), /不一致/);
    assert.throws(() => validatePlaces(collection({ ...valid, id: "", properties: { ...valid.properties, id: "" } }), types), /缺少稳定唯一 id/);
    assert.throws(() => validatePlaces(collection({ ...valid, properties: { ...valid.properties, source: "osm" } }), types), /source 必须是 user/);
    assert.throws(() => validatePlaces(collection({ ...valid, properties: { ...valid.properties, source: undefined } }), types), /source 必须是 user/);
    assert.equal(validatePlaces(collection(valid), types).features[0], valid);
  });
}

test("tracks additions, edits and deletions by stable id", () => {
  const baseline = collection(feature("a"), feature("b"));
  assert.equal(getUnsyncedChanges(collection(feature("a"), feature("b")), baseline).count, 0);
  const added = getUnsyncedChanges(collection(feature("a"), feature("b"), feature("c")), baseline);
  assert.equal(added.count, 1); assert.equal(added.currentIds.has("c"), true);
  assert.equal(getUnsyncedChanges(collection(feature("a", "edited"), feature("b")), baseline).count, 1);
  assert.equal(getUnsyncedChanges(collection(feature("a")), baseline).count, 1);
});

test("uses the required conditional save summary", () => {
  assert.equal(getSaveSummary(4, 0), "当前共有4个用户自定义地点");
  assert.equal(getSaveSummary(4, 2), "当前共有4个用户自定义地点，2个地点未保存至本地文件");
});
