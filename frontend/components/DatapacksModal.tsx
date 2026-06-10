import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  X,
  Search,
  Loader2,
  Boxes,
  ChevronLeft,
  Trash2,
  Download,
  PackageOpen,
  FolderOpen,
  ExternalLink,
  Users,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useInfiniteSearch, ResultRow, SourceBadge } from "./Browse";
import { VersionList } from "./VersionList";
import { SegmentedTabs, BrassSwitch, useClosable } from "./ui";
import type {
  ContentVersion,
  DatapackInfo,
  ProjectDetail,
  SearchHit,
  WorldInfo,
} from "@/lib/types";

type Tab = "installed" | "browse";
type Source = "modrinth" | "curseforge";

const CURSEFORGE_ACCENT_DARK: CSSProperties = {
  ["--color-brass-300" as string]: "#ffb591",
  ["--color-brass-400" as string]: "#f58c6b",
  ["--color-brass-500" as string]: "#f16436",
  ["--color-brass-600" as string]: "#d8521f",
  ["--color-brass-700" as string]: "#a83f17",
};
const CURSEFORGE_ACCENT_LIGHT: CSSProperties = {
  ["--color-brass-300" as string]: "#c2410c",
  ["--color-brass-400" as string]: "#c2410c",
  ["--color-brass-500" as string]: "#ea580c",
  ["--color-brass-600" as string]: "#c2410c",
  ["--color-brass-700" as string]: "#9a3412",
};

const MODRINTH_ACCENT_DARK: CSSProperties = {
  ["--color-brass-300" as string]: "#5fe393",
  ["--color-brass-400" as string]: "#34d27a",
  ["--color-brass-500" as string]: "#1fbf63",
  ["--color-brass-600" as string]: "#18a153",
  ["--color-brass-700" as string]: "#14803f",
};
const MODRINTH_ACCENT_LIGHT: CSSProperties = {
  ["--color-brass-300" as string]: "#15803d",
  ["--color-brass-400" as string]: "#15803d",
  ["--color-brass-500" as string]: "#1bbf5f",
  ["--color-brass-600" as string]: "#15a34a",
  ["--color-brass-700" as string]: "#0e7a37",
};

const dpKey = (source?: string | null, projectId?: string | null) =>
  `${source}:${projectId}`;

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** Synthesize a SearchHit from a tracked installed datapack so it can re-open
 *  its detail/version page. */
function hitFromInstalled(d: DatapackInfo): SearchHit | null {
  if (!d.source || !d.project_id) return null;
  return {
    project_id: d.project_id,
    slug: d.project_id,
    title: d.title ?? d.name,
    description: d.description ?? "",
    icon_url: d.icon_url,
    downloads: 0,
    author: "",
    project_type: "datapack",
    versions: [],
    source: d.source as SearchHit["source"],
  };
}

/**
 * Per-world datapack manager — manage what's installed (with provider/logo +
 * one-click re-open to change version) and browse/install datapacks from
 * Modrinth or CurseForge into that world's `datapacks/` folder.
 */
