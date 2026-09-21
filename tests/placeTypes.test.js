import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TYPE_ICON_PATHS } from "../src/components/typeIconRegistry.js";
import { validatePlaces } from "../src/services/geojson.js";
import { getTypeOptionsForGeometry, isTypeAllowedForGeometry, LINE_PLACE_TYPE_IDS } from "../src/services/placeTypes.js";

const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
const placeTypes = await readJson("../public/data/place-types.json");

test("place type ids, icons and colors are unique, valid and registered", () => {
  const ids = new Set(); const icons = new Set(); const colors = new Set();
  for (const type of placeTypes) {
    // ai coding：配置标识只允许稳定的 kebab-case，颜色只允许六位十六进制，图标必须来自共享 SVG 白名单。
    assert.match(type.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, `${type.name} id 非法`);
    assert.match(type.icon, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, `${type.name} icon 非法`);
    assert.match(type.color, /^#[0-9a-f]{6}$/i, `${type.name} color 非法`);
    assert.equal(ids.has(type.id), false, `重复 id: ${type.id}`);
    assert.equal(icons.has(type.icon), false, `重复 icon: ${type.icon}`);
    assert.equal(colors.has(type.color.toLowerCase()), false, `重复 color: ${type.color}`);
    assert.equal(typeof TYPE_ICON_PATHS[type.icon], "string", `未注册 icon: ${type.icon}`);
    assert.notEqual(TYPE_ICON_PATHS[type.icon].trim(), "", `空 SVG path: ${type.icon}`);
    ids.add(type.id); icons.add(type.icon); colors.add(type.color.toLowerCase());
  }
});

test("configured types are restricted to compatible geometry", () => {
  for (const type of placeTypes) {
    for (const [geometryType, coordinates] of [["Point", [118, 34]], ["LineString", [[118, 34], [118.1, 34.1]]], ["Polygon", [[[118, 34], [118.1, 34], [118.1, 34.1], [118, 34]]]]]) {
      const id = `${type.id}-${geometryType}`;
      const collection = { type: "FeatureCollection", features: [{ type: "Feature", id, geometry: { type: geometryType, coordinates }, properties: { id, source: "user", name: type.name, type: type.id } }] };
      const assertion = isTypeAllowedForGeometry(type.id, geometryType) ? assert.doesNotThrow : assert.throws;
      assertion(() => validatePlaces(collection, placeTypes), `${type.id}/${geometryType}`);
    }
  }
});

test("line forms expose four semantic types and hide the legacy generic type", () => {
  const options = getTypeOptionsForGeometry(placeTypes, "LineString");
  assert.deepEqual(options.map((type) => type.id), LINE_PLACE_TYPE_IDS);
  assert.deepEqual(options.map((type) => type.name), ["道路", "小巷", "河流", "桥梁"]);
  assert.equal(placeTypes.find((type) => type.id === "linear-feature")?.hidden, true);
  assert.equal(getTypeOptionsForGeometry(placeTypes, "Point").some((type) => LINE_PLACE_TYPE_IDS.includes(type.id)), false);
  assert.equal(getTypeOptionsForGeometry(placeTypes, "Polygon").some((type) => LINE_PLACE_TYPE_IDS.includes(type.id)), false);
});

test("seed places use the reviewed types for exact ids and names", async () => {
  const places = await readJson("../public/data/places.geojson");
  // ai coding：按已审核的地点语义精确锁定种子类型，商业综合体与商业街区使用各自稳定配置 id。
  const expected = new Map([
    ["735fa0e5-2da3-4af7-ba91-213ee5709c9c", ["兴美城市广场", "shopping-mall"]],
    ["f22e59ff-3142-46a2-b02d-b485c1956871", ["万象天地", "commercial-district"]],
    ["8539c6ca-44a6-490f-9042-cfa18d0c182d", ["五星电器", "brand-store"]],
    ["e1379815-7b2d-4813-8d1d-2d4f4bae3c35", ["中国城", "commercial-district"]],
    ["eab50dda-aebd-40f8-91be-7d8812cac1a8", ["柳琴剧团", "cultural-venue"]],
  ]);
  for (const [id, [name, type]] of expected) {
    const matches = places.features.filter((feature) => feature.id === id && feature.properties.id === id && feature.properties.name === name);
    assert.equal(matches.length, 1, `${name} 的 id/name 未精确匹配`);
    assert.equal(matches[0].properties.type, type);
  }
  assert.doesNotThrow(() => validatePlaces(places, placeTypes));
});
