import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Star,
  Eye,
  Download,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Boxes,
  Ruler,
  Play as PlayIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Markdown } from "./Markdown";
import { toast } from "@/lib/toast";
import type {
  SchematicCard,
  SchematicDetail,
  SchematicHome,
  SchematicFilters,
  SchematicSearchParams,
} from "@/lib/types";

const SORTS = [
  "best_match",
  "trending",
  "newest",
  "oldest",
  "highest_rated",
  "lowest_rated",
  "most_viewed",
  "least_viewed",
];

const homeCache: Record<string, SchematicHome> = {};
let filtersCache: SchematicFilters | null = null;

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-ink-600">
      {icon}
      {value}
    </span>
  );
}

function Card({
  card,
  onOpen,
}: {
  card: SchematicCard;
  onOpen: (name: string) => void;
}) {
  return (
    <button
      onClick={() => onOpen(card.name)}
      className="group flex w-full flex-col overflow-hidden rounded-lg border border-edge bg-ink-900/50 text-left transition hover:border-brass-600/40 hover:bg-ink-800/40"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-ink-950/60">
        {card.featured_image ? (
          <img
            src={card.featured_image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-700">
            <Boxes size={28} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="truncate font-mc text-[12px] text-gray-100">
          {card.title || card.name}
        </div>
        <div className="flex items-center gap-3">
          {card.rating != null && (
            <Stat
              icon={<Star size={11} className="fill-brass-400 text-brass-400" />}
              value={card.rating.toFixed(1)}
            />
          )}
          <Stat icon={<Eye size={11} />} value={String(card.views)} />
          <Stat icon={<Download size={11} />} value={String(card.downloads)} />
        </div>
        {card.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded border border-edge px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-600"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function Segment({
  title,
  cards,
  onOpen,
}: {
  title: string;
  cards: SchematicCard[];
  onOpen: (name: string) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="mb-6">
      <h3 className="mb-2 font-mc text-[13px] tracking-wide text-brass-300">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {cards.map((card) => (
          <Card key={card.name} card={card} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function Detail({
  instanceId,
  name,
  downloadFolders,
  onBack,
}: {
  instanceId: string;
  name: string;
  downloadFolders: string[];
  onBack: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<SchematicDetail | null>(null);
  const [err, setErr] = useState(false);
  const [watching, setWatching] = useState(false);
  const [found, setFound] = useState<[string, string][]>([]);
  const baseline = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(false);
    api
      .schematicDetail(name)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [name]);

  const poll = useCallback(async () => {
    if (downloadFolders.length === 0) return;
    const hits = await api.scanSchematicDownloads(downloadFolders).catch(() => []);
    const fresh = hits.filter(([, path]) => !baseline.current.has(path));
    if (fresh.length > 0) setFound(fresh);
  }, [downloadFolders]);

  useEffect(() => {
    if (!watching) return;
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [watching, poll]);

  const startDownload = async () => {
    if (!detail?.web_url) return;
    const hits = await api.scanSchematicDownloads(downloadFolders).catch(() => []);
    baseline.current = new Set(hits.map(([, path]) => path));
    setFound([]);
    setWatching(true);
    api.openExternal(detail.web_url).catch(() => {});
  };

  const doImport = async (path: string) => {
    try {
      await api.importSchematic(instanceId, path);
      toast(t("schematics.imported"), "success");
      setWatching(false);
      setFound([]);
    } catch {
      toast(t("schematics.importFailed"), "error");
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-600 transition hover:text-brass-300"
      >
        <ArrowLeft size={14} /> {t("schematics.back")}
      </button>

      {err && (
        <div className="rounded-lg border border-edge bg-ink-900/50 p-6 text-center text-ink-600">
          {t("schematics.detailError")}
        </div>
      )}

      {!detail && !err && (
        <div className="flex justify-center p-12 text-ink-600">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {detail && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-mc text-[18px] text-gray-100">{detail.title}</h2>
              {detail.author && (
                <div className="mt-0.5 text-[12px] text-ink-600">
                  {t("schematics.by")} {detail.author}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {detail.web_url && (
                <button
                  onClick={() => api.openExternal(detail.web_url!)}
                  className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <ExternalLink size={13} /> {t("schematics.viewOnSite")}
                </button>
              )}
              <button
                onClick={startDownload}
                className="brass-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-ink-950"
              >
                <Download size={13} /> {t("schematics.download")}
              </button>
            </div>
          </div>

          {detail.featured_image && (
            <img
              src={detail.featured_image}
              alt=""
              className="w-full rounded-lg border border-edge object-cover"
            />
          )}

          {watching && (
            <div className="rounded-lg border border-brass-600/40 bg-brass-500/5 p-3">
              <div className="mb-2 text-[12px] text-brass-300">
                {t("schematics.watchHint")}
              </div>
              {found.length === 0 ? (
                <div className="flex items-center gap-2 text-[12px] text-ink-600">
                  <Loader2 size={13} className="animate-spin" />
                  {t("schematics.watching")}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {found.map(([fname, path]) => (
                    <div
                      key={path}
                      className="flex items-center justify-between gap-2 rounded border border-edge bg-ink-900/50 px-2.5 py-1.5"
                    >
                      <span className="truncate text-[12px] text-gray-200">
                        {fname}
                      </span>
                      <button
                        onClick={() => doImport(path)}
                        className="brass-btn rounded px-2.5 py-1 text-[11px] text-ink-950"
                      >
                        {t("schematics.import")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-4 rounded-lg border border-edge bg-ink-900/40 p-3 text-[12px]">
            {detail.rating != null && (
              <Stat
                icon={<Star size={12} className="fill-brass-400 text-brass-400" />}
                value={`${detail.rating.toFixed(1)} (${detail.rating_count})`}
              />
            )}
            <Stat icon={<Eye size={12} />} value={String(detail.views)} />
            <Stat icon={<Download size={12} />} value={String(detail.downloads)} />
            {(detail.dimensions.x > 0 || detail.dimensions.y > 0) && (
              <Stat
                icon={<Ruler size={12} />}
                value={`${detail.dimensions.x}x${detail.dimensions.y}x${detail.dimensions.z}`}
              />
            )}
            {detail.block_count > 0 && (
              <Stat icon={<Boxes size={12} />} value={String(detail.block_count)} />
            )}
            {detail.minecraft_version && (
              <span className="text-[11px] text-ink-600">
                MC {detail.minecraft_version}
              </span>
            )}
            {detail.createmod_version && (
              <span className="text-[11px] text-ink-600">
                Create {detail.createmod_version}
              </span>
            )}
          </div>

          {detail.video && (
            <button
              onClick={() =>
                api.openExternal(`https://www.youtube.com/watch?v=${detail.video}`)
              }
              className="flex items-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <PlayIcon size={13} /> {t("schematics.watchVideo")}
            </button>
          )}

          {detail.required_mods.length > 0 && (
            <div>
              <h3 className="mb-1.5 font-mc text-[13px] text-brass-300">
                {t("schematics.requiredMods")}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {detail.required_mods.map((mod) => (
                  <span
                    key={mod}
                    className="rounded border border-edge bg-ink-900/50 px-2 py-1 text-[11px] text-gray-200"
                  >
                    {mod}
                  </span>
                ))}
              </div>
            </div>
          )}

          {detail.materials.length > 0 && (
            <div>
              <h3 className="mb-1.5 font-mc text-[13px] text-brass-300">
                {t("schematics.materials")}
              </h3>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-edge">
                {detail.materials.map((m, i) => (
                  <div
                    key={`${m.name}-${i}`}
                    className="flex items-center justify-between border-b border-edge/50 px-3 py-1.5 text-[12px] last:border-0"
                  >
                    <span className="text-gray-200">{m.name}</span>
                    <span className="tabular-nums text-ink-600">{m.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail.description_html && (
            <div>
              <h3 className="mb-1.5 font-mc text-[13px] text-brass-300">
                {t("schematics.description")}
              </h3>
              <Markdown>{detail.description_html}</Markdown>
            </div>
          )}

          {detail.comment_count > 0 && detail.web_url && (
            <button
              onClick={() => api.openExternal(detail.web_url!)}
              className="self-start text-[12px] text-ink-600 underline-offset-2 transition hover:text-brass-300 hover:underline"
            >
              {t("schematics.viewComments")} ({detail.comment_count})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SchematicsView({ instanceId }: { instanceId: string }) {
  const t = useT();
  const [home, setHome] = useState<SchematicHome | null>(homeCache[instanceId] ?? null);
  const [loadErr, setLoadErr] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [sort, setSort] = useState("best_match");
  const [category, setCategory] = useState("all");
  const [mcVersion, setMcVersion] = useState("all");
  const [createVersion, setCreateVersion] = useState("all");
  const [filters, setFilters] = useState<SchematicFilters | null>(filtersCache);
  const [results, setResults] = useState<SchematicCard[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [searching, setSearching] = useState(false);
  const [openName, setOpenName] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);

  const isSearch =
    active.trim().length > 0 ||
    sort !== "best_match" ||
    category !== "all" ||
    mcVersion !== "all" ||
    createVersion !== "all";

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setFolders(s.manual_download_folders))
      .catch(() => {});
    if (!filtersCache) {
      api
        .schematicsFilters()
        .then((f) => {
          filtersCache = f;
          setFilters(f);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (homeCache[instanceId]) return;
    setLoadErr(false);
    api
      .schematicsHome()
      .then((h) => {
        homeCache[instanceId] = h;
        setHome(h);
      })
      .catch(() => setLoadErr(true));
  }, [instanceId]);

  const runSearch = useCallback(
    async (nextPage: number) => {
      setSearching(true);
      const params: SchematicSearchParams = {
        query: active.trim(),
        sort,
        category,
        mc_version: mcVersion,
        create_version: createVersion,
        page: nextPage,
      };
      try {
        const res = await api.schematicsSearch(params);
        setResults((prev) =>
          nextPage === 1 ? res.items : [...prev, ...res.items],
        );
        setHasNext(res.has_next);
        setPage(res.page);
      } catch {
        if (nextPage === 1) setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [active, sort, category, mcVersion, createVersion],
  );

  useEffect(() => {
    if (!isSearch) return;
    void runSearch(1);
  }, [isSearch, runSearch]);

  if (openName) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <Detail
          instanceId={instanceId}
          name={openName}
          downloadFolders={folders}
          onBack={() => setOpenName(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge bg-ink-900/40 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setActive(query);
              }}
              placeholder={t("schematics.searchPlaceholder")}
              className="w-full rounded-md border border-edge bg-ink-950/40 py-2 pl-9 pr-3 text-[13px] text-gray-100 outline-none focus:border-brass-600/50"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-md border border-edge bg-ink-950/40 px-2 py-2 text-[12px] text-gray-200 no-spin"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`schematics.sort.${s}`)}
              </option>
            ))}
          </select>
          {filters && filters.categories.length > 0 && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-edge bg-ink-950/40 px-2 py-2 text-[12px] text-gray-200"
            >
              <option value="all">{t("schematics.allCategories")}</option>
              {filters.categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {filters && filters.mc_versions.length > 0 && (
            <select
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
              className="rounded-md border border-edge bg-ink-950/40 px-2 py-2 text-[12px] text-gray-200"
            >
              <option value="all">{t("schematics.allMcVersions")}</option>
              {filters.mc_versions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {filters && filters.create_versions.length > 0 && (
            <select
              value={createVersion}
              onChange={(e) => setCreateVersion(e.target.value)}
              className="rounded-md border border-edge bg-ink-950/40 px-2 py-2 text-[12px] text-gray-200"
            >
              <option value="all">{t("schematics.allCreateVersions")}</option>
              {filters.create_versions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {!isSearch && (
          <>
            {loadErr && (
              <div className="rounded-lg border border-edge bg-ink-900/50 p-6 text-center text-ink-600">
                {t("schematics.loadError")}
              </div>
            )}
            {!home && !loadErr && (
              <div className="flex justify-center p-12 text-ink-600">
                <Loader2 className="animate-spin" />
              </div>
            )}
            {home && (
              <>
                <Segment
                  title={t("schematics.trending")}
                  cards={home.trending}
                  onOpen={setOpenName}
                />
                <Segment
                  title={t("schematics.latest")}
                  cards={home.latest}
                  onOpen={setOpenName}
                />
                <Segment
                  title={t("schematics.highest")}
                  cards={home.highest}
                  onOpen={setOpenName}
                />
                {home.trending.length === 0 &&
                  home.latest.length === 0 &&
                  home.highest.length === 0 &&
                  !loadErr && (
                    <div className="rounded-lg border border-edge bg-ink-900/50 p-6 text-center text-ink-600">
                      {t("schematics.empty")}
                    </div>
                  )}
              </>
            )}
          </>
        )}

        {isSearch && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {results.map((card) => (
                <Card key={card.name} card={card} onOpen={setOpenName} />
              ))}
            </div>
            {!searching && results.length === 0 && (
              <div className="rounded-lg border border-edge bg-ink-900/50 p-6 text-center text-ink-600">
                {t("schematics.noResults")}
              </div>
            )}
            {searching && (
              <div className="flex justify-center p-6 text-ink-600">
                <Loader2 className="animate-spin" />
              </div>
            )}
            {hasNext && !searching && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => runSearch(page + 1)}
                  className="rounded-md border border-edge px-4 py-2 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  {t("schematics.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
