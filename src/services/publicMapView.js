import { resolveMapViewConfig, validateMapConfig } from "./maps.js";

// ai coding：公开页以快照标识定位当前地区配置，避免旧快照内的历史范围绕过主城区 bounds/道路更新。
export async function resolvePublicMapData(row, types, fetchJson) {
    const publishedMap = validateMapConfig(row?.map_config);
    const currentMap = validateMapConfig(await fetchJson(`/data/regions/${publishedMap.slug}/map-config.json`));
    if (currentMap.id !== publishedMap.id) throw new Error("公开快照的地图配置不匹配");
    const viewConfig = resolveMapViewConfig(currentMap);
    return { loading: false, error: "", row, map: currentMap, bounds: viewConfig.bounds, viewConfig, types };
}

// ai coding：公开页统一在此组装 2D/3D 参数，使完整快照、视觉模式和只读约束可独立执行测试。
export function createPublicMapViewProps(data, selectedId, onSelect, onRoadStatus, visualMode) {
    return {
        mapId: data.map.id,
        bounds: data.viewConfig.bounds,
        mapName: data.map.name,
        baseRoadsPath: data.viewConfig.baseRoadsPath,
        places: data.row.snapshot,
        types: data.types,
        selectedId,
        onSelect,
        onRoadStatus,
        readOnly: true,
        visualMode,
    };
}

export function createPublicCity3DViewProps(data, selectedId, onSelect, onRoadStatus, visualMode, onFallbackTo2D) {
    return {
        mapId: data.map.id,
        mapName: data.map.name,
        bounds: data.viewConfig.bounds,
        baseRoadsPath: data.viewConfig.baseRoadsPath,
        places: data.row.snapshot,
        // ai coding：公开列表选中状态只传给只读 3D 视图，用于复用既有相机定位与边界约束。
        selectedId,
        onSelect,
        onRoadStatus,
        onFallbackTo2D,
        readOnly: true,
        visualMode,
    };
}
