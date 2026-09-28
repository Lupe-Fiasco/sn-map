import test from "node:test";
import assert from "node:assert/strict";
import { applyCity3DPanBounds, clampCity3DPan, clearTooltipForKey, getCity3DPanBounds, isUserPlaceHovered, retainInitialTooltipPosition } from "../src/services/city3DInteraction.js";

test("3D 平移边界按投影范围保留少量边距并同步移动相机", () => {
  const bounds = getCity3DPanBounds({ width: 160, height: 96 });
  assert.deepEqual(bounds, { minX: -92.8, maxX: 92.8, minZ: -60.8, maxZ: 60.8, targetY: 0 });

  const result = clampCity3DPan({ x: 120, y: 6, z: -80 }, { x: 150, y: 42, z: -35 }, bounds);
  assert.equal(result.changed, true);
  assert.deepEqual(result.target, { x: 92.8, y: 0, z: -60.8 });
  assert.ok(Math.abs(result.camera.x - 122.8) < 1e-10);
  assert.ok(Math.abs(result.camera.z + 15.8) < 1e-10);
  assert.deepEqual([result.camera.x - result.target.x, result.camera.y - result.target.y, result.camera.z - result.target.z], [30, 36, 45]);
});

test("边界内目标不改变相机，避免影响旋转和缩放", () => {
  const bounds = getCity3DPanBounds({ width: 160, height: 96 });
  const result = clampCity3DPan({ x: 12, y: 0, z: -8 }, { x: 40, y: 30, z: 20 }, bounds);
  assert.equal(result.changed, false);
  assert.deepEqual(result.camera, { x: 40, y: 30, z: 20 });
});

test("连续执行边界约束只修正首次越界，边界内不再写入 controls", () => {
  const writes = { target: 0, camera: 0 };
  const controls = {
    target: { x: 120, y: 0, z: -80, set(x, y, z) { Object.assign(this, { x, y, z }); writes.target += 1; } },
    object: { position: { x: 150, y: 42, z: -35, set(x, y, z) { Object.assign(this, { x, y, z }); writes.camera += 1; } } },
  };
  const bounds = getCity3DPanBounds({ width: 160, height: 96 });

  assert.equal(applyCity3DPanBounds(controls, bounds), true);
  assert.equal(applyCity3DPanBounds(controls, bounds), false);
  assert.equal(applyCity3DPanBounds(controls, bounds), false);
  assert.deepEqual(writes, { target: 1, camera: 1 });
  assert.deepEqual(controls.target, { x: 92.8, y: 0, z: -60.8, set: controls.target.set });
  assert.deepEqual(controls.object.position, { x: 122.8, y: 42, z: -15.799999999999997, set: controls.object.position.set });
});

test("同一道路 pointer move 保留首次位置，pointerout 后可重新记录", () => {
  const road = { key: "road:1", type: "只读基础道路", name: "人民路" };
  const first = retainInitialTooltipPosition(null, road, { x: 24, y: 36 });
  const moved = retainInitialTooltipPosition(first, road, { x: 80, y: 90 });
  assert.strictEqual(moved, first);
  assert.deepEqual(moved.position, { x: 24, y: 36 });
  const cleared = clearTooltipForKey(moved, road.key);
  assert.equal(cleared, null);
  assert.deepEqual(retainInitialTooltipPosition(cleared, road, { x: 80, y: 90 }).position, { x: 80, y: 90 });
});

test("用户地点高亮只响应同一 user hover key，不污染基础道路", () => {
  assert.equal(isUserPlaceHovered({ key: "user:point-1" }, "user:point-1"), true);
  assert.equal(isUserPlaceHovered({ key: "user:area-1" }, "user:point-1"), false);
  assert.equal(isUserPlaceHovered({ key: "road:base-1" }, "user:base-1"), false);
  assert.equal(isUserPlaceHovered(null, "user:point-1"), false);
});
