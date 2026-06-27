"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, X, Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { ContentSource, FilterOptions, SearchFilters } from "@/lib/types";
import { EMPTY_FILTERS } from "@/lib/types";
import { SegmentedTabs, BrassSwitch, Dropdown, inputCls } from "./ui";

const optionsCache = new Map<string, FilterOptions>();

export function useFilters(
  load: () => Promise<FilterOptions>,
  cacheKey: string,
) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<FilterOptions | null>(
    () => optionsCache.get(cacheKey) ?? null,
  );
  const [open, setOpen] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    setFilters(EMPTY_FILTERS);
    const cached = optionsCache.get(cacheKey);
    setOptions(cached ?? null);
    if (cached) return;
    let cancelled = false;
    setLoadingOptions(true);
    load()
      .then((o) => {
        if (cancelled) return;
        optionsCache.set(cacheKey, o);
        setOptions(o);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingOptions(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return {
    filters,
    setFilters,
    options,
    open,
    setOpen,
    loadingOptions,
    activeCount: countActiveFilters(filters),
    key: filtersKey(filters),
  };
}

export function countActiveFilters(f: SearchFilters): number {
  return (
    f.categories.length +
    (f.sort ? 1 : 0) +
    f.gameVersions.length +
    f.loaders.length +
    (f.environment ? 1 : 0) +
    (f.openSource ? 1 : 0) +
    (f.license ? 1 : 0) +
    (f.updatedAfter ? 1 : 0) +
    (f.allowAnyVersion ? 1 : 0) +
    (f.allowAnyLoader ? 1 : 0)
  );
}

export function filtersKey(f: SearchFilters): string {
  return JSON.stringify(f);
}

const SORT_LABELS: Record<string, string> = {
  relevance: "sortRelevance",
  downloads: "sortDownloads",
  follows: "sortFollows",
  newest: "sortNewest",
  updated: "sortUpdated",
};

const DAY = 86400;
const DATE_RANGES: { id: string; key: string; secs: number | null }[] = [
  { id: "any", key: "anyTime", secs: null },
  { id: "week", key: "dateWeek", secs: 7 * DAY },
  { id: "month", key: "dateMonth", secs: 30 * DAY },
  { id: "quarter", key: "dateQuarter", secs: 90 * DAY },
  { id: "year", key: "dateYear", secs: 365 * DAY },
];

export function FilterSidebar({
  open,
  source,
  options,
  loading,
  filters,
  onChange,
  accentStyle,
}: {
  open: boolean;
  source: ContentSource;
  options: FilterOptions | null;
  loading?: boolean;
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  accentStyle?: React.CSSProperties;
}) {
  const t = useT();
  const [tab, setTab] = useState<"filters" | "advanced">("filters");
  const active = countActiveFilters(filters);

  const patch = (p: Partial<SearchFilters>) => onChange({ ...filters, ...p });
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const supportsEnv = options?.supportsEnvironment ?? false;
  const supportsAdvanced = options?.supportsAdvancedFacets ?? false;

  const sortOptions = useMemo(
    () =>
      (options?.sorts ?? ["relevance"]).map((s) => ({
        value: s,
        label: t(`mods.filter.${SORT_LABELS[s] ?? "sortRelevance"}`),
      })),
    [options?.sorts, t],
  );

  const dateValue =
    DATE_RANGES.find(
      (r) =>
        r.secs != null &&
        filters.updatedAfter != null &&
        Math.abs(Math.floor(Date.now() / 1000) - r.secs - filters.updatedAfter) <
          2 * DAY,
    )?.id ?? "any";

  return (
    <aside
      className={`shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? "w-64 opacity-100" : "w-0 opacity-0"
      }`}
      style={accentStyle}
      aria-hidden={!open}
    >
      <div className="flex h-full w-64 flex-col border-r border-edge">
        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
          <SegmentedTabs
            size="sm"
            value={tab}
            onChange={(v) => setTab(v as "filters" | "advanced")}
            options={[
              { id: "filters", label: t("mods.filter.tabFilters") },
              { id: "advanced", label: t("mods.filter.tabAdvanced") },
            ]}
          />
          {active > 0 && (
            <button
              onClick={() => onChange({ ...EMPTY_FILTERS })}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-600 transition hover:text-brass-300"
              title={t("mods.filter.clear")}
            >
              <X size={13} /> {t("mods.filter.clear")}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {loading && !options ? (
            <p className="px-1 py-4 text-xs text-ink-600">
              {t("mods.filter.loading")}
            </p>
          ) : tab === "filters" ? (
            <>
              <Section title={t("mods.filter.sort")}>
                <Dropdown
                  value={filters.sort ?? "relevance"}
                  onChange={(v) => patch({ sort: v === "relevance" ? null : v })}
                  options={sortOptions}
                  accentStyle={accentStyle}
                />
              </Section>

              {supportsEnv && (
                <Section title={t("mods.filter.environment")}>
                  <SegmentedTabs
                    size="sm"
                    value={filters.environment ?? "any"}
                    onChange={(v) =>
                      patch({ environment: v === "any" ? null : v })
                    }
                    options={[
                      { id: "any", label: t("mods.filter.envAny") },
                      { id: "client", label: t("mods.filter.envClient") },
                      { id: "server", label: t("mods.filter.envServer") },
                    ]}
                  />
                </Section>
              )}

              <Section title={t("mods.filter.categories")}>
                <ChipGrid
                  items={(options?.categories ?? []).map((c) => ({
                    id: c.id,
                    label: c.name,
                  }))}
                  selected={filters.categories}
                  onToggle={(id) =>
                    patch({ categories: toggleIn(filters.categories, id) })
                  }
                  emptyLabel={t("mods.filter.noCategories")}
                />
              </Section>

              {supportsAdvanced && (
                <>
                  <Section title={t("mods.filter.license")}>
                    <Dropdown
                      value={filters.license ?? ""}
                      onChange={(v) => patch({ license: v || null })}
                      placeholder={t("mods.filter.licenseAny")}
                      accentStyle={accentStyle}
                      options={[
                        { value: "", label: t("mods.filter.licenseAny") },
                        ...(options?.licenses ?? []).map((l) => ({
                          value: l.id,
                          label: l.name,
                        })),
                      ]}
                    />
                  </Section>

                  <Section title={t("mods.filter.updatedWithin")}>
                    <Dropdown
                      value={dateValue}
                      onChange={(id) => {
                        const r = DATE_RANGES.find((x) => x.id === id);
                        patch({
                          updatedAfter:
                            r && r.secs != null
                              ? Math.floor(Date.now() / 1000) - r.secs
                              : null,
                        });
                      }}
                      accentStyle={accentStyle}
                      options={DATE_RANGES.map((r) => ({
                        value: r.id,
                        label: t(`mods.filter.${r.key}`),
                      }))}
                    />
                  </Section>

                  <label className="flex cursor-pointer items-center justify-between gap-3 pt-1 text-sm text-gray-200">
                    {t("mods.filter.openSource")}
                    <BrassSwitch
                      checked={filters.openSource}
                      onChange={(v) => patch({ openSource: v })}
                    />
                  </label>
                </>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() =>
                  patch({
                    sort: "newest",
                    allowAnyVersion: true,
                    allowAnyLoader: true,
                  })
                }
                className="flex w-full items-start gap-2.5 rounded-lg border border-edge bg-ink-900/40 p-3 text-left transition hover:border-brass-500/50 hover:bg-brass-500/5"
              >
                <Sparkles size={16} className="mt-0.5 shrink-0 text-brass-300" />
                <span>
                  <span className="block text-sm font-medium text-gray-100">
                    {t("mods.filter.newestReleased")}
                  </span>
                  <span className="block text-xs text-ink-600">
                    {t("mods.filter.newestReleasedDesc")}
                  </span>
                </span>
              </button>

              <Section title={t("mods.filter.gameVersions")}>
                <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 text-sm text-gray-200">
                  <span>
                    {t("mods.filter.anyVersion")}
                    <span className="block text-xs text-ink-600">
                      {t("mods.filter.anyVersionDesc")}
                    </span>
                  </span>
                  <BrassSwitch
                    checked={filters.allowAnyVersion}
                    onChange={(v) =>
                      patch({
                        allowAnyVersion: v,
                        gameVersions: v ? [] : filters.gameVersions,
                      })
                    }
                  />
                </label>
                {!filters.allowAnyVersion && (
                  <SearchableList
                    items={options?.gameVersions ?? []}
                    selected={filters.gameVersions}
                    onToggle={(v) =>
                      patch({ gameVersions: toggleIn(filters.gameVersions, v) })
                    }
                    searchPlaceholder={t("mods.filter.searchPlaceholder")}
                    helper={
                      filters.gameVersions.length === 0
                        ? t("mods.filter.matchInstance")
                        : undefined
                    }
                  />
                )}
              </Section>

              <Section title={t("mods.filter.loaders")}>
                <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 text-sm text-gray-200">
                  <span>
                    {t("mods.filter.anyLoader")}
                    <span className="block text-xs text-ink-600">
                      {t("mods.filter.anyLoaderDesc")}
                    </span>
                  </span>
                  <BrassSwitch
                    checked={filters.allowAnyLoader}
                    onChange={(v) =>
                      patch({
                        allowAnyLoader: v,
                        loaders: v ? [] : filters.loaders,
                      })
                    }
                  />
                </label>
                {!filters.allowAnyLoader && (
                  <ChipGrid
                    items={(options?.loaders ?? []).map((l) => ({
                      id: l,
                      label: l,
                    }))}
                    selected={filters.loaders}
                    onToggle={(id) =>
                      patch({ loaders: toggleIn(filters.loaders, id) })
                    }
                    emptyLabel={t("mods.filter.matchInstance")}
                  />
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-600">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ChipGrid({
  items,
  selected,
  onToggle,
  emptyLabel,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
}) {
  if (items.length === 0)
    return <p className="text-xs text-ink-600">{emptyLabel}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = selected.includes(it.id);
        return (
          <button
            key={it.id}
            onClick={() => onToggle(it.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs capitalize transition ${
              on
                ? "border-brass-500/60 bg-brass-500/15 text-brass-200"
                : "border-edge text-ink-600 hover:border-brass-500/40 hover:text-brass-300"
            }`}
          >
            {on && <Check size={11} strokeWidth={3} />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchableList({
  items,
  selected,
  onToggle,
  searchPlaceholder,
  helper,
}: {
  items: string[];
  selected: string[];
  onToggle: (v: string) => void;
  searchPlaceholder: string;
  helper?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(
    () =>
      q.trim()
        ? items.filter((v) => v.toLowerCase().includes(q.toLowerCase()))
        : items,
    [items, q],
  );
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        className={`${inputCls} mb-1.5 py-1.5 text-xs`}
      />
      {helper && <p className="mb-1.5 text-xs text-ink-600">{helper}</p>}
      <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
        {shown.map((v) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              onClick={() => onToggle(v)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition ${
                on
                  ? "bg-brass-500/15 text-brass-200"
                  : "text-gray-200 hover:bg-ink-800"
              }`}
            >
              {v}
              {on && <Check size={12} strokeWidth={3} className="text-brass-300" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
