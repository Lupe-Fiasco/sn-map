import { useCallback, useEffect, useRef, useState } from "react";
import {
    completeApprovalOperation,
    fetchApprovalProfiles,
    toApprovalUiText,
    updateApprovalStatus,
} from "../services/approval.js";
import {
    captureOwnerGeneration,
    createOwnerGeneration,
    invalidateOwnerGeneration,
    isOwnerGenerationCurrent,
    updateOwnerGeneration,
} from "../services/ownerGeneration.js";
import { supabase } from "../services/supabaseClient.js";
import { ui } from "../uiClassNames.js";

const STATUS_LABELS = {
    pending: "待审核",
    approved: "已批准",
    rejected: "已拒绝",
};

export default function AdminPanel({ ownerId }) {
    const [profiles, setProfiles] = useState([]);
    const [state, setState] = useState({
        loading: true,
        busyId: "",
        error: "",
        message: "",
    });
    const ownerGenerationRef = useRef(createOwnerGeneration(ownerId));
    updateOwnerGeneration(ownerGenerationRef.current, ownerId);
    const beginOperation = useCallback(() => {
        invalidateOwnerGeneration(ownerGenerationRef.current);
        return captureOwnerGeneration(ownerGenerationRef.current);
    }, []);
    const load = useCallback(
        async (successMessage = null) => {
            const operation = beginOperation();
            setState((current) => ({
                ...current,
                loading: true,
                error: "",
                message: "",
            }));
            try {
                const rows = await fetchApprovalProfiles(supabase);
                if (
                    !isOwnerGenerationCurrent(
                        ownerGenerationRef.current,
                        operation,
                    )
                )
                    return;
                const rank = { pending: 0, rejected: 1, approved: 2 };
                setProfiles(
                    [...rows].sort(
                        (a, b) =>
                            rank[a.approval_status] - rank[b.approval_status] ||
                            a.created_at.localeCompare(b.created_at),
                    ),
                );
                setState((current) =>
                    completeApprovalOperation(
                        current,
                        ownerGenerationRef.current,
                        operation,
                        {
                            loading: false,
                            error: "",
                            message: toApprovalUiText(
                                successMessage,
                                `已加载 ${rows.length} 个正式账号`,
                            ),
                        },
                    ),
                );
            } catch (error) {
                setState((current) =>
                    completeApprovalOperation(
                        current,
                        ownerGenerationRef.current,
                        operation,
                        {
                            loading: false,
                            error: toApprovalUiText(error, "审核列表读取失败"),
                            message: "",
                        },
                    ),
                );
            }
        },
        [beginOperation],
    );
    useEffect(() => {
        load();
        return () => invalidateOwnerGeneration(ownerGenerationRef.current);
    }, [load]);
    const update = async (profile, approvalStatus) => {
        const operation = beginOperation();
        setState((current) => ({
            ...current,
            busyId: profile.id,
            error: "",
            message: "",
        }));
        try {
            await updateApprovalStatus(supabase, profile.id, approvalStatus);
            if (
                !isOwnerGenerationCurrent(ownerGenerationRef.current, operation)
            )
                return;
            await load(
                `${profile.email} 已${approvalStatus === "approved" ? "批准" : "拒绝"}`,
            );
        } catch (error) {
            // ai coding：失败也必须结束当前 owner/generation 的 busy 状态，旧账号请求则不得触碰新账号 UI。
            setState((current) =>
                completeApprovalOperation(
                    current,
                    ownerGenerationRef.current,
                    operation,
                    {
                        loading: false,
                        error: toApprovalUiText(error, "审核状态更新失败"),
                        message: "",
                    },
                ),
            );
        }
    };

    return (
        <section className={`${ui.card} mt-[10px] p-5`} aria-labelledby="admin-title">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className={ui.eyebrow}>管理员</p>
                    <h2 id="admin-title" className="text-[1.05rem] font-bold">注册审核</h2>
                </div>
                <button
                    className={ui.button}
                    type="button"
                    disabled={state.loading || Boolean(state.busyId)}
                    onClick={() => load()}
                >
                    刷新
                </button>
            </div>
            {state.loading ? (
                <p className={`${ui.muted} mt-[14px]`} role="status">
                    正在加载审核列表…
                </p>
            ) : profiles.length ? (
                <ul className="mt-[14px] list-none p-0">
                    {profiles.map((profile) => (
                        <li key={profile.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-[9px] border-t border-[#dbe3dd] py-[13px] cyber:border-[#68edff]/20">
                            <div>
                                <strong className="block break-words text-[.8rem]">{profile.email}</strong>
                                <span className="mt-1 block break-words text-[.68rem] text-[#60716d] cyber:text-[#9fc8d3]">
                                    注册于{" "}
                                    {new Date(
                                        profile.created_at,
                                    ).toLocaleString("zh-CN")}
                                </span>
                            </div>
                            <span
                                className={`self-start rounded-full px-[7px] py-[3px] text-[.65rem] font-bold ${profile.approval_status === "approved" ? "bg-[#dff1e8] text-[#0e5f4b] cyber:bg-[rgba(19,109,130,.36)] cyber:text-[#8df5ff]" : profile.approval_status === "rejected" ? "bg-[#ffe7e4] text-[#812e28] cyber:bg-[#381b2a] cyber:text-[#ff9caf]" : "bg-[#fff1d9] text-[#704a19] cyber:bg-[#35291c] cyber:text-[#ffd18a]"}`}
                            >
                                {STATUS_LABELS[profile.approval_status]}
                            </span>
                            <div className="col-span-full flex gap-[7px]">
                                {profile.approval_status !== "approved" && (
                                    <button
                                        className={`${ui.button} ${ui.primaryButton} !min-h-[31px] !py-1 text-[.73rem]`}
                                        type="button"
                                        disabled={Boolean(state.busyId)}
                                        onClick={() => update(profile, "approved")}
                                    >
                                        {profile.approval_status === "rejected"
                                            ? "重新批准"
                                            : "批准"}
                                    </button>
                                )}
                                {profile.approval_status !== "rejected" && (
                                    <button
                                        className={`${ui.button} ${ui.dangerButton} !min-h-[31px] !py-1 text-[.73rem]`}
                                        type="button"
                                        disabled={Boolean(state.busyId)}
                                        onClick={() => update(profile, "rejected")}
                                    >
                                        拒绝
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className={`${ui.muted} mt-[14px]`}>暂无正式账号审核记录。</p>
            )}
            {state.message && (
                <p className={`${ui.muted} mt-[14px] break-words`} role="status">
                    {state.message}
                </p>
            )}
            {state.error && (
                <p className={ui.error} role="alert">
                    {state.error}
                </p>
            )}
        </section>
    );
}
