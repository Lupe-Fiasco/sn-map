import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { VISUAL_MODE_OPTIONS, normalizeVisualMode } from "../services/visualMode.js";
import { ui } from "../uiClassNames.js";

export function isOutsidePublicThemeMenu(container, target) {
    return Boolean(container && target && !container.contains(target));
}

export default function PublicThemeMenu({ visualMode, onVisualModeChange }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    const triggerRef = useRef(null);
    const optionRefs = useRef(new Map());
    const restoreFocusRef = useRef(false);

    const closeMenu = useCallback(() => {
        restoreFocusRef.current = true;
        setOpen(false);
    }, []);

    useLayoutEffect(() => {
        // ai coding：打开菜单时聚焦当前主题；所有关闭路径统一把真实 DOM 焦点恢复到触发按钮。
        if (open) {
            optionRefs.current.get(normalizeVisualMode(visualMode))?.focus();
        } else if (restoreFocusRef.current) {
            restoreFocusRef.current = false;
            triggerRef.current?.focus();
        }
    }, [open, visualMode]);

    useEffect(() => {
        if (!open || typeof document === "undefined") return undefined;
        const closeOnOutsideClick = (event) => {
            if (isOutsidePublicThemeMenu(menuRef.current, event.target)) closeMenu();
        };
        const closeOnEscape = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeMenu();
        };
        document.addEventListener("pointerdown", closeOnOutsideClick);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnOutsideClick);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [closeMenu, open]);

    const selectMode = (mode) => {
        // ai coding：公开页主题选择只提交视觉偏好并立即收起菜单，不挂载任何账号或管理能力。
        onVisualModeChange(mode);
        closeMenu();
    };

    return (
        <div className="relative" ref={menuRef} onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
                event.preventDefault();
                closeMenu();
            }
        }}>
            <button
                ref={triggerRef}
                type="button"
                className={`${ui.button} gap-2`}
                aria-label="切换主题"
                title="切换主题"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls="public-theme-menu"
                onClick={() => setOpen((current) => !current)}
            >
                <span aria-hidden="true">◐</span> 切换主题
            </button>
            {open && (
                <div id="public-theme-menu" className="absolute right-0 top-[calc(100%+8px)] z-[1100] grid w-[260px] gap-1 rounded-[11px] border border-[#cbd8d0] bg-white p-2 shadow-[0_14px_38px_rgba(17,47,39,.2)] cyber:border-[#216d82] cyber:bg-[#0b142b] cyber:shadow-[0_14px_42px_rgba(0,0,0,.55),0_0_18px_rgba(0,234,255,.12)] minimal:shadow-[0_10px_28px_rgba(0,0,0,.1)]" role="menu" aria-label="公开地图主题">
                    {VISUAL_MODE_OPTIONS.map((option) => {
                        const selected = normalizeVisualMode(visualMode) === option.id;
                        return (
                            <button
                                key={option.id}
                                ref={(node) => {
                                    if (node) optionRefs.current.set(option.id, node);
                                    else optionRefs.current.delete(option.id);
                                }}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                className="grid gap-0.5 rounded-[7px] border-0 bg-transparent px-3 py-2 text-left text-[#31564c] hover:bg-[#edf7f2] focus-visible:bg-[#edf7f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#16785f]/40 aria-checked:bg-[#e4f1eb] cyber:text-[#e6fbff] cyber:hover:bg-[#162748] cyber:focus-visible:bg-[#162748] cyber:focus-visible:outline-[#68edff]/70 cyber:aria-checked:bg-[#163a50]"
                                onClick={() => selectMode(option.id)}
                            >
                                <strong className="text-[.8rem]">{option.label}</strong>
                                <span className={`${ui.muted} text-[.7rem]`}>{option.description}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
