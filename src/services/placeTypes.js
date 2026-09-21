export const LINE_PLACE_TYPE_IDS = Object.freeze(["road", "alley", "river", "bridge"]);
const compatibleLineTypeIds = new Set([...LINE_PLACE_TYPE_IDS, "linear-feature"]);

export function isTypeAllowedForGeometry(typeId, geometryType) {
  return geometryType === "LineString"
    ? compatibleLineTypeIds.has(typeId)
    : !compatibleLineTypeIds.has(typeId);
}

export function getTypeOptionsForGeometry(types, geometryType) {
  // ai coding：旧 linear-feature 仅保留为数据兼容项；任何新建/编辑选项均按几何隔离，防止线类型用于点或区域。
  return types.filter((type) => !type.hidden && isTypeAllowedForGeometry(type.id, geometryType));
}

export function initialTypeForGeometry(typeId, geometryType) {
  if (geometryType === "LineString") return LINE_PLACE_TYPE_IDS.includes(typeId) ? typeId : "road";
  return isTypeAllowedForGeometry(typeId, geometryType) ? typeId : "";
}
