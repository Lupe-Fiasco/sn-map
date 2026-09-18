import { useState } from "react";
import { isAnonymousUser } from "../services/supabaseAuth.js";

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
        <section className="auth-card" aria-labelledby="account-title">
            <div className="auth-summary">
                <div>
                    <p className="section-label">账号与数据空间</p>
                    <h2 id="account-title">
                        {formal
                            ? session.user.email
                            : anonymous
                              ? "匿名会话"
                              : "邮箱账号"}
                    </h2>
                </div>
                {formal && (
                    <button
                        className="button"
                        type="button"
                        disabled={auth.status.loading}
                        onClick={() => auth.signOut().catch(() => {})}
                    >
                        退出登录
                    </button>
                )}
            </div>
            {formal ? (
                <p className="auth-note">
                    当前地点仅归此账号所有。退出后会进入新的匿名数据空间。
                </p>
            ) : (
                <>
                    <div
                        className="auth-tabs"
                        role="tablist"
                        aria-label="账号操作"
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === "login"}
                            onClick={() => setMode("login")}
                        >
                            登录
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === "register"}
                            onClick={() => setMode("register")}
                        >
                            注册
                        </button>
                    </div>
                    <form className="auth-form" onSubmit={submit}>
                        <label>
                            邮箱
                            <input
                                type="email"
                                required
                                autoComplete="email"
                                value={email}
                                onChange={(event) =>
                                    setEmail(event.target.value)
                                }
                            />
                        </label>
                        <label>
                            密码
                            <input
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
                            className="button primary"
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
                        <p className="auth-warning">
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
                    className={auth.status.error ? "form-error" : "auth-note"}
                    role={auth.status.error ? "alert" : "status"}
                >
                    {auth.status.error || auth.status.message}
                </p>
            )}
        </section>
    );
}
