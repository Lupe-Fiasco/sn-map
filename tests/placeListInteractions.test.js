import test from "node:test";
import assert from "node:assert/strict";
import { filterPlaces, toggleTypeSelection } from "../src/services/placeFiltering.js";
import { PLACE_SELECTION_ZOOM, focusLeafletPlace, getCity3DSelectionView } from "../src/services/mapSelection.js";
import { inferToastType, toastItemClassName, toastReducer } from "../src/services/toast.js";

const features = [
  { id: "a", properties: { name: "人民公园", address: "青年路", type: "park" }, geometry: { type: "Point", coordinates: [117.94, 33.9] } },
  { id: "b", properties: { name: "实验学校", address: "文学路", type: "school" }, geometry: { type: "Point", coordinates: [117.95, 33.91] } },
  { id: "c", properties: { name: "中心公园", address: "文学路", type: "park" }, geometry: { type: "Point", coordinates: [117.96, 33.92] } },
];

test("多选地点筛选支持空集、多个类型和全选，并保持搜索组合", () => {
  assert.deepEqual(filterPlaces(features, "", []).map(({ id }) => id), ["a", "b", "c"]);
  assert.deepEqual(filterPlaces(features, "", ["park", "school"]).map(({ id }) => id), ["a", "b", "c"]);
  assert.deepEqual(filterPlaces(features, "文学", ["park", "school"]).map(({ id }) => id), ["b", "c"]);
  assert.deepEqual(filterPlaces(features, "", ["school"]).map(({ id }) => id), ["b"]);
  assert.deepEqual(toggleTypeSelection(["park"], "school"), ["park", "school"]);
  assert.deepEqual(toggleTypeSelection(["park", "school"], "park"), ["school"]);
});

test("toast 队列保留类型并提供可执行的退出状态 class", () => {
  let state = toastReducer([], { type: "add", toast: { id: 1, message: "保存成功", type: inferToastType("保存成功"), exiting: false } });
  state = toastReducer(state, { type: "dismiss", id: 1 });
  assert.equal(state[0].type, "success");
  assert.equal(state[0].exiting, true);
  assert.match(toastItemClassName(state[0].type, state[0].exiting), /opacity-0/);
  assert.match(toastItemClassName(state[0].type, state[0].exiting), /-translate-y-2/);
  assert.deepEqual(toastReducer(state, { type: "remove", id: 1 }), []);
  assert.equal(inferToastType("同步失败"), "error");
  assert.equal(inferToastType("请先完成操作"), "warning");
});

test("选中地点固定 zoom 并通过 setView 同时定位中心", () => {
  const calls = [];
  const map = { setView: (...args) => calls.push(args) };
  assert.equal(PLACE_SELECTION_ZOOM.Point, 16);
  assert.equal(PLACE_SELECTION_ZOOM.LineString, 16);
  assert.equal(PLACE_SELECTION_ZOOM.Polygon, 15);
  focusLeafletPlace(map, features[0]);
  focusLeafletPlace(map, { geometry: { type: "Polygon", coordinates: [[[117.9, 33.8], [118.1, 33.8], [118.1, 34], [117.9, 33.8]]] } });
  assert.deepEqual(calls[0], [[33.9, 117.94], 16]);
  assert.deepEqual(calls[1], [[33.9, 118], 15]);
});

test("3D 选中视角按形态使用稳定 target 和 distance", () => {
  const point = getCity3DSelectionView({ geometryType: "Point", points: [[3, 4]] }, 100);
  const polygon = getCity3DSelectionView({ geometryType: "Polygon", points: [[0, 0], [10, 8], [0, 0]] }, 100);
  assert.deepEqual(point, { target: [3, 0, 4], distance: 18 });
  assert.deepEqual(polygon, { target: [5, 0, 4], distance: 24 });
});
