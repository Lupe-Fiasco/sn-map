// ai coding：通用交互原语集中为 Tailwind utility 字符串，组件可组合但不再依赖全局主题选择器。
export const ui = Object.freeze({
    card: "overflow-hidden rounded-[14px] border border-[#dbe3dd] bg-white shadow-[0_8px_28px_rgba(35,66,56,0.055)] cyber:border-[#216d82] cyber:bg-[rgba(12,20,42,0.94)] cyber:text-[#e6fbff] cyber:shadow-[0_0_0_1px_rgba(189,147,255,0.08),0_10px_32px_rgba(0,234,255,0.1)]",
    // ai coding：极简模式只收敛地图面板阴影，避免通用卡片被地图视觉规则污染。
    mapCard: "minimal:border-[#dedede] minimal:shadow-none",
    button: "inline-flex min-h-9 items-center justify-center rounded-[7px] border border-[#c8d3cc] bg-white px-3 py-[7px] text-[.82rem] font-semibold text-[#19332e] hover:border-[#8ba79b] hover:bg-[#f8faf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16785f]/40 disabled:cursor-not-allowed disabled:opacity-50 cyber:border-[#356079] cyber:bg-[#111c36] cyber:text-[#e6fbff] cyber:hover:border-[#68edff] cyber:hover:bg-[#182746] cyber:focus-visible:outline-[#68edff]/70",
    // ai coding：主按钮用 important 锁定同一元素上的表面与前景，避免 Tailwind 生成顺序让基础白底覆盖主题状态。
    primaryButton: "!border-[#16785f] !bg-[#16785f] !text-white hover:!bg-[#11634e] cyber:!border-[#40dff4] cyber:!bg-[linear-gradient(135deg,#5deaff,#a98cff)] cyber:!text-[#04131d] cyber:hover:!bg-[linear-gradient(135deg,#8af2ff,#c1a8ff)]",
    dangerButton: "text-[#b0443c] cyber:text-[#ff9caf]",
    input: "w-full min-h-[38px] rounded-[7px] border border-[#cbd6cf] bg-white px-[10px] py-2 font-normal text-[#19332e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#16785f]/30 disabled:cursor-not-allowed disabled:opacity-50 cyber:border-[#315a73] cyber:bg-[#0b142b] cyber:text-[#e6fbff] cyber:[color-scheme:dark] cyber:placeholder:text-[#789aa8] cyber:focus-visible:outline-[#68edff]/70",
    label: "block text-xs font-semibold text-[#60716d] cyber:text-[#b9b4e8]",
    eyebrow: "mb-2 text-[.72rem] font-bold uppercase tracking-[.13em] text-[#16785f] cyber:text-[#68edff]",
    muted: "text-[.8rem] leading-[1.55] text-[#60716d] cyber:text-[#9fc8d3]",
    // ai coding：仅补充赛博前景色，不改变仍由既有语义 class 控制的普通/极简字号与间距。
    themeMuted: "cyber:text-[#9fc8d3]",
    themeLabel: "cyber:text-[#b9b4e8]",
    themeBody: "cyber:text-[#ccebf2]",
    error: "mt-3 border-l-[3px] border-[#b0443c] bg-[#fff2f0] px-[10px] py-[9px] text-[.8rem] text-[#812e28] cyber:border-[#b64b76] cyber:bg-[#321629] cyber:text-[#ffc0cc]",
    panelHeading: "flex min-h-[82px] items-center justify-between gap-5 border-b border-[#dbe3dd] px-5 py-[18px] cyber:border-[#68edff]/20 max-[1100px]:items-start max-[900px]:min-h-[72px] max-[900px]:px-4 max-[900px]:py-[14px]",
    sectionHeading: "flex items-center justify-between gap-3",
    infoPanel: "flex min-w-0 flex-col gap-[18px] max-[900px]:gap-3",
    actionRow: "mt-4 flex gap-2",
    viewSwitch: "inline-flex shrink-0 rounded-lg border border-[#c8d3cc] bg-[#f3f6f3] p-[3px] cyber:border-[#315a73] cyber:bg-[#0b142b]",
    viewSwitchButton: "min-h-[30px] rounded-[5px] border-0 bg-transparent px-[10px] py-[5px] text-[.76rem] font-bold text-[#60716d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#16785f]/30 disabled:cursor-not-allowed disabled:opacity-45 cyber:text-[#9fc8d3] cyber:focus-visible:outline-[#68edff]/70",
    viewSwitchActive: "!bg-[#24483f] !text-white shadow-[0_1px_4px_rgba(25,51,46,.2)] cyber:!bg-[#68edff] cyber:!text-[#07101d]",
    iconButton: "border-0 bg-transparent text-2xl text-[#60716d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#16785f]/30 cyber:text-[#9fc8d3] cyber:hover:text-[#68edff] cyber:focus-visible:text-[#68edff] cyber:focus-visible:outline-[#68edff]/70",
    formLabel: "mt-3 block text-[.77rem] font-semibold text-[#60716d] cyber:text-[#b9b4e8] [&_input]:mt-[5px] [&_select]:mt-[5px] [&_textarea]:mt-[5px]",
});
