// ai coding：2D 管理端与公开分享页共用较宽松的固定地点层级；3D 距离保持独立。
export const PLACE_SELECTION_ZOOM = Object.freeze({ Point: 16, LineString: 16, Polygon: 15 });

export function getPlaceSelectionCenter(feature) {
  if (feature?.geometry?.type === "Point") return feature.geometry.coordinates;
  const coordinates = feature?.geometry?.type === "Polygon" ? feature.geometry.coordinates?.[0] : feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  return [(Math.min(...longitudes) + Math.max(...longitudes)) / 2, (Math.min(...latitudes) + Math.max(...latitudes)) / 2];
}

export function focusLeafletPlace(map, feature) {
  const center = getPlaceSelectionCenter(feature);
  const zoom = PLACE_SELECTION_ZOOM[feature?.geometry?.type];
  if (!map || !center || !zoom) return false;
  // ai coding：列表选中始终同时更新中心与固定层级，避免沿用此前过近或过远的 zoom。
  map.setView([center[1], center[0]], zoom);
  return true;
}

export function getCity3DSelectionView(place, extent) {
  if (!place?.points?.length) return null;
  const xs = place.points.map(([x]) => x); const zs = place.points.map(([, z]) => z);
  const safeExtent = Number.isFinite(extent) && extent > 0 ? extent : 160;
  return {
    target: [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2],
    distance: safeExtent * (place.geometryType === "Polygon" ? 0.24 : 0.18),
  };
}
