import { useEffect, useMemo, useRef, useState } from "react";
import {
    fetchOwnerSnapshot,
    publishSnapshot,
    shareTokenForOwner,
    snapshotForOwner,
    unpublishSnapshot,
} from "../services/mapSnapshots.js";
import {
    captureOwnerGeneration,
    createOwnerGeneration,
    invalidateOwnerGeneration,
    isOwnerGenerationCurrent,
    updateOwnerGeneration,
} from "../services/ownerGeneration.js";
import { supabase } from "../services/supabaseClient.js";

const DEFAULT_TITLE = "睢宁地点地图";

function shareUrl(token) {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ share: token }).toString();
    url.hash = "";
    return url.toString();
}

export default function SnapshotCard({ ownerId, places, cloud }) {
    const [snapshot, setSnapshot] = useState(null);
    const [title, setTitle] = useState(DEFAULT_TITLE);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const ownerGenerationRef = useRef(createOwnerGeneration(ownerId ?? null));
    // ai coding：render 时立即使前一账号及更早快照请求失效，所有完成回调均须通过同一 guard。
    updateOwnerGeneration(ownerGenerationRef.current, ownerId ?? null);
    const currentSnapshot = snapshotForOwner(snapshot, ownerId);
    const currentShareToken = shareTokenForOwner(snapshot, ownerId);
    const link = useMemo(
        () => (currentShareToken ? shareUrl(currentShareToken) : ""),
        [currentShareToken],
    );

    useEffect(() => {
        let active = true;
        const operation = captureOwnerGeneration(ownerGenerationRef.current);
        setSnapshot(null);
        setTitle(DEFAULT_TITLE);
        setStatus("");
        setError("");
        setBusy(false);
        if (!ownerId || !supabase) return undefined;
        fetchOwnerSnapshot(supabase, ownerId)
            .then((row) => {
                const ownerSnapshot = snapshotForOwner(row, operation.ownerId);
                if (
                    !active ||
                    !isOwnerGenerationCurrent(
                        ownerGenerationRef.current,
                        operation,
                    ) ||
                    !ownerSnapshot
                )
                    return;
                setSnapshot(ownerSnapshot);
                setTitle(ownerSnapshot.title);
            })
            .catch((reason) => {
                if (
                    active &&
                    isOwnerGenerationCurrent(
                        ownerGenerationRef.current,
                        operation,
                    )
                )
                    setError(reason.message);
            });
        return () => {
            active = false;
        };
    }, [ownerId]);

    const publish = async () => {
        invalidateOwnerGeneration(ownerGenerationRef.current);
        const operation = captureOwnerGeneration(ownerGenerationRef.current);
        setBusy(true);
        setError("");
        setStatus("正在发布当前完整地点集合…");
        try {
            const row = await publishSnapshot(supabase, ownerId, title, places);
            if (
                !isOwnerGenerationCurrent(ownerGenerationRef.current, operation)
            )
                return;
            const ownerSnapshot = snapshotForOwner(row, operation.ownerId);
            if (!ownerSnapshot) return;
            setSnapshot(ownerSnapshot);
            setTitle(ownerSnapshot.title);
            setStatus(`发布成功，共 ${places.features.length} 个地点。`);
        } catch (reason) {
            if (
                isOwnerGenerationCurrent(ownerGenerationRef.current, operation)
            ) {
                setError(reason.message);
                setStatus("");
            }
        } finally {
            if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation))
                setBusy(false);
        }
    };
    const copy = async () => {
        const operation = captureOwnerGeneration(ownerGenerationRef.current);
        // ai coding：复制前重新按当前 owner 取 token，不能使用前一账号 render 遗留的 link。
        const token = shareTokenForOwner(snapshot, ownerId);
        if (
            !token ||
            operation.ownerId !== ownerId ||
            !isOwnerGenerationCurrent(ownerGenerationRef.current, operation)
        )
            return;
        const ownerLink = shareUrl(token);
        try {
            await navigator.clipboard.writeText(ownerLink);
            if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation))
                setStatus("分享链接已复制。");
        } catch {
            if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation))
                setError("复制失败，请手动选择分享链接。");
        }
    };
    const cancel = async () => {
        invalidateOwnerGeneration(ownerGenerationRef.current);
        const operation = captureOwnerGeneration(ownerGenerationRef.current);
        setBusy(true);
        setError("");
        try {
            const row = await unpublishSnapshot(supabase, ownerId);
            if (
                !isOwnerGenerationCurrent(ownerGenerationRef.current, operation)
            )
                return;
            const ownerSnapshot = snapshotForOwner(row, operation.ownerId);
            if (!ownerSnapshot) return;
            setSnapshot(ownerSnapshot);
            setStatus("公开访问已取消，原链接现在不可访问。");
        } catch (reason) {
            if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation))
                setError(reason.message);
        } finally {
            if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation))
                setBusy(false);
        }
    };

    const unavailable =
        !ownerId ||
        cloud.state !== "connected" ||
        cloud.ownerId !== ownerId ||
        cloud.saving;
    return (
        <section className="snapshot-card" aria-labelledby="snapshot-title">
            <p className="section-label">公开只读快照</p>
            <div className="snapshot-heading">
                <h2 id="snapshot-title">
                    {currentSnapshot?.is_public ? "已公开" : "未公开"}
                </h2>
                <span
                    className={`publish-badge ${currentSnapshot?.is_public ? "public" : ""}`}
                >
                    {currentSnapshot?.is_public ? "PUBLIC" : "PRIVATE"}
                </span>
            </div>
            <label className="snapshot-label">
                地图标题
                <input
                    maxLength="120"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={busy}
                />
            </label>
            <p className="file-status">
                发布会复制此刻的正式地点集合；待定点、编辑草稿及 localStorage
                草稿不会进入快照，后续编辑也不会自动更新。
            </p>
            {currentSnapshot?.is_public && (
                <label className="snapshot-label">
                    分享链接
                    <input
                        readOnly
                        value={link}
                        onFocus={(event) => event.target.select()}
                    />
                </label>
            )}
            <div className="data-actions">
                <button
                    className="button primary"
                    type="button"
                    disabled={busy || unavailable}
                    onClick={publish}
                >
                    {busy
                        ? "处理中…"
                        : currentSnapshot?.is_public
                          ? "更新公开快照"
                          : "生成公开快照"}
                </button>
                {currentSnapshot?.is_public ? (
                    <button
                        className="button"
                        type="button"
                        disabled={busy}
                        onClick={copy}
                    >
                        复制分享链接
                    </button>
                ) : (
                    <span />
                )}
            </div>
            {currentSnapshot?.is_public && (
                <button
                    className="button danger-text snapshot-unpublish"
                    type="button"
                    disabled={busy}
                    onClick={cancel}
                >
                    取消公开
                </button>
            )}
            {unavailable && (
                <p className="file-status">需先连接云端后才能发布。</p>
            )}
            {status && (
                <p className="file-status" role="status">
                    {status}
                </p>
            )}
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
