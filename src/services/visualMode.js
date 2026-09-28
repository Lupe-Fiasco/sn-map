export const VISUAL_MODES = Object.freeze(["normal", "cyberpunk", "minimal"]);
export const VISUAL_MODE_STORAGE_KEY = "sn-map:visual-mode";

export const VISUAL_MODE_OPTIONS = Object.freeze([
    Object.freeze({ id: "normal", label: "普通模式", description: "保留当前视觉与全部基础图层" }),
    Object.freeze({ id: "cyberpunk", label: "赛博朋克模式", description: "暗色地图、霓虹建筑与动态光波" }),
    Object.freeze({ id: "minimal", label: "极简模式", description: "只显示基础底图与用户地点" }),
]);

export function normalizeVisualMode(value) {
    return VISUAL_MODES.includes(value) ? value : "normal";
}

export function readVisualMode(storage = globalThis.localStorage) {
    try {
        return normalizeVisualMode(storage?.getItem(VISUAL_MODE_STORAGE_KEY));
    } catch {
        return "normal";
    }
}

export function subscribeVisualMode(listener, eventTarget = globalThis) {
    if (!eventTarget?.addEventListener || typeof listener !== "function") return () => {};
    const handleStorage = (event) => {
        if (event.key !== VISUAL_MODE_STORAGE_KEY) return;
        listener(normalizeVisualMode(event.newValue));
    };
    // ai coding：公开页通过标准 storage 事件订阅同一视觉偏好，不引入认证或业务数据初始化。
    eventTarget.addEventListener("storage", handleStorage);
    return () => eventTarget.removeEventListener?.("storage", handleStorage);
}

export function persistVisualMode(value, storage = globalThis.localStorage) {
    const mode = normalizeVisualMode(value);
    try {
        storage?.setItem(VISUAL_MODE_STORAGE_KEY, mode);
    } catch {
        // UI 偏好持久化不可用时仍允许当前会话即时切换。
    }
    return mode;
}

export function applyVisualModeTheme(value, root = globalThis.document?.documentElement) {
    const mode = normalizeVisualMode(value);
    if (!root) return mode;
    // ai coding：主题状态同时写入语义 dataset 与单一 class，供全站卡片、公开页和弹层共享，且不触碰业务数据。
    root.dataset.visualMode = mode;
    root.classList?.remove("theme-normal", "theme-cyberpunk", "theme-minimal");
    root.classList?.add(`theme-${mode}`);
    return mode;
}

// ai coding：模式能力集中定义，2D/3D 渲染器共享同一过滤语义，不接触 owner、map 或地点数据。
export function getVisualModeCapabilities(value) {
    const mode = normalizeVisualMode(value);
    return Object.freeze({
        mode,
        showBaseRoads: mode !== "minimal",
        showProceduralBuildings: mode !== "minimal",
        darkTiles: mode === "cyberpunk",
        cyberEffects: mode === "cyberpunk",
    });
}

export function applyLeafletVisualMode({ map, container, roads, layerControl }, value) {
    const capabilities = getVisualModeCapabilities(value);
    if (!map || !container) return capabilities;

    // ai coding：Leaflet 会把布局 class 写到容器上；只用 classList 增量切换主题，避免 React 覆盖 className 后瓦片 pane 失去定位样式。
    container.classList?.remove(...VISUAL_MODES.map((mode) => `map-visual-${mode}`));
    container.classList?.add(`map-visual-${capabilities.mode}`);

    if (roads && layerControl) {
        layerControl.removeLayer(roads);
        if (capabilities.showBaseRoads) {
            if (!map.hasLayer(roads)) roads.addTo(map);
            layerControl.addOverlay(roads, "OSM 基础道路（只读）");
        } else if (map.hasLayer(roads)) {
            map.removeLayer(roads);
        }
    }
    // 主题滤镜改变后刷新现有 Leaflet 尺寸；不重建地图，因此视野、选择和编辑状态保持不变。
    map.invalidateSize?.({ pan: false });
    return capabilities;
}

export function updateProceduralBuildingMaterial(material, value, elapsedTime = 0) {
    if (!material) return material;
    const cyberEffects = getVisualModeCapabilities(value).cyberEffects;
    material.roughness = cyberEffects ? 0.42 : 0.76;
    if (cyberEffects) {
        material.emissiveIntensity = 0.3 + (Math.sin(elapsedTime * 2.2) + 1) * 0.28;
        material.emissive.setHSL((elapsedTime * 0.035) % 1, 0.9, 0.35);
    } else {
        // ai coding：显式恢复普通材质，避免退出赛博模式后保留动画最后一帧的霓虹自发光。
        material.emissiveIntensity = 0;
        material.emissive.set(0x000000);
    }
    return material;
}
