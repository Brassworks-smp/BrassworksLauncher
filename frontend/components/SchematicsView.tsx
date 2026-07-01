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
  MessageSquare,
} from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Dropdown } from "./ui";
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

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

function Pill({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-edge bg-ink-950/40 px-2.5 py-1 text-[11px] text-ink-600">
      {icon}
      {children}
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
      className="group relative flex flex-col overflow-hidden rounded-xl border border-edge bg-ink-900/50 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brass-500/50 hover:shadow-lg hover:shadow-brass-500/5"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-ink-800/60 to-ink-950/80">
        {card.featured_image ? (
          <img
            src={card.featured_image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-700">
            <Boxes size={30} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-950/90 to-transparent" />
        {card.rating != null && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-[11px] font-medium text-brass-300 backdrop-blur">
            <Star size={11} className="fill-brass-400 text-brass-400" />
            {card.rating.toFixed(1)}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <span className="truncate font-mc text-[12px] text-gray-50 drop-shadow">
            {card.title || card.name}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <div className="flex items-center gap-3 text-[11px] text-ink-600">
          <span className="flex items-center gap-1">
            <Eye size={11} /> {fmt(card.views)}
          </span>
          <span className="flex items-center gap-1">
            <Download size={11} /> {fmt(card.downloads)}
          </span>
        </div>
        {card.author && (
          <span className="truncate text-[10px] text-ink-700">{card.author}</span>
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
    <section className="mb-7">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-4 w-1 rounded-full bg-gradient-to-b from-brass-300 to-brass-600" />
        <h3 className="font-mc text-[14px] tracking-wide text-gray-100">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
  const [hero, setHero] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [found, setFound] = useState<[string, string][]>([]);
  const baseline = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(false);
    setHero(null);
    api
      .schematicDetail(name)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setHero(d.featured_image);
      })
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

  const gallery = detail
    ? [detail.featured_image, ...detail.gallery].filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-5xl">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-[12px] text-ink-600 transition hover:text-brass-300"
      >
        <ArrowLeft size={14} /> {t("schematics.back")}
      </button>

      {err && (
        <div className="rounded-xl border border-edge bg-ink-900/50 p-8 text-center text-ink-600">
          {t("schematics.detailError")}
        </div>
      )}

      {!detail && !err && (
        <div className="flex justify-center p-16 text-ink-600">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {detail && (
        <div className="flex flex-col gap-5">
          <div className="relative overflow-hidden rounded-2xl border border-edge bg-ink-900/60">
            <div className="relative aspect-[21/9] w-full bg-gradient-to-br from-ink-800/60 to-ink-950">
              {hero ? (
                <img src={hero} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-700">
                  <Boxes size={48} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5">
                <div className="min-w-0">
                  <h2 className="truncate font-mc text-[22px] text-gray-50 drop-shadow">
                    {detail.title}
                  </h2>
                  {detail.author && (
                    <div className="mt-1 text-[12px] text-gray-300">
                      {t("schematics.by")} {detail.author}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {detail.web_url && (
                    <button
                      onClick={() => api.openExternal(detail.web_url!)}
                      className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-ink-950/60 px-3 py-2 text-[12px] text-gray-200 backdrop-blur transition hover:border-brass-500/50 hover:text-brass-300"
                    >
                      <ExternalLink size={13} /> {t("schematics.viewOnSite")}
                    </button>
                  )}
                  <button
                    onClick={startDownload}
                    className="brass-btn flex items-center gap-1.5 rounded-lg bg-brass-500 px-4 py-2 text-[12px] font-semibold text-ink-950 transition hover:bg-brass-400"
                  >
                    <Download size={13} /> {t("schematics.download")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {gallery.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {gallery.map((g) => (
                <button
                  key={g}
                  onClick={() => setHero(g!)}
                  className={`h-16 w-28 shrink-0 overflow-hidden rounded-lg border transition ${
                    hero === g
                      ? "border-brass-500"
                      : "border-edge opacity-70 hover:opacity-100"
                  }`}
                >
                  <img src={g!} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {detail.rating != null && (
              <Pill icon={<Star size={12} className="fill-brass-400 text-brass-400" />}>
                {detail.rating.toFixed(1)}
                <span className="text-ink-700"> ({detail.rating_count})</span>
              </Pill>
            )}
            <Pill icon={<Eye size={12} />}>{fmt(detail.views)}</Pill>
            <Pill icon={<Download size={12} />}>{fmt(detail.downloads)}</Pill>
            {(detail.dimensions.x > 0 || detail.dimensions.y > 0) && (
              <Pill icon={<Ruler size={12} />}>
                {detail.dimensions.x}×{detail.dimensions.y}×{detail.dimensions.z}
              </Pill>
            )}
            {detail.block_count > 0 && (
              <Pill icon={<Boxes size={12} />}>{fmt(detail.block_count)}</Pill>
            )}
            {detail.minecraft_version && (
              <Pill icon={null}>MC {detail.minecraft_version}</Pill>
            )}
            {detail.createmod_version && (
              <Pill icon={null}>Create {detail.createmod_version}</Pill>
            )}
          </div>

          {watching && (
            <div className="rounded-xl border border-brass-600/40 bg-brass-500/5 p-4">
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
                      className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-ink-900/50 px-3 py-2"
                    >
                      <span className="truncate text-[12px] text-gray-200">{fname}</span>
                      <button
                        onClick={() => doImport(path)}
                        className="brass-btn rounded-md bg-brass-500 px-3 py-1 text-[11px] font-semibold text-ink-950 transition hover:bg-brass-400"
                      >
                        {t("schematics.import")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="flex flex-col gap-5 lg:col-span-2">
              {detail.video && (
                <button
                  onClick={() =>
                    api.openExternal(`https://www.youtube.com/watch?v=${detail.video}`)
                  }
                  className="flex items-center gap-2 self-start rounded-lg border border-edge px-3 py-2 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <PlayIcon size={13} /> {t("schematics.watchVideo")}
                </button>
              )}

              {detail.description_html && (
                <div>
                  <h3 className="mb-2 font-mc text-[13px] text-brass-300">
                    {t("schematics.description")}
                  </h3>
                  <Markdown>{detail.description_html}</Markdown>
                </div>
              )}

              {detail.comment_count > 0 && detail.web_url && (
                <button
                  onClick={() => api.openExternal(detail.web_url!)}
                  className="flex items-center gap-1.5 self-start text-[12px] text-ink-600 transition hover:text-brass-300"
                >
                  <MessageSquare size={13} /> {t("schematics.viewComments")} (
                  {detail.comment_count})
                </button>
              )}
            </div>

            <div className="flex flex-col gap-5">
              {detail.required_mods.length > 0 && (
                <div className="rounded-xl border border-edge bg-ink-900/40 p-3.5">
                  <h3 className="mb-2 font-mc text-[12px] text-brass-300">
                    {t("schematics.requiredMods")}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.required_mods.map((mod) => (
                      <span
                        key={mod}
                        className="rounded-md border border-edge bg-ink-950/40 px-2 py-1 text-[11px] text-gray-200"
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.materials.length > 0 && (
                <div className="rounded-xl border border-edge bg-ink-900/40 p-3.5">
                  <h3 className="mb-2 font-mc text-[12px] text-brass-300">
                    {t("schematics.materials")}
                  </h3>
                  <div className="max-h-80 overflow-y-auto">
                    {detail.materials.map((m, i) => (
                      <div
                        key={`${m.name}-${i}`}
                        className="flex items-center justify-between gap-2 border-b border-edge/40 py-1.5 text-[12px] last:border-0"
                      >
                        <span className="truncate text-gray-200">{m.name}</span>
                        <span className="shrink-0 tabular-nums text-ink-600">
                          {m.count > 0 ? `×${m.count}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
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

  const sortOptions = SORTS.map((s) => ({
    value: s,
    label: t(`schematics.sort.${s}`),
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-20 px-5 pb-2 pt-5">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-edge bg-gradient-to-b from-ink-900/85 to-ink-900/55 p-2.5 shadow-lg shadow-ink-950/40 backdrop-blur-xl">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setActive(query);
              }}
              placeholder={t("schematics.searchPlaceholder")}
              className="w-full rounded-xl border border-edge bg-ink-950/60 py-2 pl-10 pr-4 text-[13px] text-gray-100 outline-none transition focus:border-brass-500/50 focus:bg-ink-950/80"
            />
          </div>
          <div className="w-40">
            <Dropdown value={sort} onChange={setSort} options={sortOptions} />
          </div>
          {filters && filters.categories.length > 0 && (
            <div className="w-40">
              <Dropdown
                value={category}
                onChange={setCategory}
                options={[
                  { value: "all", label: t("schematics.allCategories") },
                  ...filters.categories,
                ]}
              />
            </div>
          )}
          {filters && filters.mc_versions.length > 0 && (
            <div className="w-36">
              <Dropdown
                value={mcVersion}
                onChange={setMcVersion}
                options={[
                  { value: "all", label: t("schematics.allMcVersions") },
                  ...filters.mc_versions,
                ]}
              />
            </div>
          )}
          {filters && filters.create_versions.length > 0 && (
            <div className="w-36">
              <Dropdown
                value={createVersion}
                onChange={setCreateVersion}
                options={[
                  { value: "all", label: t("schematics.allCreateVersions") },
                  ...filters.create_versions,
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {!isSearch && (
          <>
            <div className="mb-6 overflow-hidden rounded-2xl border border-brass-600/25 bg-gradient-to-r from-brass-500/10 via-ink-900/40 to-ink-900/20 px-6 py-5">
              <h2 className="font-mc text-[20px] tracking-wide text-gray-50">
                {t("schematics.heroTitle")}
              </h2>
              <p className="mt-1 text-[12px] text-ink-600">{t("schematics.heroSub")}</p>
            </div>
            {loadErr && (
              <div className="rounded-xl border border-edge bg-ink-900/50 p-8 text-center text-ink-600">
                {t("schematics.loadError")}
              </div>
            )}
            {!home && !loadErr && (
              <div className="flex justify-center p-16 text-ink-600">
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
                    <div className="rounded-xl border border-edge bg-ink-900/50 p-8 text-center text-ink-600">
                      {t("schematics.empty")}
                    </div>
                  )}
              </>
            )}
          </>
        )}

        {isSearch && (
          <>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {results.map((card) => (
                <Card key={card.name} card={card} onOpen={setOpenName} />
              ))}
            </div>
            {!searching && results.length === 0 && (
              <div className="rounded-xl border border-edge bg-ink-900/50 p-8 text-center text-ink-600">
                {t("schematics.noResults")}
              </div>
            )}
            {searching && (
              <div className="flex justify-center p-8 text-ink-600">
                <Loader2 className="animate-spin" />
              </div>
            )}
            {hasNext && !searching && (
              <div className="mt-5 flex justify-center">
                <button
                  onClick={() => runSearch(page + 1)}
                  className="rounded-lg border border-edge px-5 py-2 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
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
