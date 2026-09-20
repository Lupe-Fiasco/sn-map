import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView.jsx";
import PlaceList from "./components/PlaceList.jsx";
import PlaceForm from "./components/PlaceForm.jsx";
import PlaceDetails from "./components/PlaceDetails.jsx";
import SaveCard from "./components/SaveCard.jsx";
import AuthCard from "./components/AuthCard.jsx";
import SnapshotCard from "./components/SnapshotCard.jsx";
import SharePage from "./components/SharePage.jsx";
import ApprovalGate from "./components/ApprovalGate.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import { usePlaces } from "./hooks/usePlaces.js";
import { useAuth } from "./hooks/useAuth.js";
import { resolveAppRoute } from "./services/approval.js";
import { loadMapConfigs } from "./services/maps.js";
import {
    forgetSessionFileHandle,
    getSessionFileHandle,
    isFileHandleUnavailable,
    rememberSessionFileHandle,
    writePlacesFile,
} from "./services/fileSync.js";

export default function App() {
    // ai coding：公开分享路由在任何 Auth hook 挂载前分流，访客不会触发登录、profile 或管理员查询。
    const route = resolveAppRoute(window.location.search);
    return route.kind === "public-share" ? <SharePage token={route.token} /> : <ManagementApp />;
}

function ManagementApp() {
    const auth = useAuth();
    const formal = auth.session?.user && !auth.session.user.is_anonymous;
    if (formal && (auth.access.ownerId !== auth.session.user.id || auth.access.loading || !auth.access.allowed)) return <ApprovalGate auth={auth} />;
    return <ApprovedManagementApp auth={auth} />;
}

