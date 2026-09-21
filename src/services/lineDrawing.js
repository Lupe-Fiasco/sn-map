export function distinctVertexCount(coordinates) {
  return new Set((coordinates ?? []).map(([longitude, latitude]) => `${longitude},${latitude}`)).size;
}

export function canFinishLine(coordinates) {
  return distinctVertexCount(coordinates) >= 2;
}

export function finishLineDrawing(coordinates) {
  const openCoordinates = (coordinates ?? []).map((position) => position.slice(0, 2));
  // ai coding：即使末点误点回首点也移除闭合点，LineString 草稿和最终保存几何始终保持开放。
  while (openCoordinates.length > 1 && samePosition(openCoordinates[0], openCoordinates.at(-1))) openCoordinates.pop();
  if (!canFinishLine(openCoordinates)) return { geometry: null, message: "至少绘制 2 个不同顶点后才能结束线绘制" };
  return { geometry: { type: "LineString", coordinates: openCoordinates }, message: "线已完成，请填写地点信息后保存" };
}

export function finishAreaDrawing(coordinates) {
  if (distinctVertexCount(coordinates) < 3) return { geometry: null, message: "至少需要 3 个点（且顶点各不相同）才能闭合区域" };
  const vertices = coordinates.map((position) => position.slice(0, 2));
  return { geometry: { type: "Polygon", coordinates: [[...vertices, vertices[0].slice()]] }, message: "区域已闭合，请填写地点信息后保存" };
}

export function drawingContextAction({ button = 0, mode = "line", coordinates = [] } = {}) {
  if (button !== 2) return { preventDefault: false, finish: false, message: "" };
  if (!["line", "area"].includes(mode)) return { preventDefault: false, finish: false, message: "" };
  const result = mode === "area" ? finishAreaDrawing(coordinates) : finishLineDrawing(coordinates);
  return { preventDefault: true, finish: Boolean(result.geometry), ...result };
}

function samePosition(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}
