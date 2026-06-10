import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Loader2, Star } from "lucide-react";

/** Shared themed form/layout primitives used by the settings screens. */
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

export function Slider({
  label,
  value,
  onChange,
  min = 1024,
  max = 16384,
  step = 512,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const fill = `calc(${pct / 100} * (100% - 18px) + 9px)`;
  const knob = `calc(${pct / 100} * (100% - 18px))`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-600">{label}</span>
        <span className="rounded-md bg-brass-500/10 px-2 py-0.5 font-mc text-xs tabular-nums text-brass-300">
          {(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB
        </span>
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

/**
 * Segmented tab/filter control with a highlight pill that slides from the old
 * selection to the new one. The pill is an absolutely-positioned element whose
 * left/width track the active button (measured via layout effect + a resize
 * observer); the slide is suppressed on first paint so it doesn't fly in.
 */
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

/**
 * Smoothly animates its children's height open/closed using the
 * grid-template-rows 0fr⇄1fr technique (no fixed height needed). Keep the body
 * mounted across toggles so both directions animate.
 */
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
        checked ? "border-brass-600 bg-brass-500" : "border-edge bg-ink-700"
      }`}
    >
      <span
        className={`h-[16px] w-[16px] rounded-[2px] transition-transform duration-150 ${
          checked ? "translate-x-[25px] bg-white" : "translate-x-[3px] bg-ink-600"
        }`}
      />
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

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} cursor-pointer appearance-none`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-ink-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Card({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl panel p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-brass-400/80">
        {icon}
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
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

/** Star/favourite toggle shared by worlds, servers and screenshots. */
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
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title ?? (starred ? "Unstar" : "Star")}
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