function ApprovedManagementApp({ auth }) {
    const [maps, setMaps] = useState([]);
    const [mapId, setMapId] = useState("suining");
    const [mapConfigError, setMapConfigError] = useState("");
    const mapConfig = maps.find((item) => item.id === mapId) ?? null;
    useEffect(() => {
        let active = true;
        loadMapConfigs().then((items) => { if (active) setMaps(items); })
            .catch((error) => { if (active) setMapConfigError(error.message); });
        return () => { active = false; };
    }, []);
    const {
        places,
        types,
        status: placeLoad,
        cloud,
        unsynced,
        save,
        remove,
        getOwnerOperation,
        isOwnerOperationCurrent,
        markSynced,
    } = usePlaces(auth.session, !auth.status.loading, mapConfig);
    const bounds = mapConfig?.bounds ?? null;
    const [mode, setMode] = useState("browse");
    const [selectedId, setSelectedId] = useState(null);
    const [newCoordinates, setNewCoordinates] = useState(null);
    const [drawCoordinates, setDrawCoordinates] = useState([]);
    const [newGeometry, setNewGeometry] = useState(null);
    const [editGeometry, setEditGeometry] = useState(null);
    const [query, setQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [syncing, setSyncing] = useState(false);
    const [fileStatus, setFileStatus] = useState("");
    const [toast, setToast] = useState("");
    const [mapErrors, setMapErrors] = useState({ bounds: "", roads: "" });
    const syncRunRef = useRef(0);
    const syncingRef = useRef(false);
    const busy = syncing || cloud.saving || auth.status.loading || (auth.configured && !auth.session);
    const selected = useMemo(
        () => places.features.find((item) => item.id === selectedId) ?? null,
        [places, selectedId],
    );
    const areaPreview = mode === "drawing-area" || newGeometry?.type === "Polygon" || (mode === "editing" && editGeometry?.type === "Polygon");
    const drawDistinctCount = useMemo(
        () => new Set(drawCoordinates.map(([longitude, latitude]) => `${longitude},${latitude}`)).size,
        [drawCoordinates],
    );

    const notify = useCallback((message) => setToast(message), []);
    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(""), 3200);
        return () => clearTimeout(timer);
    }, [toast]);
    const closePanel = useCallback(() => {
        setMode("browse");
        setSelectedId(null);
        setNewCoordinates(null);
        setDrawCoordinates([]);
        setNewGeometry(null);
        setEditGeometry(null);
    }, []);
    useEffect(() => {
        // ai coding：owner 或地图切换时关闭旧范围的详情及所有几何草稿，并立即废弃进行中的文件同步。
        closePanel();
        syncRunRef.current += 1;
        const interrupted = syncingRef.current;
        syncingRef.current = false;
        setSyncing(false);
        setFileStatus(interrupted ? "账号或地图已切换，旧同步结果已忽略；请重新同步当前范围。" : "");
    }, [auth.session?.user?.id, mapId, closePanel]);
    useEffect(() => { forgetSessionFileHandle(); }, [auth.session?.user?.id]);
    useEffect(() => () => {
        // ai coding：离开当前地图（含页面退出）即丢弃其会话句柄并使尚未完成的同步回调失效，返回时必须重新选择文件。
        syncRunRef.current += 1;
        forgetSessionFileHandle(mapId);
    }, [mapId]);
    useEffect(() => {
        // ai coding：地区切换同步清除道路错误、筛选和所有仅属于前一地图的 UI 状态。
        setMapErrors({ bounds: "", roads: "" });
        setQuery("");
        setTypeFilter("");
    }, [mapId]);
    const closeArea = useCallback(() => {
        const distinct = new Set(drawCoordinates.map(([longitude, latitude]) => `${longitude},${latitude}`));
        if (distinct.size < 3) return notify("至少绘制 3 个不同顶点后才能闭合区域");
        // ai coding：只在闭合时生成标准 Polygon 外环，未完成绘制始终不进入地点数据。
        setNewGeometry({ type: "Polygon", coordinates: [[...drawCoordinates, drawCoordinates[0]]] });
        setMode("creating");
        notify("区域已闭合，请填写地点信息后保存");
    }, [drawCoordinates, notify]);
    useEffect(() => {
        const keydown = (event) => {
            if (event.key === "Escape" && mode !== "browse") closePanel();
            else if (event.key === "Enter" && mode === "drawing-area") {
                // ai coding：地图控件及绘制首点自行处理 Enter，不触发全局闭合快捷键。
                if (event.target instanceof Element && event.target.closest("a, button, input, select, textarea, [contenteditable='true'], [role='button'], [role='option']")) return;
                event.preventDefault(); closeArea();
            }
        };
        document.addEventListener("keydown", keydown);
        return () => document.removeEventListener("keydown", keydown);
    }, [mode, closePanel, closeArea]);

    const selectPlace = useCallback((id) => {
        setEditGeometry(null);
        setSelectedId(id);
        setMode("details");
    }, []);
    const mapClick = useCallback(
        (longitude, latitude) => {
            if (busy) return;
            if (mode === "adding") {
                setNewCoordinates([longitude, latitude]);
                setMode("creating");
            } else if (mode === "drawing-area") {
                setDrawCoordinates((current) => [...current, [longitude, latitude]]);
            }
        },
        [mode, busy],
    );
    // ai coding：新增点表单是坐标输入的唯一编辑源；这里只保存可供 Leaflet 安全预览的最新 WGS84 坐标。
    const updatePendingCoordinates = useCallback((longitudeValue, latitudeValue) => {
        if (String(longitudeValue).trim() === "" || String(latitudeValue).trim() === "") return;
        const longitude = Number(longitudeValue);
        const latitude = Number(latitudeValue);
        if (
            Number.isFinite(longitude) &&
            Number.isFinite(latitude) &&
            longitude >= -180 &&
            longitude <= 180 &&
            latitude >= -90 &&
            latitude <= 90
        ) {
            setNewCoordinates([longitude, latitude]);
        }
    }, []);
    const roadStatus = useCallback(
        (kind, text) =>
            setMapErrors((current) => ({
                ...current,
                roads: kind === "error" ? `基础道路${text}` : "",
            })),
        [],
    );
    const toggleAdding = () => {
        if (busy) return notify("数据保存进行中，请稍候");
        if (mode === "adding") closePanel();
        else {
            setMode("adding");
            setSelectedId(null);
            setNewCoordinates(null);
            setDrawCoordinates([]);
            setNewGeometry(null);
            setEditGeometry(null);
            notify("请在地图矩形范围内点击地点位置");
        }
    };
    const toggleAreaDrawing = () => {
        if (busy) return notify("数据保存进行中，请稍候");
        if (mode === "drawing-area") closePanel();
        else {
            setMode("drawing-area"); setSelectedId(null); setNewCoordinates(null);
            setNewGeometry(null); setEditGeometry(null); setDrawCoordinates([]);
            notify("请连续点击区域顶点；点击首点或按 Enter 闭合，Escape 取消");
        }
    };
    const savePlace = async (values) => {
        if (busy) throw new Error("数据保存进行中，请稍候");
        const editing = mode === "editing";
        const { feature, draftSaved, cloudSaved } = await save(values, editing ? selected : null);
        setSelectedId(feature.id);
        setMode("details");
        setNewCoordinates(null);
        setDrawCoordinates([]);
        setNewGeometry(null);
        setEditGeometry(null);
        // ai coding：正式内存状态与浏览器暂存结果分别反馈，写入失败时明确提醒刷新风险。
        notify(cloudSaved
            ? `${editing ? "地点已更新" : "地点已添加"}并保存到云端${draftSaved ? "" : "，但本地草稿写入失败"}`
            : (draftSaved
                ? `${editing ? "地点已更新" : "地点已添加"}并在本地暂存（云端当前不可用）`
                : `${editing ? "地点已更新" : "地点已添加"}，但本地暂存失败；刷新页面可能丢失本次修改`));
    };
    const editPlace = () => {
        // ai coding：Polygon 编辑从正式 geometry 建立隔离的内存草稿；Point 编辑继续沿用原有表单流程。
        setEditGeometry(selected?.geometry.type === "Polygon" ? structuredClone(selected.geometry) : null);
        setMode("editing");
    };
    const deletePlace = async () => {
        if (
            !selected ||
            busy ||
            !window.confirm(
                `确定删除用户地点“${selected.properties.name}”吗？${cloud.state === "fallback" ? "删除结果将保存在本地草稿。" : "确认后将从云端删除。"}`,
            )
        )
            return;
        try {
            // ai coding：删除同样等待云端确认；失败时不关闭详情、不移除正式内存地点。
            const { draftSaved, cloudSaved } = await remove(selected.id);
            closePanel();
            notify(cloudSaved
                ? `地点已从云端删除${draftSaved ? "" : "，但本地草稿写入失败"}`
                : (draftSaved ? "地点已删除并在本地暂存（云端当前不可用）" : "地点已删除，但本地暂存失败；刷新页面可能恢复该地点"));
        } catch (error) {
            notify(error instanceof Error ? error.message : "云端删除失败，请稍后重试");
        }
    };
    const exportPlaces = () => {
        const blob = new Blob([`${JSON.stringify(places, null, 2)}\n`], {
            type: "application/geo+json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${mapConfig?.slug || "map"}-places.geojson`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        notify(`已导出 ${mapConfig?.name || "当前地区"}地点数据`);
    };
    const syncPlaces = async () => {
        // ai coding：同步基线无差异时不启动文件选择，按钮与处理函数保持一致。
        if (busy || unsynced.count === 0) return;
        if (!("showOpenFilePicker" in window)) {
            const message = "当前浏览器不支持原位写回，请使用“导出地点数据”。";
            setFileStatus(message);
            notify(message);
            return;
        }
        const snapshot = structuredClone(places);
        const ownerOperation = getOwnerOperation();
        if (!ownerOperation) {
            setFileStatus("当前账号数据正在加载，请稍候再同步。");
            return;
        }
        const runId = ++syncRunRef.current;
        // ai coding：每次点击都从页面会话缓存取得句柄；快照仍固定为本次点击时的完整数据。
        const fileHandle = getSessionFileHandle(mapId);
        setSyncing(true);
        syncingRef.current = true;
        setFileStatus(
            fileHandle
                ? `正在写入 ${fileHandle.name || "所选文件"}…`
                : `请选择 ${mapConfig.slug}-places.geojson；不会读取所选文件，也不会替换当前修改。`,
        );
        try {
            const result = await writePlacesFile({
                places: snapshot,
                fileHandle,
                pickFile: window.showOpenFilePicker.bind(window),
                confirmWrite: window.confirm.bind(window),
                mapSlug: mapConfig.slug,
            });
            if (runId !== syncRunRef.current || !isOwnerOperationCurrent(ownerOperation)) return;
            if (result.cancelled)
                setFileStatus("已取消同步；当前地点数据和本地暂存未更改。");
            else {
                rememberSessionFileHandle(result.fileHandle, mapId);
                if (!markSynced(snapshot, ownerOperation)) {
                    forgetSessionFileHandle(mapId);
                    setFileStatus("账号已切换，旧同步结果已忽略；请重新同步当前账号。");
                    return;
                }
                setFileStatus(
                    `同步成功：已将 ${snapshot.features.length} 个地点写入 ${result.fileHandle.name || "所选文件"}。`,
                );
                notify("当前完整地点数据已同步到本地文件");
            }
        } catch (error) {
            if (runId !== syncRunRef.current || !isOwnerOperationCurrent(ownerOperation)) return;
            if (fileHandle && (isFileHandleUnavailable(error) || error.name === "AbortError")) {
                // ai coding：失效或无权限的旧句柄必须先清除；下次用户点击时再安全打开选择器。
                forgetSessionFileHandle(mapId);
                const message = error.name === "NotFoundError"
                    ? "同步失败：原文件可能已移动或删除。已清除本会话文件关联，请再次点击“同步到本地”重新选择 places.geojson。"
                    : "同步失败：原文件句柄已失效或没有写入权限。已清除本会话文件关联，请再次点击“同步到本地”重新选择 places.geojson。";
                setFileStatus(message);
                notify(message);
            } else if (error.name === "AbortError")
                setFileStatus("已取消文件选择；当前地点数据和本地暂存未更改。");
            else if (
                error.name === "NotAllowedError" ||
                error.name === "SecurityError"
            )
                setFileStatus(
                    "同步失败：未获得文件写入权限。请再次点击“同步到本地”重新选择并授权，或使用“导出地点数据”。",
                );
            else {
                console.error("同步地点文件失败：", error);
                setFileStatus(`同步失败：${error.message}`);
            }
        } finally {
            if (runId === syncRunRef.current) {
                syncingRef.current = false;
                setSyncing(false);
            }
        }
    };

    return (
        <>
            <header className="site-header">
                <div>
                    <p className="eyebrow">SN MAP / 多地区</p>
                    <h1>{mapConfig?.name || "地区地图"}数据</h1>
                    <p className="intro">
                        在只读的 OpenStreetMap
                        道路底图上，维护独立的用户地点数据。
                    </p>
                </div>
                <div className="header-tools">
                    <label className="map-selector">当前地图
                        <select value={mapId} onChange={(event) => setMapId(event.target.value)} disabled={!maps.length || busy}>
                            {maps.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_active === false ? "（停用）" : ""}</option>)}
                        </select>
                        <small>{mapConfig ? `已选择 · ${mapConfig.name}` : "正在加载地区配置…"}</small>
                    </label>
                    <AuthCard session={auth.session} auth={auth} placeCount={places.features.length} onExport={exportPlaces} />
                </div>
            </header>
            <main>
                {/* ai coding：公开快照跟随地图主列排列，避免继续占用地点维护侧栏。 */}
                <div className="map-column">
                <section className="map-panel" aria-labelledby="map-title">
                    <div className="panel-heading">
                        <h2 id="map-title">地图视图</h2>
                        <div className="map-actions">
                            <button
                                className={`button ${mode === "adding" ? "" : "primary"}`}
                                type="button"
                                disabled={
                                    !bounds || placeLoad.loading || busy
                                }
                                onClick={toggleAdding}
                                aria-pressed={mode === "adding"}
                            >
                                {mode === "adding"
                                    ? "退出新增模式"
                                    : "＋ 新增地点"}
                            </button>
                            <button
                                className={`button ${mode === "drawing-area" ? "" : "primary"}`}
                                type="button"
                                disabled={!bounds || placeLoad.loading || busy}
                                onClick={toggleAreaDrawing}
                                aria-pressed={mode === "drawing-area"}
                            >
                                {mode === "drawing-area" ? "退出区域绘制" : "▱ 新增区域"}
                            </button>
                        </div>
                    </div>
                    {mapErrors.roads && (
                        <p className="map-error" role="alert">{mapErrors.roads}</p>
                    )}
                    {mapConfigError || mapErrors.bounds ? (
                        <div id="map" className="map-loading" role="alert">
                            {mapConfigError || mapErrors.bounds}
                        </div>
                    ) : bounds ? (
                         <MapView
                            key={mapId}
                             bounds={bounds}
                            mapName={mapConfig.name}
                            baseRoadsPath={mapConfig.base_roads_path}
                            places={places}
                            types={types}
                            selectedId={selectedId}
                            pendingCoordinates={mode === "creating" && !newGeometry ? newCoordinates : null}
                            adding={mode === "adding"}
                            areaDrawing={mode === "drawing-area"}
                            areaPreview={areaPreview}
                            drawCoordinates={drawCoordinates}
                            onMapClick={mapClick}
                            onCloseArea={closeArea}
                            onSelect={selectPlace}
                            onRoadStatus={roadStatus}
                            editingFeature={mode === "editing" && editGeometry ? selected : null}
                            editGeometry={editGeometry}
                            onEditGeometryChange={setEditGeometry}
                        />
                    ) : (
                        <div id="map" className="map-loading" role="status">
                            正在加载地图范围…
                        </div>
                    )}
                </section>
                    {/* ai coding：owner 切换时同步重建卡片，首帧不复用上一账号的本地 UI 状态。 */}
                    <SnapshotCard key={`${auth.session?.user?.id ?? "no-owner"}:${mapId}`} ownerId={auth.session?.user?.id} mapId={mapId} mapName={mapConfig?.name} imagesEnabled={!auth.session?.user?.is_anonymous && (auth.access.state === "approved" || auth.access.isAdmin)} places={places} cloud={cloud} />
                </div>
                <aside className="info-panel" aria-label="地点维护面板">
                    {auth.access.isAdmin && <AdminPanel key={auth.access.ownerId} ownerId={auth.access.ownerId} />}
                    <section
                        className="place-card"
                        aria-labelledby="places-title"
                    >
                        <div className="section-heading">
                            <div>
                                <p className="section-label">用户地点</p>
                                <h2 id="places-title">地点列表</h2>
                            </div>
                            <span className="count-badge">
                                {places.features.length}
                            </span>
                        </div>
                        {mode === "drawing-area" && (
                            <div className="drawing-status" role="status" aria-live="polite">
                                <b>正在绘制区域</b>
                                <span>已添加 {drawDistinctCount} 个不同顶点。{drawDistinctCount < 3 ? `至少还需添加 ${3 - drawDistinctCount} 个顶点。` : "点击首点或按 Enter 闭合。"}</span>
                                <button className="button" type="button" onClick={closePanel}>取消绘制</button>
                            </div>
                        )}
                        {(mode === "browse" || mode === "adding") &&
                            placeLoad.loading && (
                                <p className="empty-state" role="status">
                                    正在加载地点数据…
                                </p>
                            )}
                        {(mode === "browse" || mode === "adding") &&
                            placeLoad.error && (
                                <p className="form-error" role="alert">
                                    地点数据加载失败：{placeLoad.error}
                                </p>
                            )}
                        {(mode === "browse" || mode === "adding") &&
                            !placeLoad.loading &&
                            !placeLoad.error && (
                                <PlaceList
                                    places={places}
                                    types={types}
                                    unsyncedIds={unsynced.currentIds}
                                    query={query}
                                    typeFilter={typeFilter}
                                    onQuery={setQuery}
                                    onTypeFilter={setTypeFilter}
                                    onSelect={selectPlace}
                                />
                            )}
                        {(mode === "creating" || mode === "editing") &&
                            bounds && (
                                <PlaceForm
                                    key={`${mode}-${selectedId ?? "new"}`}
                                    feature={
                                        mode === "editing" ? selected : null
                                    }
                                     ownerId={auth.session?.user?.is_anonymous ? null : auth.session?.user?.id}
                                    mapId={mapId}
                                    initialCoordinates={newCoordinates}
                                    geometry={mode === "editing" ? editGeometry : newGeometry}
                                    types={types}
                                    bounds={bounds}
                                    disabled={busy}
                                    onSave={savePlace}
                                    onCancel={closePanel}
                                    onCoordinatesChange={
                                        mode === "creating" && !newGeometry
                                            ? updatePendingCoordinates
                                            : undefined
                                    }
                                />
                            )}
                        {mode === "details" && selected && (
                            <PlaceDetails
                                feature={selected}
                                 ownerId={auth.session?.user?.is_anonymous ? null : auth.session?.user?.id}
                                mapId={mapId}
                                type={types.find(
                                    (type) =>
                                        type.id === selected.properties.type,
                                )}
                                disabled={busy}
                                onEdit={editPlace}
                                onDelete={deletePlace}
                                onClose={closePanel}
                            />
                        )}
                    </section>
                    <SaveCard
                        total={places.features.length}
                        unsyncedCount={unsynced.count}
                        loading={placeLoad.loading}
                        syncing={syncing}
                        status={fileStatus}
                        cloud={cloud}
                        canSync={"showOpenFilePicker" in window}
                        onSync={syncPlaces}
                        onExport={exportPlaces}
                    />
                </aside>
            </main>
            {toast && (
                <div className="toast" role="status" aria-live="polite">
                    {toast}
                </div>
            )}
            <footer>
                <span>SN MAP · React 地图</span>
                <span>地图数据 © OpenStreetMap contributors</span>
            </footer>
        </>
    );
}
