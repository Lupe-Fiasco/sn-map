import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
    VISUAL_MODE_STORAGE_KEY,
    applyLeafletVisualMode,
    applyVisualModeTheme,
    getVisualModeCapabilities,
    normalizeVisualMode,
    persistVisualMode,
    readVisualMode,
    subscribeVisualMode,
    updateProceduralBuildingMaterial,
} from "../src/services/visualMode.js";

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        values,
    };
}

test("视觉模式仅接受合法值并可独立持久化", () => {
    const storage = memoryStorage({ [VISUAL_MODE_STORAGE_KEY]: "cyberpunk" });
    assert.equal(readVisualMode(storage), "cyberpunk");
    assert.equal(persistVisualMode("minimal", storage), "minimal");
    assert.equal(storage.values.get(VISUAL_MODE_STORAGE_KEY), "minimal");
    assert.equal(normalizeVisualMode("unknown"), "normal");
    assert.equal(persistVisualMode("unknown", storage), "normal");
});

test("视觉模式订阅仅响应同一持久化键并可解除监听", () => {
    let handler;
    const target = {
        addEventListener: (name, callback) => { assert.equal(name, "storage"); handler = callback; },
        removeEventListener: (name, callback) => { assert.equal(name, "storage"); assert.equal(callback, handler); handler = null; },
    };
    const modes = [];
    const unsubscribe = subscribeVisualMode((mode) => modes.push(mode), target);
    handler({ key: "other", newValue: "minimal" });
    handler({ key: VISUAL_MODE_STORAGE_KEY, newValue: "cyberpunk" });
    handler({ key: VISUAL_MODE_STORAGE_KEY, newValue: "invalid" });
    assert.deepEqual(modes, ["cyberpunk", "normal"]);
    unsubscribe();
    assert.equal(handler, null);
});

test("主题工具为赛博模式设置可执行的根节点状态并清理旧模式 class", () => {
    const classes = new Set(["theme-normal", "application-root"]);
    const root = {
        dataset: {},
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
        },
    };

    assert.equal(applyVisualModeTheme("cyberpunk", root), "cyberpunk");
    assert.equal(root.dataset.visualMode, "cyberpunk");
    assert.equal(classes.has("theme-cyberpunk"), true);
    assert.equal(classes.has("theme-normal"), false);
    assert.equal(classes.has("application-root"), true);

    applyVisualModeTheme("invalid", root);
    assert.equal(root.dataset.visualMode, "normal");
    assert.equal(classes.has("theme-normal"), true);
    assert.equal(classes.has("theme-cyberpunk"), false);
});

test("极简模式过滤所有基础内容但保留用户地点语义", () => {
    assert.deepEqual(getVisualModeCapabilities("minimal"), {
        mode: "minimal",
        showBaseRoads: false,
        showProceduralBuildings: false,
        darkTiles: false,
        cyberEffects: false,
    });
});

test("赛博模式启用暗色瓦片和动态 3D 效果且保留基础图层", () => {
    assert.deepEqual(getVisualModeCapabilities("cyberpunk"), {
        mode: "cyberpunk",
        showBaseRoads: true,
        showProceduralBuildings: true,
        darkTiles: true,
        cyberEffects: true,
    });
});

test("2D 模式切换保留 Leaflet 容器 class、瓦片和用户地点，只按模式切换基础道路", () => {
    const classes = new Set(["map-view", "leaflet-container", "leaflet-touch", "map-visual-normal"]);
    const tiles = { id: "tiles" };
    const roads = { id: "roads", addTo: (map) => map.layers.add(roads) };
    const places = { id: "places" };
    const map = {
        layers: new Set([tiles, roads, places]),
        hasLayer(layer) { return this.layers.has(layer); },
        removeLayer(layer) { this.layers.delete(layer); },
        invalidateSizeOptions: null,
        invalidateSize(options) { this.invalidateSizeOptions = options; },
    };
    const labels = [];
    const layerControl = {
        removeLayer: () => {},
        addOverlay: (layer, label) => labels.push([layer, label]),
    };
    const container = {
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
        },
    };

    applyLeafletVisualMode({ map, container, roads, layerControl }, "cyberpunk");
    assert.equal(classes.has("leaflet-container"), true);
    assert.equal(classes.has("leaflet-touch"), true);
    assert.equal(classes.has("map-visual-cyberpunk"), true);
    assert.equal(map.layers.has(tiles), true);
    assert.equal(map.layers.has(roads), true);
    assert.equal(map.layers.has(places), true);

    applyLeafletVisualMode({ map, container, roads, layerControl }, "minimal");
    assert.equal(map.layers.has(tiles), true);
    assert.equal(map.layers.has(roads), false);
    assert.equal(map.layers.has(places), true);

    applyLeafletVisualMode({ map, container, roads, layerControl }, "normal");
    assert.equal(map.layers.has(tiles), true);
    assert.equal(map.layers.has(roads), true);
    assert.equal(map.layers.has(places), true);
    assert.deepEqual(map.invalidateSizeOptions, { pan: false });
    assert.equal(labels.at(-1)[1], "OSM 基础道路（只读）");
});

test("背景建筑材质从赛博切回普通或极简时清除霓虹，并可再次启动动画", () => {
    for (const targetMode of ["normal", "minimal"]) {
        const material = new THREE.MeshStandardMaterial();
        updateProceduralBuildingMaterial(material, "cyberpunk", 3.2);
        assert.ok(material.emissiveIntensity > 0);
        assert.notEqual(material.emissive.getHex(), 0x000000);

        updateProceduralBuildingMaterial(material, targetMode, 4.1);
        assert.equal(material.emissiveIntensity, 0);
        assert.equal(material.emissive.getHex(), 0x000000);
        assert.equal(material.roughness, 0.76);

        updateProceduralBuildingMaterial(material, "cyberpunk", 5.6);
        assert.ok(material.emissiveIntensity > 0);
        assert.notEqual(material.emissive.getHex(), 0x000000);
        assert.equal(material.roughness, 0.42);
        material.dispose();
    }
});
