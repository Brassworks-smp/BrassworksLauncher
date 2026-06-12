import {
  Children,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  Star,
  ChevronUp,
  ChevronDown,
  Check,
  RotateCcw,
} from "lucide-react";
import { useT } from "@/lib/i18n";

export function useClosable(onClose: () => void, duration = 190) {
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setClosing(true);
    setTimeout(onClose, duration);
  }, [onClose, duration]);
  return { closing, close };
}

export const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";


export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  className = "",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const clamp = (n: number) => {
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    return n;
  };
  const commit = (raw: string) => {
    if (raw.trim() === "") return onChange(null);
    const n = Math.round(Number(raw));
    if (Number.isFinite(n)) onChange(clamp(n));
    else setDraft(value == null ? "" : String(value));
  };
  const bump = (dir: 1 | -1) => {
    const base = Number(draft);
    const start = Number.isFinite(base) && draft.trim() !== "" ? base : value ?? min ?? 0;
    onChange(clamp(start + dir * step));
  };
  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder={placeholder}
        className={`${inputCls} no-spin pr-6`}
      />
      <div className="absolute right-1 flex flex-col">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("ui.increase")}
          onClick={() => bump(1)}
          className="-my-px text-ink-600 transition hover:text-brass-300"
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("ui.decrease")}
          onClick={() => bump(-1)}
          className="-my-px text-ink-600 transition hover:text-brass-300"
        >
          <ChevronDown size={11} />
        </button>
      </div>
    </div>
  );
}


export function placeMenu(
  anchor: DOMRect,
  desiredHeight = 256,
  margin = 8,
): { top?: number; bottom?: number; maxHeight: number } {
  const below = window.innerHeight - anchor.bottom - margin;
  const above = anchor.top - margin;
  if (below < desiredHeight && above > below) {
    return {
      bottom: window.innerHeight - anchor.top + 4,
      maxHeight: Math.max(96, Math.min(desiredHeight, above)),
    };
  }
  return {
    top: anchor.bottom + 4,
    maxHeight: Math.max(96, Math.min(desiredHeight, below)),
  };
}


export function useMenuDismiss(
  open: boolean,
  close: () => void,
  
  ignoreRef?: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = (e: Event) => {
      if (ignoreRef?.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, ignoreRef]);
}


