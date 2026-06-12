import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Download,
  Loader2,
  Package,
  Puzzle,
} from "lucide-react";
import type { OptionalComponent } from "@/lib/types";
import { useT } from "@/lib/i18n";


export function OptionalModsPicker({
  title,
  components,
  busy,
  onBack,
  onConfirm,
}: {
  title: string;
  components: OptionalComponent[];
  busy: boolean;
  onBack: () => void;
  onConfirm: (selectedIds: string[]) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(components.filter((c) => c.default).map((c) => c.id)),
  );

  const allSelected = selected.size === components.length;
  const noneSelected = selected.size === 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const setAll = (on: boolean) =>
    setSelected(on ? new Set(components.map((c) => c.id)) : new Set());

  const sorted = useMemo(
    () =>
      [...components].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
    [components],
  );

  return (
    <div className="swap-in flex min-h-0 flex-1 flex-col gap-3">
      <button
        onClick={onBack}
        disabled={busy}
        className="flex shrink-0 items-center gap-1 self-start text-xs text-ink-600 transition hover:text-brass-300 disabled:opacity-50"
      >
        <ChevronLeft size={14} /> {t("common.back")}
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-ink-800 text-brass-400">
          <Puzzle size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-mc text-sm text-gray-100">
            {t("optionalMods.title")}
          </div>
          <div className="truncate text-xs text-ink-600">
            {t("optionalMods.subtitle", { title, count: components.length })}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between text-xs">
        <span className="text-ink-600">
          {t("optionalMods.selectedCount", {
            selected: selected.size,
            total: components.length,
          })}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAll(true)}
            disabled={busy || allSelected}
            className="rounded-md px-2 py-1 text-ink-500 transition hover:bg-ink-800 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("mods.selectAll")}
          </button>
          <button
            onClick={() => setAll(false)}
            disabled={busy || noneSelected}
            className="rounded-md px-2 py-1 text-ink-500 transition hover:bg-ink-800 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("mods.none")}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {sorted.map((c) => {
          const on = selected.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              disabled={busy}
              className={`group flex items-start gap-3 rounded-lg border p-3 text-left transition disabled:opacity-60 ${
                on
                  ? "border-brass-500/50 bg-brass-500/[0.07]"
                  : "border-edge bg-ink-950/30 hover:border-brass-600/30"
              }`}
            >
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition ${
                  on
                    ? "border-brass-500 bg-brass-500 text-ink-950"
                    : "border-ink-600 text-transparent group-hover:border-brass-500/50"
                }`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <Package size={13} className="shrink-0 text-ink-600" />
                  <span className="truncate text-sm text-gray-100">
                    {c.name}
                  </span>
                  {c.side && c.side !== "both" && (
                    <span className="shrink-0 rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
                      {c.side}
                    </span>
                  )}
                </span>
                {c.description && (
                  <span className="mt-1 block text-xs leading-snug text-ink-600">
                    {c.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onConfirm(Array.from(selected))}
        disabled={busy}
        className="brass-btn flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Download size={16} />
        )}
        {noneSelected
          ? t("optionalMods.installNoExtras")
          : t("optionalMods.installWithExtras", { count: selected.size })}
      </button>
    </div>
  );
}
