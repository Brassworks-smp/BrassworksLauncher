import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Search,
  Loader2,
  Download,
  ChevronLeft,
  Package,
  ExternalLink,
  Star,
  SlidersHorizontal,
} from "lucide-react";
import * as api from "@/lib/api";
import type {
  SearchHit,
  ContentVersion,
  ProjectDetail,
  FeaturedPack,
} from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { VersionList } from "@/components/VersionList";
import { ResultRow, SourceBadge, useInfiniteSearch, SEARCH_PAGE } from "@/components/Browse";
import { FilterSidebar, useFilters } from "@/components/FilterSidebar";
import { useT } from "@/lib/i18n";


export function ModpackBrowser({
  source,
  detailInstanceId,
  installing,
  onInstall,
  featured = [],
  featuredEnabled = true,
  onOpenFeatured,
  onEnableFeatured,
  onFiltersOpenChange,
}: {
  source: "modrinth" | "curseforge";
  detailInstanceId: string | null;
  installing: boolean;
  onInstall: (projectId: string, versionId: string, name: string) => void;

  featured?: FeaturedPack[];
  featuredEnabled?: boolean;

  onOpenFeatured?: (id: string) => void;

  onEnableFeatured?: () => void;
  onFiltersOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const matchFeatured = useCallback(
    (hit: SearchHit): FeaturedPack | undefined =>
      featured.find((fp) =>
        (hit.source === "modrinth" ? fp.modrinth_ids : fp.curseforge_ids).includes(
          hit.project_id,
        ),
      ),
    [featured],
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const {
    filters,
    setFilters,
    options: filterOptions,
    open: filtersOpen,
    setOpen: setFiltersOpen,
    loadingOptions,
    activeCount,
    key: filtersK,
  } = useFilters(() => api.modpackFilterOptions(source), `modpack:${source}`);

  useEffect(() => {
    onFiltersOpenChange?.(filtersOpen);
  }, [filtersOpen, onFiltersOpenChange]);

  const fetchPage = useCallback(
    (q: string, offset: number) => api.searchModpacks(source, q, offset, filters),
    [source, filters],
  );
  const { hits, loading, loadingMore, hasMore, error, handleScroll } =
    useInfiniteSearch(fetchPage, query, `${source}:${filtersK}`);

  
  
  const listScrollRef = useRef<HTMLDivElement>(null);
  const scrollByKey = useRef<Record<string, number>>({});
  const scrollKey = `${source}:${query}`;
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    handleScroll(e);
    scrollByKey.current[scrollKey] = e.currentTarget.scrollTop;
  };
  useLayoutEffect(() => {
    if (selected || loading) return;
    const el = listScrollRef.current;
    if (el) el.scrollTop = scrollByKey.current[scrollKey] ?? 0;
  }, [selected, loading, scrollKey]);

  useEffect(() => {
    if (!selected) return;
    setVersions(null);
    setDetail(null);
    setShowVersions(false);
    setDetailError(null);
    api
      .modpackVersions(source, selected.project_id)
      .then(setVersions)
      .catch((e) => setDetailError(String(e)));
    if (detailInstanceId) {
      api
        .contentDetail(detailInstanceId, selected.project_id, source)
        .then(setDetail)
        .catch(() => {});
    }
  }, [selected, source, detailInstanceId]);

  if (selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <button
          onClick={() => setSelected(null)}
          className="flex shrink-0 items-center gap-1 self-start text-xs text-ink-600 hover:text-brass-300"
        >
          <ChevronLeft size={14} /> {t("modpackBrowser.backToResults")}
        </button>
        <div className="flex items-center gap-3">
          {selected.icon_url ? (
            <img
              src={selected.icon_url}
              alt=""
              className="h-12 w-12 rounded-md object-cover"
            />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-md bg-ink-800 text-ink-600">
              <Package size={20} />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate font-mc text-sm text-gray-100">
                {selected.title}
              </div>
              <SourceBadge source={selected.source} />
            </div>
            <div className="truncate text-xs text-ink-600">
              {t("modpackBrowser.byAuthor", {
                author: selected.author,
                downloads: selected.downloads.toLocaleString(),
              })}
            </div>
          </div>
        </div>

        {detailError && (
          <div className="text-xs text-red-300">{detailError}</div>
        )}

        <div key={showVersions ? "versions" : "overview"} className="swap-in flex min-h-0 flex-1 flex-col gap-3">
        {!showVersions ? (
          <>
            {(() => {
              const fp = matchFeatured(selected);
              if (!fp || !onOpenFeatured) return null;
              return (
                <div className="shrink-0 rounded-lg border border-brass-600/40 bg-brass-500/[0.06] p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-brass-300">
                    <Star size={12} className="fill-brass-300" /> {t("play.featuredPack")}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {t("modpackBrowser.featuredDesc1")}
                    <span className="text-gray-200">{fp.name}</span>
                    {t("modpackBrowser.featuredDesc2")}
                    {!featuredEnabled && t("modpackBrowser.featuredOff")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        if (!featuredEnabled) onEnableFeatured?.();
                        onOpenFeatured(fp.id);
                      }}
                      className="flex items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400"
                    >
                      <Star size={12} />
                      {featuredEnabled
                        ? t("modpackBrowser.openFeatured")
                        : t("modpackBrowser.enableAndOpen")}
                    </button>
                  </div>
                </div>
              );
            })()}
            <div className="flex items-center gap-2">
              <button
                disabled={!versions || versions.length === 0}
                onClick={() => setShowVersions(true)}
                className="brass-btn flex flex-1 items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {versions === null ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {t("modpackBrowser.installChooseVersion")}
              </button>
              {detail?.url && (
                <button
                  onClick={() => api.openExternal(detail.url!).catch(() => {})}
                  title={t("modpackBrowser.openPage")}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <ExternalLink size={15} />
                </button>
              )}
            </div>
            {detail?.body && (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-edge bg-ink-950/30 p-4">
                <Markdown className="text-[13px]">{detail.body}</Markdown>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => setShowVersions(false)}
              className="flex shrink-0 items-center gap-1 self-start text-xs text-ink-600 hover:text-brass-300"
            >
              <ChevronLeft size={14} /> {t("modpackBrowser.backToOverview")}
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <VersionList
                instanceId={detailInstanceId ?? ""}
                projectId={selected.project_id}
                source={source}
                versions={versions ?? []}
                actionLabel={installing ? t("versionList.installing") : t("mods.install")}
                busy={installing}
                onPick={(vid) => onInstall(selected.project_id, vid, selected.title)}
              />
            </div>
          </>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md bg-ink-950/70 px-3 ring-1 ring-edge focus-within:ring-brass-500/60">
          <Search size={15} className="text-ink-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("modpackBrowser.searchPlaceholder", { source: api.sourceLabel(source) })}
            className="flex-1 bg-transparent py-2 text-sm outline-none"
          />
          {(loading || loadingMore) && (
            <Loader2 size={14} className="animate-spin text-ink-600" />
          )}
        </div>
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          title={t("mods.filter.button")}
          className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm transition ${
            filtersOpen || activeCount > 0
              ? "border-brass-500/60 bg-brass-500/10 text-brass-200"
              : "border-edge text-ink-600 hover:text-gray-200"
          }`}
        >
          <SlidersHorizontal size={15} />
          {activeCount > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brass-500 px-1 text-[10px] font-semibold text-ink-950">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <FilterSidebar
          open={filtersOpen}
          source={source}
          options={filterOptions}
          loading={loadingOptions}
          filters={filters}
          onChange={setFilters}
        />
        <div
          ref={listScrollRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto pl-px pr-1"
          onScroll={onListScroll}
        >
          {hits.map((h) => (
            <ResultRow
              key={`${h.source}:${h.project_id}`}
              hit={h}
              featured={!!matchFeatured(h)}
              showSource
              onOpen={() => setSelected(h)}
            />
          ))}
          {loadingMore && (
            <div className="grid place-items-center py-3 text-ink-600">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!loading && hits.length === 0 && (
            <div className="py-6 text-center text-xs text-ink-600">
              {query ? t("modpackBrowser.noResults") : t("modpackBrowser.loadingPopular")}
            </div>
          )}
          {!hasMore && hits.length >= SEARCH_PAGE && (
            <div className="py-3 text-center text-[11px] text-ink-600">
              {t("addContent.endOfResults")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
