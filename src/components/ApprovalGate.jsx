import { toApprovalUiText } from "../services/approval.js";
import { ui } from "../uiClassNames.js";

export default function ApprovalGate({ auth }) {
    const state = auth.access.state;
    const loading = auth.access.loading || auth.access.ownerId !== auth.session?.user?.id;
    const rejected = state === "rejected";
    return (
        <div className="min-h-screen bg-[#f6f7f2] text-[#19332e] cyber:bg-[#070b18] cyber:text-[#e6fbff] minimal:bg-[#fafafa]">
            <header className="mx-auto flex w-[min(1440px,calc(100%_-_48px))] items-center justify-between gap-6 pb-6 pt-[38px]">
                <div><p className={ui.eyebrow}>SN MAP / 账号审核</p><h1 className="text-[clamp(1.65rem,3vw,2.35rem)] font-bold tracking-[-.035em]">睢宁地图数据</h1></div>
            </header>
            <main className="mx-auto grid min-h-[520px] w-[min(1440px,calc(100%_-_48px))] place-items-start justify-center pt-[72px]">
                {/* ai coding：门禁状态使用主题 utility，加载、拒绝与不可用语义仍由原状态机驱动。 */}
                <section className={`${ui.card} w-[min(560px,100%)] p-[34px] text-center`} aria-labelledby="approval-title">
                    <span className={`mx-auto mb-[18px] grid h-[52px] w-[52px] place-items-center rounded-full text-xl font-extrabold ${rejected ? "bg-[#ffebe8] text-[#9d352e] cyber:bg-[#381b2a] cyber:text-[#ff9caf]" : "bg-[#fff3dc] text-[#8a5a1c] cyber:bg-[#35291c] cyber:text-[#ffd18a]"}`} aria-hidden="true">{rejected ? "!" : "…"}</span>
                    <p className={ui.eyebrow}>正式账号访问</p>
                    <h2 id="approval-title" className="mt-1 text-[1.35rem] font-bold">{loading ? "正在检查审核状态" : rejected ? "账号审核未通过" : state === "unavailable" ? "暂时无法确认审核状态" : "账号等待管理员审核"}</h2>
                    <p className="mx-auto mt-[14px] max-w-[440px] text-[.88rem] leading-[1.7] text-[#60716d] cyber:text-[#9fc8d3]">{loading ? "正在安全读取当前账号权限，请稍候。" : rejected ? "此账号目前不能进入地图管理端。管理员重新批准后即可使用。" : state === "unavailable" ? toApprovalUiText(auth.access.error, "请确认数据库已执行审核 migration，然后重新检查。") : "邮箱确认和管理员审核是两个独立步骤。审核通过后可管理自己的地点与快照。"}</p>
                    <div className="mt-6 flex justify-center gap-[9px]">
                        <button className={`${ui.button} ${ui.primaryButton}`} type="button" disabled={loading} onClick={() => auth.refreshApproval()}>重新检查</button>
                        <button className={ui.button} type="button" disabled={auth.status.loading} onClick={() => auth.signOut().catch(() => {})}>退出登录</button>
                    </div>
                </section>
            </main>
            <footer><span>SN MAP · React 地图</span><span>账号权限由数据库审核策略保护</span></footer>
        </div>
    );
}
