import { getSaveSummary } from "../services/geojson.js";
import { ui } from "../uiClassNames.js";

export default function SaveCard({
    total,
    unsyncedCount,
    loading,
    syncing,
    status,
    cloud,
    canSync,
    onSync,
    onExport,
}) {
    // ai coding：原生 disabled 同时提供不可操作状态和正确的辅助技术语义。
    const syncDisabled = loading || syncing || cloud.saving || !canSync || unsyncedCount === 0;
    // ai coding：无待同步修改时不再展示首次选择文件的操作提示。
    const syncStatus = loading
        ? "正在确认地点数据同步状态…"
        : unsyncedCount === 0
          ? status || "当前地点数据已同步，无需同步。"
          : canSync
            ? status ||
              "首次同步时请选择 public/data/places.geojson；不会读取所选文件。"
             : "当前浏览器不支持原位写回，请使用“导出地点数据”。";
    const cloudProblem = cloud.state === "fallback" || cloud.state === "failed";
    return (
        <section className={`${ui.card} p-5`} aria-labelledby="draft-status">
            <p className={ui.eyebrow}>数据保存</p>
            {/* ai coding：云端状态条改为显式 utility 状态组合，不再依赖全局 status 选择器串联。 */}
            <p className={`mb-3 grid grid-cols-[8px_auto_minmax(0,1fr)] items-center gap-[7px] rounded-lg border px-[10px] py-[9px] text-xs leading-[1.4] cyber:text-[#ccebf2] ${cloudProblem ? "border-[#ead0ad] bg-[#fff8ed] text-[#704a19] cyber:border-[#9b6b37] cyber:bg-[#302316] cyber:text-[#ffd18a]" : "border-[#c9ded5] bg-[#edf7f2] text-[#31564c] cyber:border-[#68edff]/30 cyber:bg-[rgba(17,40,65,.76)]"}`} role="status" aria-live="polite">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${cloudProblem ? "bg-[#b66a20]" : cloud.state === "connecting" ? "animate-pulse bg-[#a0661d]" : "bg-[#16785f]"}`} />
                <b>{cloud.state === "connected" ? "云端已连接" : cloud.state === "connecting" ? "正在连接云端" : cloud.state === "failed" ? "云端同步失败" : "本地回退"}</b>
                <span className="break-words text-[#60716d] cyber:text-[#9fc8d3]">{cloud.message}</span>
            </p>
            <h2 id="draft-status" className="mt-0.5 text-[.92rem] leading-[1.5]">
                {loading
                    ? "正在加载地点数据…"
                    : getSaveSummary(total, unsyncedCount)}
            </h2>
            <div className="mt-[14px] grid grid-cols-2 gap-2">
                <button
                    className={`${ui.button} ${ui.primaryButton}`}
                    type="button"
                    onClick={onSync}
                    disabled={syncDisabled}
                >
                    {syncing ? "同步中…" : "同步到本地"}
                </button>
                <button
                    className={ui.button}
                    type="button"
                    onClick={onExport}
                    disabled={loading || cloud.saving}
                >
                    导出地点数据
                </button>
            </div>
            <p className={`${ui.muted} mt-[14px] break-words`} role="status" aria-live="polite">
                {syncStatus}
            </p>
        </section>
    );
}
