const WATER_WORDS = ["river", "water", "waterway", "canal", "stream", "drain", "ditch", "河流", "河道", "水系", "水道", "沟渠", "溪", "湖"];
const ROAD_WORDS = ["road", "street", "highway", "lane", "alley", "bridge", "linear-feature", "道路", "公路", "街", "路", "巷", "桥"];

// ai coding：只缩放建筑 X/Z 占地，不改变高度、道路宽度或用户 Polygon 的真实投影范围。
export const CITY_BUILDING_FOOTPRINT_SCALE = 0.28;

// ai coding：所有 3D 楼体在数据生成阶段统一降低高度，保留分类档位且不改变贴地位置或 Polygon 范围。
export const CITY_BUILDING_HEIGHT_SCALE = 0.55;

const PLACE_PROFILES = Object.freeze({
  retail: Object.freeze({ label: "商业建筑", tier: "low", height: 0.8, width: 0.72, depth: 0.58, color: "#c98b5c", roof: "#f0c98d", groupCount: 4 }),
  civic: Object.freeze({ label: "公共/办公建筑", tier: "medium-high", height: 3.6, width: 1.05, depth: 0.82, color: "#7189a6", roof: "#aebed0", groupCount: 4 }),
  residential: Object.freeze({ label: "居民建筑群", tier: "medium", height: 2.35, width: 0.82, depth: 0.62, color: "#ad8f77", roof: "#d6bba0", groupCount: 8 }),
  campus: Object.freeze({ label: "校园建筑群", tier: "low-medium", height: 1.55, width: 1.08, depth: 0.62, color: "#b27a62", roof: "#dbc19e", groupCount: 6 }),
  leisure: Object.freeze({ label: "休闲设施", tier: "low", height: 0.65, width: 0.68, depth: 0.58, color: "#6e9c72", roof: "#a8c98e", groupCount: 3 }),
  transport: Object.freeze({ label: "公共设施", tier: "low-medium", height: 1.25, width: 1.12, depth: 0.68, color: "#78878c", roof: "#b8c2c2", groupCount: 3 }),
  standard: Object.freeze({ label: "地点建筑", tier: "medium", height: 1.85, width: 0.82, depth: 0.68, color: "#8d8174", roof: "#c1b5a5", groupCount: 4 }),
});

export const CITY_3D_STYLE = Object.freeze({
  baseRoads: Object.freeze({
    major: Object.freeze({ color: "#697176", width: 0.62 }),
    primary: Object.freeze({ color: "#858d91", width: 0.46 }),
    local: Object.freeze({ color: "#a4aaac", width: 0.28 }),
  }),
  userLines: Object.freeze({
    road: Object.freeze({ color: "#727b80", visibleWidth: 0.24, hitWidth: 0.5, elevation: 0.1 }),
    water: Object.freeze({ color: "#3189bd", visibleWidth: 0.3, hitWidth: 0.54, elevation: 0.095 }),
  }),
  polygon: Object.freeze({ elevation: 0.075, opacity: 0.2 }),
});

function classificationParts(values) {
  return values
    .flatMap((value) => typeof value === "object" && value ? [value.id, value.name, value.label] : [value])
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.toLocaleLowerCase("zh-CN"));
}

function classificationText(values) {
  return classificationParts(values).join(" ");
}

function valuesForClassification(place) {
  const properties = place?.properties ?? {};
  const keys = ["type", "type_id", "typeId", "type_name", "typeName", "category", "category_id", "kind", "class", "amenity", "shop", "building", "waterway", "name", "title", "label"];
  return classificationText([...keys.map((key) => properties[key]), ...keys.map((key) => place?.[key])]);
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

// ai coding：先逐项采用规范/兼容类型字段，只有类型无法判定时才回退到名称关键词，避免道路名称中的“河/湖”改变线色。
export function classifyLinearPlace(place) {
  const properties = place?.properties ?? {};
  const typeKeys = ["type", "type_id", "typeId", "type_name", "typeName", "category", "category_id", "categoryId", "kind", "class", "amenity", "shop", "building", "waterway"];
  const typeValues = [...typeKeys.map((key) => properties[key]), ...typeKeys.map((key) => place?.[key])];
  for (const value of typeValues) {
    for (const typeText of classificationParts([value])) {
      if (includesAny(typeText, WATER_WORDS)) return "water";
      if (includesAny(typeText, ROAD_WORDS)) return "road";
    }
  }
  const fallbackText = classificationText([properties.name, properties.title, properties.label, place?.name, place?.title, place?.label]);
  if (includesAny(fallbackText, WATER_WORDS)) return "water";
  if (includesAny(fallbackText, ROAD_WORDS)) return "road";
  return "road";
}

// ai coding：地点语义与视觉参数分离，后续可在 profile 中扩展窗户、屋顶和牌匾配置。
export function classifyPlaceBuilding(place) {
  const text = valuesForClassification(place);
  let category = "standard";
  if (includesAny(text, ["school", "education", "training", "学校", "校园", "教育", "培训", "文化场馆"])) category = "campus";
  else if (includesAny(text, ["residential", "community", "小区", "住宅", "居民", "社区"])) category = "residential";
  else if (includesAny(text, ["hospital", "government", "office", "company", "corporation", "bank", "hotel", "医院", "政府", "机关", "办公", "公司", "企业", "银行", "酒店"])) category = "civic";
  else if (includesAny(text, ["shop", "store", "restaurant", "market", "supermarket", "mall", "pharmacy", "salon", "商店", "商铺", "餐", "市场", "超市", "药店", "便利店", "专卖店", "商业"])) category = "retail";
  else if (includesAny(text, ["park", "attraction", "fitness", "entertainment", "公园", "景点", "休闲", "运动"])) category = "leisure";
  else if (includesAny(text, ["station", "parking", "toilet", "logistics", "gas", "auto", "公交", "车站", "停车", "公厕", "物流", "加油", "汽车"])) category = "transport";
  const profile = PLACE_PROFILES[category];
  return { category, ...profile, height: profile.height * CITY_BUILDING_HEIGHT_SCALE };
}

export function getCity3DCameraConfig(extent) {
  const safeExtent = Number.isFinite(extent) && extent > 0 ? extent : 160;
  return Object.freeze({ minDistance: 4, maxDistance: safeExtent * 2.4 });
}
