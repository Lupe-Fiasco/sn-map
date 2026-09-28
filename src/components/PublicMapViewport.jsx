import React, { lazy, Suspense, useMemo, useState } from "react";
import City3DErrorBoundary from "./City3DErrorBoundary.jsx";
import { createPublicCity3DViewProps, createPublicMapViewProps } from "../services/publicMapView.js";
import { getCity3DImportAttempt, hasNextCity3DImportAttempt } from "../services/city3DLoader.js";

export default function PublicMapViewport({ data, selectedId, onSelect, onRoadStatus, visualMode, MapComponent, City3DComponent = null }) {
    const [viewMode, setViewMode] = useState("2d");
    const [city3DImportIndex, setCity3DImportIndex] = useState(0);
    const city3DImportAttempt = getCity3DImportAttempt(city3DImportIndex);
    const LazyCity3DView = useMemo(() => lazy(city3DImportAttempt.load), [city3DImportAttempt]);
    const ThreeDimensionalView = City3DComponent || LazyCity3DView;

    return <>
        <div className="public-view-toolbar">
            {/* ai coding：公开快照仅切换只读渲染器；不挂载管理操作，也不改变快照数据。 */}
            <div className="view-switch" role="group" aria-label="公开地图视图模式">
                <button type="button" className={viewMode === "2d" ? "active" : ""} aria-pressed={viewMode === "2d"} onClick={() => setViewMode("2d")}>2D 地图</button>
                <button type="button" className={viewMode === "3d" ? "active" : ""} aria-pressed={viewMode === "3d"} onClick={() => setViewMode("3d")}>3D 城市</button>
            </div>
            <span>{viewMode === "2d" ? "基础瓦片与快照地点" : "可旋转、缩放与受限平移"}</span>
        </div>
        {viewMode === "2d" ? (
            <MapComponent {...createPublicMapViewProps(data, selectedId, onSelect, onRoadStatus, visualMode)} />
        ) : (
            <City3DErrorBoundary
                onReturnTo2D={() => setViewMode("2d")}
                canRetry={hasNextCity3DImportAttempt(city3DImportIndex)}
                onRetry={() => setCity3DImportIndex((index) => index + 1)}
            >
                <Suspense fallback={<div className="city3d-message" role="status">正在加载 3D 渲染器…</div>}>
                    <ThreeDimensionalView {...createPublicCity3DViewProps(data, onSelect, onRoadStatus, visualMode, () => setViewMode("2d"))} />
                </Suspense>
            </City3DErrorBoundary>
        )}
    </>;
}
