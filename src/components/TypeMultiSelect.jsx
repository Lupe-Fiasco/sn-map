import { useEffect, useId, useRef, useState } from "react";
import TypeIcon from "./TypeIcon.jsx";
import { toggleTypeSelection } from "../services/placeFiltering.js";

export default function TypeMultiSelect({ id, value = [], options, onChange }) {
  const generatedId = useId();
  const menuId = `${id || generatedId}-menu`;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const selectedOptions = options.filter((option) => selected.has(option.id));
  const label = !selectedOptions.length ? "全部类型" : selectedOptions.length <= 2 ? selectedOptions.map(({ name }) => name).join("、") : `已选 ${selectedOptions.length} 类`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape, true);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape, true); };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0" onClick={(event) => event.stopPropagation()}>
      <button ref={triggerRef} id={id} className="flex min-h-[38px] w-full items-center gap-2 rounded-[7px] border border-[#cbd6cf] bg-white px-[10px] py-2 text-left text-[.82rem] font-semibold text-[#19332e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#16785f]/30 cyber:border-[#315a73] cyber:bg-[#0b142b] cyber:text-[#e6fbff] cyber:focus-visible:outline-[#68edff]/70" type="button" aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selectedOptions.length > 0 && <span className="rounded-full bg-[#e5f1ec] px-1.5 py-0.5 text-[.68rem] text-[#16785f] cyber:bg-[#17354a] cyber:text-[#68edff]">{selectedOptions.length}</span>}
        <span className={`h-2 w-2 shrink-0 rotate-45 border-b-2 border-r-2 border-current transition-transform ${open ? "-rotate-[135deg] translate-y-0.5" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="按地点类型筛选" className="absolute right-0 z-[1200] mt-1.5 w-[min(280px,80vw)] rounded-lg border border-[#cbd6cf] bg-white p-2 shadow-[0_10px_28px_rgba(23,51,43,.18)] cyber:border-[#315a73] cyber:bg-[#101a35] cyber:text-[#e6fbff]">
          <div className="mb-1 flex items-center justify-between border-b border-[#dbe3dd] px-1 pb-2 cyber:border-[#68edff]/20">
            <span className="text-xs text-[#60716d] cyber:text-[#9fc8d3]">{selected.size ? `已选 ${selected.size} 类` : "未选择时显示全部"}</span>
            <span className="flex gap-1">
              <button className="rounded px-2 py-1 text-xs font-semibold text-[#16785f] hover:bg-[#edf7f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#16785f] cyber:text-[#68edff] cyber:hover:bg-[#17354a]" type="button" onClick={() => onChange(options.map(({ id: optionId }) => optionId))}>全选</button>
              <button className="rounded px-2 py-1 text-xs font-semibold text-[#60716d] hover:bg-[#f1f4f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#16785f] cyber:text-[#b9b4e8] cyber:hover:bg-[#211d43]" type="button" onClick={() => onChange([])}>清空</button>
            </span>
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {options.map((option) => (
              <label key={option.id} role="menuitemcheckbox" aria-checked={selected.has(option.id)} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[.8rem] hover:bg-[#edf7f2] focus-within:bg-[#edf7f2] cyber:hover:bg-[#17354a] cyber:focus-within:bg-[#17354a]">
                <input className="h-4 w-4 accent-[#16785f] cyber:accent-[#68edff]" type="checkbox" checked={selected.has(option.id)} onChange={() => onChange(toggleTypeSelection(value, option.id))} />
                <TypeIcon icon={option.icon} color={option.color} />
                <span>{option.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
