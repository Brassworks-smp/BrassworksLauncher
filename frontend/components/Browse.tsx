import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Users } from "lucide-react";
import * as api from "@/lib/api";
import type { SearchHit } from "@/lib/types";

/**
 * Shared search widgets for the content browser and the modpack browser, so both
 * use the exact same result row + infinite-scroll behaviour (one place to
 * restyle, no duplicated paging logic).
 */

export const SEARCH_PAGE = 20;

const keyOf = (h: { source: string; project_id: string }) =>
  `${h.source}:${h.project_id}`;

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/**
 * Debounced, paginated search backed by any `(query, offset) => hits` fetcher.
 *
 * Results stream in page-by-page as you scroll (no waiting for everything), and
 * changing `query` or `resetKey` clears the previous results immediately instead
 * of leaving the old tab's content on screen until the new search resolves.
 */
export function useInfiniteSearch(
  fetchPage: (query: string, offset: number) => Promise<SearchHit[]>,
  query: string,
  resetKey: string,
  opts?: { debounce?: number; enabled?: boolean },
) {
  const { debounce = 250, enabled = true } = opts ?? {};
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reqId = useRef(0);
  const hitsRef = useRef<SearchHit[]>([]);
  hitsRef.current = hits;
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const stateRef = useRef({ hasMore, loadingMore, loading });
  stateRef.current = { hasMore, loadingMore, loading };

  useEffect(() => {
    if (!enabled || !api.isTauri()) return;
    setHits([]);
    setHasMore(true);
    setError(null);
    setLoading(true);
    const id = ++reqId.current;
    const h = setTimeout(() => {
      fetchRef
        .current(query, 0)
        .then((res) => {
          if (id !== reqId.current) return;
          setHits(res);
          setHasMore(res.length >= SEARCH_PAGE);
        })
        .catch((e) => id === reqId.current && setError(String(e)))
        .finally(() => id === reqId.current && setLoading(false));
    }, debounce);
    return () => clearTimeout(h);
  }, [query, resetKey, enabled, debounce]);

  const loadMore = useCallback(() => {
    if (!api.isTauri()) return;
    const id = reqId.current;
    setLoadingMore(true);
    fetchRef
      .current(query, hitsRef.current.length)
      .then((res) => {
        if (id !== reqId.current) return;
        setHits((prev) => {
          const seen = new Set(prev.map(keyOf));
          return [...prev, ...res.filter((h) => !seen.has(keyOf(h)))];
        });
        setHasMore(res.length >= SEARCH_PAGE);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [query]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
      const s = stateRef.current;
      if (near && s.hasMore && !s.loadingMore && !s.loading) loadMore();
    },
    [loadMore],
  );

  return { hits, loading, loadingMore, hasMore, error, handleScroll };
}

/** A "Modrinth" / "CurseForge" pill. */
export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        source === "curseforge" ? "badge-curseforge" : "badge-modrinth"
      }`}
    >
      {api.sourceLabel(source)}
    </span>
  );
}

/** A single search result row, shared by the content + modpack browsers. */
export function ResultRow({
  hit,
  installed,
  showSource,
  onOpen,
}: {
  hit: SearchHit;
  installed?: boolean;
  showSource?: boolean;
  onOpen: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <button
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-lg border border-edge bg-ink-850/40 p-3 text-left transition hover:border-brass-600/40 hover:bg-brass-500/[0.04]"
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-ink-600">
        {hit.icon_url && !iconFailed ? (
          <img
            src={hit.icon_url}
            alt={hit.title}
            className="h-full w-full object-cover"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Box size={18} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-100 group-hover:text-brass-300">
            {hit.title}
          </span>
          {showSource && <SourceBadge source={hit.source} />}
          {hit.author && (
            <span className="shrink-0 text-[11px] text-ink-600">
              by {hit.author}
            </span>
          )}
          {installed && (
            <span className="shrink-0 rounded bg-patina-500/15 px-1.5 text-[9px] font-medium text-patina-400">
              Installed
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-ink-600">
          {hit.description}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-600">
          <Users size={11} /> {fmtDownloads(hit.downloads)} downloads
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-ink-600 opacity-0 transition group-hover:opacity-100">
        Details →
      </span>
    </button>
  );
}