export function DatapacksModal({
  instanceId,
  world,
  onClose,
}: {
  instanceId: string;
  world: WorldInfo;
  onClose: () => void;
}) {
  const { closing, close } = useClosable(onClose);
  const [tab, setTab] = useState<Tab>("installed");
  const [source, setSource] = useState<Source>("modrinth");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");

  const [installed, setInstalled] = useState<DatapackInfo[] | null>(null);
  const refresh = useCallback(() => {
    api
      .listDatapacks(instanceId, world.folder)
      .then(setInstalled)
      .catch(() => setInstalled([]));
  }, [instanceId, world.folder]);
  useEffect(refresh, [refresh]);

  const installedByKey = new Map(
    (installed ?? [])
      .filter((d) => d.project_id)
      .map((d) => [dpKey(d.source, d.project_id), d] as const),
  );

  const fetchPage = useCallback(
    (q: string, offset: number) =>
      api.searchContent(instanceId, q, "datapack", source, offset),
    [instanceId, source],
  );
  const { hits, loading, loadingMore, hasMore, error, handleScroll } =
    useInfiniteSearch(fetchPage, query, source, { enabled: tab === "browse" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) {
        setDir("back");
        setSelected(null);
      } else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, selected]);

  const open = (hit: SearchHit) => {
    setDir("fwd");
    setSelected(hit);
  };
  const back = () => {
    setDir("back");
    setSelected(null);
  };

  // Only the Browse flow gets a source-branded accent (Modrinth green /
  // CurseForge orange). The Installed tab keeps the global accent.
  const accentSource =
    tab === "browse" ? (selected ? selected.source : source) : null;
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-light");
  const accent =
    accentSource === "curseforge"
      ? isLight
        ? CURSEFORGE_ACCENT_LIGHT
        : CURSEFORGE_ACCENT_DARK
      : accentSource === "modrinth"
        ? isLight
          ? MODRINTH_ACCENT_LIGHT
          : MODRINTH_ACCENT_DARK
        : undefined;

  const selectedInstalled = selected
    ? installedByKey.get(dpKey(selected.source, selected.project_id))
    : undefined;

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={accent}
        className="flex h-[80vh] w-[760px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl transition-colors"
      >
        <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {selected && (
              <button
                onClick={back}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:-translate-x-0.5 hover:bg-ink-800 hover:text-gray-200"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <Boxes size={17} className="shrink-0 text-brass-400" />
            <h2 className="truncate font-mc text-base tracking-wide text-gray-100">
              {selected ? selected.title : "Datapacks"}
            </h2>
            {selected ? (
              <SourceBadge source={selected.source} />
            ) : (
              <span className="shrink-0 truncate text-xs text-ink-600">
                · {world.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!selected && (
              <SegmentedTabs
                size="sm"
                value={tab}
                onChange={(v) => setTab(v as Tab)}
                options={[
                  { id: "installed", label: "Installed" },
                  { id: "browse", label: "Browse" },
                ]}
              />
            )}
            <button
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        <div
          key={selected ? `detail:${selected.source}:${selected.project_id}` : tab}
          className={`flex min-h-0 flex-1 flex-col ${
            dir === "fwd" ? "swap-in" : "swap-in-back"
          }`}
        >
          {selected ? (
            <DatapackDetail
              instanceId={instanceId}
              world={world.folder}
              hit={selected}
              installedVersionId={selectedInstalled?.version_id ?? null}
              onInstalled={() => {
                refresh();
                toast(`Updated in ${world.name}`, "success");
                back();
              }}
            />
          ) : tab === "installed" ? (
            <InstalledList
              instanceId={instanceId}
              world={world.folder}
              items={installed}
              onChanged={refresh}
              onBrowse={() => setTab("browse")}
              onOpen={(d) => {
                const hit = hitFromInstalled(d);
                if (hit) open(hit);
              }}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 px-5 py-3">
                <SegmentedTabs
                  size="sm"
                  value={source}
                  onChange={(v) => setSource(v as Source)}
                  options={[
                    { id: "modrinth", label: "Modrinth" },
                    { id: "curseforge", label: "CurseForge" },
                  ]}
                />
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
                  />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${api.sourceLabel(source)} datapacks…`}
                    className="w-full rounded-lg bg-ink-950/60 py-2 pl-9 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
                  />
                </div>
              </div>
              {error && (
                <div className="mx-5 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
              <div
                className="flex-1 overflow-y-auto px-5 pb-5"
                onScroll={handleScroll}
              >
                {loading ? (
                  <div className="grid h-full place-items-center text-ink-600">
                    <Loader2 className="animate-spin" />
                  </div>
                ) : hits.length === 0 ? (
                  <div className="grid h-full place-items-center text-center text-sm text-ink-600">
                    {query
                      ? "No datapacks found - try a different search."
                      : `Start typing to search ${api.sourceLabel(source)}.`}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {hits.map((hit) => (
                      <ResultRow
                        key={`${hit.source}:${hit.project_id}`}
                        hit={hit}
                        showSource
                        installed={installedByKey.has(
                          dpKey(hit.source, hit.project_id),
                        )}
                        onOpen={() => open(hit)}
                      />
                    ))}
                    {loadingMore && (
                      <div className="grid place-items-center py-3 text-ink-600">
                        <Loader2 size={18} className="animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InstalledList({
  instanceId,
  world,
  items,
  onChanged,
  onBrowse,
  onOpen,
}: {
  instanceId: string;
  world: string;
  items: DatapackInfo[] | null;
  onChanged: () => void;
  onBrowse: () => void;
  onOpen: (d: DatapackInfo) => void;
}) {
  if (items === null)
    return (
      <div className="grid flex-1 place-items-center text-ink-600">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (items.length === 0)
    return (
      <div className="grid flex-1 place-items-center px-6 text-center text-ink-600">
        <div>
          <PackageOpen size={30} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No datapacks in this world yet.</p>
          <button
            onClick={onBrowse}
            className="brass-btn mt-3 inline-flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            <Download size={15} /> Browse datapacks
          </button>
        </div>
      </div>
    );

  const toggle = (d: DatapackInfo) =>
    api
      .setDatapackEnabled(instanceId, world, d.filename, !d.enabled)
      .then(onChanged)
      .catch(() => {});
  const remove = (d: DatapackInfo) =>
    api.removeDatapack(instanceId, world, d.filename).then(onChanged).catch(() => {});

  return (
    <div className="stagger flex flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
      {items.map((d) => {
        const fromSource = !!d.project_id && !!d.source;
        return (
          <div
            key={d.filename}
            className={`group flex items-center gap-3 rounded-lg border border-edge p-2.5 transition ${
              d.enabled
                ? "bg-ink-800 hover:border-brass-600/40"
                : "bg-ink-900/40 opacity-60 hover:opacity-100"
            }`}
          >
            <button
              onClick={() => fromSource && onOpen(d)}
              disabled={!fromSource}
              title={fromSource ? "View / change version" : undefined}
              className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-brass-400 disabled:cursor-default"
            >
              {d.icon_url ? (
                <img src={d.icon_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Boxes size={16} />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => fromSource && onOpen(d)}
                  disabled={!fromSource}
                  className={`truncate text-sm text-gray-100 ${
                    fromSource ? "hover:text-brass-300" : "cursor-default"
                  }`}
                >
                  {d.name}
                </button>
                {fromSource && <SourceBadge source={d.source!} />}
                {fromSource && (
                  <ExternalLink size={10} className="shrink-0 text-ink-600" />
                )}
              </div>
              <div className="truncate text-[11px] text-ink-600">
                {d.is_dir ? "folder" : api.formatBytes(d.size_bytes)}
                {!d.enabled && " · disabled"}
              </div>
            </div>
            <button
              onClick={() => remove(d)}
              title="Remove"
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={14} />
            </button>
            <BrassSwitch checked={d.enabled} onChange={() => toggle(d)} />
          </div>
        );
      })}
      <button
        onClick={() => api.openDir(instanceId, `saves/${world}/datapacks`).catch(() => {})}
        className="mt-1 flex items-center justify-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
      >
        <FolderOpen size={13} /> Open folder
      </button>
    </div>
  );
}

function DatapackDetail({
  instanceId,
  world,
  hit,
  installedVersionId,
  onInstalled,
}: {
  instanceId: string;
  world: string;
  hit: SearchHit;
  installedVersionId: string | null;
  onInstalled: () => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .contentDetail(instanceId, hit.project_id, hit.source)
      .then((d) => alive && setDetail(d))
      .catch(() => {});
    api
      .contentVersions(instanceId, hit.project_id, "datapack", hit.source)
      .then((v) => alive && setVersions(v))
      .catch(() => alive && setVersions([]));
    return () => {
      alive = false;
    };
  }, [instanceId, hit.project_id, hit.source]);

  const latest = versions?.[0];
  const updateAvailable =
    !!installedVersionId && !!latest && latest.version_id !== installedVersionId;

  const install = (versionId: string) => {
    setBusy(true);
    api
      .installDatapack(instanceId, world, hit.source, hit.project_id, versionId)
      .then(() => onInstalled())
      .catch((e) => toast(String(e), "error"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-start gap-4 border-b border-edge px-5 py-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-900 text-ink-600">
          {hit.icon_url ? (
            <img src={hit.icon_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Boxes size={22} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mc text-lg text-gray-100">{hit.title}</h3>
            {detail?.url && (
              <button
                onClick={() => api.openExternal(detail.url!).catch(() => {})}
                title={`View on ${api.sourceLabel(hit.source)}`}
                className="text-ink-600 hover:text-brass-300"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">
            {detail?.description ?? hit.description}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-600">
            <Users size={11} />
            {fmtDownloads(detail?.downloads ?? hit.downloads ?? 0)} downloads
            {latest && (
              <span className="ml-1 font-mono">latest {latest.version_number}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            {installedVersionId && (
              <span className="rounded bg-patina-500/15 px-1.5 py-0.5 text-patina-400">
                Installed
              </span>
            )}
            {updateAvailable && (
              <span className="rounded bg-brass-500/15 px-1.5 py-0.5 text-brass-300">
                Update available
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {versions === null ? (
          <div className="grid place-items-center py-10 text-ink-600">
            <Loader2 className="animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-600">
            No compatible datapack versions.
          </div>
        ) : (
          <VersionList
            instanceId={instanceId}
            projectId={hit.project_id}
            source={hit.source}
            versions={versions}
            actionLabel={installedVersionId ? "Switch" : "Add"}
            busy={busy}
            currentVersionId={installedVersionId}
            onPick={install}
          />
        )}
      </div>
    </div>
  );
}
