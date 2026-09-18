import { useEffect, useId, useRef, useState } from "react";
import TypeIcon from "./TypeIcon.jsx";

export default function TypeSelect({ id, name, value, options, placeholder, onChange, disabled = false, required = false }) {
  const generatedId = useId();
  const listId = `${id || generatedId}-listbox`;
  const rootRef = useRef(null);
  const optionRefs = useRef([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.id === value);
  const items = placeholder ? [{ id: "", name: placeholder, icon: "other", color: "#60716d" }, ...options] : options;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // ai coding：键盘移动高亮项后，保持 aria-activedescendant 指向的选项可见。
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const show = () => {
    const selectedIndex = items.findIndex((item) => item.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };
  const choose = (item) => {
    onChange(item.id);
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) return show();
      if (event.key === "Home") setActiveIndex(0);
      else if (event.key === "End") setActiveIndex(items.length - 1);
      else setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(items[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  const current = selected || items[0];

  return (
    <div className="type-select" ref={rootRef}>
      <input type="hidden" name={name} value={value} />
      <button
        id={id}
        className="type-select-trigger"
        type="button"
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <TypeIcon icon={current?.icon} color={current?.color} />
        <span>{selected?.name || placeholder}</span>
        <span className="type-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul id={listId} className="type-select-options" role="listbox" aria-label={placeholder}>
          {items.map((item, index) => (
            <li
              id={`${listId}-${index}`}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              key={item.id || "all"}
              role="option"
              aria-selected={item.id === value}
              className={index === activeIndex ? "active" : ""}
              onPointerMove={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              <TypeIcon icon={item.icon} color={item.color} />
              <span>{item.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
