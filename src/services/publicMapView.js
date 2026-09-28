// ai coding：公开页统一在此组装 MapView 参数，使视觉模式传递与只读约束可独立执行测试。
export function createPublicMapViewProps(data, selectedId, onSelect, onRoadStatus, visualMode) {
    return {
        mapId: data.map.id,
        bounds: data.bounds,
        mapName: data.map.name,
        baseRoadsPath: data.map.base_roads_path,
        places: data.row.snapshot,
        types: data.types,
        selectedId,
        onSelect,
        onRoadStatus,
        readOnly: true,
        visualMode,
    };
}
