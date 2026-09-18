import { isAnonymousUser } from "./supabaseAuth.js";
import { isOwnerGenerationCurrent } from "./ownerGeneration.js";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"];

export function toApprovalUiText(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value instanceof Error && typeof value.message === "string") return value.message;
  return fallback;
}

export function completeApprovalOperation(state, ownerGeneration, operation, patch) {
  if (!isOwnerGenerationCurrent(ownerGeneration, operation)) return state;
  // ai coding：审核 UI 的 message/error 只允许字符串，事件或响应对象不得进入 React 子节点。
  const safePatch = { ...patch };
  if (Object.hasOwn(safePatch, "message")) safePatch.message = toApprovalUiText(safePatch.message);
  if (Object.hasOwn(safePatch, "error")) safePatch.error = toApprovalUiText(safePatch.error, "审核操作失败");
  return { ...state, ...safePatch, busyId: "" };
}

export function resolveManagementAccess(user, profile, isAdmin = false) {
  if (!user) return { allowed: true, state: "signed-out", isAdmin: false };
  if (isAnonymousUser(user)) return { allowed: true, state: "anonymous", isAdmin: false };
  if (isAdmin) return { allowed: true, state: "approved", isAdmin: true };
  const state = APPROVAL_STATUSES.includes(profile?.approval_status) ? profile.approval_status : "unavailable";
  return { allowed: state === "approved", state, isAdmin: false };
}

export function resolveAppRoute(search = "") {
  const token = new URLSearchParams(search).get("share");
  return token ? { kind: "public-share", token } : { kind: "management", token: "" };
}

function approvalError(prefix, error) {
  const missing = ["42P01", "PGRST202", "PGRST205", "42883"].includes(error?.code)
    || /(could not find|relation).+(profiles|is_admin)/i.test(error?.message || "");
  return new Error(missing
    ? `${prefix}：注册审核功能尚未初始化，请先执行 migration 005`
    : `${prefix}：${error?.message || "云端请求失败"}`);
}

export async function fetchCurrentAccess(client, user) {
  if (!user || isAnonymousUser(user)) return resolveManagementAccess(user, null, false);
  const [profileResult, adminResult] = await Promise.all([
    client.from("profiles").select("id,email,approval_status,created_at,updated_at").eq("id", user.id).maybeSingle(),
    client.rpc("is_admin"),
  ]);
  if (profileResult.error) throw approvalError("审核状态读取失败", profileResult.error);
  if (adminResult.error) throw approvalError("管理员身份读取失败", adminResult.error);
  return resolveManagementAccess(user, profileResult.data, adminResult.data === true);
}

export async function fetchApprovalProfiles(client) {
  const { data, error } = await client.from("profiles")
    .select("id,email,approval_status,created_at,updated_at")
    .not("email", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw approvalError("审核列表读取失败", error);
  return data ?? [];
}

export async function updateApprovalStatus(client, userId, approvalStatus) {
  if (!APPROVAL_STATUSES.includes(approvalStatus)) throw new Error("审核状态无效");
  // ai coding：客户端只提交审核状态；身份、邮箱和管理员绑定均不能由浏览器改写。
  const payload = { approval_status: approvalStatus };
  const { data, error } = await client.from("profiles").update(payload).eq("id", userId)
    .select("id,email,approval_status,created_at,updated_at").single();
  if (error || !data) throw approvalError("审核状态更新失败", error);
  return data;
}
