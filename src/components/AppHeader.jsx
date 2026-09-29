import React, { useEffect, useRef, useState } from "react";
import { VISUAL_MODE_OPTIONS, normalizeVisualMode } from "../services/visualMode.js";
import { ui } from "../uiClassNames.js";

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
        <header className="management-header fixed inset-x-0 top-0 z-[3000] block w-full border-b border-[rgba(187,203,194,.9)] bg-[rgba(246,247,242,.96)] shadow-[0_5px_24px_rgba(25,51,46,.08)] backdrop-blur-xl cyber:border-[rgba(0,234,255,.38)] cyber:bg-[rgba(8,13,28,.96)] cyber:shadow-[0_5px_28px_rgba(0,234,255,.13)]">
            {/* ai coding：保留用户确认的 68px、30px Header 参数；仅把原规则等价迁移为 utility。 */}
            <div className="site-header-inner flex min-h-[68px] items-center justify-between gap-6 px-[30px] py-[14px] max-[900px]:mx-auto max-[900px]:min-h-24 max-[900px]:w-[min(calc(100%_-_24px),680px)] max-[900px]:px-0 max-[900px]:py-[10px]">
                <div className="flex min-w-0 items-center gap-[22px]">
                    <p className={`${ui.eyebrow} !mb-0 shrink-0`}>SN MAP / 多地区</p>
                    <div className="flex items-center gap-4">
                        <h1 className="mb-[3px] text-[1.55rem] font-bold tracking-[-.035em] cyber:text-[#d9fbff]">{mapName || "地区地图"}数据</h1>
                        <p className="m-0 max-w-[680px] text-[.78rem] leading-[1.45] text-[#60716d] cyber:text-[#9fc8d3]">在只读的 OpenStreetMap 道路底图上，维护独立的用户地点数据。</p>
                    </div>
                </div>
                <div className="flex items-end justify-end gap-3 max-[1100px]:items-center">
                    <div className="relative flex items-stretch gap-2" ref={menuRef}>
                        <button
                            className="inline-flex min-h-12 items-center gap-[7px] rounded-[10px] border border-[#c8d3cc] bg-white px-[11px] py-2 text-[.76rem] font-bold text-[#31564c] hover:border-[#70a18f] hover:bg-[#f2f8f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#16785f]/30 aria-expanded:border-[#70a18f] aria-expanded:bg-[#f2f8f5] cyber:border-[#245b73] cyber:bg-[#111a31] cyber:text-[#d9fbff] cyber:hover:border-[#68edff] cyber:hover:bg-[#16203d] cyber:aria-expanded:border-[#68edff] cyber:aria-expanded:bg-[#16203d] cyber:focus-visible:outline-[#68edff]/70 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.6]"
                            type="button"
                            aria-label="切换主题"
                            title="切换主题"
                            aria-haspopup="dialog"
                            aria-expanded={open && panel === "settings"}
                            aria-controls="account-menu-panel"
                            onClick={() => togglePanel("settings")}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>
                            <span>切换主题</span>
                        </button>
                        <button
                            className="grid min-h-12 min-w-[142px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-[#c8d3cc] bg-white px-[10px] py-[7px] text-left text-[#19332e] hover:border-[#70a18f] hover:bg-[#f2f8f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#16785f]/30 aria-expanded:border-[#70a18f] aria-expanded:bg-[#f2f8f5] cyber:border-[#245b73] cyber:bg-[#111a31] cyber:text-[#d9fbff] cyber:hover:border-[#68edff] cyber:hover:bg-[#16203d] cyber:aria-expanded:border-[#68edff] cyber:aria-expanded:bg-[#16203d] cyber:focus-visible:outline-[#68edff]/70 [&_svg]:h-7 [&_svg]:w-7 [&_svg]:rounded-full [&_svg]:bg-[#e4f1eb] [&_svg]:p-1 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.7] cyber:[&_svg]:bg-[rgba(27,87,111,.42)] cyber:[&_svg]:text-[#68edff]"
                            type="button"
                            aria-label={`用户信息：${userLabel}`}
                            aria-haspopup="dialog"
                            aria-expanded={open && panel === "account"}
                            aria-controls="account-menu-panel"
                            onClick={() => togglePanel("account")}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-4.1 3-6.2 7-6.2s6.4 2.1 7 6.2" /></svg>
                            <span className="max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap text-[.75rem] font-bold">{userLabel}</span>
                            {isAdmin && <b className="rounded-full bg-[#dff1e8] px-[5px] py-0.5 text-[.6rem] text-[#0e5f4b] cyber:bg-[rgba(19,109,130,.36)] cyber:text-[#8df5ff]">管理员</b>}
                        </button>
                        {open && (
                            <div id="account-menu-panel" className="absolute right-0 top-[calc(100%+10px)] max-h-[calc(100vh-132px)] w-[min(560px,calc(100vw-48px))] overflow-y-auto rounded-[14px] border border-[#cbd8d0] bg-[#f6f8f6] p-[10px] shadow-[0_18px_55px_rgba(17,47,39,.22)] cyber:border-[#216d82] cyber:bg-[rgba(7,12,27,.98)] cyber:text-[#e6fbff] cyber:shadow-[0_18px_60px_rgba(0,0,0,.55),0_0_24px_rgba(0,234,255,.14)]" role="dialog" aria-label={panel === "settings" ? "切换主题" : "用户信息与数据空间"}>
                                {panel === "settings" ? (
                                    <section className="p-3" aria-labelledby="visual-mode-title">
                                        <p className={ui.eyebrow}>界面主题</p>
                                        <h2 id="visual-mode-title" className="mb-1.5 text-[1.05rem] font-bold">切换主题</h2>
                                        <p className={`${ui.muted} mb-[14px]`}>仅改变当前设备的显示效果，不会修改地点或账号数据。</p>
                                        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="选择视觉模式">
                                            {VISUAL_MODE_OPTIONS.map((option) => {
                                                const selected = normalizeVisualMode(visualMode) === option.id;
                                                return <button key={option.id} type="button" role="radio" aria-checked={selected} className="grid min-h-[90px] gap-[5px] rounded-[9px] border border-[#ced9d2] bg-white p-3 text-left text-[#31564c] hover:border-[#16785f] hover:bg-[#edf7f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#16785f]/40 aria-checked:border-[#16785f] aria-checked:bg-[#edf7f2] aria-checked:shadow-[inset_0_0_0_1px_#16785f] cyber:border-[#2a526d] cyber:bg-[#10182f] cyber:text-[#e6fbff] cyber:hover:border-[#68edff] cyber:hover:bg-[#162748] cyber:aria-checked:border-[#68edff] cyber:aria-checked:bg-[#162748] cyber:aria-checked:shadow-[inset_0_0_0_1px_rgba(189,147,255,.55),0_0_14px_rgba(0,234,255,.13)]" onClick={() => selectVisualMode(option.id)}><strong>{option.label}</strong><span className="text-[.7rem] leading-[1.4] text-[#60716d] cyber:text-[#9fc8d3]">{option.description}</span></button>;
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
