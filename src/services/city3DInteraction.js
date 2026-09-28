export function getCity3DPanBounds(projection, marginRatio = 0.08) {
  const width = Number.isFinite(projection?.width) && projection.width > 0 ? projection.width : 160;
  const height = Number.isFinite(projection?.height) && projection.height > 0 ? projection.height : 160;
  const margin = Math.max(width, height) * Math.max(0, marginRatio);
  return Object.freeze({
    minX: -width / 2 - margin,
    maxX: width / 2 + margin,
    minZ: -height / 2 - margin,
    maxZ: height / 2 + margin,
    targetY: 0,
  });
}

export function clampCity3DPan(target, cameraPosition, bounds) {
  const nextTarget = {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, target.x)),
    y: bounds.targetY,
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, target.z)),
  };
  const delta = {
    x: nextTarget.x - target.x,
    y: nextTarget.y - target.y,
    z: nextTarget.z - target.z,
  };
  return {
    changed: delta.x !== 0 || delta.y !== 0 || delta.z !== 0,
    target: nextTarget,
    camera: {
      x: cameraPosition.x + delta.x,
      y: cameraPosition.y + delta.y,
      z: cameraPosition.z + delta.z,
    },
  };
}

export function applyCity3DPanBounds(controls, bounds) {
  const clamped = clampCity3DPan(controls.target, controls.object.position, bounds);
  if (!clamped.changed) return false;
  controls.target.set(clamped.target.x, clamped.target.y, clamped.target.z);
  controls.object.position.set(clamped.camera.x, clamped.camera.y, clamped.camera.z);
  return true;
}

// ai coding：同一命中对象沿用首次进入坐标；离开清空后再次进入才建立新锚点。
export function retainInitialTooltipPosition(current, item, position) {
  if (current?.key === item.key) return current;
  return { ...item, position: { x: position.x, y: position.y } };
}

export function clearTooltipForKey(current, key) {
  return current?.key === key ? null : current;
}

// ai coding：高亮严格跟随当前用户地点 hover key，基础道路和背景建筑永远不会误触发。
export function isUserPlaceHovered(hover, placeKey) {
  return Boolean(placeKey?.startsWith("user:") && hover?.key === placeKey);
}
