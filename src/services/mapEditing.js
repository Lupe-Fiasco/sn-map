export const EDIT_IN_2D_MESSAGE = "请切换至2D地图后再进行编辑";

export function getCreateActionPresentation(viewMode, unavailable, active) {
    const visuallyDisabled = viewMode === "3d";
    // ai coding：3D 仅使用可点击的视觉禁用态，真实 disabled 只保留给加载、保存等不可操作状态。
    return {
        className: `button ${active ? "" : "primary"}${visuallyDisabled ? " is-disabled" : ""}`.trim(),
        disabled: Boolean(unavailable),
        "aria-disabled": Boolean(unavailable) || visuallyDisabled,
        title: visuallyDisabled ? EDIT_IN_2D_MESSAGE : undefined,
    };
}

export function runCreateAction(viewMode, notify, action) {
    // ai coding：视觉禁用的 3D 新增按钮仍可由鼠标和键盘触发统一 toast，不改变 2D 原操作入口。
    if (viewMode === "3d") {
        notify(EDIT_IN_2D_MESSAGE);
        return false;
    }
    action();
    return true;
}