export function CardColumns({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const items = Children.toArray(children).filter(Boolean);
  const left = items.filter((_, i) => i % 2 === 0);
  const right = items.filter((_, i) => i % 2 === 1);
  return (
    <div className={`grid grid-cols-2 items-start gap-4 ${className}`}>
      <div className="flex flex-col gap-4">{left}</div>
      <div className="flex flex-col gap-4">{right}</div>
    </div>
  );
}

const clampNum = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

function MemSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 512,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  const t = useT();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n > 0) onChange(clampNum(n, min, max));
    else setDraft(String(value));
  };
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const fill = `calc(${pct / 100} * (100% - 18px) + 9px)`;
  const knob = `calc(${pct / 100} * (100% - 18px))`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-ink-600">{label}</span>
        <div className="flex items-center gap-1.5">
          <div className="relative flex items-center">
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="no-spin w-24 rounded-md bg-ink-950/70 py-1 pl-2.5 pr-6 text-left font-mc text-xs tabular-nums text-brass-300 outline-none ring-1 ring-edge transition focus:ring-brass-500/60"
            />
            <div className="absolute right-1 flex flex-col">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("ui.increase")}
                onClick={() => onChange(clampNum(value + step, min, max))}
                className="-my-px text-ink-600 transition hover:text-brass-300"
              >
                <ChevronUp size={11} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("ui.decrease")}
                onClick={() => onChange(clampNum(value - step, min, max))}
                className="-my-px text-ink-600 transition hover:text-brass-300"
              >
                <ChevronDown size={11} />
              </button>
            </div>
          </div>
          <span className="font-mc text-[11px] text-ink-600">
            MB · {(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB
          </span>
        </div>
      </div>
      <div className="group relative flex h-[18px] items-center">
        <div className="absolute inset-x-0 h-2 overflow-hidden rounded-full border border-edge bg-ink-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brass-600 to-brass-400 transition-[width] duration-150 ease-out"
            style={{ width: fill }}
          />
        </div>
        <span
          className="pointer-events-none absolute h-[18px] w-[18px] rounded-[4px] border border-brass-700 bg-gradient-to-b from-brass-400 to-brass-600 shadow-[0_2px_0_var(--color-brass-700)] transition-[left] duration-150 ease-out group-active:translate-y-px"
          style={{ left: knob }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

export function MemorySettings({
  max,
  min,
  onChange,
  note,
}: {
  max: number;
  min: number;
  onChange: (max: number, min: number) => void;
  note?: React.ReactNode;
}) {
  const t = useT();
  const HARD_CAP = 65536;
  const SOFT_CAP = 16384;
  const [allowHigh, setAllowHigh] = useState(max > SOFT_CAP || min > SOFT_CAP);
  const high = allowHigh || max > SOFT_CAP || min > SOFT_CAP;
  const cap = high ? HARD_CAP : SOFT_CAP;
  return (
    <>
      <Toggle
        label={t("ui.allowHighMem")}
        description={t("ui.allowHighMemDesc")}
        checked={high}
        onChange={(on) => {
          setAllowHigh(on);
          if (!on)
            onChange(Math.min(max, SOFT_CAP), Math.min(min, SOFT_CAP));
        }}
      />
      <MemSlider
        label={t("ui.maxMemory")}
        value={max}
        min={1024}
        max={cap}
        onChange={(v) => onChange(v, Math.min(min, v))}
      />
      <MemSlider
        label={t("ui.minMemory")}
        value={min}
        min={512}
        max={Math.min(max, cap)}
        onChange={(v) => onChange(max, Math.min(v, max))}
      />
      {note}
    </>
  );
}


export function SegmentedTabs({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: React.ReactNode; icon?: React.ReactNode }[];
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  const measure = () => {
    const c = ref.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>('[data-seg-active="true"]');
    if (!el) return;
    const left = el.offsetLeft;
    const width = el.offsetWidth;
    setInd((p) => (p && p.left === left && p.width === width ? p : { left, width }));
  };

  useLayoutEffect(measure, [value]);

  useEffect(() => {
    if (!ind || animate) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [ind, animate]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !ref.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item =
    size === "sm" ? "gap-1 px-2.5 py-1 text-xs" : "gap-1.5 px-3 py-1.5 text-sm";

  return (
    <div
      ref={ref}
      className={`relative inline-flex gap-1 rounded-lg border border-edge bg-ink-900/50 p-1 ${
        className ?? ""
      }`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-1 top-1 rounded-md bg-brass-500/15 ${
          animate
            ? "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            : ""
        }`}
        style={{
          left: ind?.left ?? 0,
          width: ind?.width ?? 0,
          opacity: ind ? 1 : 0,
        }}
      />
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            data-seg-active={active}
            onClick={() => onChange(o.id)}
            className={`relative z-10 flex items-center whitespace-nowrap rounded-md font-medium transition-colors ${item} ${
              active ? "text-brass-300" : "text-ink-600 hover:text-brass-300/80"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      } ${className ?? ""}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span>
        <span className="block text-gray-200">{label}</span>
        {description && (
          <span className="block text-xs text-ink-600">{description}</span>
        )}
      </span>
      <BrassSwitch checked={checked} onChange={onChange} />
    </label>
  );
}

export function BrassSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-[4px] border transition-colors ${
        checked
          ? "border-brass-600/70 bg-gradient-to-b from-brass-400 to-brass-500"
          : "border-edge bg-ink-700"
      }`}
    >
      <span
        className={`flex h-[16px] w-[16px] items-center justify-center transition-transform duration-150 ${
          checked ? "translate-x-[25px]" : "translate-x-[3px]"
        }`}
      >
        <span
          className={`h-[14px] w-[4px] rounded-full transition-colors ${
            checked ? "bg-white shadow-[0_0_2px_rgba(0,0,0,0.25)]" : "bg-ink-600"
          }`}
        />
      </span>
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-sm text-ink-600">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-ink-600">{hint}</div>}
    </div>
  );
}


export function Select(props: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return <Dropdown {...props} />;
}


export function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  accentStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  
  accentStyle?: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, menuRef);

  const toggle = () => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`${inputCls} flex cursor-pointer items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected ? "" : "text-ink-600"}`}>
          {selected ? selected.label : placeholder ?? t("ui.select")}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-ink-600 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[80]"
              onClick={() => setOpen(false)}
            />
            <div
              ref={menuRef}
              className="fixed z-[81] overflow-y-auto rounded-lg border border-edge bg-ink-900 p-1 shadow-2xl"
              style={{
                ...(() => {
                  const p = placeMenu(rect);
                  return p.top != null
                    ? { top: p.top, maxHeight: p.maxHeight }
                    : { bottom: p.bottom, maxHeight: p.maxHeight };
                })(),
                left: rect.left,
                width: rect.width,
                ...accentStyle,
              }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
                    o.value === value
                      ? "bg-brass-500/15 text-brass-200"
                      : "text-gray-200 hover:bg-ink-800"
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow ring-1 ring-ink-950/30">
                      <Check size={11} strokeWidth={3.5} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

export function Card({
  title,
  children,
  icon,
  onReset,
  resetTitle,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  
  onReset?: () => void;
  resetTitle?: string;
}) {
  const t = useT();
  const resetLabel = resetTitle ?? t("ui.resetSection");
  return (
    <section className="rounded-xl border border-edge bg-ink-900/50 p-4">
      <h2 className="mb-3 flex items-center gap-1.5 font-mc text-xs tracking-wide text-brass-300">
        {icon}
        {title}
        {onReset && (
          <button
            onClick={onReset}
            title={resetLabel}
            aria-label={resetLabel}
            className="ml-auto rounded-md p-1 text-ink-600 transition hover:bg-brass-500/10 hover:text-brass-300"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-600">{label}</span>
      <span className="font-mc text-xs text-gray-200">{value}</span>
    </div>
  );
}

export function ActionButton({
  children,
  icon,
  onClick,
  onClickAsync,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  onClickAsync?: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (onClickAsync) void onClickAsync();
        else onClick?.();
      }}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "border-red-500/30 text-red-300 hover:border-red-500/60 hover:bg-red-500/10"
          : "border-edge text-gray-200 hover:border-brass-600/40 hover:bg-brass-500/5 hover:text-brass-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-md border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
    >
      {icon}
      {children}
    </button>
  );
}

export function Spinner() {
  return <Loader2 size={15} className="animate-spin" />;
}


export function useProgressive<T>(
  items: T[],
  batch = 48,
  resetKey: string = "",
): { shown: T[]; hasMore: boolean } {
  const [limit, setLimit] = useState(batch);
  useEffect(() => {
    setLimit(batch);
  }, [resetKey, batch]);
  useEffect(() => {
    if (limit >= items.length) return;
    const raf = requestAnimationFrame(() => setLimit((n) => n + batch));
    return () => cancelAnimationFrame(raf);
  }, [limit, items.length, batch]);
  const shown = useMemo(() => items.slice(0, limit), [items, limit]);
  return { shown, hasMore: limit < items.length };
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className ?? ""}`} />;
}


export function useDeferredReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return ready;
}

export function StarButton({
  starred,
  onClick,
  size = 14,
  title,
  className,
}: {
  starred: boolean;
  onClick: () => void;
  size?: number;
  title?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title ?? (starred ? t("ui.unstar") : t("ui.star"))}
      className={`pressable grid place-items-center rounded-md transition ${
        starred
          ? "text-brass-300 hover:text-brass-200"
          : "text-ink-600 hover:text-brass-300"
      } ${className ?? ""}`}
    >
      <Star size={size} className={starred ? "fill-current" : ""} />
    </button>
  );
}
