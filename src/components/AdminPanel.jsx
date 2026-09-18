import { useCallback, useEffect, useRef, useState } from "react";
import { completeApprovalOperation, fetchApprovalProfiles, toApprovalUiText, updateApprovalStatus } from "../services/approval.js";
import { captureOwnerGeneration, createOwnerGeneration, invalidateOwnerGeneration, isOwnerGenerationCurrent, updateOwnerGeneration } from "../services/ownerGeneration.js";
import { supabase } from "../services/supabaseClient.js";

const STATUS_LABELS = { pending: "待审核", approved: "已批准", rejected: "已拒绝" };

export default function AdminPanel({ ownerId }) {
    const [profiles, setProfiles] = useState([]);
    const [state, setState] = useState({ loading: true, busyId: "", error: "", message: "" });
    const ownerGenerationRef = useRef(createOwnerGeneration(ownerId));
    updateOwnerGeneration(ownerGenerationRef.current, ownerId);
    const beginOperation = useCallback(() => {
        invalidateOwnerGeneration(ownerGenerationRef.current);
        return captureOwnerGeneration(ownerGenerationRef.current);
    }, []);
    const load = useCallback(async (successMessage = null) => {
        const operation = beginOperation();
        setState((current) => ({ ...current, loading: true, error: "", message: "" }));
        try {
            const rows = await fetchApprovalProfiles(supabase);
            if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) return;
            const rank = { pending: 0, rejected: 1, approved: 2 };
            setProfiles([...rows].sort((a, b) => rank[a.approval_status] - rank[b.approval_status] || a.created_at.localeCompare(b.created_at)));
            setState((current) => completeApprovalOperation(current, ownerGenerationRef.current, operation, {
                loading: false, error: "", message: toApprovalUiText(successMessage, `已加载 ${rows.length} 个正式账号`),
            }));
        } catch (error) {
            setState((current) => completeApprovalOperation(current, ownerGenerationRef.current, operation, {
                loading: false, error: toApprovalUiText(error, "审核列表读取失败"), message: "",
            }));
        }
    }, [beginOperation]);
    useEffect(() => {
        load();
        return () => invalidateOwnerGeneration(ownerGenerationRef.current);
    }, [load]);
    const update = async (profile, approvalStatus) => {
        const operation = beginOperation();
        setState((current) => ({ ...current, busyId: profile.id, error: "", message: "" }));
        try {
            await updateApprovalStatus(supabase, profile.id, approvalStatus);
            if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) return;
            await load(`${profile.email} 已${approvalStatus === "approved" ? "批准" : "拒绝"}`);
        } catch (error) {
            // ai coding：失败也必须结束当前 owner/generation 的 busy 状态，旧账号请求则不得触碰新账号 UI。
            setState((current) => completeApprovalOperation(current, ownerGenerationRef.current, operation, {
                loading: false, error: toApprovalUiText(error, "审核状态更新失败"), message: "",
            }));
        }
    };

    return (
        <section className="admin-card" aria-labelledby="admin-title">
            <div className="section-heading"><div><p className="section-label">管理员</p><h2 id="admin-title">注册审核</h2></div><button className="button" type="button" disabled={state.loading || Boolean(state.busyId)} onClick={() => load()}>刷新</button></div>
            {state.loading ? <p className="empty-state" role="status">正在加载审核列表…</p> : profiles.length ? (
                <ul className="approval-list">
                    {profiles.map((profile) => <li key={profile.id}>
                        <div><strong>{profile.email}</strong><span>注册于 {new Date(profile.created_at).toLocaleString("zh-CN")}</span></div>
                        <span className={`approval-badge ${profile.approval_status}`}>{STATUS_LABELS[profile.approval_status]}</span>
                        <div className="approval-row-actions">
                            {profile.approval_status !== "approved" && <button className="button primary" type="button" disabled={Boolean(state.busyId)} onClick={() => update(profile, "approved")}>{profile.approval_status === "rejected" ? "重新批准" : "批准"}</button>}
                            {profile.approval_status !== "rejected" && <button className="button danger-text" type="button" disabled={Boolean(state.busyId)} onClick={() => update(profile, "rejected")}>拒绝</button>}
                        </div>
                    </li>)}
                </ul>
            ) : <p className="empty-state">暂无正式账号审核记录。</p>}
            {state.message && <p className="file-status" role="status">{state.message}</p>}
            {state.error && <p className="form-error" role="alert">{state.error}</p>}
        </section>
    );
}
