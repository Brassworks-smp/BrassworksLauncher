"use client";

import { Loader2 } from "lucide-react";

/** Shared themed form/layout primitives used by the settings screens. */

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
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-600">{label}</span>
        <span className="rounded-md bg-brass-500/10 px-2 py-0.5 font-mc text-xs tabular-nums text-brass-300">
          {(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="brass-range"
      />
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
