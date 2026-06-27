import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Download,
  ExternalLink,
  Star,
  ListChecks,
  ChevronLeft,
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
import {
  ResultRow,
  SourceBadge,
  BrowseResults,
  DetailShell,
} from "@/components/Browse";
import { useFilters } from "@/components/FilterSidebar";
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
  onDetailOpenChange,
  onUpload,
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
  onDetailOpenChange?: (open: boolean) => void;
  onUpload?: () => void;
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

  const filtering = useFilters(
    () => api.modpackFilterOptions(source),
    `modpack:${source}`,
  );

  useEffect(() => {
    onFiltersOpenChange?.(filtering.open);
  }, [filtering.open, onFiltersOpenChange]);

  useEffect(() => {
    onDetailOpenChange?.(!!selected);
  }, [selected, onDetailOpenChange]);

  const fetchPage = useCallback(
    (q: string, offset: number) =>
      api.searchModpacks(source, q, offset, filtering.filters),
    [source, filtering.filters],
  );

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

  const latest = versions?.[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BrowseResults
        hidden={!!selected}
        padded={false}
        source={source}
        query={query}
        onQueryChange={setQuery}
        placeholder={t("modpackBrowser.searchPlaceholder", {
          source: api.sourceLabel(source),
        })}
        filtering={filtering}
        fetchPage={fetchPage}
        resetKey={source}
        scrollKeyBase={source}
        onUpload={onUpload}
        onOpen={setSelected}
        emptyText={t("modpackBrowser.noResults")}
        startTypingText={t("modpackBrowser.loadingPopular")}
        renderRow={(h, open) => (
          <ResultRow
            key={`${h.source}:${h.project_id}`}
            hit={h}
            featured={!!matchFeatured(h)}
            showSource
            onOpen={open}
          />
        )}
      />

      {selected && (
        <div className="flex min-h-0 flex-1 flex-col swap-in">
          <DetailShell
            hit={selected}
            padded={false}
            onBack={() => setSelected(null)}
            badge={<SourceBadge source={selected.source} />}
            error={detailError}
            subtitle={
              <div className="truncate text-xs text-ink-600">
                {t("modpackBrowser.byAuthor", {
                  author: selected.author,
                  downloads: selected.downloads.toLocaleString(),
                })}
              </div>
            }
            actions={
              <>
                <button
                  disabled={!latest || installing}
                  onClick={() =>
                    latest &&
                    onInstall(selected.project_id, latest.version_id, selected.title)
                  }
                  className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {versions === null || installing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  {t("modpackBrowser.installLatest")}
                </button>
                <button
                  onClick={() => setShowVersions((v) => !v)}
                  aria-pressed={showVersions}
                  title={
                    showVersions
                      ? t("modpackBrowser.backToOverview")
                      : t("modpackBrowser.versions")
                  }
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    showVersions
                      ? "border-brass-500/50 bg-brass-500/15 text-brass-200"
                      : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
                  }`}
                >
                  {showVersions ? <ChevronLeft size={16} /> : <ListChecks size={16} />}
                  {showVersions
                    ? t("modpackBrowser.backToOverview")
                    : t("modpackBrowser.versions")}
                </button>
                {detail?.url && (
                  <button
                    onClick={() => api.openExternal(detail.url!).catch(() => {})}
                    title={t("modpackBrowser.openPage")}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                  >
                    <ExternalLink size={15} />
                  </button>
                )}
              </>
            }
            showVersions={showVersions}
            bodyNode={
              <>
                {(() => {
                  const fp = matchFeatured(selected);
                  if (!fp || !onOpenFeatured) return null;
                  return (
                    <div className="shrink-0 rounded-lg border border-brass-600/40 bg-brass-500/[0.06] p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-brass-300">
                        <Star size={12} className="fill-brass-300" />{" "}
                        {t("play.featuredPack")}
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
                {detail?.body && (
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-edge bg-ink-950/30 p-4">
                    <Markdown className="text-[13px]">{detail.body}</Markdown>
                  </div>
                )}
              </>
            }
            versionsNode={
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <VersionList
                  instanceId={detailInstanceId ?? ""}
                  projectId={selected.project_id}
                  source={source}
                  versions={versions}
                  actionLabel={t("mods.install")}
                  busy={installing ? "installing" : null}
                  showLatestBadge
                  onPick={(vid) =>
                    onInstall(selected.project_id, vid, selected.title)
                  }
                />
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
