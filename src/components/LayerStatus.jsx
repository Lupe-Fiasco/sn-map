import { ui } from "../uiClassNames.js";

export default function LayerStatus({ bounds, roads, places }) {
  const rows = [["地图范围", bounds], ["基础道路", roads], ["自维护地点", places]];
  return <section className={`${ui.card} p-5`} aria-labelledby="status-title"><p className={ui.eyebrow}>加载状态</p><h2 id="status-title">数据图层</h2><ul className="mt-5 list-none p-0" aria-live="polite">{rows.map(([name, state]) => <li className="flex items-center gap-[10px] border-t border-[#dbe3dd] py-3 text-[.86rem] text-[#60716d] cyber:border-[#68edff]/20 cyber:text-[#9fc8d3]" key={name}><span className={`h-2 w-2 shrink-0 rounded-full ${state.kind === "error" ? "bg-[#b0443c]" : state.kind === "loading" ? "animate-pulse bg-[#a0661d]" : "bg-[#16785f]"}`} />{name}：{state.text}</li>)}</ul></section>;
}
