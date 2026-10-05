import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

/*
 * Styled replacement for <select>, following the WAI-ARIA "select-only combobox"
 * pattern: a button with role=combobox controls a role=listbox popup; focus stays
 * on the button and the active option is exposed via aria-activedescendant.
 * It takes <option> children and calls onChange({ target: { value } }) like a
 * native select, so existing call sites don't change.
 */

interface Opt {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

export interface SelectProps {
  id: string;
  value?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

const textOf = (n: ReactNode): string =>
  typeof n === "string" || typeof n === "number"
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join("")
      : isValidElement(n)
        ? textOf((n.props as { children?: ReactNode }).children)
        : "";

function readOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const p = (child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>).props;
    const label = p.children;
    out.push({ value: String(p.value ?? textOf(label)), label, text: textOf(label), disabled: !!p.disabled });
  });
  return out;
}

const MAX_H = 264;

export function Select({ id, value, onChange, children, disabled, invalid, describedBy, className }: SelectProps) {
  const options = useMemo(() => readOptions(children), [children]);
  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === String(value ?? "")),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIdx);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = `${id}-listbox`;
  const optId = (i: number) => `${id}-opt-${i}`;

  const place = useCallback(() => {
    const b = button.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const want = Math.min(MAX_H, options.length * 44 + 8);
    const up = below < want && above > below;
    const width = Math.max(r.width, 176);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos(
      up
        ? { left, width, bottom: window.innerHeight - r.top + 4, maxH: Math.min(MAX_H, above) }
        : { left, width, top: r.bottom + 4, maxH: Math.min(MAX_H, Math.max(120, below)) },
    );
  }, [options.length]);

  const openList = (at = selectedIdx) => {
    if (disabled) return;
    setActive(at);
    place();
    setOpen(true);
  };
  const close = () => setOpen(false);
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    close();
    if (o.value !== String(value ?? "")) {
      onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } } as unknown as ChangeEvent<HTMLSelectElement>);
    }
  };

  // Keep the popup attached while scrolling/resizing; close on outside press.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, place]);

  useLayoutEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const step = (from: number, dir: 1 | -1, n = 1) => {
    let i = from;
    for (let moved = 0; moved < n; ) {
      const next = i + dir;
      if (next < 0 || next >= options.length) break;
      i = next;
      if (!options[i]!.disabled) moved++;
    }
    return i;
  };

  const typeahead = (ch: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 700 ? typed.current.text + ch : ch, at: now };
    const q = typed.current.text.toLowerCase();
    const start = open ? active : selectedIdx;
    const order = [...options.keys()].map((k) => (start + 1 + k) % options.length);
    const hit = order.find((i) => !options[i]!.disabled && options[i]!.text.toLowerCase().startsWith(q));
    if (hit !== undefined) {
      if (open) setActive(hit);
      else openList(hit);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(k)) {
        e.preventDefault();
        openList(k === "ArrowUp" ? step(selectedIdx, -1) : selectedIdx);
      } else if (k === "Home" || k === "End") {
        e.preventDefault();
        openList(k === "Home" ? step(-1, 1) : step(options.length, -1));
      } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typeahead(k);
      }
      return;
    }
    switch (k) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (e.altKey) choose(active);
        else setActive((a) => step(a, -1));
        break;
      case "PageDown":
        e.preventDefault();
        setActive((a) => step(a, 1, 10));
        break;
      case "PageUp":
        e.preventDefault();
        setActive((a) => step(a, -1, 10));
        break;
      case "Home":
        e.preventDefault();
        setActive(step(-1, 1));
        break;
      case "End":
        e.preventDefault();
        setActive(step(options.length, -1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        choose(active);
        break;
      default:
        if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(k);
    }
  };

  const current = options[selectedIdx];

  return (
    <div className={className}>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optId(active) : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (!list.current?.contains(e.relatedTarget as Node)) close();
        }}
        className="input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{current?.label ?? "—"}</span>
        <ChevronDown
          size={18}
          aria-hidden
          className={`shrink-0 text-accent-text transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && pos && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          className="animate-drop fixed z-50 overflow-auto rounded-xl border border-accent/70 bg-surface p-1 shadow-card"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
          onMouseDown={(e) => e.preventDefault() /* keep focus on the combobox */}
        >
          {options.map((o, i) => {
            const selected = i === selectedIdx;
            return (
              <li
                key={`${o.value}-${i}`}
                id={optId(i)}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => choose(i)}
                className={[
                  "flex min-h-[40px] cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-sm transition-colors duration-100",
                  o.disabled ? "cursor-not-allowed opacity-50" : "",
                  i === active ? "bg-primary-soft text-primary-strong" : "",
                  selected ? "font-semibold text-accent-text" : "",
                ].join(" ")}
              >
                <span className="truncate">{o.label}</span>
                {selected && <Check size={16} aria-hidden className="shrink-0 text-accent-text" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
