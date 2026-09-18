import { toApprovalUiText } from "../services/approval.js";

export default function ApprovalGate({ auth }) {
    const state = auth.access.state;
    const loading = auth.access.loading || auth.access.ownerId !== auth.session?.user?.id;
    const rejected = state === "rejected";
    return (
        <>
            <header className="site-header approval-header">
                <div><p className="eyebrow">SN MAP / 账号审核</p><h1>睢宁地图数据</h1></div>
            </header>
            <main className="approval-main">
                <section className="approval-card" aria-labelledby="approval-title">
                    <span className={`approval-mark ${rejected ? "rejected" : ""}`} aria-hidden="true">{rejected ? "!" : "…"}</span>
                    <p className="section-label">正式账号访问</p>
                    <h2 id="approval-title">{loading ? "正在检查审核状态" : rejected ? "账号审核未通过" : state === "unavailable" ? "暂时无法确认审核状态" : "账号正在等待管理员审核"}</h2>
                    <p>{loading ? "正在安全读取当前账号权限，请稍候。" : rejected ? "此账号目前不能进入地图管理端。管理员重新批准后即可使用。" : state === "unavailable" ? toApprovalUiText(auth.access.error, "请确认数据库已执行审核 migration，然后重新检查。") : "邮箱确认和管理员审核是两个独立步骤。审核通过后可管理自己的地点与快照。"}</p>
                    <div className="approval-actions">
                        <button className="button primary" type="button" disabled={loading} onClick={() => auth.refreshApproval()}>重新检查</button>
                        <button className="button" type="button" disabled={auth.status.loading} onClick={() => auth.signOut().catch(() => {})}>退出登录</button>
                    </div>
                </section>
            </main>
            <footer><span>SN MAP · React 地图</span><span>账号权限由数据库审核策略保护</span></footer>
        </>
    );
}
