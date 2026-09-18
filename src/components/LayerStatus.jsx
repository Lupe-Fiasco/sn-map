export default function LayerStatus({ bounds, roads, places }) {
  const rows = [["地图范围", bounds], ["基础道路", roads], ["自维护地点", places]];
  return <section className="status-card" aria-labelledby="status-title"><p className="section-label">加载状态</p><h2 id="status-title">数据图层</h2><ul className="status-list" aria-live="polite">{rows.map(([name, state]) => <li key={name}><span className={`status-dot ${state.kind}`} />{name}：{state.text}</li>)}</ul></section>;
}
