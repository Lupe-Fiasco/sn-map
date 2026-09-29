import { useState } from "react";
import { isAnonymousUser } from "../services/supabaseAuth.js";
import { ui } from "../uiClassNames.js";

export default function AuthCard({ session, auth, placeCount, onExport }) {
    const [mode, setMode] = useState("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const anonymous = isAnonymousUser(session?.user);
    const formal = session?.user && !anonymous;

    const submit = async (event) => {
        event.preventDefault();
        if (
            mode === "register" &&
            anonymous &&
            !window.confirm(
                `注册会切换到新的正式账号，当前匿名账号的 ${placeCount} 个地点不会自动迁移。建议先导出备份。仍要继续吗？`,
            )
        )
            return;
        try {
            if (mode === "register") await auth.register(email, password);
            else await auth.signIn(email, password);
            setPassword("");
        } catch {
            /* 错误由认证状态区统一展示。 */
        }
    };

    return (
        <section className={`${ui.card} min-w-0 px-[18px] py-4`} aria-labelledby="account-title">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className={ui.eyebrow}>账号与数据空间</p>
                    <h2 id="account-title" className="text-[1.05rem] font-bold">
                        {formal
                            ? session.user.email
                            : anonymous
                              ? "匿名会话"
                              : "邮箱账号"}
                    </h2>
                </div>
                {formal && (
                    <button
                        className={ui.button}
                        type="button"
                        disabled={auth.status.loading}
                        onClick={() => auth.signOut().catch(() => {})}
                    >
                        退出登录
                    </button>
                )}
            </div>
            {formal ? (
                <p className={`${ui.muted} mt-[9px] text-[.73rem] leading-[1.45]`}>
                    当前地点仅归此账号所有。退出后会进入新的匿名数据空间。
                </p>
            ) : (
                <>
                    <div
                        className="mt-[10px] flex gap-1"
                        role="tablist"
                        aria-label="账号操作"
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === "login"}
                            className="rounded-full border-0 bg-transparent px-[9px] py-[3px] text-[.75rem] text-[#60716d] aria-selected:bg-[#e4f1eb] aria-selected:font-bold aria-selected:text-[#0e5f4b] cyber:text-[#9fc8d3] cyber:aria-selected:bg-[rgba(25,91,111,.42)] cyber:aria-selected:text-[#68edff]"
                            onClick={() => setMode("login")}
                        >
                            登录
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === "register"}
                            className="rounded-full border-0 bg-transparent px-[9px] py-[3px] text-[.75rem] text-[#60716d] aria-selected:bg-[#e4f1eb] aria-selected:font-bold aria-selected:text-[#0e5f4b] cyber:text-[#9fc8d3] cyber:aria-selected:bg-[rgba(25,91,111,.42)] cyber:aria-selected:text-[#68edff]"
                            onClick={() => setMode("register")}
                        >
                            注册
                        </button>
                    </div>
                    <form className="mt-[10px] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 max-[900px]:grid-cols-1" onSubmit={submit}>
                        <label className={ui.label}>
                            邮箱
                            <input
                                className={`${ui.input} mt-1`}
                                type="email"
                                required
                                autoComplete="email"
                                value={email}
                                onChange={(event) =>
                                    setEmail(event.target.value)
                                }
                            />
                        </label>
                        <label className={ui.label}>
                            密码
                            <input
                                className={`${ui.input} mt-1`}
                                type="password"
                                required
                                minLength="6"
                                autoComplete={
                                    mode === "register"
                                        ? "new-password"
                                        : "current-password"
                                }
                                value={password}
                                onChange={(event) =>
                                    setPassword(event.target.value)
                                }
                            />
                        </label>
                        <button
                            className={`${ui.button} ${ui.primaryButton}`}
                            type="submit"
                            disabled={!auth.configured || auth.status.loading}
                        >
                            {auth.status.loading
                                ? "处理中…"
                                : mode === "register"
                                  ? "创建正式账号"
                                  : "登录正式账号"}
                        </button>
                    </form>
                    {anonymous && (
                        <p className="mt-[9px] text-[.73rem] leading-[1.45] text-[#704a19] cyber:text-[#ffd18a] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[3px] [&_button]:font-bold [&_button]:text-[#0e6f59] [&_button]:underline cyber:[&_button]:text-[#68edff]">
                            登录或注册不会迁移、合并或覆盖当前匿名地点。请先
                            <button type="button" onClick={onExport}>
                                导出备份
                            </button>
                            ；退出匿名会话后无法自动找回该 owner。
                        </p>
                    )}
                </>
            )}
            {(auth.status.error || (!formal && auth.status.message)) && (
                <p
                    className={auth.status.error ? ui.error : `${ui.muted} mt-[9px] text-[.73rem]`}
                    role={auth.status.error ? "alert" : "status"}
                >
                    {auth.status.error || auth.status.message}
                </p>
            )}
        </section>
    );
}
