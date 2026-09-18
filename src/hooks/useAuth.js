import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseConfiguration } from "../services/supabaseClient.js";
import { getOrCreateManagementSession, registerWithPassword, signInWithPassword, signOutToAnonymous } from "../services/supabaseAuth.js";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState({ loading: true, error: "", message: "正在初始化登录…" });

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

  const run = useCallback(async (action, workingMessage) => {
    setStatus({ loading: true, error: "", message: workingMessage });
    try {
      const result = await action();
      setSession(result?.session ?? result ?? null);
      setStatus({ loading: false, error: "", message: result?.confirmationRequired ? "注册邮件已发送，请验证邮箱后登录" : "登录状态已更新" });
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
    signIn: (email, password) => run(() => signInWithPassword(supabase, email, password), "正在登录…"),
    register: (email, password) => run(() => registerWithPassword(supabase, email, password), "正在注册…"),
    signOut: () => run(() => signOutToAnonymous(supabase), "正在退出…"),
  };
}
