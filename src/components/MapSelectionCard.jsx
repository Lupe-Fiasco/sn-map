import React from "react";
import { ui } from "../uiClassNames.js";

export default function MapSelectionCard({ maps, mapId, mapName, disabled, onChange }) {
    return (
        // ai coding：主题使用 background 简写同时清除普通模式渐变层，避免只改 background-color 后白色渐变仍覆盖赛博底色。
        <section
            className={`${ui.card} ${ui.mapCard} !bg-[linear-gradient(135deg,#fff_35%,#edf6f1)] px-[18px] py-4 cyber:!border-[#1c6574] cyber:![background:#10172b] cyber:!text-[#d9fbff] minimal:![background:white]`}
            aria-labelledby="map-selection-title"
        >
            <label className={`${ui.label} grid min-w-[190px] gap-[5px] cyber:!text-[#7cecff]`} htmlFor="management-map-select">
                <span id="map-selection-title">选择地图</span>
                <select className={`${ui.input} pr-[34px] font-semibold`} id="management-map-select" value={mapId} onChange={onChange} disabled={disabled}>
                    {maps.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_active === false ? "（停用）" : ""}</option>)}
                </select>
                <small className="text-[.68rem] font-semibold text-[#16785f] cyber:text-[#68edff]">{mapName ? `当前 · ${mapName}` : "正在加载地区配置…"}</small>
            </label>
        </section>
    );
}
