import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ImageLightbox from "./ImageLightbox.jsx";
import {
    deleteAfterConfirmation,
    imageCollectionView,
} from "../services/imagePresentation.js";
import {
    deletePlaceImage,
    fetchPlaceImages,
    uploadPlaceImage,
} from "../services/placeImages.js";
import { supabase } from "../services/supabaseClient.js";

function EyeIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
            <circle cx="12" cy="12" r="2.75" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
        </svg>
    );
}

export default function PlaceImages({ ownerId, mapId, placeId, disabled = false }) {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [operation, setOperation] = useState("");
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [status, setStatus] = useState("");
    const [preview, setPreview] = useState(null);
    const [pendingDelete, setPendingDelete] = useState(null);
    const cancelDeleteRef = useRef(null);
    const deleteDialogRef = useRef(null);

    const load = useCallback(
        async (active = () => true) => {
            if (!supabase || !ownerId || !placeId) {
                if (active()) setLoading(false);
                return;
            }
            if (active()) {
                setLoading(true);
                setLoadError("");
            }
            try {
                const next = await fetchPlaceImages(supabase, ownerId, mapId, placeId);
                if (active()) setImages(next);
            } catch (reason) {
                if (active()) setLoadError(reason.message);
            } finally {
                if (active()) setLoading(false);
            }
        },
        [ownerId, mapId, placeId],
    );

    useEffect(() => {
        let active = true;
        setImages([]);
        setLoadError("");
        setActionError("");
        setStatus("");
        setPreview(null);
        setPendingDelete(null);
        load(() => active);
        return () => {
            active = false;
        };
    }, [load]);

    useEffect(() => {
        if (!pendingDelete) return undefined;
        const previousFocus = document.activeElement;
        // ai coding：确认弹窗在捕获阶段独占 Escape，并将正反向 Tab 严格圈定在可用操作内。
        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPendingDelete(null);
                return;
            }
            if (event.key !== "Tab") return;
            const controls = [
                ...(deleteDialogRef.current?.querySelectorAll(
                    "button:not([disabled])",
                ) || []),
            ];
            event.preventDefault();
            if (!controls.length) {
                deleteDialogRef.current?.focus();
                return;
            }
            const currentIndex = controls.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? currentIndex <= 0
                    ? controls.length - 1
                    : currentIndex - 1
                : currentIndex < 0 || currentIndex === controls.length - 1
                  ? 0
                  : currentIndex + 1;
            controls[nextIndex].focus();
        };
        document.addEventListener("keydown", onKeyDown, true);
        cancelDeleteRef.current?.focus();
        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            previousFocus?.focus?.();
        };
    }, [pendingDelete]);

    const upload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setBusy(true);
        setOperation("upload");
        setActionError("");
        setStatus("正在上传实景图片…");
        try {
            await uploadPlaceImage(supabase, ownerId, mapId, placeId, file);
            await load();
            window.dispatchEvent(new Event("place-images-changed"));
            setStatus("图片已上传。");
        } catch (reason) {
            setActionError(reason.message);
            setStatus("");
        } finally {
            setBusy(false);
            setOperation("");
        }
    };

    const confirmDelete = async () => {
        const image = pendingDelete;
        if (!image) return;
        setBusy(true);
        setOperation("delete");
        setActionError("");
        try {
            await deleteAfterConfirmation(true, () =>
                deletePlaceImage(supabase, ownerId, mapId, placeId, image),
            );
            setImages((current) =>
                current.filter((item) => item.id !== image.id),
            );
            setPendingDelete(null);
            window.dispatchEvent(new Event("place-images-changed"));
            setStatus("图片已删除。");
        } catch (reason) {
            setActionError(reason.message);
            requestAnimationFrame(() => cancelDeleteRef.current?.focus());
        } finally {
            setBusy(false);
            setOperation("");
        }
    };

    const unavailable = disabled || busy || loading || !supabase || !ownerId;
    const view = imageCollectionView({ loading, error: loadError, images });
    if (!ownerId)
        return (
            <p className="form-help">匿名兼容账号不能上传或管理实景图片。</p>
        );
    return (
        <section
            className="place-images"
            aria-labelledby={`place-images-${placeId}`}
            aria-busy={loading || busy}
        >
            <div className="place-images-heading">
                <div>
                    <h4 id={`place-images-${placeId}`}>实景图片</h4>
                    <small>
                        {view.state === "loading"
                            ? "图片加载中…"
                            : view.state === "error"
                              ? "图片加载失败"
                              : `${view.count} 张 · JPG/PNG/WebP，单张不超过 5MB`}
                    </small>
                </div>
                <label
                    className={`button image-upload ${unavailable ? "disabled" : ""}`}
                >
                    {operation === "upload" ? (
                        <>
                            <span
                                className="upload-spinner"
                                aria-hidden="true"
                            />
                            上传中…
                        </>
                    ) : (
                        <>上传</>
                    )}
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={unavailable}
                        onChange={upload}
                    />
                </label>
            </div>
            {view.state === "ready" && (
                <ul className="private-image-list">
                    {images.map((image) => {
                        const alt =
                            image.alt_text ||
                            image.storage_path?.split("/").pop() ||
                            "地点实景";
                        return (
                            <li key={image.id} className="image-card">
                                <button
                                    className="image-preview-button"
                                    type="button"
                                    aria-label={`预览图片：${alt}`}
                                    onClick={() =>
                                        setPreview({
                                            url: image.previewUrl,
                                            alt,
                                        })
                                    }
                                >
                                    <img src={image.previewUrl} alt={alt} />
                                    <span
                                        className="image-preview-icon"
                                        aria-hidden="true"
                                    >
                                        <EyeIcon />
                                    </span>
                                </button>
                                <button
                                    className="image-delete-icon"
                                    type="button"
                                    disabled={unavailable}
                                    aria-label={`删除图片：${alt}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setActionError("");
                                        setPendingDelete(image);
                                    }}
                                    onKeyDown={(event) =>
                                        event.stopPropagation()
                                    }
                                >
                                    <TrashIcon />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {view.state === "empty" && (
                <p className="file-status">暂无实景图片。</p>
            )}
            {view.state === "error" && (
                <div className="image-load-error" role="alert">
                    <p>{loadError}</p>
                    <button
                        className="button"
                        type="button"
                        onClick={() => load()}
                    >
                        重试
                    </button>
                </div>
            )}
            {status && (
                <p className="file-status" role="status">
                    {status}
                </p>
            )}
            {actionError && !pendingDelete && (
                <p className="form-error" role="alert">
                    {actionError}
                </p>
            )}
            <ImageLightbox image={preview} onClose={() => setPreview(null)} />
            {/* ai coding：全屏确认层挂载到 body，避免受地点卡片 stacking context 限制而落到 Leaflet 控件下方。 */}
            {pendingDelete &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                    className="confirm-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget && !busy)
                            setPendingDelete(null);
                    }}
                >
                    <div
                        ref={deleteDialogRef}
                        className="confirm-dialog"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="delete-image-title"
                        aria-describedby="delete-image-description"
                        tabIndex="-1"
                    >
                        <h4 id="delete-image-title">删除这张实景图片？</h4>
                        <p id="delete-image-description">
                            确认后将删除私有原图及相关公开副本，此操作无法撤销。
                        </p>
                        {actionError && (
                            <p className="form-error" role="alert">
                                {actionError}
                            </p>
                        )}
                        <div>
                            <button
                                ref={cancelDeleteRef}
                                className="button"
                                type="button"
                                disabled={busy}
                                onClick={() => setPendingDelete(null)}
                            >
                                取消
                            </button>
                            <button
                                className="button danger-text"
                                type="button"
                                disabled={busy}
                                onClick={confirmDelete}
                            >
                                {busy ? "删除中…" : "确认删除"}
                            </button>
                        </div>
                    </div>
                    </div>,
                    document.body,
                )}
        </section>
    );
}
