import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Box,
  Users,
  Star,
  Download,
  Loader2,
  Check,
  Search,
  SlidersHorizontal,
  Upload,
  ExternalLink,
} from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import type {
  ContentSource,
  FilterOptions,
  SearchFilters,
  SearchHit,
} from "@/lib/types";
import { FilterSidebar } from "./FilterSidebar";
import { BackButton } from "./ui";



export const SEARCH_PAGE = 20;

const keyOf = (h: { source: string; project_id: string }) =>
  `${h.source}:${h.project_id}`;

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-600">
          <span className="flex items-center gap-1">
            <Users size={11} /> {t("addContent.downloads", { count: fmtDownloads(hit.downloads) })}
          </span>
          {hit.date_modified && (
            <span className="hidden sm:inline">· {relTime(hit.date_modified)}</span>
          )}
          {hit.categories && hit.categories.length > 0 && (
            <span className="hidden items-center gap-1 md:flex">
              {hit.categories.slice(0, 3).map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-ink-800 px-1.5 py-px text-[10px] capitalize text-ink-500"
                >
                  {c}
                </span>
              ))}
            </span>
          )}
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


export interface Filtering {
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  options: FilterOptions | null;
  open: boolean;
  setOpen: (updater: (o: boolean) => boolean) => void;
  loadingOptions: boolean;
  activeCount: number;
  key: string;
}

/**
 * Shared "search row + filter sidebar + results list + infinite scroll" scaffold
 * used by the content / datapack / modpack browsers. Owns the infinite-search hook
 * and per-(scope/query) scroll-position memory. Stays mounted while a detail is open
 * (`hidden`) so returning restores scroll without a refetch.
 */
