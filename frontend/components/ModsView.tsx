"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  RefreshCw,
  Search,
  Package,
  Image as ImageIcon,
  Sparkles,
  Box,
  Plus,
  Trash2,
  ExternalLink,
  Lock,
  Unlock,
  History,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import * as api from "@/lib/api";
import { getCachedInfo, setCachedInfo } from "@/lib/modcache";
import type {
  ContentVersion,
  InstalledMod,
  ModInfo,
  SearchHit,
} from "@/lib/types";
import { AddContentModal } from "./AddContentModal";

type CategoryId = "all" | "mods" | "resourcepacks" | "shaderpacks";

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mods", label: "Mods" },
  { id: "resourcepacks", label: "Resource Packs" },
  { id: "shaderpacks", label: "Shaders" },
];

function categoryIcon(category: string, size = 16) {
  if (category === "resourcepacks") return <ImageIcon size={size} />;
  if (category === "shaderpacks") return <Sparkles size={size} />;
  return <Box size={size} />;
}

function projectTypeOf(category: string): string {
  if (category === "resourcepacks") return "resourcepack";
  if (category === "shaderpacks") return "shader";
  return "mod";
}

const ENRICH_CONCURRENCY = 8;

export function ModsView({
  instanceId,
  locked,
  onToggleLock,
}: {
  instanceId: string;
  locked: boolean;
  onToggleLock: () => void;
}) {
  const [mods, setMods] = useState<InstalledMod[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<CategoryId>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<SearchHit | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const applyInfo = useCallback((path: string, info: ModInfo) => {
    setMods((prev) =>
      prev
        ? prev.map((m) =>
            m.path === path
              ? {
                  ...m,
                  title: info.title ?? m.title,
                  description: info.description ?? m.description,
                  icon_url: info.icon_url ?? m.icon_url,
                  version: m.version ?? info.version,
                }
              : m,
          )
        : prev,
    );
  }, []);

  const enrich = useCallback(
    async (list: InstalledMod[]) => {
      const queue = list.filter(
        (m) => m.modrinth_id && (!m.title || !m.icon_url),
      );
      let i = 0;
      const worker = async () => {
        while (i < queue.length) {
          const m = queue[i++];
          try {
            const info = await api.modInfo(
              instanceId,
              m.modrinth_id!,
              m.modrinth_version,
            );
            setCachedInfo(m.modrinth_id!, m.modrinth_version, info);
            applyInfo(m.path, info);
          } catch {
          }
        }
      };
      await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, worker));
    },
    [instanceId, applyInfo],
  );

  const load = useCallback(() => {
    if (!api.isTauri()) {
      setMods([]);
      return;
    }
    setLoading(true);
    api
      .listMods(instanceId)
      .then((list) => {
        const merged = list.map((m) => {
          if (m.modrinth_id) {
            const c = getCachedInfo(m.modrinth_id, m.modrinth_version);
            if (c)
              return {
                ...m,
                title: c.title ?? m.title,
                description: c.description ?? m.description,
                icon_url: c.icon_url ?? m.icon_url,
                version: m.version ?? c.version,
              };
          }
          return m;
        });
        setMods(merged);
        setError(null);
        void enrich(merged);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [instanceId, enrich]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of mods ?? []) c[m.category] = (c[m.category] ?? 0) + 1;
    return c;
  }, [mods]);

  const installedMap = useMemo(() => {
    const r: Record<string, string | null> = {};
    for (const m of mods ?? [])
      if (m.modrinth_id) r[m.modrinth_id] = m.modrinth_version;
    return r;
  }, [mods]);

  const lockedIds = useMemo(
    () =>
      locked
        ? (mods ?? [])
            .filter((m) => m.managed && m.modrinth_id)
            .map((m) => m.modrinth_id!)
        : [],
    [mods, locked],
  );

  const openDetail = (m: InstalledMod) => {
    if (!m.modrinth_id) return;
    setDetail({
      project_id: m.modrinth_id,
      slug: m.modrinth_id,
      title: m.title ?? m.name,
      description: m.description ?? "",
      icon_url: m.icon_url,
      downloads: 0,
      author: "",
      project_type: projectTypeOf(m.category),
      versions: [],
    });
  };

  const filtered = useMemo(() => {
    let list = mods ?? [];
    if (cat !== "all") list = list.filter((m) => m.category === cat);
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (m) =>
          (m.title ?? m.name).toLowerCase().includes(q) ||
          m.filename.toLowerCase().includes(q),
      );
    return [...list].sort((a, b) =>
      (a.title ?? a.name)
        .toLowerCase()
        .localeCompare((b.title ?? b.name).toLowerCase()),
    );
  }, [mods, cat, query]);

  const openFolder = (folder?: string) =>
    api.openDir(instanceId, folder).catch((e) => setError(String(e)));

  const toggle = (mod: InstalledMod) => {
    const next = !mod.enabled;
    setMods((prev) =>
      prev
        ? prev.map((m) => (m.path === mod.path ? { ...m, enabled: next } : m))
        : prev,
    );
    api.setContentEnabled(instanceId, mod.path, next).catch((e) => {
      setError(String(e));
      load();
    });
  };

  const remove = (mod: InstalledMod) => {
    setMods((prev) => (prev ? prev.filter((m) => m.path !== mod.path) : prev));
    api.removeContent(instanceId, mod.path).catch((e) => {
      setError(String(e));
      load();
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">
            Content
          </h1>
          <p className="text-sm text-ink-600">
            {mods ? `${mods.length} installed` : "Loading…"}
            {!locked && (
              <span className="ml-2 text-amber-400/80">· unlocked</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => (locked ? setConfirmUnlock(true) : onToggleLock())}
            title={
              locked
                ? "Unlock to disable / re-version modpack content (pauses auto-updates)"
                : "Lock to restore managed modpack content and auto-updates"
            }
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
              locked
                ? "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300"
            }`}
          >
            {locked ? <Lock size={15} /> : <Unlock size={15} />}
            {locked ? "Locked" : "Unlocked"}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-brass-500 px-3.5 py-2 text-sm font-semibold text-ink-950 shadow-[0_3px_0_var(--color-brass-700)] transition hover:bg-brass-400 active:translate-y-[2px] active:shadow-[0_1px_0_var(--color-brass-700)]"
          >
            <Plus size={16} /> Add content
          </button>
          <button
            onClick={() => openFolder("mods")}
            title="Open mods folder"
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={15} /> Folder
          </button>
          <button
            onClick={load}
            title="Refresh"
            className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-edge bg-ink-900/50 p-1">
          {CATEGORIES.map((c) => {
            const active = cat === c.id;
            const n = c.id === "all" ? mods?.length ?? 0 : counts[c.id] ?? 0;
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-brass-500/15 text-brass-300"
                    : "text-ink-600 hover:text-brass-300/80"
                }`}
              >
                {c.label}
                <span className="ml-1.5 tabular-nums text-ink-600">{n}</span>
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search content…"
            className="w-full rounded-lg bg-ink-900/50 py-2 pl-9 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {filtered.map((m) => (
          <ModRow
            key={m.path}
            instanceId={instanceId}
            mod={m}
            unlocked={!locked}
            onToggle={() => toggle(m)}
            onRemove={() => remove(m)}
            onChanged={load}
            onError={setError}
            onOpenDetail={() => openDetail(m)}
          />
        ))}
        {mods && filtered.length === 0 && (
          <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
            <div>
              <Package size={28} className="mx-auto mb-2 opacity-50" />
              {mods.length === 0
                ? "Nothing installed yet — press Play to install the modpack."
                : "No content matches your search."}
            </div>
          </div>
        )}
      </div>

      {(adding || detail) && (
        <AddContentModal
          instanceId={instanceId}
          installed={installedMap}
          lockedIds={lockedIds}
          initial={detail}
          onClose={() => {
            setAdding(false);
            setDetail(null);
          }}
          onInstalled={() => load()}
        />
      )}

      {confirmUnlock && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setConfirmUnlock(false)}
        >
          <div className="rise w-[440px] max-w-full rounded-xl border border-amber-500/30 bg-ink-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-amber-300">
              <AlertTriangle size={20} />
              <h2 className="font-mc text-lg tracking-wide">Unlock the modpack?</h2>
            </div>
            <p className="text-sm leading-relaxed text-ink-600">
              Unlocking lets you disable and change modpack mods, and{" "}
              <span className="text-amber-300/90">pauses automatic updates</span>.
              This may break your modpack and{" "}
              <span className="text-amber-300/90">
                prevent you from joining Brassworks
              </span>
              . Lock it again to restore the modpack and updates.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmUnlock(false)}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmUnlock(false);
                  onToggleLock();
                }}
                className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-amber-400"
              >
                <Unlock size={15} /> Unlock anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModRow({
  instanceId,
  mod,
  unlocked,
  onToggle,
  onRemove,
  onChanged,
  onError,
  onOpenDetail,
}: {
  instanceId: string;
  mod: InstalledMod;
  unlocked: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onChanged: () => void;
  onError: (e: string) => void;
  onOpenDetail: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const title = mod.title ?? mod.name;
  const hasModrinth = !!mod.modrinth_id;
  const controllable = !mod.managed || unlocked;
  const canVersion = hasModrinth && controllable;
  const open = () => hasModrinth && onOpenDetail();

  return (
    <div
      className={`rounded-lg border transition ${
        mod.enabled
          ? "border-edge bg-ink-800 hover:border-brass-600/40 hover:bg-brass-500/[0.04]"
          : "border-edge/60 bg-ink-900/40 opacity-60 hover:opacity-100"
      }`}
    >
      <div className="flex items-center gap-3 p-2.5">
        <button
          onClick={open}
          disabled={!hasModrinth}
          title={hasModrinth ? "View on Modrinth" : undefined}
          className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-ink-600 disabled:cursor-default"
        >
          {mod.icon_url && !iconFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mod.icon_url}
              alt={title}
              className="h-full w-full object-cover"
              onError={() => setIconFailed(true)}
            />
          ) : (
            categoryIcon(mod.category)
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={open}
              disabled={!hasModrinth}
              className={`truncate text-sm font-medium text-gray-100 ${
                hasModrinth ? "hover:text-brass-300" : "cursor-default"
              }`}
            >
              {title}
            </button>
            {mod.version && (
              <span className="shrink-0 font-mono text-[11px] text-ink-600/80">
                {mod.version}
              </span>
            )}
            {hasModrinth && (
              <ExternalLink size={10} className="shrink-0 text-ink-600" />
            )}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-600">
            {hasModrinth && (
              <span className="shrink-0 rounded bg-[#1bd96a]/15 px-1.5 text-[9px] font-medium text-[#54e596]">
                Modrinth
              </span>
            )}
            <span className="truncate">{mod.description || mod.filename}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {mod.managed && (
            <span
              title={
                unlocked
                  ? "Modpack content (unlocked)"
                  : "Part of the modpack — managed automatically"
              }
              className="rounded-md border border-edge bg-ink-900/60 px-2 py-1 text-[10px] uppercase tracking-wide text-ink-600"
            >
              Modpack
            </span>
          )}
          {canVersion && (
            <button
              onClick={() => setShowVersions((v) => !v)}
              title="Change version"
              className={`grid h-8 w-8 place-items-center rounded-md transition ${
                showVersions
                  ? "bg-brass-500/15 text-brass-300"
                  : "text-ink-600 hover:bg-ink-700 hover:text-brass-300"
              }`}
            >
              <History size={15} />
            </button>
          )}
          {!mod.managed && (
            <button
              onClick={onRemove}
              title="Remove"
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={14} />
            </button>
          )}
          {controllable && <RowToggle checked={mod.enabled} onChange={onToggle} />}
        </div>
      </div>

      {showVersions && canVersion && (
        <RowVersions
          instanceId={instanceId}
          mod={mod}
          onError={onError}
          onPicked={() => {
            setShowVersions(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function RowVersions({
  instanceId,
  mod,
  onError,
  onPicked,
}: {
  instanceId: string;
  mod: InstalledMod;
  onError: (e: string) => void;
  onPicked: () => void;
}) {
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const projectType = projectTypeOf(mod.category);

  useEffect(() => {
    let alive = true;
    api
      .contentVersions(instanceId, mod.modrinth_id!, projectType)
      .then((v) => alive && setVersions(v))
      .catch((e) => alive && onError(String(e)));
    return () => {
      alive = false;
    };
  }, [instanceId, mod.modrinth_id, projectType, onError]);

  const pick = (versionId: string) => {
    setBusy(versionId);
    api
      .installContentVersion(instanceId, mod.modrinth_id!, versionId, projectType)
      .then(() => onPicked())
      .catch((e) => {
        onError(String(e));
        setBusy(null);
      });
  };

  return (
    <div className="border-t border-edge/60 px-3 py-2">
      {!versions ? (
        <div className="flex items-center gap-2 py-2 text-xs text-ink-600">
          <Loader2 size={13} className="animate-spin" /> Loading versions…
        </div>
      ) : versions.length === 0 ? (
        <div className="py-2 text-xs text-ink-600">No compatible versions.</div>
      ) : (
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {versions.map((v, i) => {
            const isCurrent = mod.modrinth_version === v.version_id;
            return (
              <div
                key={v.version_id}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-ink-700/40"
              >
                <span className="flex-1 truncate font-mono text-[12px] text-gray-200">
                  {v.version_number}
                </span>
                {i === 0 && (
                  <span className="rounded bg-brass-500/15 px-1.5 text-[9px] text-brass-300">
                    latest
                  </span>
                )}
                <button
                  disabled={!!busy || isCurrent}
                  onClick={() => pick(v.version_id)}
                  className="rounded bg-brass-500/15 px-2.5 py-1 text-[11px] font-medium text-brass-300 transition hover:bg-brass-500/25 disabled:opacity-50"
                >
                  {busy === v.version_id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : isCurrent ? (
                    "Current"
                  ) : (
                    "Install"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RowToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      title={checked ? "Disable" : "Enable"}
      className={`relative h-6 w-11 shrink-0 border-2 transition-colors ${
        checked ? "border-brass-700 bg-brass-500/80" : "border-ink-700 bg-ink-900"
      }`}
      style={{ borderRadius: 3 }}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] border-2 transition-all ${
          checked
            ? "left-[24px] border-brass-300 bg-brass-400"
            : "left-[2px] border-ink-600 bg-ink-700"
        }`}
        style={{ borderRadius: 2 }}
      />
    </button>
  );
}
