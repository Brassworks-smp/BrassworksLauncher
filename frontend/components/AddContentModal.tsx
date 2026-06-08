"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ListChecks,
} from "lucide-react";
import * as api from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type {
  ContentVersion,
  InstalledMod,
  ProjectDetail,
  SearchHit,
} from "@/lib/types";

type ProjectType = "mod" | "resourcepack" | "shader";

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
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchHit | null>(initial ?? null);
  const lockedSet = new Set(lockedIds ?? []);
  const reqId = useRef(0);
  const hitsRef = useRef<SearchHit[]>([]);
  hitsRef.current = hits;
  const moreRef = useRef({ hasMore, loadingMore, loading });
  moreRef.current = { hasMore, loadingMore, loading };

  const PAGE = 20;

  const search = useCallback(
    (q: string, t: ProjectType) => {
      if (!api.isTauri()) return;
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      api
        .searchContent(instanceId, q, t, 0)
        .then((res) => {
          if (id !== reqId.current) return;
          setHits(res);
          setHasMore(res.length >= PAGE);
        })
        .catch((e) => id === reqId.current && setError(String(e)))
        .finally(() => id === reqId.current && setLoading(false));
    },
    [instanceId],
  );

  const loadMore = useCallback(() => {
    if (!api.isTauri()) return;
    const id = reqId.current;
    setLoadingMore(true);
    api
      .searchContent(instanceId, query, type, hitsRef.current.length)
      .then((res) => {
        if (id !== reqId.current) return;
        setHits((prev) => {
          const seen = new Set(prev.map((h) => h.project_id));
          return [...prev, ...res.filter((h) => !seen.has(h.project_id))];
        });
        setHasMore(res.length >= PAGE);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [instanceId, query, type]);

  useEffect(() => {
    setHits([]);
    setHasMore(true);
    setLoading(true);
    const h = setTimeout(() => search(query, type), 250);
    return () => clearTimeout(h);
  }, [query, type, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && (selected ? setSelected(null) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, selected]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise flex h-[80vh] w-[780px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        {}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="font-mc text-lg tracking-wide text-gray-100">
              {selected ? selected.title : "Add content"}
            </h2>
            <span className="rounded bg-[#1bd96a]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#54e596]">
              Modrinth
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={17} />
          </button>
        </div>

        {selected ? (
          <DetailView
            instanceId={instanceId}
            hit={selected}
            type={type}
            installedVersion={installed[selected.project_id]}
            isInstalled={selected.project_id in installed}
            locked={lockedSet.has(selected.project_id)}
            onInstalled={onInstalled}
          />
        ) : (
          <>
            {}
            <div className="flex items-center gap-2 px-5 py-3">
              <div className="flex gap-1 rounded-lg border border-edge bg-ink-950/50 p-1">
                {TABS.map(({ id, label, icon: Icon }) => {
                  const active = type === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setType(id)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "bg-brass-500/15 text-brass-300"
                          : "text-ink-600 hover:text-brass-300/80"
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="relative flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search Modrinth for ${
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
              onScroll={(e) => {
                const el = e.currentTarget;
                const near =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 240;
                const s = moreRef.current;
                if (near && s.hasMore && !s.loadingMore && !s.loading) loadMore();
              }}
            >
              {loading ? (
                <div className="grid h-full place-items-center text-ink-600">
                  <Loader2 className="animate-spin" />
                </div>
              ) : hits.length === 0 ? (
                <div className="grid h-full place-items-center text-center text-sm text-ink-600">
                  {query
                    ? "No results — try a different search."
                    : "Start typing to search Modrinth."}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {hits.map((hit) => (
                    <ResultRow
                      key={hit.project_id}
                      hit={hit}
                      installed={hit.project_id in installed}
                      onOpen={() => setSelected(hit)}
                    />
                  ))}
                  {loadingMore && (
                    <div className="grid place-items-center py-3 text-ink-600">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  )}
                  {!hasMore && hits.length >= PAGE && (
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
  );
}

function ResultRow({
  hit,
  installed,
  onOpen,
}: {
  hit: SearchHit;
  installed: boolean;
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
          // eslint-disable-next-line @next/next/no-img-element
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
      .contentDetail(instanceId, hit.project_id)
      .then((d) => alive && setDetail(d))
      .catch(() => {});
    api
      .contentVersions(instanceId, hit.project_id, type)
      .then((v) => alive && setVersions(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [instanceId, hit.project_id, type]);

  const latest = versions?.[0];
  const updateAvailable =
    isInstalled && latest && installedVersion !== latest.version_id;

  const install = (versionId?: string) => {
    setBusy(versionId ?? "latest");
    setError(null);
    const p = versionId
      ? api.installContentVersion(instanceId, hit.project_id, versionId, type)
      : api.installContent(instanceId, hit.project_id, type);
    p.then((mod) => onInstalled(mod))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-start gap-4 border-b border-edge px-5 py-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-900 text-ink-600">
          {hit.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
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
                  .openExternal(api.modrinthUrl(hit.slug || hit.project_id))
                  .catch(() => {})
              }
              title="View on Modrinth"
              className="text-ink-600 hover:text-brass-300"
            >
              <ExternalLink size={14} />
            </button>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">
            {detail?.description ?? hit.description}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-600">
            <Users size={11} /> {fmtDownloads(hit.downloads)} downloads
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
        {showVersions ? (
          <VersionList
            versions={versions}
            installedVersion={installedVersion}
            busy={busy}
            locked={locked}
            onPick={(v) => install(v)}
          />
        ) : detail ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              a: ({href, children, ...props}) => (
                <a
                  href={href}
                  onClick={e => {
                    e.preventDefault();
                    if (href) api.openExternal(href);
                  }}
                  {...props}
                >
                  {children}
                </a>
              ),
            }}
          >
            {detail.body || detail.description}
          </ReactMarkdown>
        ) : (
          <div className="grid place-items-center py-10 text-ink-600">
            <Loader2 className="animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

function VersionList({
  versions,
  installedVersion,
  busy,
  locked,
  onPick,
}: {
  versions: ContentVersion[] | null;
  installedVersion: string | null | undefined;
  busy: string | null;
  locked: boolean;
  onPick: (versionId: string) => void;
}) {
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
        return (
          <div
            key={v.version_id}
            className="flex items-center gap-2 rounded-md border border-edge bg-ink-850/40 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
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
            </div>
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
        );
      })}
    </div>
  );
}
