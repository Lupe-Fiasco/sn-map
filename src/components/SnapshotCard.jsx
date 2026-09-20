import { useEffect, useMemo, useRef, useState } from "react";
import {
    fetchOwnerSnapshot,
    publicationLevel,
    publishSnapshot,
    SNAPSHOT_LEVEL_LABELS,
    SNAPSHOT_PRESETS,
    shareTokenForOwner,
    snapshotDisclosure,
    snapshotForOwner,
    snapshotNeedsRepublish,
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
const PRESET_OPTIONS = [
    ["basic", SNAPSHOT_LEVEL_LABELS.basic, "地图位置或区域形状、名称、类型和代表经纬度"],
    ["details", SNAPSHOT_LEVEL_LABELS.details, "基础级别 + 备注、地址、电话等安全业务信息"],
    ["images", SNAPSHOT_LEVEL_LABELS.images, "详细级别 + 已发布的实景图片"],
];

function shareUrl(token) {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ share: token }).toString();
    url.hash = "";
    return url.toString();
}

export default function SnapshotCard({ ownerId, imagesEnabled, places, cloud }) {
    const [snapshot, setSnapshot] = useState(null);
    const [title, setTitle] = useState(DEFAULT_TITLE);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [preset, setPreset] = useState("basic");
    const [imageCount, setImageCount] = useState(null);
    const [imageCountError, setImageCountError] = useState("");
    const [imageCountReload, setImageCountReload] = useState(0);
    const [loadedOwnerId, setLoadedOwnerId] = useState(null);
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
        setPreset("basic");
        setLoadedOwnerId(null);
        if (!ownerId || !supabase) {
            setLoadedOwnerId(ownerId ?? null);
            return undefined;
        }
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
                const publishedFields = snapshotDisclosure(ownerSnapshot.snapshot, ownerSnapshot);
                setPreset(publicationLevel(publishedFields) ?? "basic");
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
            })
            .finally(() => {
                if (active && isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) {
                    setLoadedOwnerId(operation.ownerId);
                }
            });
        return () => {
            active = false;
        };
    }, [ownerId, imagesEnabled]);

    useEffect(() => {
        let active = true;
        const ids = places.features.map((feature) => String(feature.id));
        setImageCountError("");
        if (!ownerId || !imagesEnabled || !supabase || !ids.length) { setImageCount(0); return undefined; }
        setImageCount(null);
        const refreshImageCount = () => supabase.from("place_images").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).in("place_id", ids)
            .then(({ count, error: countError }) => {
                if (!active) return;
                if (countError) setImageCountError("实景图片数量读取失败，请确认已执行 migration 006。");
                else setImageCount(count ?? 0);
            }).catch(() => { if (active) setImageCountError("实景图片数量读取失败，请检查网络后重试。"); });
        refreshImageCount();
        window.addEventListener("place-images-changed", refreshImageCount);
        return () => { active = false; window.removeEventListener("place-images-changed", refreshImageCount); };
    }, [ownerId, imagesEnabled, places, imageCountReload]);

    const publish = async () => {
        invalidateOwnerGeneration(ownerGenerationRef.current);
        const operation = captureOwnerGeneration(ownerGenerationRef.current);
        setBusy(true);
        setError("");
        setStatus("正在生成并发布脱敏快照…");
        try {
            const row = await publishSnapshot(supabase, ownerId, title, places, preset, { images: imagesEnabled });
            if (
                !isOwnerGenerationCurrent(ownerGenerationRef.current, operation)
            )
                return;
            const ownerSnapshot = snapshotForOwner(row, operation.ownerId);
            if (!ownerSnapshot) return;
            setSnapshot(ownerSnapshot);
            setTitle(ownerSnapshot.title);
            setStatus(row.cleanupWarning
                ? `快照已更新，但公开图片清理未完成：${row.cleanupWarning}${row.pendingCleanupPaths?.length ? ` 待清理路径：${row.pendingCleanupPaths.join("、")}` : ""}`
                : `发布成功，共 ${places.features.length} 个地点；已应用“${SNAPSHOT_LEVEL_LABELS[preset]}”。`);
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
            setStatus(row.cleanupWarning
                ? `公开访问已取消，但图片清理未完成：${row.cleanupWarning}${row.pendingCleanupPaths?.length ? ` 待清理路径：${row.pendingCleanupPaths.join("、")}` : ""}`
                : "公开访问已取消；原链接现在不可访问，但已缓存或已复制内容无法绝对收回。");
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
    // ai coding：账号切换时旧快照立即隐藏；空状态始终以 basic 驱动表单，渲染逻辑不接收 null disclosure。
    const snapshotLoading = Boolean(ownerId && supabase && loadedOwnerId !== ownerId);
    const publishedDisclosure = currentSnapshot
        ? (snapshotDisclosure(currentSnapshot.snapshot, currentSnapshot) ?? SNAPSHOT_PRESETS.basic)
        : SNAPSHOT_PRESETS.basic;
    const publishedLevel = publicationLevel(publishedDisclosure) ?? "basic";
    const needsRepublish = snapshotNeedsRepublish(currentSnapshot?.snapshot);
    const imagesUnavailable = preset === "images" && (!imagesEnabled || imageCount === null || imageCount === 0);
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
            {currentSnapshot?.is_public && <p className="snapshot-current-level">当前公开级别：<b>{SNAPSHOT_LEVEL_LABELS[publishedLevel]}</b></p>}
            {snapshotLoading ? (
                <p className="file-status" role="status">正在读取当前账号的公开快照…</p>
            ) : !currentSnapshot ? (
                <p className="file-status">当前账号尚无公开快照；首次发布默认使用基础级别。</p>
            ) : null}
            <label className="snapshot-label">
                地图标题
                <input
                    maxLength="120"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={busy}
                />
            </label>
            <fieldset className="snapshot-options" disabled={busy}>
                <legend>公开展示级别</legend>
                <div className="snapshot-presets">
                    {PRESET_OPTIONS.map(([value, label, help]) => (
                        <label key={value} className={value === "images" && (!imagesEnabled || !(imageCount > 0)) ? "disabled" : ""}>
                            <input type="radio" name="snapshot-preset" checked={preset === value} disabled={value === "images" && (!imagesEnabled || !(imageCount > 0))} onChange={() => setPreset(value)} />
                            <span><b>{label}</b><small>{help}</small></span>
                        </label>
                    ))}
                </div>
                <p className="form-help">三个级别均固定公开名称、类型、代表经纬度和 Point 位置或 Polygon 完整形状。{imagesEnabled ? (imageCountError ? "图片数量暂不可用。" : imageCount === null ? "正在读取实景图片数量…" : imageCount ? `当前正式地点共 ${imageCount} 张图片；级别 3 会重新编码并移除元数据。` : "当前没有可公开的实景图片，级别 3 暂不可选。") : "实景图片仅限已批准正式账号或管理员公开。"}</p>
                {imageCountError && <div className="image-count-error" role="alert"><span>{imageCountError}</span><button className="button" type="button" onClick={() => setImageCountReload((value) => value + 1)}>重试</button></div>}
            </fieldset>
            <p className="file-status">
                发布会复制此刻的正式地点集合；待定点、编辑草稿及 localStorage
                草稿不会进入快照，后续编辑也不会自动更新。
            </p>
            {currentSnapshot && (
                <p className="snapshot-warning">
                    {needsRepublish
                        ? "这是旧版快照，当前范围已按原记录兼容显示。请重新发布以应用新版固定展示级别；如不再公开，可先取消公开。"
                        : snapshotDisclosure(currentSnapshot.snapshot, currentSnapshot)
                        ? "当前公开内容以最后一次发布时选择的展示范围为准；修改选项后需更新公开快照。"
                        : "这是历史快照，无法确认其脱敏范围。请重新发布以应用展示范围；如不再公开，可先取消公开。"}
                </p>
            )}
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
                    disabled={busy || unavailable || imagesUnavailable}
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
