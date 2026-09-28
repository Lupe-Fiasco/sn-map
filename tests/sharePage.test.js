import test from "node:test";
import assert from "node:assert/strict";
import { createPublicMapViewProps } from "../src/services/publicMapView.js";
import { getVisualModeCapabilities } from "../src/services/visualMode.js";

const data = {
    map: { id: "suining", name: "睢宁县", base_roads_path: "/roads.geojson" },
    bounds: [[33.7, 117.5], [34.3, 118.2]],
    row: { snapshot: { type: "FeatureCollection", features: [] } },
    types: [],
};

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
