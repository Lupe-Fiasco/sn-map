import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function ImageLightbox({ image, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!image || typeof document === "undefined") return undefined;
    const previousFocus = document.activeElement;
    // ai coding：在捕获阶段截断弹层 Escape，避免同一次按键继续触发 App 的全局关闭逻辑。
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus?.();
    };
  }, [image, onClose]);

  if (!image || typeof document === "undefined") return null;
  // ai coding：挂载到 body 顶层，脱离地点卡片的 stacking context，确保覆盖全部 Leaflet pane 和控件。
  return createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label="实景图片预览" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button ref={closeRef} className="image-lightbox-close" type="button" onClick={onClose} aria-label="关闭图片预览">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
    <img src={image.url} alt={image.alt} />
  </div>, document.body);
}
