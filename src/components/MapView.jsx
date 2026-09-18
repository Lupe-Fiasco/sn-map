import { useEffect, useRef } from "react";
import L from "leaflet";
import { TYPE_ICON_PATHS } from "./TypeIcon.jsx";
import { createPolygonDraftGeometry, insertPolygonVertex } from "../services/geojson.js";

const MAX_ZOOM = 19;
const padding = L.point(12, 12);
const SVG_NS = "http://www.w3.org/2000/svg";
function markerMetrics(zoom) {
    if (zoom >= 14) return { width: 32, height: 40 };
    if (zoom >= 12) return { width: 26, height: 33 };
    return { width: 20, height: 25 };
}

function createPlaceMarker(type, selected, metrics) {
    // ai coding：完全通过 DOM/SVG API 构造标记，配置和地点名称均不拼接为 HTML。
    const marker = document.createElement("span");
    marker.className = `place-marker${selected ? " selected" : ""}`;
    marker.style.width = `${metrics.width}px`;
    marker.style.height = `${metrics.height}px`;
    marker.style.setProperty("--marker-select-lift", `${Math.max(1, Math.round(metrics.height * 0.05))}px`);
    marker.style.setProperty("--marker-color", /^#[0-9a-f]{6}$/i.test(type?.color) ? type.color : "#65736f");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 32 40");
    svg.setAttribute("aria-hidden", "true");
    const pin = document.createElementNS(SVG_NS, "path");
    pin.setAttribute("class", "marker-pin");
    pin.setAttribute("d", "M16 1C7.7 1 2 7.2 2 15c0 10 14 24 14 24s14-14 14-24C30 7.2 24.3 1 16 1Z");
    const symbol = document.createElementNS(SVG_NS, "svg");
    symbol.setAttribute("x", "6"); symbol.setAttribute("y", "5"); symbol.setAttribute("width", "20"); symbol.setAttribute("height", "20"); symbol.setAttribute("viewBox", "0 0 24 24");
    const glyph = document.createElementNS(SVG_NS, "path");
    glyph.setAttribute("class", "marker-symbol");
    glyph.setAttribute("d", TYPE_ICON_PATHS[type?.icon] || TYPE_ICON_PATHS.other);
    symbol.appendChild(glyph); svg.append(pin, symbol); marker.appendChild(svg);
    return marker;
}

function createPlaceIcon(type, selected, zoom) {
    const metrics = markerMetrics(zoom);
    return L.divIcon({
        className: "",
        html: createPlaceMarker(type, selected, metrics),
        iconSize: [metrics.width, metrics.height],
        iconAnchor: [metrics.width / 2, metrics.height - 1],
    });
}

function createPendingIcon(zoom) {
    const metrics = markerMetrics(zoom);
    // ai coding：待保存点使用固定的安全 SVG DOM，与正式地点类型图标及数据层完全隔离。
    const marker = document.createElement("span");
    marker.className = "pending-place-marker";
    marker.style.width = `${metrics.width}px`;
    marker.style.height = `${metrics.height}px`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 32 40");
    svg.setAttribute("aria-hidden", "true");
    const pin = document.createElementNS(SVG_NS, "path");
    pin.setAttribute("class", "pending-marker-pin");
    pin.setAttribute("d", "M16 1C7.7 1 2 7.2 2 15c0 10 14 24 14 24s14-14 14-24C30 7.2 24.3 1 16 1Z");
    const question = document.createElementNS(SVG_NS, "path");
    question.setAttribute("class", "pending-marker-symbol");
    question.setAttribute("d", "M11.4 11.4a5 5 0 0 1 9.5 2.2c0 3.7-4.9 4.1-4.9 7.2M16 26.7h.01");
    svg.append(pin, question);
    marker.appendChild(svg);
    return L.divIcon({
        className: "pending-place-icon",
        html: marker,
        iconSize: [metrics.width, metrics.height],
        iconAnchor: [metrics.width / 2, metrics.height - 1],
    });
}

function updatePlaceMarkerSizes(map, layer) {
    const metrics = markerMetrics(map.getZoom());
    layer.eachLayer((marker) => {
        if (!marker.isPlaceMarker || marker.placeMarkerWidth === metrics.width) return;
        marker.setIcon(createPlaceIcon(marker.placeType, marker.placeSelected, map.getZoom()));
        marker.placeMarkerWidth = metrics.width;
        const tooltip = marker.getTooltip();
        if (tooltip) {
            tooltip.options.offset = L.point(0, -Math.round(metrics.height * 0.8));
            tooltip.update();
        }
    });
}

function updatePendingMarkerSizes(map, layer) {
    const zoom = map.getZoom();
    const metrics = markerMetrics(zoom);
    layer.eachLayer((marker) => {
        if (!marker.isPendingMarker || marker.pendingMarkerWidth === metrics.width) return;
        marker.setIcon(createPendingIcon(zoom));
        marker.pendingMarkerWidth = metrics.width;
        const tooltip = marker.getTooltip();
        if (tooltip) {
            tooltip.options.offset = L.point(0, -Math.round(metrics.height * 0.8));
            tooltip.update();
        }
        const element = marker.getElement();
        if (element) {
            element.setAttribute("role", "img");
            element.setAttribute("aria-label", "待保存地点");
        }
    });
}

function createTextContent(text) {
    const content = document.createElement("span");
    content.textContent = text;
    return content;
}

function roadStyle(feature, zoom) {
    const highway = feature.properties?.highway;
    const major = ["motorway", "trunk", "motorway_link", "trunk_link"].includes(
        highway,
    );
    const primary = ["primary", "primary_link"].includes(highway);
    const secondary = ["secondary", "secondary_link"].includes(highway);
    if (zoom <= 9 && !major && !primary) return { opacity: 0, weight: 0 };
    const style = major
        ? [2.2, 0.58]
        : primary
          ? [1.8, 0.48]
          : secondary
            ? [1.35, 0.38]
            : [1, zoom <= 10 ? 0.16 : 0.28];
    return {
        color: "#72539b",
        weight: style[0] * (zoom <= 10 ? 0.75 : 1),
        opacity: style[1] * (zoom <= 10 ? 0.75 : 1),
        lineCap: "round",
        lineJoin: "round",
    };
}

function drawCursorPreview(layer, drawCoordinates, cursorLatLng) {
    layer.clearLayers();
    if (!cursorLatLng) return;

    const clickedLatLngs = drawCoordinates.map(([longitude, latitude]) => [latitude, longitude]);
    const cursor = [cursorLatLng.lat, cursorLatLng.lng];
    const previewLatLngs = [...clickedLatLngs, cursor];
    const distinctCount = new Set(
        [...drawCoordinates, [cursorLatLng.lng, cursorLatLng.lat]].map(
            ([longitude, latitude]) => `${longitude},${latitude}`,
        ),
    ).size;

    // ai coding：光标坐标仅存在于 Leaflet 临时层；实时面填充由已点击点与光标点共同组成，不写入 React 顶点状态。
    if (previewLatLngs.length >= 3 && distinctCount >= 3) {
        L.polygon(previewLatLngs, {
            stroke: false,
            fillColor: "#2c9a78",
            fillOpacity: 0.14,
            interactive: false,
        }).addTo(layer);
    }
    if (clickedLatLngs.length) {
        L.polyline([clickedLatLngs.at(-1), cursor], {
            color: "#0e6f59",
            weight: 3,
            opacity: 0.9,
            interactive: false,
        }).addTo(layer);
    }
    if (clickedLatLngs.length >= 2) {
        L.polyline([cursor, clickedLatLngs[0]], {
            color: "#0e6f59",
            weight: 3,
            opacity: 0.9,
            dashArray: "7 6",
            interactive: false,
        }).addTo(layer);
    }
    L.circleMarker(cursor, {
        radius: 3.5,
        color: "#fff",
        weight: 1.5,
        fillColor: "#0e6f59",
        fillOpacity: 1,
        interactive: false,
    }).addTo(layer);
}

function nearestPolygonEdge(map, vertices, latLng) {
    const clickPoint = map.latLngToLayerPoint(latLng);
    let nearest = null;
    vertices.forEach((vertex, index) => {
        const next = vertices[(index + 1) % vertices.length];
        const start = map.latLngToLayerPoint([vertex[1], vertex[0]]);
        const end = map.latLngToLayerPoint([next[1], next[0]]);
        const dx = end.x - start.x; const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared ? Math.max(0, Math.min(1, ((clickPoint.x - start.x) * dx + (clickPoint.y - start.y) * dy) / lengthSquared)) : 0;
        const point = L.point(start.x + ratio * dx, start.y + ratio * dy);
        const distance = clickPoint.distanceTo(point);
        if (!nearest || distance < nearest.distance) nearest = { index, distance, point };
    });
    return nearest;
}

function createEditVertexIcon() {
    const control = document.createElement("span");
    control.className = "polygon-edit-vertex";
    control.setAttribute("aria-hidden", "true");
    return L.divIcon({ className: "polygon-edit-vertex-icon", html: control, iconSize: [18, 18], iconAnchor: [9, 9] });
}

export default function MapView({
    bounds,
    places,
    types,
    selectedId,
    pendingCoordinates,
    adding,
    areaDrawing,
    areaPreview,
    drawCoordinates,
    onMapClick,
    onCloseArea,
    onSelect,
    onRoadStatus,
    editingFeature,
    editGeometry,
    onEditGeometryChange,
    readOnly = false,
}) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const layersRef = useRef(null);
    const drawCoordinatesRef = useRef(drawCoordinates);
    const callbacksRef = useRef({ onMapClick, onSelect, onCloseArea, onEditGeometryChange });
    drawCoordinatesRef.current = drawCoordinates;
    callbacksRef.current = { onMapClick, onSelect, onCloseArea, onEditGeometryChange };

    useEffect(() => {
        if (!bounds || !containerRef.current || mapRef.current)
            return undefined;
        const mapBounds = L.latLngBounds(
            [bounds.south, bounds.west],
            [bounds.north, bounds.east],
        );
        const map = L.map(containerRef.current, {
            maxBounds: mapBounds,
            maxBoundsViscosity: 1,
            maxZoom: MAX_ZOOM,
        });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: MAX_ZOOM,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        const layers = {
            rectangle: L.layerGroup().addTo(map),
            roads: L.layerGroup().addTo(map),
            places: L.layerGroup().addTo(map),
            pendingPlace: L.layerGroup().addTo(map),
            drawing: L.layerGroup().addTo(map),
            drawingCursor: L.layerGroup().addTo(map),
            polygonEditing: L.layerGroup().addTo(map),
        };
        // ai coding：正式与待保存标记共用 zoom 断点，并在 zoomend 一次性同步图标锚点及 tooltip 偏移。
        const handleMarkerZoomEnd = () => {
            updatePlaceMarkerSizes(map, layers.places);
            updatePendingMarkerSizes(map, layers.pendingPlace);
        };
        map.on("zoomend", handleMarkerZoomEnd);
        L.rectangle(mapBounds, {
            color: "#16785f",
            weight: 1,
            opacity: 0.35,
            fill: false,
            dashArray: "5 5",
            interactive: false,
        }).addTo(layers.rectangle);
        L.control
            .layers(null, {
                地图范围: layers.rectangle,
                "OSM 基础道路（只读）": layers.roads,
                [readOnly ? "快照地点（只读）" : "用户地点"]: layers.places,
            })
            .addTo(map);
        const updateLimits = () => {
            const followedMinimum =
                Number.isFinite(map.getZoom()) &&
                map.getZoom() === map.getMinZoom();
            map.setMinZoom(0);
            const minZoom = map.getBoundsZoom(mapBounds, false, padding);
            map.setMinZoom(minZoom);
            map.setMaxBounds(mapBounds);
            if (followedMinimum && map.getZoom() !== minZoom)
                map.setZoom(minZoom, { animate: false });
            if (Number.isFinite(map.getZoom()))
                map.panInsideBounds(mapBounds, { animate: false });
        };
        map.fitBounds(mapBounds, { padding });
        updateLimits();
        map.on("click", (event) =>
            callbacksRef.current.onMapClick?.(
                event.latlng.lng,
                event.latlng.lat,
            ),
        );
        const observer = new ResizeObserver(() => {
            map.invalidateSize({ pan: false });
            updateLimits();
        });
        observer.observe(containerRef.current);
        mapRef.current = map;
        layersRef.current = layers;

        let roadLayer;
        let cancelled = false;
        fetch("/data/base-roads.geojson")
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((data) => {
                if (cancelled || data.type !== "FeatureCollection") return;
                roadLayer = L.geoJSON(data, {
                    style: (feature) => roadStyle(feature, map.getZoom()),
                    onEachFeature: (feature, layer) => {
                        const { name, ref, highway } = feature.properties ?? {};
                        if (name || ref)
                            layer.bindTooltip(
                                createTextContent(
                                    [
                                        name || ref,
                                        ref && ref !== name ? ref : null,
                                        highway,
                                    ]
                                        .filter(Boolean)
                                        .join(" · "),
                                ),
                            );
                    },
                }).addTo(layers.roads);
                map.on("zoomend", () =>
                    roadLayer?.setStyle((feature) =>
                        roadStyle(feature, map.getZoom()),
                    ),
                );
                onRoadStatus?.(
                    "ready",
                    `已加载 ${data.features.length} 个只读要素`,
                );
            })
            .catch((error) => {
                console.error("加载基础道路失败：", error);
                onRoadStatus?.("error", `加载失败（${error.message}）`);
            });

        return () => {
            cancelled = true;
            observer.disconnect();
            map.off("zoomend", handleMarkerZoomEnd);
            map.remove();
            mapRef.current = null;
            layersRef.current = null;
        };
    }, [bounds, onRoadStatus, readOnly]);

    useEffect(() => {
        const map = mapRef.current;
        const layer = layersRef.current?.places;
        if (!map || !layer) return;
        layer.clearLayers();
        places.features.forEach((feature) => {
            if (editingFeature?.id === feature.id) return;
            const type = types.find(
                (item) => item.id === feature.properties.type,
            );
            const selected = feature.id === selectedId;
            const tooltip = createTextContent(feature.properties.name);
            if (feature.geometry.type === "Polygon") {
                const color = /^#[0-9a-f]{6}$/i.test(type?.color) ? type.color : "#65736f";
                const polygon = L.polygon(feature.geometry.coordinates[0].map(([longitude, latitude]) => [latitude, longitude]), {
                    color, fillColor: color, fillOpacity: selected ? 0.32 : 0.18,
                    opacity: 0.9, weight: selected ? 4 : 2, interactive: !areaPreview,
                    bubblingMouseEvents: false,
                }).bindTooltip(tooltip).addTo(layer);
                // ai coding：绘制及待保存预览期间既有区域退出交互，避免误选导致临时几何丢失。
                const element = polygon.getElement();
                if (!areaPreview && element) {
                    // ai coding：区域截获地图点击时显式按模式分流，新增点模式使用实际点击坐标，其余模式仍选中区域。
                    polygon.on("click", (event) => {
                        if (adding) callbacksRef.current.onMapClick?.(event.latlng.lng, event.latlng.lat);
                        else callbacksRef.current.onSelect?.(feature.id, true);
                    });
                    if (!adding) {
                        element.setAttribute("tabindex", "0"); element.setAttribute("role", "button");
                        element.setAttribute("aria-label", `${feature.properties.name}，区域`);
                        element.addEventListener("keydown", (event) => {
                            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); callbacksRef.current.onSelect?.(feature.id, true); }
                        });
                    }
                }
                return;
            }
            const metrics = markerMetrics(map.getZoom());
            const icon = createPlaceIcon(type, selected, map.getZoom());
            const [longitude, latitude] = feature.geometry.coordinates;
            const marker = L.marker([latitude, longitude], {
                icon,
                    keyboard: !areaPreview && !adding,
                    interactive: !areaPreview,
                title: feature.properties.name,
            })
                .bindTooltip(tooltip, {
                    direction: "top",
                    offset: [0, -Math.round(metrics.height * 0.8)],
                })
                .on("click", (event) => {
                    if (adding) callbacksRef.current.onMapClick?.(event.latlng.lng, event.latlng.lat);
                    else callbacksRef.current.onSelect?.(feature.id, true);
                })
                .addTo(layer);
            marker.placeType = type;
            marker.placeSelected = selected;
            marker.placeMarkerWidth = metrics.width;
            marker.isPlaceMarker = true;
        });
    }, [places, types, selectedId, adding, areaPreview, editingFeature?.id]);

    useEffect(() => {
        const map = mapRef.current;
        const layer = layersRef.current?.polygonEditing;
        if (!map || !layer) return undefined;
        layer.clearLayers();
        if (!editingFeature || editGeometry?.type !== "Polygon") return undefined;

        let vertices = editGeometry.coordinates[0].slice(0, -1).map(([longitude, latitude]) => [longitude, latitude]);
        const type = types.find((item) => item.id === editingFeature.properties.type);
        const color = /^#[0-9a-f]{6}$/i.test(type?.color) ? type.color : "#16785f";

        const publish = () => callbacksRef.current.onEditGeometryChange?.(createPolygonDraftGeometry(vertices));
        const render = () => {
            layer.clearLayers();
            const latLngs = vertices.map(([longitude, latitude]) => [latitude, longitude]);
            const polygon = L.polygon(latLngs, {
                color, weight: 3, opacity: 1, dashArray: "7 5", fillColor: color,
                fillOpacity: 0.28, interactive: false,
            }).addTo(layer);

            // ai coding：透明加宽边线只接受边缘附近点击；再投影到最近线段后插点，区域内部点击不会误操作。
            const edge = L.polyline([...latLngs, latLngs[0]], {
                color, weight: 18, opacity: 0, interactive: true, bubblingMouseEvents: false,
            }).addTo(layer);
            edge.on("click", (event) => {
                const nearest = nearestPolygonEdge(map, vertices, event.latlng);
                if (!nearest || nearest.distance > 12) return;
                const projected = map.layerPointToLatLng(nearest.point);
                const inserted = insertPolygonVertex(createPolygonDraftGeometry(vertices), nearest.index, [projected.lng, projected.lat]);
                vertices = inserted.coordinates[0].slice(0, -1);
                publish();
                render();
            });
            const edgeElement = edge.getElement();
            if (edgeElement) {
                edgeElement.classList.add("polygon-edit-edge");
                edgeElement.setAttribute("aria-label", "区域编辑边线，点击插入顶点");
            }

            // ai coding：拖拽和键盘微调共用几何刷新，确保可见面与透明点击边线始终对应同一组最新顶点。
            const updateGeometry = () => {
                const nextLatLngs = vertices.map(([lng, lat]) => [lat, lng]);
                polygon.setLatLngs(nextLatLngs);
                edge.setLatLngs([...nextLatLngs, nextLatLngs[0]]);
                publish();
            };

            vertices.forEach(([longitude, latitude], index) => {
                const marker = L.marker([latitude, longitude], {
                    icon: createEditVertexIcon(), draggable: true, keyboard: true,
                    bubblingMouseEvents: false, title: `区域顶点 ${index + 1}，可拖拽或使用方向键调整`,
                    zIndexOffset: 800,
                }).addTo(layer);
                marker.on("drag", (event) => {
                    const current = event.target.getLatLng();
                    vertices[index] = [current.lng, current.lat];
                    updateGeometry();
                });
                const element = marker.getElement();
                if (element) {
                    element.setAttribute("tabindex", "0");
                    element.setAttribute("role", "button");
                    element.setAttribute("aria-roledescription", "区域顶点控制点");
                    element.setAttribute("aria-label", `区域顶点 ${index + 1}，可拖拽或使用方向键微调，按 Escape 取消编辑`);
                    element.addEventListener("keydown", (event) => {
                        const offset = {
                            ArrowUp: [0, -1], ArrowDown: [0, 1],
                            ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                        }[event.key];
                        if (offset) {
                            event.preventDefault();
                            event.stopPropagation();
                            const point = map.latLngToLayerPoint(marker.getLatLng());
                            const next = map.layerPointToLatLng(L.point(point.x + offset[0], point.y + offset[1]));
                            marker.setLatLng(next);
                            vertices[index] = [next.lng, next.lat];
                            updateGeometry();
                        } else if (event.key === "Enter") {
                            // 保持当前控制点焦点，并隔离地图或页面级 Enter 快捷键。
                            event.preventDefault();
                            event.stopPropagation();
                        }
                    });
                }
            });
        };
        render();
        return () => layer.clearLayers();
    }, [editingFeature?.id, types]);

    useEffect(() => {
        const map = mapRef.current;
        const layer = layersRef.current?.pendingPlace;
        if (!map || !layer) return;
        layer.clearLayers();
        if (!pendingCoordinates) return;
        const [longitude, latitude] = pendingCoordinates;
        const metrics = markerMetrics(map.getZoom());
        const marker = L.marker([latitude, longitude], {
            icon: createPendingIcon(map.getZoom()),
            interactive: false,
            keyboard: false,
            title: "待保存地点",
            zIndexOffset: 600,
        }).bindTooltip(createTextContent("待保存地点"), {
            permanent: true,
            direction: "top",
            offset: [0, -Math.round(metrics.height * 0.8)],
            className: "pending-place-tooltip",
        }).addTo(layer);
        marker.isPendingMarker = true;
        marker.pendingMarkerWidth = metrics.width;
        const element = marker.getElement();
        if (element) {
            element.setAttribute("role", "img");
            element.setAttribute("aria-label", "待保存地点");
        }
    }, [pendingCoordinates]);

    useEffect(() => {
        const layer = layersRef.current?.drawing;
        if (!layer) return;
        layer.clearLayers();
        if (!areaPreview || !drawCoordinates?.length) return;
        const latLngs = drawCoordinates.map(([longitude, latitude]) => [latitude, longitude]);
        const distinctCount = new Set(drawCoordinates.map(([longitude, latitude]) => `${longitude},${latitude}`)).size;
        if (latLngs.length > 1) {
            if (areaDrawing) L.polyline(latLngs, {
                color: "#0e6f59", weight: 3, opacity: 0.9, interactive: false,
            }).addTo(layer);
            else L.polygon(latLngs, {
                color: "#0e6f59", weight: 3, opacity: 0.9, dashArray: "7 6",
                fill: distinctCount >= 3, fillColor: "#2c9a78", fillOpacity: distinctCount >= 3 ? 0.14 : 0,
                interactive: false,
            }).addTo(layer);
        }
        drawCoordinates.forEach(([longitude, latitude], index) => {
            const first = index === 0; const canClose = first && distinctCount >= 3;
            const vertex = L.circleMarker([latitude, longitude], {
                radius: first ? 8 : 5, color: first ? "#0e5f4b" : "#fff", weight: first ? 3 : 2,
                fillColor: first ? "#fff" : "#16785f", fillOpacity: 1, interactive: first && areaDrawing,
                bubblingMouseEvents: false,
            }).addTo(layer);
            if (first && areaDrawing) {
                const closeLabel = canClose ? "点击闭合区域" : "至少绘制 3 个不同顶点后可闭合";
                vertex.bindTooltip(closeLabel, { permanent: false, direction: "top" });
                vertex.on("click", () => callbacksRef.current.onCloseArea?.());
                const element = vertex.getElement();
                if (element) {
                    element.setAttribute("tabindex", "0"); element.setAttribute("role", "button"); element.setAttribute("aria-label", closeLabel);
                    element.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); callbacksRef.current.onCloseArea?.(); } });
                }
            }
        });
    }, [areaDrawing, areaPreview, drawCoordinates]);

    useEffect(() => {
        const map = mapRef.current;
        const layer = layersRef.current?.drawingCursor;
        const container = containerRef.current;
        if (!map || !layer || !container) return undefined;
        layer.clearLayers();
        if (!areaDrawing) return undefined;

        // ai coding：mousemove 直接更新独立 Leaflet 临时层，避免高频 setState 重绘应用；离图或结束绘制即彻底清理。
        const handleMouseMove = (event) => {
            drawCursorPreview(layer, drawCoordinatesRef.current ?? [], event.latlng);
        };
        const hideCursorPreview = () => layer.clearLayers();
        map.on("mousemove", handleMouseMove);
        container.addEventListener("mouseleave", hideCursorPreview);
        return () => {
            map.off("mousemove", handleMouseMove);
            container.removeEventListener("mouseleave", hideCursorPreview);
            layer.clearLayers();
        };
    }, [areaDrawing]);

    useEffect(() => {
        containerRef.current?.classList.toggle("adding-place", adding || areaDrawing);
        containerRef.current?.classList.toggle("adding-point", adding);
        containerRef.current?.classList.toggle("editing-area", Boolean(editingFeature));
    }, [adding, areaDrawing, editingFeature]);
    useEffect(() => {
        if (!selectedId) return;
        const feature = places.features.find((item) => item.id === selectedId);
        if (feature) {
            if (feature.geometry.type === "Point") mapRef.current?.panTo([feature.geometry.coordinates[1], feature.geometry.coordinates[0]]);
            else mapRef.current?.panTo(L.polygon(feature.geometry.coordinates[0].map(([longitude, latitude]) => [latitude, longitude])).getBounds().getCenter());
        }
    }, [selectedId, places]);

    return (
        <div
            ref={containerRef}
            id="map"
            role="application"
            aria-label={readOnly ? "睢宁县公开快照只读地图" : "睢宁县交互地图"}
        />
    );
}
