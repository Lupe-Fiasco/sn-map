// ai coding：睢宁主城区边界依据现有地点（117.9313–117.9499, 33.8966–33.9539）及中央大街、元府路等现有 OSM 道路确定。
export const SUINING_MAIN_CITY_BOUNDS = Object.freeze({
  south: 33.86,
  west: 117.88,
  north: 33.96,
  east: 118.01,
});

export function coordinateInBounds([longitude, latitude], bounds) {
  return longitude >= bounds.west && longitude <= bounds.east
    && latitude >= bounds.south && latitude <= bounds.north;
}

export function clipSegmentToBounds(start, end, bounds) {
  const [x1, y1] = start; const [x2, y2] = end;
  const dx = x2 - x1; const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - bounds.west, bounds.east - x1, y1 - bounds.south, bounds.north - y1];
  let low = 0; let high = 1;
  for (let index = 0; index < p.length; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return null;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) low = Math.max(low, ratio); else high = Math.min(high, ratio);
    if (low > high) return null;
  }
  const round = (value) => Number(value.toFixed(7));
  return [[round(x1 + low * dx), round(y1 + low * dy)], [round(x1 + high * dx), round(y1 + high * dy)]];
}

export function clipLineToBounds(points, bounds) {
  const parts = []; let current = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const clipped = clipSegmentToBounds(points[index], points[index + 1], bounds);
    if (!clipped) {
      if (current.length >= 2) parts.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    if (current.length && current.at(-1)[0] === start[0] && current.at(-1)[1] === start[1]) current.push(end);
    else {
      if (current.length >= 2) parts.push(current);
      current = [start, end];
    }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

export function clipRoadCollection(collection, bounds, name = collection.name) {
  const features = (collection.features ?? []).flatMap((feature) => {
    const lines = feature.geometry?.type === "LineString" ? [feature.geometry.coordinates]
      : feature.geometry?.type === "MultiLineString" ? feature.geometry.coordinates : [];
    const parts = lines.flatMap((line) => clipLineToBounds(line, bounds));
    if (!parts.length) return [];
    return [{ ...feature, geometry: parts.length === 1
      ? { type: "LineString", coordinates: parts[0] }
      : { type: "MultiLineString", coordinates: parts } }];
  });
  return { ...collection, name, bbox: [bounds.west, bounds.south, bounds.east, bounds.north], features };
}
