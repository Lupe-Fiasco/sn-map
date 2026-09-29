import { useCallback, useEffect, useState } from "react";
import MapView from "./MapView.jsx";
import PublicMapViewport from "./PublicMapViewport.jsx";
import PublicSharePageFrame from "./PublicSharePageFrame.jsx";
import PublicImageGallery from "./PublicImageGallery.jsx";
import { fetchPublicSnapshot, publicPlaceDetails } from "../services/mapSnapshots.js";
import { supabase, supabaseConfiguration } from "../services/supabaseClient.js";
import { applyVisualModeTheme, readVisualMode, subscribeVisualMode } from "../services/visualMode.js";
import { resolvePublicMapData } from "../services/publicMapView.js";
import { ui } from "../uiClassNames.js";

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

export default function SharePage({ token }) {
    const [data, setData] = useState({ loading: true, error: "", row: null, bounds: null, types: [] });
    const [selectedId, setSelectedId] = useState(null);
    const [roadError, setRoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [visualMode, setVisualMode] = useState(readVisualMode);
    useEffect(() => subscribeVisualMode((nextMode) => {
        // ai coding：公开快照只订阅视觉偏好并同步根主题，保持只读且不会初始化匿名登录。
        setVisualMode(nextMode);
        applyVisualModeTheme(nextMode);
    }), []);
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (!supabaseConfiguration.configured || !supabase) throw new Error("公开地图服务尚未配置");
                const [types, row] = await Promise.all([getJson("/data/place-types.json"), fetchPublicSnapshot(supabase, token)]);
                if (!row) throw new Error("分享链接无效、已取消公开或快照不存在");
                // ai coding：row.snapshot 已由安全 RPC 在数据库内白名单重建，浏览器从不接收原始快照。
                const resolved = await resolvePublicMapData(row, types, getJson);
                if (active) setData(resolved);
            } catch (error) {
                if (active) setData({ loading: false, error: error.message, row: null, bounds: null, types: [] });
            }
        })();
        return () => { active = false; };
    }, [token, reloadKey]);
    const roadStatus = useCallback((kind, text) => setRoadError(kind === "error" ? `基础道路${text}` : ""), []);
    const selectedFeature = data.row?.snapshot.features.find((feature) => feature.id === selectedId);
    const details = selectedFeature ? publicPlaceDetails(selectedFeature, data.types) : null;

    // ai coding：公开路由用独立全视口画布包住加载、失败、无快照和地图分支，主题背景不会在短内容下中断。
    return <PublicSharePageFrame>
        <header className="public-header mx-auto flex w-[calc(100%_-_48px)] max-w-[1440px] items-end justify-between gap-6 pb-6 pt-[38px]"><div><p className={ui.eyebrow}>SN MAP / {data.map?.name || "公开快照"}</p><h1 className="mb-2 text-[clamp(1.65rem,3vw,2.35rem)] font-bold tracking-[-.035em]">{data.row?.title || "公开地图"}</h1><p className={`${ui.muted} m-0 max-w-[680px] leading-[1.7]`}>无需登录的只读地图。快照仅反映发布时的数据。</p></div><a className={ui.button} href={window.location.pathname}>返回管理端</a></header>
        {data.loading ? <main className={`${ui.card} block min-h-[420px] p-[60px] text-center`} role="status">正在加载公开快照与图片…</main> : data.error ? <main className={`${ui.card} block min-h-[420px] p-[60px] text-center text-[#812e28] cyber:text-[#ffc0cc]`} role="alert"><h2>无法打开公开地图</h2><p>{data.error}</p><button className={ui.button} type="button" onClick={() => { setData((current) => ({ ...current, loading: true, error: "" })); setReloadKey((value) => value + 1); }}>重试</button></main> : (
            <main className="public-main">
                <section className={`${ui.card} ${ui.mapCard}`} aria-labelledby="public-map-title"><div className={ui.panelHeading}><div><p className={ui.eyebrow}>{data.map.name} · 只读地图</p><h2 id="public-map-title">{data.row.snapshot.features.length} 个地点与区域</h2></div><span className="publish-badge public">PUBLIC</span></div>{roadError && <p className="map-error" role="alert">{roadError}</p>}<PublicMapViewport data={data} selectedId={selectedId} onSelect={setSelectedId} onRoadStatus={roadStatus} visualMode={visualMode} MapComponent={MapView} /></section>
                <aside className={ui.infoPanel}><section className={`${ui.card} relative z-[2] overflow-visible p-5`}><p className={ui.eyebrow}>快照地点</p><h2>地点列表</h2>{details && <div className="public-details" aria-live="polite"><h3>{details.name}</h3><dl>{[["类型", details.type], ["经纬度", details.coordinates], ["备注", details.description || details.notes], ["地址", details.address], ["电话", details.phone], ["网站", details.website], ["开放时间", details.opening_hours]].map(([label, value]) => value ? <div key={label}><dt className={ui.themeLabel}>{label}</dt><dd className={ui.themeBody}>{value}</dd></div> : null)}</dl><PublicImageGallery images={details.images} placeName={details.name} /></div>}<ul className="mt-3 max-h-[620px] list-none overflow-auto p-0">{data.row.snapshot.features.map((feature) => <li className="border-t border-[#dbe3dd] cyber:border-[#68edff]/20" key={feature.id}><button className={`grid w-full grid-cols-[12px_1fr_auto] items-center gap-[9px] border-0 bg-transparent px-3 py-[11px] text-left text-inherit hover:bg-[#f6f7f2] focus-visible:bg-[#f6f7f2] focus-visible:outline-none cyber:hover:bg-[rgba(26,79,105,.48)] cyber:focus-visible:bg-[rgba(26,79,105,.48)] ${selectedId === feature.id ? "bg-[#eaf4ef] cyber:bg-[rgba(26,79,105,.48)] cyber:text-[#e6fbff]" : ""}`} type="button" onClick={() => setSelectedId(feature.id)} aria-pressed={selectedId === feature.id}><span className="type-swatch" style={{ background: data.types.find((type) => type.id === feature.properties.type)?.color || "#65736f" }} /><span className="overflow-hidden text-ellipsis whitespace-nowrap text-[.86rem] font-bold">{feature.properties.name}</span><span className={`text-xs text-[#60716d] ${ui.themeMuted}`}>{feature.geometry.type === "Polygon" ? "区域" : feature.geometry.type === "LineString" ? "线" : "点"}</span></button></li>)}</ul>{!data.row.snapshot.features.length && <p className={`${ui.muted} mt-[14px]`}>该快照没有地点。</p>}<p className={`${ui.muted} mt-[14px]`}>最后发布：{new Date(data.row.published_at).toLocaleString("zh-CN")}</p></section></aside>
            </main>
        )}
        <footer><span>SN MAP · 公开只读快照</span><span>地图数据 © OpenStreetMap contributors</span></footer>
    </PublicSharePageFrame>;
}