export function BrowseResults({
  source,
  query,
  onQueryChange,
  placeholder,
  headerLeft,
  filtering,
  fetchPage,
  resetKey,
  enabled = true,
  renderRow,
  onOpen,
  emptyText,
  startTypingText,
  accent,
  onUpload,
  footer,
  scrollKeyBase,
  hidden = false,
  padded = true,
  autoFocusSearch = false,
}: {
  source: ContentSource;
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  headerLeft?: ReactNode;
  filtering: Filtering;
  fetchPage: (q: string, offset: number) => Promise<SearchHit[]>;
  resetKey: string;
  enabled?: boolean;
  renderRow: (hit: SearchHit, open: () => void) => ReactNode;
  onOpen: (hit: SearchHit) => void;
  emptyText: string;
  startTypingText: string;
  accent?: CSSProperties;
  onUpload?: () => void;
  footer?: ReactNode;
  scrollKeyBase: string;
  hidden?: boolean;
  padded?: boolean;
  autoFocusSearch?: boolean;
}) {
  const t = useT();
  const {
    filters,
    setFilters,
    options,
    open,
    setOpen,
    loadingOptions,
    activeCount,
    key,
  } = filtering;
  const { hits, loading, loadingMore, hasMore, error, handleScroll } =
    useInfiniteSearch(fetchPage, query, `${resetKey}:${key}`, { enabled });

  const listScrollRef = useRef<HTMLDivElement>(null);
  const scrollByKey = useRef<Record<string, number>>({});
  const scrollKey = `${scrollKeyBase}:${query}`;
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    handleScroll(e);
    scrollByKey.current[scrollKey] = e.currentTarget.scrollTop;
  };

  // Replay the "slide back in" animation when the list reappears after a detail
  // closes (we stay mounted under the detail, so a key bump re-triggers the anim).
  const [showTick, setShowTick] = useState(0);
  const prevHidden = useRef(hidden);
  useEffect(() => {
    if (prevHidden.current && !hidden) setShowTick((n) => n + 1);
    prevHidden.current = hidden;
  }, [hidden]);

  useLayoutEffect(() => {
    if (hidden || loading) return;
    const el = listScrollRef.current;
    if (el) el.scrollTop = scrollByKey.current[scrollKey] ?? 0;
  }, [hidden, loading, scrollKey, showTick]);

  const colCls = `flex min-h-0 flex-1 flex-col${padded ? "" : " gap-3"}`;
  if (hidden) return <div className="hidden" />;

  return (
    <div className={colCls}>
      <div
        key={showTick}
        className={`${colCls}${showTick > 0 ? " swap-in-back" : ""}`}
      >
        <div
          className={
            padded
              ? "flex items-center gap-2 px-5 py-3"
              : "flex shrink-0 items-center gap-2"
          }
        >
          {headerLeft}
          <div className="relative flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <input
              autoFocus={autoFocusSearch}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg bg-ink-950/60 py-2 pl-9 pr-9 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
            />
            {(loading || loadingMore) && (
              <Loader2
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-600"
              />
            )}
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            title={t("mods.filter.button")}
            className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition ${
              open || activeCount > 0
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
          {onUpload && (
            <button
              onClick={onUpload}
              title={t("addInstance.uploadInstead")}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-edge px-2.5 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Upload size={15} />
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <FilterSidebar
            open={open}
            source={source}
            options={options}
            loading={loadingOptions}
            filters={filters}
            onChange={setFilters}
            accentStyle={accent}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {error && (
              <div className="mx-5 mb-2 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <div
              ref={listScrollRef}
              onScroll={onListScroll}
              className={
                padded
                  ? "flex-1 overflow-y-auto px-5 pb-5 pt-3"
                  : `flex-1 overflow-y-auto pr-1 ${open ? "pl-4" : "pl-px"}`
              }
            >
              {loading ? (
                <div className="grid h-full place-items-center text-ink-600">
                  <Loader2 className="animate-spin" />
                </div>
              ) : hits.length === 0 ? (
                <div className="grid h-full place-items-center text-center text-sm text-ink-600">
                  {query ? emptyText : startTypingText}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {hits.map((hit) => renderRow(hit, () => onOpen(hit)))}
                  {loadingMore && (
                    <div className="grid place-items-center py-3 text-ink-600">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  )}
                  {!hasMore && hits.length >= SEARCH_PAGE && (
                    <div className="py-3 text-center text-[11px] text-ink-600">
                      {t("addContent.endOfResults")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {footer &&
          (padded ? (
            <div className="border-t border-edge px-5 py-2 text-center text-[11px] text-ink-600">
              {footer}
            </div>
          ) : (
            footer
          ))}
      </div>
    </div>
  );
}

/**
 * Shared detail shell: icon/title header + an animated swap between a body pane and
 * a versions pane. Each browser supplies its own `actions` (install buttons) and the
 * `bodyNode` / `versionsNode` content; the shell standardizes the layout + animation.
 */
export function DetailShell({
  hit,
  onBack,
  accent,
  badge,
  subtitle,
  onExternal,
  externalTitle,
  actions,
  error,
  showVersions,
  bodyNode,
  versionsNode,
  padded = true,
}: {
  hit: SearchHit;
  onBack?: () => void;
  accent?: CSSProperties;
  badge?: ReactNode;
  subtitle?: ReactNode;
  onExternal?: () => void;
  externalTitle?: string;
  actions?: ReactNode;
  error?: ReactNode;
  showVersions: boolean;
  bodyNode: ReactNode;
  versionsNode: ReactNode;
  padded?: boolean;
}) {
  return (
    <div
      style={accent}
      className={
        padded
          ? "flex flex-1 flex-col overflow-hidden"
          : "flex min-h-0 flex-1 flex-col gap-3"
      }
    >
      <div
        className={
          padded
            ? "flex items-start gap-4 border-b border-edge px-5 py-4"
            : "flex items-center gap-2"
        }
      >
        {onBack && <BackButton onClick={onBack} />}
        <div
          className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-900 text-ink-600 ${
            padded ? "h-16 w-16" : "h-12 w-12"
          }`}
        >
          {hit.icon_url ? (
            <img
              src={hit.icon_url}
              alt={hit.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <Box size={padded ? 24 : 20} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              className={`truncate font-mc text-gray-100 ${
                padded ? "text-lg" : "text-sm"
              }`}
            >
              {hit.title}
            </h3>
            {badge}
            {onExternal && (
              <button
                onClick={onExternal}
                title={externalTitle}
                className="text-ink-600 hover:text-brass-300"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          {subtitle}
        </div>
        {actions && (
          <div
            className={
              padded
                ? "flex shrink-0 flex-col gap-2"
                : "flex shrink-0 items-center gap-2"
            }
          >
            {actions}
          </div>
        )}
      </div>

      {error &&
        (padded ? (
          <div className="mx-5 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        ) : (
          <div className="text-xs text-red-300">{error}</div>
        ))}

      <div
        className={
          padded ? "flex-1 overflow-y-auto px-5 py-4" : "flex min-h-0 flex-1 flex-col"
        }
      >
        <div
          key={showVersions ? "versions" : "body"}
          className={
            padded ? "swap-in" : "swap-in flex min-h-0 flex-1 flex-col gap-3"
          }
        >
          {showVersions ? versionsNode : bodyNode}
        </div>
      </div>
    </div>
  );
}
