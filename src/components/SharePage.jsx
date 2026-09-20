import { useCallback, useEffect, useState } from "react";
import MapView from "./MapView.jsx";
import PublicImageGallery from "./PublicImageGallery.jsx";
import { fetchPublicSnapshot, publicPlaceDetails } from "../services/mapSnapshots.js";
import { supabase, supabaseConfiguration } from "../services/supabaseClient.js";

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
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (!supabaseConfiguration.configured || !supabase) throw new Error("公开地图服务尚未配置");
                const [bounds, types, row] = await Promise.all([getJson("/data/map-bounds.json"), getJson("/data/place-types.json"), fetchPublicSnapshot(supabase, token)]);
                if (!row) throw new Error("分享链接无效、已取消公开或快照不存在");
                // ai coding：row.snapshot 已由安全 RPC 在数据库内白名单重建，浏览器从不接收原始快照。
                if (active) setData({ loading: false, error: "", row, bounds, types });
            } catch (error) {
                if (active) setData({ loading: false, error: error.message, row: null, bounds: null, types: [] });
            }
        })();
        return () => { active = false; };
    }, [token, reloadKey]);
    const roadStatus = useCallback((kind, text) => setRoadError(kind === "error" ? `基础道路${text}` : ""), []);
    const selectedFeature = data.row?.snapshot.features.find((feature) => feature.id === selectedId);
    const details = selectedFeature ? publicPlaceDetails(selectedFeature, data.types) : null;

    return <>
        <header className="site-header public-header"><div><p className="eyebrow">SN MAP / 公开快照</p><h1>{data.row?.title || "睢宁公开地图"}</h1><p className="intro">无需登录的只读地图。快照仅反映发布时的数据。</p></div><a className="button" href={window.location.pathname}>返回管理端</a></header>
        {data.loading ? <main className="share-message" role="status">正在加载公开快照与图片…</main> : data.error ? <main className="share-message error" role="alert"><h2>无法打开公开地图</h2><p>{data.error}</p><button className="button" type="button" onClick={() => { setData((current) => ({ ...current, loading: true, error: "" })); setReloadKey((value) => value + 1); }}>重试</button></main> : (
            <main className="public-main">
                <section className="map-panel" aria-labelledby="public-map-title"><div className="panel-heading"><div><p className="section-label">只读地图</p><h2 id="public-map-title">{data.row.snapshot.features.length} 个地点与区域</h2></div><span className="publish-badge public">PUBLIC</span></div>{roadError && <p className="map-error" role="alert">{roadError}</p>}<MapView bounds={data.bounds} places={data.row.snapshot} types={data.types} selectedId={selectedId} onSelect={setSelectedId} onRoadStatus={roadStatus} readOnly /></section>
                <aside className="info-panel"><section className="place-card"><p className="section-label">快照地点</p><h2>地点列表</h2>{details && <div className="public-details" aria-live="polite"><h3>{details.name}</h3><dl>{[["类型", details.type], ["经纬度", details.coordinates], ["备注", details.description || details.notes], ["地址", details.address], ["电话", details.phone], ["网站", details.website], ["开放时间", details.opening_hours]].map(([label, value]) => value ? <div key={label}><dt>{label}</dt><dd>{value}</dd></div> : null)}</dl><PublicImageGallery images={details.images} placeName={details.name} /></div>}<ul className="place-list public-place-list">{data.row.snapshot.features.map((feature) => <li key={feature.id}><button type="button" onClick={() => setSelectedId(feature.id)} aria-pressed={selectedId === feature.id}><span className="type-swatch" style={{ background: data.types.find((type) => type.id === feature.properties.type)?.color || "#65736f" }} /><span className="place-name">{feature.properties.name}</span><span className="place-type">{feature.geometry.type === "Polygon" ? "区域" : "点"}</span></button></li>)}</ul>{!data.row.snapshot.features.length && <p className="empty-state">该快照没有地点。</p>}<p className="file-status">最后发布：{new Date(data.row.published_at).toLocaleString("zh-CN")}</p></section></aside>
            </main>
        )}
        <footer><span>SN MAP · 公开只读快照</span><span>地图数据 © OpenStreetMap contributors</span></footer>
    </>;
}
