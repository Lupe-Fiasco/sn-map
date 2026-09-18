import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseConfiguration } from "../services/supabaseClient.js";
import { getOrCreateManagementSession, registerWithPassword, signInWithPassword, signOutToAnonymous } from "../services/supabaseAuth.js";
import { fetchCurrentAccess, resolveManagementAccess } from "../services/approval.js";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState({ loading: true, error: "", message: "正在初始化登录…" });
  const [accessRun, setAccessRun] = useState(0);
  const [access, setAccess] = useState({ loading: true, ...resolveManagementAccess(null), ownerId: null, error: "" });

  useEffect(() => {
    let active = true;
    if (!supabaseConfiguration.configured || !supabase) {
      setStatus({ loading: false, error: supabaseConfiguration.error || "未配置 Supabase", message: "仅可使用本地回退" });
      return undefined;
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    getOrCreateManagementSession(supabase).then((nextSession) => {
      if (active) {
        setSession(nextSession);
        setStatus({ loading: false, error: "", message: "登录状态已就绪" });
      }
    }).catch((error) => {
      if (active) setStatus({ loading: false, error: error.message, message: "登录初始化失败" });
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    const user = session?.user ?? null;
    if (!supabaseConfiguration.configured || !supabase) {
      setAccess({ loading: false, ...resolveManagementAccess(null), state: "local", ownerId: null, error: "" });
      return undefined;
    }
    setAccess({ loading: Boolean(user && !user.is_anonymous), ...resolveManagementAccess(user), ownerId: user?.id ?? null, error: "" });
    // ai coding：每次 owner/session 变化重新从 RLS 读取审核状态，旧请求不得覆盖新账号门禁。
    fetchCurrentAccess(supabase, user).then((next) => {
      if (active) setAccess({ loading: false, ...next, ownerId: user?.id ?? null, error: "" });
    }).catch((error) => {
      if (active) setAccess({ loading: false, allowed: false, state: "unavailable", isAdmin: false, ownerId: user?.id ?? null, error: error.message });
    });
    return () => { active = false; };
  }, [session?.user?.id, accessRun]);

  const run = useCallback(async (action, workingMessage) => {
    setStatus({ loading: true, error: "", message: workingMessage });
    try {
      const result = await action();
      setSession(result?.session ?? result ?? null);
      setStatus({ loading: false, error: "", message: result?.registered
        ? (result.confirmationRequired ? "注册成功：请先验证邮箱；登录后仍需等待管理员审核" : "注册成功，正在等待管理员审核")
        : "登录状态已更新" });
      return result;
    } catch (error) {
      setStatus({ loading: false, error: error.message, message: "认证操作失败" });
      throw error;
    }
  }, []);

  return {
    session,
    status,
    configured: supabaseConfiguration.configured,
    access,
    refreshApproval: () => setAccessRun((current) => current + 1),
    signIn: (email, password) => run(() => signInWithPassword(supabase, email, password), "正在登录…"),
    register: (email, password) => run(() => registerWithPassword(supabase, email, password), "正在注册…"),
    signOut: () => run(() => signOutToAnonymous(supabase), "正在退出…"),
  };
}
