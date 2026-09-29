import React, { useLayoutEffect, useRef, useState } from "react";
import { ui } from "../uiClassNames.js";

export default function ManagementWorkspace({ workspaceRef, children, sidebar }) {
    const [panelState, setPanelState] = useState("expanded");
    const collapseButtonRef = useRef(null);
    const expandButtonRef = useRef(null);
    const collapsed = panelState === "collapsing" || panelState === "collapsed";
    const sidebarInactive = panelState === "collapsed";

    useLayoutEffect(() => {
        // ai coding：用两阶段切换先把焦点移出即将 inert 的侧栏，再完成收起；展开时先解除 inert 并把焦点送回入口。
        if (panelState === "collapsing") {
            expandButtonRef.current?.focus();
            setPanelState("collapsed");
        } else if (panelState === "expanding") {
            collapseButtonRef.current?.focus();
            setPanelState("expanded");
        }
    }, [panelState]);

    return (
        <main
            ref={workspaceRef}
            className={`management-workspace relative transition-[grid-template-columns,gap] duration-300 ease-out motion-reduce:transition-none ${collapsed ? "!grid-cols-[minmax(0,1fr)_0px] !gap-0" : "!grid-cols-[minmax(0,1fr)_380px]"}`}
            data-sidebar-collapsed={collapsed ? "true" : "false"}
        >
            {children}
            <aside
                className={`${ui.infoPanel} overflow-hidden transition-[opacity,visibility] duration-200 motion-reduce:transition-none ${sidebarInactive ? "invisible opacity-0" : "visible opacity-100"}`}
                aria-label="地点维护面板"
                aria-hidden={sidebarInactive}
                inert={sidebarInactive ? "" : undefined}
            >
                <button
                    ref={collapseButtonRef}
                    type="button"
                    className={`${ui.button} w-full gap-2`}
                    aria-label="收起右侧面板"
                    title="收起右侧面板"
                    onClick={() => setPanelState("collapsing")}
                >
                    <span aria-hidden="true">→</span> 收起右侧面板
                </button>
                {sidebar}
            </aside>
            {panelState !== "expanded" && (
                // ai coding：侧栏收起后保留固定在视口右缘的键盘入口；网格宽度动画会触发现有 Leaflet/Canvas 尺寸观察器。
                <button
                    ref={expandButtonRef}
                    type="button"
                    className={`${ui.button} fixed right-0 top-1/2 z-[1200] -translate-y-1/2 rounded-r-none border-r-0 px-2.5 py-4 shadow-[0_5px_20px_rgba(25,51,46,.18)] [writing-mode:vertical-rl]`}
                    aria-label="展开右侧面板"
                    title="展开右侧面板"
                    onClick={() => setPanelState("expanding")}
                >
                    展开右侧面板
                </button>
            )}
        </main>
    );
}
