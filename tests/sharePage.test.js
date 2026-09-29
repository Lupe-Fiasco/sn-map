import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import City3DView from "../src/components/City3DView.jsx";
import PublicMapViewport from "../src/components/PublicMapViewport.jsx";
import PublicSharePageFrame from "../src/components/PublicSharePageFrame.jsx";
import { createPublicCity3DViewProps, createPublicMapViewProps, resolvePublicMapData } from "../src/services/publicMapView.js";
import { getVisualModeCapabilities } from "../src/services/visualMode.js";
import { createLocalProjection } from "../src/services/cityProjection.js";
import { getCity3DPanBounds } from "../src/services/city3DInteraction.js";

const data = {
    map: { id: "suining", name: "睢宁县" },
    viewConfig: { bounds: { south: 33.86, west: 117.88, north: 33.96, east: 118.01 }, baseRoadsPath: "/data/regions/suining/base-roads-main-city.geojson" },
    row: { snapshot: { type: "FeatureCollection", features: [{ id: "place-1", geometry: { type: "Point", coordinates: [117.94, 33.91] }, properties: { name: "测试地点", type: "other" } }] } },
    types: [],
};

test("公开页非地图状态实际挂载在全视口页面画布中", () => {
    for (const role of ["status", "alert"]) {
        const renderer = TestRenderer.create(React.createElement(PublicSharePageFrame, null,
            React.createElement("main", { className: "share-message", role }, role)));
        const frame = renderer.root.find((node) => node.type === "div" && node.props.className?.includes("public-share-page"));
        assert.match(frame.props.className, /cyber:bg-\[#070b18\]/);
        assert.equal(renderer.root.findByProps({ role }).parent, frame);
        renderer.unmount();
    }
});

test("公开地图真实 props 路径传递当前视觉模式并保持只读", () => {
    for (const mode of ["cyberpunk", "minimal"]) {
        const props = createPublicMapViewProps(data, null, () => {}, () => {}, mode);
        assert.equal(props.visualMode, mode);
        assert.equal(props.readOnly, true);
        assert.equal(props.places, data.row.snapshot);
        assert.equal(getVisualModeCapabilities(props.visualMode).showBaseRoads, mode !== "minimal");
        assert.equal(getVisualModeCapabilities(props.visualMode).darkTiles, mode === "cyberpunk");
    }
});

test("公开快照使用当前 map-config 的主城区范围和道路，而非历史发布配置", async () => {
    const historical = {
        id: "suining", slug: "suining", name: "旧睢宁", bounds: { south: 33.6, west: 117.4, north: 34.2, east: 118.2 },
        center: { lat: 33.9, lon: 117.9 }, base_roads_path: "/data/regions/suining/base-roads.geojson", seed_places_path: "/data/regions/suining/places.geojson",
    };
    const current = {
        ...historical, name: "睢宁县", bounds: data.viewConfig.bounds, center: { lat: 33.91, lon: 117.945 },
        base_roads_path: data.viewConfig.baseRoadsPath,
    };
    const resolved = await resolvePublicMapData({ map_config: historical, snapshot: data.row.snapshot }, [], async (url) => {
        assert.equal(url, "/data/regions/suining/map-config.json");
        return current;
    });
    assert.deepEqual(resolved.viewConfig, data.viewConfig);
});

test("公开页可执行切换 2D/3D，并向两种渲染器传递同一完整快照和只读范围", () => {
    function Fake2D(props) { return React.createElement("fake-2d", props); }
    function Fake3D(props) { return React.createElement("fake-3d", props); }
    const renderer = TestRenderer.create(React.createElement(PublicMapViewport, {
        data, selectedId: "place-1", onSelect: () => {}, onRoadStatus: () => {}, visualMode: "cyberpunk",
        MapComponent: Fake2D, City3DComponent: Fake3D,
    }));
    const twoDimensional = renderer.root.findByType("fake-2d").props;
    assert.equal(twoDimensional.places, data.row.snapshot);
    assert.equal(twoDimensional.readOnly, true);
    assert.deepEqual(twoDimensional.bounds, data.viewConfig.bounds);
    assert.equal(twoDimensional.baseRoadsPath, data.viewConfig.baseRoadsPath);

    act(() => renderer.root.findByProps({ children: "3D 城市" }).props.onClick());
    const threeDimensional = renderer.root.findByType("fake-3d").props;
    assert.equal(threeDimensional.places, data.row.snapshot);
    assert.equal(threeDimensional.readOnly, true);
    assert.equal(threeDimensional.visualMode, "cyberpunk");
    assert.deepEqual(threeDimensional.bounds, data.viewConfig.bounds);
    assert.equal(threeDimensional.baseRoadsPath, data.viewConfig.baseRoadsPath);
    const panBounds = getCity3DPanBounds(createLocalProjection(threeDimensional.bounds));
    assert.ok(panBounds.minX < 0 && panBounds.maxX > 0 && panBounds.minZ < 0 && panBounds.maxZ > 0);

    act(() => renderer.root.findByProps({ children: "2D 地图" }).props.onClick());
    assert.equal(renderer.root.findByType("fake-2d").props.places, data.row.snapshot);
    renderer.unmount();
});

test("公开 3D props 不包含任何写入或管理回调", () => {
    const props = createPublicCity3DViewProps(data, () => {}, () => {}, "minimal");
    assert.equal(props.readOnly, true);
    for (const operation of ["onSave", "onDelete", "onEdit", "auth", "admin"]) assert.equal(operation in props, false);
    assert.equal(getVisualModeCapabilities(props.visualMode).showBaseRoads, false);
});

test("公开 3D 道路失败降级回调通过安全配置返回 2D", () => {
    function Fake2D(props) { return React.createElement("fake-2d", props); }
    function Fake3D(props) {
        return React.createElement("button", { type: "button", onClick: props.onFallbackTo2D }, "模拟道路加载失败并返回 2D");
    }
    const renderer = TestRenderer.create(React.createElement(PublicMapViewport, {
        data, selectedId: null, onSelect: () => {}, onRoadStatus: () => {}, visualMode: "normal",
        MapComponent: Fake2D, City3DComponent: Fake3D,
    }));

    act(() => renderer.root.findByProps({ children: "3D 城市" }).props.onClick());
    const fallback = renderer.root.findByProps({ children: "模拟道路加载失败并返回 2D" });
    assert.equal(typeof fallback.props.onClick, "function");
    act(() => fallback.props.onClick());
    assert.equal(renderer.root.findByType("fake-2d").props.readOnly, true);
    renderer.unmount();
});

test("City3DView 基础道路请求失败时提供可执行的 2D 降级入口", async () => {
    const originalFetch = globalThis.fetch;
    const originalReact = globalThis.React;
    const originalConsoleError = console.error;
    let fallbackCount = 0;
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    globalThis.React = React;
    console.error = () => {};
    try {
        let renderer;
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(City3DView, {
                mapId: data.map.id,
                mapName: data.map.name,
                bounds: data.viewConfig.bounds,
                baseRoadsPath: data.viewConfig.baseRoadsPath,
                places: data.row.snapshot,
                readOnly: true,
                onFallbackTo2D: () => { fallbackCount += 1; },
            }));
            await Promise.resolve();
            await Promise.resolve();
        });

        assert.equal(renderer.root.findByProps({ role: "alert" }).findByType("strong").children.join(""), "3D 城市数据加载失败");
        act(() => renderer.root.findByProps({ children: "返回 2D 地图" }).props.onClick());
        assert.equal(fallbackCount, 1);
        assert.ok(renderer.root.findByProps({ children: "重新加载" }));
        renderer.unmount();
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.React = originalReact;
        console.error = originalConsoleError;
    }
});
