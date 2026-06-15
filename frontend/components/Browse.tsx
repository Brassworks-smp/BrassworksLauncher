import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Users, Star, Download, Loader2, Check } from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { SearchHit } from "@/lib/types";



export const SEARCH_PAGE = 20;

const keyOf = (h: { source: string; project_id: string }) =>
  `${h.source}:${h.project_id}`;

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}


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


export function ResultRow({
  hit,
  installed,
  featured,
  showSource,
  onOpen,
  onQuickInstall,
}: {
  hit: SearchHit;
  installed?: boolean;
  featured?: boolean;
  showSource?: boolean;
  onOpen: () => void;
  onQuickInstall?: () => Promise<void>;
}) {
  const t = useT();
  const [iconFailed, setIconFailed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const isInstalled = installed || justInstalled;
  const quickInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (installing || isInstalled || !onQuickInstall) return;
    setInstalling(true);
    try {
      await onQuickInstall();
      setJustInstalled(true);
    } catch {
      
    } finally {
      setInstalling(false);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-edge bg-ink-850/40 p-3 text-left transition hover:border-brass-600/40 hover:bg-brass-500/[0.04]"
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
              {t("browse.byAuthor", { author: hit.author })}
            </span>
          )}
          {isInstalled && (
            <span className="shrink-0 rounded bg-patina-500/15 px-1.5 text-[9px] font-medium text-patina-400">
              {t("versionList.installed")}
            </span>
          )}
          {featured && (
            <span className="flex shrink-0 items-center gap-0.5 rounded bg-brass-500/15 px-1.5 text-[9px] font-medium text-brass-300">
              <Star size={8} className="fill-brass-300" /> {t("instances.featured")}
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-ink-600">
          {hit.description}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-600">
          <Users size={11} /> {t("addContent.downloads", { count: fmtDownloads(hit.downloads) })}
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-ink-600 opacity-0 transition group-hover:opacity-100">
        {t("browse.details")}
      </span>
      {onQuickInstall && !isInstalled && (
        <button
          type="button"
          onClick={quickInstall}
          disabled={installing}
          title={t("addContent.quickInstall")}
          aria-label={t("addContent.quickInstall")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:bg-brass-500/10 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {installing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
        </button>
      )}
      {onQuickInstall && isInstalled && (
        <span className="grid h-8 w-8 shrink-0 place-items-center text-patina-400">
          <Check size={16} />
        </span>
      )}
    </div>
  );
}
