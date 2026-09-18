import { createClient } from "@supabase/supabase-js";

const environment = import.meta.env ?? {};
const url = environment.VITE_SUPABASE_URL?.trim();
const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfiguration = {
  configured: Boolean(url && publishableKey),
  error: "",
};

let client = null;

if (supabaseConfiguration.configured) {
  try {
    // ai coding：仅交给官方客户端持久化认证；允许处理 Supabase 邮箱确认回跳，绝不记录配置、session 或 token。
    client = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    supabaseConfiguration.configured = false;
    supabaseConfiguration.error = "Supabase 配置无效";
  }
}

export const supabase = client;
