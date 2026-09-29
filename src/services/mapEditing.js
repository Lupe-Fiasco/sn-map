import { ui } from "../uiClassNames.js";

export const EDIT_IN_2D_MESSAGE = "请切换至2D地图后再进行编辑";

export function getCreateActionPresentation(viewMode, unavailable, active) {
    const visuallyDisabled = viewMode === "3d";
    // ai coding：aria-disabled 灰态同时锁定普通/赛博 hover 的背景色与背景图，按钮仍可点击并提示切换 2D。
    return {
        className: `${ui.button} ${active ? "" : ui.primaryButton}${visuallyDisabled ? " aria-disabled:!border-[#c8d3cc] aria-disabled:!bg-[#eef1ef] aria-disabled:![background-image:none] aria-disabled:!text-[#60716d] aria-disabled:hover:!bg-[#eef1ef] aria-disabled:hover:![background-image:none] opacity-60 cyber:aria-disabled:!border-[#33455b] cyber:aria-disabled:!bg-[#172033] cyber:aria-disabled:![background-image:none] cyber:aria-disabled:!text-[#8296a5] cyber:aria-disabled:hover:!bg-[#172033] cyber:aria-disabled:hover:![background-image:none]" : ""}`.trim(),
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
