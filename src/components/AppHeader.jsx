import React, { useEffect, useRef, useState } from "react";
import { VISUAL_MODE_OPTIONS, normalizeVisualMode } from "../services/visualMode.js";

export function isOutsideAccountMenu(container, target) {
    return Boolean(container && target && !container.contains(target));
}

export function handleAccountMenuEscape(event, open, closeMenu) {
    if (!open || event.key !== "Escape") return false;
    // ai coding：账号浮层在捕获阶段消费 Escape，避免同一次按键继续取消地图编辑草稿。
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    return true;
}

export default function AppHeader({
    mapName,
    userLabel,
    isAdmin,
    accountContent,
    adminContent,
    visualMode,
    onVisualModeChange,
}) {
    const [open, setOpen] = useState(false);
    const [panel, setPanel] = useState("account");
    const menuRef = useRef(null);

    useEffect(() => {
        if (!open || typeof document === "undefined") return undefined;
        // 账号按钮与浮层共用边界，外部 pointerdown 关闭，内部登录/同步/审核操作不受影响。
        const handlePointerDown = (event) => {
            if (isOutsideAccountMenu(menuRef.current, event.target)) setOpen(false);
        };
        const handleKeyDown = (event) => {
            handleAccountMenuEscape(event, open, () => setOpen(false));
        };
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [open]);

    const togglePanel = (nextPanel) => {
        if (open && panel === nextPanel) setOpen(false);
        else {
            setPanel(nextPanel);
            setOpen(true);
        }
    };

    const selectVisualMode = (nextMode) => {
        // ai coding：先提交模式选择再立即关闭设置层；关闭状态不依赖 visualMode prop，避免父级回写时形成更新循环。
        onVisualModeChange?.(nextMode);
        setOpen(false);
    };

    return (
        <header className="site-header management-header">
            <div className="site-header-inner">
                <div className="header-brand">
                    <p className="eyebrow">SN MAP / 多地区</p>
                    <div className="flex items-center gap-4">
                        <h1>{mapName || "地区地图"}数据</h1>
                        <p className="intro">在只读的 OpenStreetMap 道路底图上，维护独立的用户地点数据。</p>
                    </div>
                </div>
                <div className="header-tools">
                    <div className="account-menu" ref={menuRef}>
                        <button
                            className="settings-menu-trigger"
                            type="button"
                            aria-label="视觉模式设置"
                            aria-haspopup="dialog"
                            aria-expanded={open && panel === "settings"}
                            aria-controls="account-menu-panel"
                            onClick={() => togglePanel("settings")}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>
                            <span>设置</span>
                        </button>
                        <button
                            className="account-menu-trigger"
                            type="button"
                            aria-label={`用户信息：${userLabel}`}
                            aria-haspopup="dialog"
                            aria-expanded={open && panel === "account"}
                            aria-controls="account-menu-panel"
                            onClick={() => togglePanel("account")}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-4.1 3-6.2 7-6.2s6.4 2.1 7 6.2" /></svg>
                            <span>{userLabel}</span>
                            {isAdmin && <b>管理员</b>}
                        </button>
                        {open && (
                            <div id="account-menu-panel" className="account-menu-panel" role="dialog" aria-label={panel === "settings" ? "视觉模式设置" : "用户信息与数据空间"}>
                                {panel === "settings" ? (
                                    <section className="visual-mode-settings" aria-labelledby="visual-mode-title">
                                        <p className="section-label">界面设置</p>
                                        <h2 id="visual-mode-title">视觉模式</h2>
                                        <p>仅改变当前设备的显示效果，不会修改地点或账号数据。</p>
                                        <div className="visual-mode-options" role="radiogroup" aria-label="选择视觉模式">
                                            {VISUAL_MODE_OPTIONS.map((option) => {
                                                const selected = normalizeVisualMode(visualMode) === option.id;
                                                return <button key={option.id} type="button" role="radio" aria-checked={selected} className={selected ? "active" : ""} onClick={() => selectVisualMode(option.id)}><strong>{option.label}</strong><span>{option.description}</span></button>;
                                            })}
                                        </div>
                                    </section>
                                ) : <>
                                    {accountContent}
                                    {isAdmin && adminContent}
                                </>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
