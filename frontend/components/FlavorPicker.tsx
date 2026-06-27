import { useMemo, useState } from "react";
import { Download, Loader2, SlidersHorizontal } from "lucide-react";
import { BackButton } from "./ui";
import type { FlavorGroup } from "@/lib/types";
import { isBooleanFlavor } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { useT } from "@/lib/i18n";


function initialSelection(
  groups: FlavorGroup[],
  preset: string[] | undefined,
): Record<string, string> {
  const presetSet = new Set(preset ?? []);
  const out: Record<string, string> = {};
  for (const g of groups) {
    const fromPreset = g.choices.find((c) => presetSet.has(c.id));
    const fromDefault = g.choices.find((c) => c.default);
    out[g.id] = (fromPreset ?? fromDefault ?? g.choices[0])?.id ?? "";
  }
  return out;
}


export function FlavorPicker({
  title,
  groups,
  preset,
  busy,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  title: string;
  groups: FlavorGroup[];
  preset?: string[];
  busy: boolean;
  confirmLabel?: string;
  onBack: () => void;
  onConfirm: (selectedIds: string[]) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    initialSelection(groups, preset),
  );

  const pick = (groupId: string, choiceId: string) =>
    setSelected((prev) => ({ ...prev, [groupId]: choiceId }));

  const sorted = useMemo(
    () => [...groups].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    [groups],
  );

  return (
    <div className="swap-in flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <BackButton onClick={onBack} disabled={busy} title={t("common.back")} />
        <span className="grid h-9 w-9 place-items-center rounded-md bg-ink-800 text-brass-400">
          <SlidersHorizontal size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-mc text-sm text-gray-100">{t("quickSettings.flavors")}</div>
          <div className="truncate text-xs text-ink-600">
            {t("flavorPicker.subtitle", { title, count: groups.length })}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {sorted.map((g) =>
          isBooleanFlavor(g) ? (
            <BooleanGroup
              key={g.id}
              group={g}
              on={selected[g.id] === `${g.id}_on`}
              busy={busy}
              onToggle={(on) => pick(g.id, on ? `${g.id}_on` : `${g.id}_off`)}
            />
          ) : (
            <RadioGroup
              key={g.id}
              group={g}
              selected={selected[g.id]}
              busy={busy}
              onPick={(cid) => pick(g.id, cid)}
            />
          ),
        )}
      </div>

      <button
        onClick={() => onConfirm(Object.values(selected).filter(Boolean))}
        disabled={busy}
        className="brass-btn flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {confirmLabel ?? t("mods.install")}
      </button>
    </div>
  );
}

function GroupHeader({ group }: { group: FlavorGroup }) {
  return (
    <div className="flex items-center gap-2">
      <span className="truncate text-sm font-semibold text-gray-100">{group.name}</span>
      {group.side && group.side !== "both" && (
        <span className="shrink-0 rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
          {group.side}
        </span>
      )}
    </div>
  );
}

function BooleanGroup({
  group,
  on,
  busy,
  onToggle,
}: {
  group: FlavorGroup;
  on: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={on}
      tabIndex={busy ? -1 : 0}
      onClick={() => !busy && onToggle(!on)}
      onKeyDown={(e) => {
        if (!busy && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onToggle(!on);
        }
      }}
      className={`group flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition ${
        busy ? "opacity-60" : ""
      } ${
        on ? "border-brass-500/50 bg-brass-500/[0.07]" : "border-edge bg-ink-950/30 hover:border-brass-600/30"
      }`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition ${
          on
            ? "border-brass-500 bg-brass-500 text-ink-950"
            : "border-ink-600 text-transparent group-hover:border-brass-500/50"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <GroupHeader group={group} />
        {group.description && (
          <div
            className="mt-1 text-xs leading-snug text-ink-600"
            onClick={(e) => e.stopPropagation()}
          >
            <Markdown className="text-xs">{group.description}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function RadioGroup({
  group,
  selected,
  busy,
  onPick,
}: {
  group: FlavorGroup;
  selected: string;
  busy: boolean;
  onPick: (choiceId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-edge bg-ink-950/30 p-3">
      <GroupHeader group={group} />
      {group.description && (
        <div className="mt-1 text-xs leading-snug text-ink-600">
          <Markdown className="text-xs">{group.description}</Markdown>
        </div>
      )}
      <div className="mt-2 flex flex-col gap-1.5">
        {group.choices.map((c) => {
          const on = selected === c.id;
          return (
            <div
              key={c.id}
              role="radio"
              aria-checked={on}
              tabIndex={busy ? -1 : 0}
              onClick={() => !busy && onPick(c.id)}
              onKeyDown={(e) => {
                if (!busy && (e.key === " " || e.key === "Enter")) {
                  e.preventDefault();
                  onPick(c.id);
                }
              }}
              className={`group flex cursor-pointer items-start gap-2.5 rounded-md border p-2 text-left transition ${
                busy ? "opacity-60" : ""
              } ${
                on ? "border-brass-500/50 bg-brass-500/[0.07]" : "border-edge/60 hover:border-brass-600/30"
              }`}
            >
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition ${
                  on ? "border-brass-500" : "border-ink-600 group-hover:border-brass-500/50"
                }`}
              >
                {on && <span className="h-2 w-2 rounded-full bg-brass-500" />}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-gray-100">{c.name}</span>
                {c.description && (
                  <div
                    className="mt-0.5 text-[11px] leading-snug text-ink-600"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Markdown className="text-[11px]">{c.description}</Markdown>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
