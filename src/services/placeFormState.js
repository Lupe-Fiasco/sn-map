import { initialTypeForGeometry } from "./placeTypes.js";

export function resolveShapeGeometry(feature, pendingGeometry) {
  if (["LineString", "Polygon"].includes(pendingGeometry?.type)) return pendingGeometry;
  if (["LineString", "Polygon"].includes(feature?.geometry?.type)) return feature.geometry;
  return null;
}

export function createInitialPlaceFormValues(feature, coordinates, geometryType) {
  return {
    name: feature?.properties?.name ?? "",
    type: initialTypeForGeometry(feature?.properties?.type ?? "", geometryType),
    longitude: String(coordinates?.[0] ?? (feature?.geometry?.type === "Point" ? feature.geometry.coordinates?.[0] ?? "" : "")),
    latitude: String(coordinates?.[1] ?? (feature?.geometry?.type === "Point" ? feature.geometry.coordinates?.[1] ?? "" : "")),
    address: feature?.properties?.address ?? "",
    phone: feature?.properties?.phone ?? "",
    description: feature?.properties?.description ?? "",
  };
}
