export const TOAST_VISIBLE_MS = 2800;
export const TOAST_EXIT_MS = 360;

export function inferToastType(message) {
  const text = String(message ?? "");
  if (/失败|错误|无法|丢失/.test(text)) return "error";
  if (/至少|请先|不支持|不可用|稍候|取消/.test(text)) return "warning";
  if (/已|成功|完成|保存|添加|更新|删除|导出|同步/.test(text)) return "success";
  return "info";
}

export function toastItemClassName(type, exiting = false) {
  const tone = {
    success: "border-[#84b9a6] bg-[#f2faf6] text-[#164f40] cyber:border-[#5deab1] cyber:bg-[#102b2c] cyber:text-[#bfffe0]",
    error: "border-[#d99a94] bg-[#fff4f2] text-[#812e28] cyber:border-[#ff7298] cyber:bg-[#321629] cyber:text-[#ffc0cc]",
    warning: "border-[#dfbd71] bg-[#fff9e9] text-[#6d5013] cyber:border-[#ffd166] cyber:bg-[#302716] cyber:text-[#ffe7a3]",
    info: "border-[#91b4aa] bg-white text-[#19332e] cyber:border-[#68edff] cyber:bg-[#101a35] cyber:text-[#e6fbff]",
  }[type] ?? "";
  return `pointer-events-auto flex max-w-full items-start gap-3 rounded-lg border px-4 py-3 text-[.84rem] shadow-[0_8px_24px_rgba(0,0,0,.16)] transition-all duration-300 ease-out cyber:shadow-[0_0_20px_rgba(0,234,255,.2)] ${tone} ${exiting ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100"}`;
}

export function toastReducer(state, action) {
  if (action.type === "add") return [...state, action.toast].slice(-4);
  if (action.type === "dismiss") return state.map((toast) => toast.id === action.id ? { ...toast, exiting: true } : toast);
  if (action.type === "remove") return state.filter((toast) => toast.id !== action.id);
  return state;
}
