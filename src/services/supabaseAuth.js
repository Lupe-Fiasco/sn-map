export function isAnonymousUser(user) {
  return Boolean(user?.is_anonymous);
}

export async function getOrCreateManagementSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`登录状态读取失败：${error.message}`);
  if (data.session?.user?.id) return data.session;
  const result = await client.auth.signInAnonymously();
  if (result.error || !result.data.session?.user?.id) {
    throw new Error(`匿名登录失败：${result.error?.message || "未返回有效会话"}`);
  }
  return result.data.session;
}

export async function signInWithPassword(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) throw new Error(`登录失败：${error?.message || "未返回有效会话"}`);
  return data.session;
}

export async function registerWithPassword(client, email, password) {
  // ai coding：不猜测匿名数据归属、不在客户端跨 owner 搬运；注册前结束匿名会话，旧数据仍安全保留在旧 owner 下。
  const signOut = await client.auth.signOut();
  if (signOut.error) throw new Error(`注册准备失败：${signOut.error.message}`);
  const { data, error } = await client.auth.signUp({ email: email.trim(), password });
  if (error || !data.user) throw new Error(`注册失败：${error?.message || "未返回用户"}`);
  return { session: data.session ?? null, confirmationRequired: !data.session };
}

export async function signOutToAnonymous(client) {
  const result = await client.auth.signOut();
  if (result.error) throw new Error(`退出失败：${result.error.message}`);
  return getOrCreateManagementSession(client);
}
