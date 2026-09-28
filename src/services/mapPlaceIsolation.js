const EMPTY_PLACES = Object.freeze({ type: "FeatureCollection", features: Object.freeze([]) });

// ai coding：渲染层只读取与当前 owner + map scope 完全一致的地点，地区切换首帧即隔离旧集合。
export function placesForScope(placeState, expectedScope) {
  return placeState?.scope === expectedScope ? placeState.collection : EMPTY_PLACES;
}
