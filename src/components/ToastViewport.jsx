import { useEffect } from "react";
import { createPortal } from "react-dom";
import { TOAST_EXIT_MS, TOAST_VISIBLE_MS, toastItemClassName } from "../services/toast.js";

function ToastItem({ toast, onDismiss, onRemove }) {
  useEffect(() => {
    if (toast.exiting) {
      const timer = setTimeout(() => onRemove(toast.id), TOAST_EXIT_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.exiting, onDismiss, onRemove]);

  return (
    <div className={toastItemClassName(toast.type, toast.exiting)} role={toast.type === "error" ? "alert" : "status"}>
      <span className="min-w-0 flex-1 leading-[1.45]">{toast.message}</span>
      <button className="-mr-1 -mt-1 rounded p-1 text-lg leading-none opacity-65 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current" type="button" onClick={() => onDismiss(toast.id)} aria-label="关闭提示">×</button>
    </div>
  );
}

export default function ToastViewport({ toasts, onDismiss, onRemove }) {
  if (!toasts.length) return null;
  // ai coding：提示挂载到 body，避开 Header 与 Leaflet stacking context；容器不截获页面操作，只有提示卡片可点击。
  return createPortal(
    <div className="pointer-events-none fixed left-1/2 top-20 z-[3000] flex w-[min(420px,calc(100%_-_32px))] -translate-x-1/2 flex-col gap-2" aria-live="polite" aria-label="操作提示">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} onRemove={onRemove} />)}
    </div>,
    document.body,
  );
}
