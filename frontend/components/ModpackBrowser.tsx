import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, Download, ChevronLeft, Package, ExternalLink } from "lucide-react";
import * as api from "@/lib/api";
import type { SearchHit, ContentVersion, ProjectDetail } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { VersionList } from "@/components/VersionList";
import { ResultRow, SourceBadge, useInfiniteSearch, SEARCH_PAGE } from "@/components/Browse";

/**
 * Search + pick a Modrinth / CurseForge modpack, read its README and per-version
 * changelog, and choose a version to install. Installation itself is handled by
 * the parent (`onInstall`), which owns the progress + completion events.
 *
 * Shares the result row + infinite-scroll behaviour with the content browser
 * (see {@link useInfiniteSearch} / {@link ResultRow}).
 */
export function ModpackBrowser({
  source,
  detailInstanceId,
  installing,
  onInstall,
}: {
  source: "modrinth" | "curseforge";
  detailInstanceId: string | null;
  installing: boolean;
  onInstall: (projectId: string, versionId: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (q: string, offset: number) => api.searchModpacks(source, q, offset),
    [source],
  );
  const { hits, loading, loadingMore, hasMore, error, handleScroll } =
    useInfiniteSearch(fetchPage, query, source);

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
      <div className="flex flex-col gap-3">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1 self-start text-xs text-ink-600 hover:text-brass-300"
        >
          <ChevronLeft size={14} /> Back to results
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
              by {selected.author} · {selected.downloads.toLocaleString()}{" "}
              downloads
            </div>
          </div>
        </div>

        {detailError && (
          <div className="text-xs text-red-300">{detailError}</div>
        )}

        <div key={showVersions ? "versions" : "overview"} className="swap-in flex flex-col gap-3">
        {!showVersions ? (
          <>
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
                Install — choose a version
              </button>
              {detail?.url && (
                <button
                  onClick={() => api.openExternal(detail.url!).catch(() => {})}
                  title="Open page"
                  className="grid h-10 w-10 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <ExternalLink size={15} />
                </button>
              )}
            </div>
            {detail?.body && (
              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-edge bg-ink-950/30 p-4">
                <Markdown className="text-[13px]">{detail.body}</Markdown>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => setShowVersions(false)}
              className="flex items-center gap-1 self-start text-xs text-ink-600 hover:text-brass-300"
            >
              <ChevronLeft size={14} /> Back to overview
            </button>
            <div className="max-h-[360px] overflow-y-auto pr-1">
              <VersionList
                instanceId={detailInstanceId ?? ""}
                projectId={selected.project_id}
                source={source}
                versions={versions ?? []}
                actionLabel={installing ? "Installing…" : "Install"}
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md bg-ink-950/70 px-3 ring-1 ring-edge focus-within:ring-brass-500/60">
        <Search size={15} className="text-ink-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${api.sourceLabel(source)} modpacks…`}
          className="flex-1 bg-transparent py-2 text-sm outline-none"
        />
        {(loading || loadingMore) && (
          <Loader2 size={14} className="animate-spin text-ink-600" />
        )}
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}

      <div
        className="flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-1"
        onScroll={handleScroll}
      >
        {hits.map((h) => (
          <ResultRow
            key={`${h.source}:${h.project_id}`}
            hit={h}
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
            {query ? "No modpacks found." : "Loading popular modpacks…"}
          </div>
        )}
        {!hasMore && hits.length >= SEARCH_PAGE && (
          <div className="py-3 text-center text-[11px] text-ink-600">
            End of results
          </div>
        )}
      </div>
    </div>
  );
}
