import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { completeApprovalOperation, fetchApprovalProfiles, resolveAppRoute, resolveManagementAccess, toApprovalUiText, updateApprovalStatus } from "../src/services/approval.js";
import { captureOwnerGeneration, createOwnerGeneration, invalidateOwnerGeneration, updateOwnerGeneration } from "../src/services/ownerGeneration.js";

test("formal users are gated by approval while anonymous users and admins remain compatible", () => {
  const formal = { id: "formal-user", is_anonymous: false };
  assert.equal(resolveManagementAccess(formal, { approval_status: "pending" }).allowed, false);
  assert.equal(resolveManagementAccess(formal, { approval_status: "rejected" }).allowed, false);
  assert.equal(resolveManagementAccess(formal, { approval_status: "approved" }).allowed, true);
  assert.deepEqual(resolveManagementAccess(formal, { approval_status: "pending" }, true), { allowed: true, state: "approved", isAdmin: true });
  assert.equal(resolveManagementAccess({ id: "anon", is_anonymous: true }, { approval_status: "pending" }).allowed, true);
});

test("public share routing is selected before management approval", () => {
  assert.deepEqual(resolveAppRoute("?share=" + "t".repeat(32)), { kind: "public-share", token: "t".repeat(32) });
  assert.deepEqual(resolveAppRoute(""), { kind: "management", token: "" });
});

test("admin list and update use RLS-backed profiles calls with an allowlisted payload", async () => {
  const calls = [];
  const rows = [{ id: "user-a", email: "user@example.test", approval_status: "pending", created_at: "2026-01-01", updated_at: "2026-01-01" }];
  const listQuery = {
    select(columns) { calls.push(["select", columns]); return this; },
    not(...args) { calls.push(["not", ...args]); return this; },
    order: async (...args) => { calls.push(["order", ...args]); return { data: rows, error: null }; },
  };
  assert.equal((await fetchApprovalProfiles({ from: () => listQuery }))[0].approval_status, "pending");

  let payload;
  const updateQuery = {
    update(value) { payload = value; return this; }, eq() { return this; }, select() { return this; },
    single: async () => ({ data: { ...rows[0], approval_status: "approved" }, error: null }),
  };
  await updateApprovalStatus({ from: (table) => { assert.equal(table, "profiles"); return updateQuery; } }, "user-a", "approved");
  assert.deepEqual(payload, { approval_status: "approved" });
  assert.equal(JSON.stringify(payload).match(/key|password|token|email/i), null);
});

test("failed approval update clears busy only for the current owner generation", () => {
  const ownerGeneration = createOwnerGeneration("admin-a");
  invalidateOwnerGeneration(ownerGeneration);
  const operation = captureOwnerGeneration(ownerGeneration);
  const busy = { loading: false, busyId: "user-a", error: "", message: "" };

  const failed = completeApprovalOperation(busy, ownerGeneration, operation, {
    loading: false, error: "审核状态更新失败：网络错误", message: "",
  });
  assert.deepEqual(failed, { loading: false, busyId: "", error: "审核状态更新失败：网络错误", message: "" });

  updateOwnerGeneration(ownerGeneration, "admin-b");
  assert.equal(completeApprovalOperation(busy, ownerGeneration, operation, { error: "旧账号错误" }), busy);
});

test("approval UI state never exposes events or arbitrary objects as React children", () => {
  const ownerGeneration = createOwnerGeneration("admin-a");
  const operation = captureOwnerGeneration(ownerGeneration);
  const event = { _reactName: "onClick", nativeEvent: {} };
  const state = completeApprovalOperation(
    { loading: true, busyId: "user-a", error: "", message: "" },
    ownerGeneration,
    operation,
    { loading: false, message: event, error: { message: "object error" } },
  );

  assert.equal(state.message, "");
  assert.equal(state.error, "审核操作失败");
  assert.equal(typeof state.message, "string");
  assert.equal(typeof state.error, "string");
  assert.equal(toApprovalUiText(new Error("网络错误")), "网络错误");
  assert.equal(toApprovalUiText(event, "刷新完成"), "刷新完成");
});

test("admin refresh and review buttons do not forward click events to operations", async () => {
  const [adminPanel, approvalGate] = await Promise.all([
    readFile(new URL("../src/components/AdminPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ApprovalGate.jsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(adminPanel, /onClick=\{load\}/);
  assert.match(adminPanel, /onClick=\{\(\) => load\(\)\}/);
  assert.match(adminPanel, /onClick=\{\(\) => update\(profile, "approved"\)\}/);
  assert.match(adminPanel, /onClick=\{\(\) => update\(profile, "rejected"\)\}/);
  assert.match(approvalGate, /onClick=\{\(\) => auth\.refreshApproval\(\)\}/);
});
