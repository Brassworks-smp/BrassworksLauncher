import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  X,
  Search,
  Download,
  Check,
  Loader2,
  Box,
  Image as ImageIcon,
  Sparkles,
  ExternalLink,
  Users,
  ChevronLeft,
  ChevronDown,
  ListChecks,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { ResultRow, useInfiniteSearch, SEARCH_PAGE } from "./Browse";
import { Markdown, Changelog } from "./Markdown";
import { SegmentedTabs, Collapse, useClosable } from "./ui";
import type {
  ContentSource,
  ContentVersion,
  InstalledMod,
  ProjectDetail,
  SearchHit,
} from "@/lib/types";

type ProjectType = "mod" | "resourcepack" | "shader";
type Source = "modrinth" | "curseforge";

const SOURCES: { id: Source; label: string; color: string }[] = [
  { id: "modrinth", label: "Modrinth", color: "#54e596" },
  { id: "curseforge", label: "CurseForge", color: "#f58c6b" },
];

const keyOf = (h: { source: string; project_id: string }) =>
  `${h.source}:${h.project_id}`;

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

const TABS: { id: ProjectType; label: string; icon: typeof Box }[] = [
  { id: "mod", label: "Mods", icon: Box },
  { id: "resourcepack", label: "Resource Packs", icon: ImageIcon },
  { id: "shader", label: "Shaders", icon: Sparkles },
];

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function AddContentModal({
  instanceId,
  installed,
  lockedIds,
  initial,
  onClose,
  onInstalled,
}: {
  instanceId: string;
  installed: Record<string, string | null>;
  lockedIds?: string[];
  initial?: SearchHit | null;
  onClose: () => void;
  onInstalled: (mod: InstalledMod) => void;
}) {
  const [type, setType] = useState<ProjectType>(
    (initial?.project_type as ProjectType) || "mod",
  );
  const [source, setSource] = useState<Source>(
    (initial?.source as Source) === "curseforge" ? "curseforge" : "modrinth",
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchHit | null>(initial ?? null);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const { closing, close } = useClosable(onClose);
  const openDetail = (hit: SearchHit) => {
    setDir("fwd");
    setSelected(hit);
  };
  const goBack = () => {
    setDir("back");
    setSelected(null);
  };
  const lockedSet = new Set(lockedIds ?? []);
  const detailOnly = !!initial;
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-light");
  const accent =
    source === "curseforge"
      ? isLight
        ? CURSEFORGE_ACCENT_LIGHT
        : CURSEFORGE_ACCENT_DARK
      : isLight
        ? MODRINTH_ACCENT_LIGHT
        : MODRINTH_ACCENT_DARK;

  const fetchPage = useCallback(
    (q: string, offset: number) =>
      api.searchContent(instanceId, q, type, source, offset),
    [instanceId, type, source],
  );
  const { hits, loading, loadingMore, hasMore, error, handleScroll } =
    useInfiniteSearch(fetchPage, query, `${type}:${source}`, {
      enabled: !detailOnly,
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" &&
      (selected && !detailOnly ? goBack() : close());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, selected, detailOnly]);

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="rise flex h-[80vh] w-[780px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl transition-colors"
        style={accent}
      >
        {}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            {selected && (
              <button
                onClick={() => (detailOnly ? close() : goBack())}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:-translate-x-0.5 hover:text-gray-200"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="font-mc text-lg tracking-wide text-gray-100">
              {selected ? selected.title : "Add content"}
            </h2>
            {selected ? (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  selected.source === "curseforge"
                    ? "badge-curseforge"
                    : "badge-modrinth"
                }`}
              >
                {api.sourceLabel(selected.source)}
              </span>
            ) : (
              <SegmentedTabs
                size="sm"
                value={source}
                onChange={(v) => setSource(v as Source)}
                options={SOURCES.map((s) => ({ id: s.id, label: s.label }))}
              />
            )}
          </div>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={17} />
          </button>
        </div>

        <div
          key={selected ? "detail" : "list"}
          className={`flex min-h-0 flex-1 flex-col ${
            dir === "fwd" ? "swap-in" : "swap-in-back"
          }`}
        >
        {selected ? (
          <DetailView
            instanceId={instanceId}
            hit={selected}
            type={type}
            installedVersion={installed[keyOf(selected)]}
            isInstalled={keyOf(selected) in installed}
            locked={lockedSet.has(keyOf(selected))}
            onInstalled={onInstalled}
          />
        ) : (
          <>
            {}
            <div className="flex items-center gap-2 px-5 py-3">
              <SegmentedTabs
                value={type}
                onChange={(v) => setType(v as ProjectType)}
                options={TABS.map(({ id, label, icon: Icon }) => ({
                  id,
                  label,
                  icon: <Icon size={14} />,
                }))}
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
                  placeholder={`Search ${api.sourceLabel(source)} for ${
                    TABS.find((t) => t.id === type)?.label.toLowerCase() ??
                    "content"
                  }…`}
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
                    ? "No results - try a different search."
                    : `Start typing to search ${api.sourceLabel(source)}.`}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {hits.map((hit) => (
                    <ResultRow
                      key={`${hit.source}:${hit.project_id}`}
                      hit={hit}
                      installed={keyOf(hit) in installed}
                      onOpen={() => openDetail(hit)}
                    />
                  ))}
                  {loadingMore && (
                    <div className="grid place-items-center py-3 text-ink-600">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  )}
                  {!hasMore && hits.length >= SEARCH_PAGE && (
                    <div className="py-3 text-center text-[11px] text-ink-600">
                      End of results
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-edge px-5 py-2 text-center text-[11px] text-ink-600">
              Only versions compatible with Minecraft 1.21.1
              {type === "mod" ? " · NeoForge" : ""} are shown.
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function DetailView({
  instanceId,
  hit,
  type,
  installedVersion,
  isInstalled,
  locked,
  onInstalled,
}: {
  instanceId: string;
  hit: SearchHit;
  type: ProjectType;
  installedVersion: string | null | undefined;
  isInstalled: boolean;
  locked: boolean;
  onInstalled: (mod: InstalledMod) => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .contentDetail(instanceId, hit.project_id, hit.source)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e)));
    api
      .contentVersions(instanceId, hit.project_id, type, hit.source)
      .then((v) => alive && setVersions(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [instanceId, hit.project_id, hit.source, type]);

  const latest = versions?.[0];
  const updateAvailable =
    isInstalled && latest && installedVersion !== latest.version_id;

  const install = (versionId?: string) => {
    setBusy(versionId ?? "latest");
    setError(null);
    const p = versionId
      ? api.installContentVersion(
          instanceId,
          hit.project_id,
          versionId,
          type,
          hit.source,
        )
      : api.installContent(instanceId, hit.project_id, type, hit.source);
    p.then((res) => {
      const n = res.dependencies.length;
      toast(
        `Installed ${res.item.name}${
          n ? ` + ${n} ${n === 1 ? "dependency" : "dependencies"}` : ""
        }`,
        "success",
      );
      onInstalled(res.item);
    })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-start gap-4 border-b border-edge px-5 py-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-900 text-ink-600">
          {hit.icon_url ? (
            <img src={hit.icon_url} alt={hit.title} className="h-full w-full object-cover" />
          ) : (
            <Box size={24} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mc text-lg text-gray-100">{hit.title}</h3>
            <button
              onClick={() =>
                api
                  .openExternal(
                    detail?.url ??
                      api.sourceUrl(hit.source, hit.slug || hit.project_id),
                  )
                  .catch(() => {})
              }
              title={`View on ${api.sourceLabel(hit.source)}`}
              className="text-ink-600 hover:text-brass-300"
            >
              <ExternalLink size={14} />
            </button>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">
            {detail?.description ?? hit.description}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-600">
            <Users size={11} /> {fmtDownloads(hit.downloads || detail?.downloads || 0)}{" "}
            downloads
            {latest && (
              <span className="ml-2 font-mono">latest {latest.version_number}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {locked ? (
            <div className="w-32 rounded-md border border-edge bg-ink-850/60 px-3 py-2 text-center text-[11px] leading-snug text-ink-600">
              Managed by the modpack. Unlock it on the Content page to change.
            </div>
          ) : (
            <button
              disabled={!!busy}
              onClick={() => install()}
              className="flex items-center justify-center gap-1.5 rounded-md bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-60"
            >
              {busy === "latest" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : updateAvailable ? (
                <>
                  <Download size={15} /> Update
                </>
              ) : isInstalled ? (
                <>
                  <Check size={15} /> Reinstall
                </>
              ) : (
                <>
                  <Download size={15} /> Add
                </>
              )}
            </button>
          )}
          <button
            onClick={() => setShowVersions((v) => !v)}
            className="flex items-center justify-center gap-1.5 rounded-md border border-edge px-4 py-2 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <ListChecks size={14} /> Versions
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div key={showVersions ? "versions" : "body"} className="swap-in">
          {showVersions ? (
            <VersionList
              instanceId={instanceId}
              projectId={hit.project_id}
              source={hit.source}
              versions={versions}
              installedVersion={installedVersion}
              busy={busy}
              locked={locked}
              onPick={(v) => install(v)}
            />
          ) : detail ? (
            <Markdown>{detail.body || detail.description}</Markdown>
          ) : (
            <div className="grid place-items-center py-10 text-ink-600">
              <Loader2 className="animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionList({
  instanceId,
  projectId,
  source,
  versions,
  installedVersion,
  busy,
  locked,
  onPick,
}: {
  instanceId: string;
  projectId: string;
  source: string;
  versions: ContentVersion[] | null;
  installedVersion: string | null | undefined;
  busy: string | null;
  locked: boolean;
  onPick: (versionId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!versions)
    return (
      <div className="grid place-items-center py-10 text-ink-600">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (versions.length === 0)
    return (
      <div className="py-10 text-center text-sm text-ink-600">
        No compatible versions.
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      {versions.map((v, i) => {
        const isInstalled = installedVersion === v.version_id;
        const expanded = open === v.version_id;
        return (
          <div
            key={v.version_id}
            className="overflow-hidden rounded-md border border-edge bg-ink-850/40"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() =>
                  setOpen(expanded ? null : v.version_id)
                }
                title="Show changelog"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded transition ${
                  expanded
                    ? "bg-brass-500/15 text-brass-300"
                    : "text-ink-600 hover:text-brass-300"
                }`}
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              <button
                onClick={() => setOpen(expanded ? null : v.version_id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[13px] text-gray-100">
                    {v.version_number}
                  </span>
                  {i === 0 && (
                    <span className="rounded bg-brass-500/15 px-1.5 text-[9px] text-brass-300">
                      latest
                    </span>
                  )}
                  {isInstalled && (
                    <span className="rounded bg-patina-500/15 px-1.5 text-[9px] text-patina-400">
                      installed
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-ink-600">
                  {v.game_versions.join(", ")}
                  {v.loaders.length ? ` · ${v.loaders.join(", ")}` : ""}
                </div>
              </button>
              <button
                disabled={!!busy || isInstalled || locked}
                onClick={() => onPick(v.version_id)}
                className="shrink-0 rounded-md bg-brass-500/15 px-3 py-1.5 text-xs font-medium text-brass-300 transition hover:bg-brass-500/25 disabled:opacity-50"
              >
                {busy === v.version_id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : isInstalled ? (
                  "Current"
                ) : (
                  "Install"
                )}
              </button>
            </div>
            <Collapse open={expanded}>
              <Changelog
                instanceId={instanceId}
                projectId={projectId}
                versionId={v.version_id}
                source={source}
                enabled={expanded}
              />
            </Collapse>
          </div>
        );
      })}
    </div>
  );
}
