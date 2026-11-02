"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * Button + menu single-select. The button shows the current option's label with a chevron after it.
 * Keyboard: Enter/Space/ArrowDown opens, arrows move, Enter selects, Escape or Tab closes.
 */
export default function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  /** Accessible name, e.g. "Status". */
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const menuId = useId();
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  function openMenu() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function choose(i: number) {
    setOpen(false);
    buttonRef.current?.focus();
    if (options[i].value !== value) onChange(options[i].value);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${label}: ${current?.label}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openMenu();
          }
        }}
        className={`inline-flex h-[46px] items-center whitespace-nowrap rounded-[9px] border bg-surface px-4 text-[13px] font-medium shadow-xs transition-colors hover:border-brand/40 hover:bg-navbar focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${
          open ? "border-brand/50" : "border-line"
        } ${value ? "text-brand" : "text-ink"}`}
      >
        {current?.label}
        <svg
          aria-hidden
          className={`ms-1.5 -me-0.5 size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul
          id={menuId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-20 mt-1.5 min-w-full w-max max-w-72 rounded-[9px] border border-line bg-surface p-1.5 text-[13px] font-medium text-text shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
            else if (e.key === "Home") setActive(0);
            else if (e.key === "End") setActive(options.length - 1);
            else if (e.key === "Enter" || e.key === " ") choose(active);
            else if (e.key === "Escape") {
              setOpen(false);
              buttonRef.current?.focus();
            } else if (e.key === "Tab") setOpen(false);
            else return;
            e.preventDefault();
          }}
        >
          {options.map((o, i) => {
            const selected = i === selectedIndex;
            return (
              <li
                key={o.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-4 rounded-md px-2.5 py-2 outline-none ${
                  i === active ? "bg-subtle text-ink" : ""
                } ${selected ? "text-brand" : ""}`}
              >
                {o.label}
                {selected && (
                  <svg aria-hidden className="size-4" viewBox="0 0 24 24" fill="none">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12.5 10 17.5 19 7" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
