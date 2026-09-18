import { getSaveSummary } from "../services/geojson.js";

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
    return (
        <section className="data-card" aria-labelledby="draft-status">
            <p className="section-label">数据保存</p>
            <p className={`cloud-status ${cloud.state}`} role="status" aria-live="polite">
                <span aria-hidden="true" className="cloud-status-dot" />
                <b>{cloud.state === "connected" ? "云端已连接" : cloud.state === "connecting" ? "正在连接云端" : cloud.state === "failed" ? "云端同步失败" : "本地回退"}</b>
                <span>{cloud.message}</span>
            </p>
            <h2 id="draft-status" className="data-summary">
                {loading
                    ? "正在加载地点数据…"
                    : getSaveSummary(total, unsyncedCount)}
            </h2>
            <div className="data-actions">
                <button
                    className="button primary"
                    type="button"
                    onClick={onSync}
                    disabled={syncDisabled}
                >
                    {syncing ? "同步中…" : "同步到本地"}
                </button>
                <button
                    className="button"
                    type="button"
                    onClick={onExport}
                    disabled={loading || cloud.saving}
                >
                    导出地点数据
                </button>
            </div>
            <p className="file-status" role="status" aria-live="polite">
                {syncStatus}
            </p>
        </section>
    );
}
