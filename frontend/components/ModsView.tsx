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
  ArrowUpCircle,
  Check,
  X,
  FileDown,
  Share2,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { SegmentedTabs, Collapse, Skeleton } from "./ui";
import { VersionList } from "./VersionList";
import { getCachedInfo, setCachedInfo } from "@/lib/modcache";
import type {
  ContentVersion,
  InstalledMod,
  LoaderKind,
  ModInfo,
  SearchHit,
} from "@/lib/types";
import { AddContentModal, type ProjectType, type Source } from "./AddContentModal";
import { ExportContentModal } from "./ExportContentModal";

type CategoryId = "all" | "mods" | "resourcepacks" | "shaderpacks";

const CATEGORIES: { id: CategoryId; tkey: string }[] = [
  { id: "all", tkey: "mods.all" },
  { id: "mods", tkey: "mods.catMods" },
  { id: "resourcepacks", tkey: "mods.catResourcePacks" },
  { id: "shaderpacks", tkey: "mods.catShaders" },
];

function categoryIcon(category: string, size = 16) {
  if (category === "resourcepacks") return <ImageIcon size={size} />;
  if (category === "shaderpacks") return <Sparkles size={size} />;
  return <Box size={size} />;
}

function projectTypeOf(category: string): ProjectType {
  if (category === "resourcepacks") return "resourcepack";
  if (category === "shaderpacks") return "shader";
  return "mod";
}

const ENRICH_CONCURRENCY = 8;


const modsCache = new Map<string, InstalledMod[]>();


function mergeCached(list: InstalledMod[]): InstalledMod[] {
  return list.map((m) => {
    if (m.project_id) {
      const c = getCachedInfo(m.source, m.project_id, m.version_id);
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
}


const dupKey = (id: string) => `bw:dupDismissed:${id}`;
function getDupDismissed(id: string): string | null {
  try {
    return localStorage.getItem(dupKey(id));
  } catch {
    return null;
  }
}
function storeDupDismissed(id: string, sig: string) {
  try {
    localStorage.setItem(dupKey(id), sig);
  } catch {
  }
}

function ContentSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-edge bg-ink-900/50 p-2.5"
        >
          <Skeleton className="h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-6 w-11 rounded-[4px]" />
        </div>
      ))}
    </div>
  );
}

export function ModsView({
  instanceId,
  packName,
  mc,
  loader,
  locked,
  shared,
  onToggleLock,
}: {
  instanceId: string;
  packName?: string;
  mc: string;
  loader: LoaderKind;
  locked: boolean;
  shared?: boolean;
  onToggleLock: () => void;
}) {
  const t = useT();
  const [mods, setMods] = useState<InstalledMod[] | null>(
    () => modsCache.get(instanceId) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<CategoryId>("all");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "modrinth" | "curseforge" | "local"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [originFilter, setOriginFilter] = useState<"all" | "modpack" | "user">(
    "all",
  );
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<SearchHit | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [confirmUpdateAll, setConfirmUpdateAll] = useState(false);
  const [unlockClosing, setUnlockClosing] = useState(false);
  const [updateAllClosing, setUpdateAllClosing] = useState(false);
  const closeUnlock = () => {
    setUnlockClosing(true);
    setTimeout(() => {
      setConfirmUnlock(false);
      setUnlockClosing(false);
    }, 190);
  };
  const closeUpdateAll = () => {
    setUpdateAllClosing(true);
    setTimeout(() => {
      setConfirmUpdateAll(false);
      setUpdateAllClosing(false);
    }, 190);
  };
  const [updatingAll, setUpdatingAll] = useState(false);
  const [dupDismissed, setDupDismissed] = useState<string | null>(() =>
    getDupDismissed(instanceId),
  );
  useEffect(() => {
    setDupDismissed(getDupDismissed(instanceId));
  }, [instanceId]);

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
        (m) => m.project_id && (!m.title || !m.icon_url),
      );
      let i = 0;
      const worker = async () => {
        while (i < queue.length) {
          const m = queue[i++];
          try {
            const info = await api.modInfo(
              instanceId,
              m.source,
              m.project_id!,
              m.version_id,
            );
            setCachedInfo(m.source, m.project_id!, m.version_id, info);
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
    const cached = modsCache.get(instanceId);
    if (cached) setMods(cached);
    else {
      setMods(null);
      setLoading(true);
    }
    api
      .listMods(instanceId)
      .then((list) => {
        const merged = mergeCached(list);
        modsCache.set(instanceId, merged);
        setMods(merged);
        setError(null);
        enrich(merged)
          .then(() => modsCache.set(instanceId, mergeCached(list)))
          .catch(() => {});
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
      if (m.project_id) r[`${m.source}:${m.project_id}`] = m.version_id;
    return r;
  }, [mods]);

  const lockedIds = useMemo(
    () =>
      locked
        ? (mods ?? [])
            .filter((m) => m.managed && m.project_id)
            .map((m) => `${m.source}:${m.project_id}`)
        : [],
    [mods, locked],
  );

  const openDetail = (m: InstalledMod) => {
    if (!m.project_id) return;
    setDetail({
      project_id: m.project_id,
      slug: m.project_id,
      title: m.title ?? m.name,
      description: m.description ?? "",
      icon_url: m.icon_url,
      downloads: 0,
      author: "",
      project_type: projectTypeOf(m.category),
      versions: [],
      source: m.source === "local" ? "modrinth" : m.source,
    });
  };

  const filtered = useMemo(() => {
    let list = mods ?? [];
    if (cat !== "all") list = list.filter((m) => m.category === cat);
    if (sourceFilter !== "all")
      list = list.filter((m) => m.source === sourceFilter);
    if (statusFilter !== "all")
      list = list.filter((m) =>
        statusFilter === "enabled" ? m.enabled : !m.enabled,
      );
    if (originFilter !== "all")
      list = list.filter((m) =>
        originFilter === "modpack" ? m.managed : !m.managed,
      );
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
  }, [mods, cat, query, sourceFilter, statusFilter, originFilter]);

  const RENDER_BATCH = 40;
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  useEffect(() => {
    setRenderLimit(RENDER_BATCH);
  }, [cat, query, sourceFilter, statusFilter, originFilter, instanceId]);
  useEffect(() => {
    if (renderLimit >= filtered.length) return;
    const raf = requestAnimationFrame(() =>
      setRenderLimit((n) => n + RENDER_BATCH),
    );
    return () => cancelAnimationFrame(raf);
  }, [renderLimit, filtered.length]);
  const shown = useMemo(
    () => filtered.slice(0, renderLimit),
    [filtered, renderLimit],
  );

  const conflicts = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    for (const m of mods ?? []) {
      if (!m.enabled) continue;
      const base = m.filename
        .replace(/\.(jar|zip)(\.disabled)?$/i, "")
        .replace(/[-_ ]?v?\d[\d.+]*$/i, "")
        .replace(/[-_ ]?(mc)?1\.\d+(\.\d+)?$/i, "")
        .trim()
        .toLowerCase();
      if (!base) continue;
      const key = `${m.category}:${base}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)!.add(m.title ?? m.name);
    }
    return [...groups.values()]
      .filter((s) => s.size > 1)
      .map((s) => [...s]);
  }, [mods]);

  const conflictKey = useMemo(
    () => conflicts.map((g) => g.join("|")).join(";"),
    [conflicts],
  );
  const showDup = conflicts.length > 0 && dupDismissed !== conflictKey;

  const userMods = useMemo(
    () => (mods ?? []).filter((m) => !m.managed && m.project_id),
    [mods],
  );
  const userContentCount = userMods.length;
  const [updateSel, setUpdateSel] = useState<Set<string>>(new Set());

  const openUpdatePicker = () => {
    setUpdateSel(new Set(userMods.map((m) => `${m.source}:${m.project_id}`)));
    setConfirmUpdateAll(true);
  };

  const runUpdate = () => {
    const keys = [...updateSel];
    closeUpdateAll();
    if (keys.length === 0) return;
    setUpdatingAll(true);
    toast(t("mods.checkingUpdates", { count: keys.length }), "info");
    api
      .updateSelectedContent(instanceId, keys)
      .then((names) => {
        if (names.length === 0) toast(t("mods.upToDate"), "info");
        else
          toast(
            t("mods.updatedMods", {
              count: names.length,
              names: names.join(", "),
            }),
            "success",
          );
        load();
      })
      .catch((e) => {
        setError(String(e));
        toast(t("mods.updateFailed"), "error");
      })
      .finally(() => setUpdatingAll(false));
  };

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
    <div className="flex flex-1 flex-col overflow-hidden px-1 -mx-1">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">
            {t("mods.title")}
          </h1>
          <p className="text-sm text-ink-600">
            {mods ? t("mods.installed", { count: mods.length }) : t("common.loading")}
            {!locked && !shared && (
              <span className="ml-2 text-amber-400/80">{t("mods.unlocked")}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {shared ? (
            <span
              title={t("mods.sharedPackHint")}
              className="flex items-center gap-2 rounded-lg border border-brass-600/40 bg-brass-500/10 px-3 py-2 text-sm text-brass-200"
            >
              <Share2 size={15} />
              {t("mods.sharedPack")}
            </span>
          ) : (
            <button
              onClick={() => (locked ? setConfirmUnlock(true) : onToggleLock())}
              title={locked ? t("mods.unlockTitle") : t("mods.lockedTitle")}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                locked
                  ? "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}
            >
              {locked ? <Lock size={15} /> : <Unlock size={15} />}
              {locked ? t("mods.locked") : t("mods.unlockedBtn")}
            </button>
          )}
          <button
            onClick={openUpdatePicker}
            disabled={updatingAll || userContentCount === 0}
            title={t("mods.updateAllTitle")}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {updatingAll ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowUpCircle size={15} />
            )}
            {t("mods.updateAll")}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            <Plus size={16} /> {t("mods.addContent")}
          </button>
          <button
            onClick={() => setExporting(true)}
            disabled={!mods || mods.length === 0}
            title={t("exportContent.title")}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileDown size={15} /> {t("exportContent.export")}
          </button>
          <button
            onClick={() => openFolder("mods")}
            title={t("mods.openFolderTitle")}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={15} /> {t("mods.folder")}
          </button>
          <button
            onClick={load}
            title={t("common.refresh")}
            className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <SegmentedTabs
          value={cat}
          onChange={(v) => setCat(v as CategoryId)}
          options={CATEGORIES.map((c) => {
            const n = c.id === "all" ? mods?.length ?? 0 : counts[c.id] ?? 0;
            return {
              id: c.id,
              label: (
                <>
                  {t(c.tkey)}
                  <span className="ml-1.5 tabular-nums text-ink-600">{n}</span>
                </>
              ),
            };
          })}
        />
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mods.searchPlaceholder")}
            className="w-full rounded-lg bg-ink-900/50 py-2 pl-9 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <Segmented
          label={t("mods.sourceLabel")}
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
          options={[
            { id: "all", label: t("mods.all") },
            { id: "modrinth", label: t("mods.modrinth") },
            { id: "curseforge", label: t("mods.curseforge") },
            { id: "local", label: t("mods.local") },
          ]}
        />
        <Segmented
          label={t("mods.statusLabel")}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          options={[
            { id: "all", label: t("mods.all") },
            { id: "enabled", label: t("mods.enabled") },
            { id: "disabled", label: t("mods.disabled") },
          ]}
        />
        <Segmented
          label={t("mods.originLabel")}
          value={originFilter}
          onChange={(v) => setOriginFilter(v as typeof originFilter)}
          options={[
            { id: "all", label: t("mods.all") },
            { id: "modpack", label: t("mods.modpack") },
            { id: "user", label: t("mods.addedByYou") },
          ]}
        />
      </div>

      {showDup && (
        <div className="dup-warn mb-3 rounded-lg border px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={13} /> {t("mods.dupDetected")}
            <button
              onClick={() => {
                setDupDismissed(conflictKey);
                storeDupDismissed(instanceId, conflictKey);
              }}
              title={t("mods.dismiss")}
              className="ml-auto -mr-1 grid h-5 w-5 place-items-center rounded transition hover:bg-amber-500/20"
            >
              <X size={13} />
            </button>
          </div>
          <ul className="dup-warn-list mt-1 list-disc pl-5">
            {conflicts.map((g, i) => (
              <li key={i}>{g.join("  ·  ")}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto pr-1">
        {mods === null ? (
          <ContentSkeleton />
        ) : (
        <div
          key={`${cat}:${sourceFilter}:${statusFilter}:${originFilter}`}
          className="reveal-down flex flex-1 flex-col gap-2"
        >
        {shown.map((m) => (
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
        {renderLimit < filtered.length && (
          <div className="flex items-center justify-center py-3 text-ink-600">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {mods && filtered.length === 0 && (
          <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
            <div>
              <Package size={28} className="mx-auto mb-2 opacity-50" />
              {mods.length === 0
                ? t("mods.emptyInstall")
                : t("mods.emptySearch")}
            </div>
          </div>
        )}
        </div>
        )}
      </div>

      {(adding || detail) && (
        <AddContentModal
          instanceId={instanceId}
          mc={mc}
          loader={loader}
          installed={installedMap}
          lockedIds={lockedIds}
          initial={detail}
          initialType={projectTypeOf(cat)}
          initialSource={
            sourceFilter === "curseforge"
              ? ("curseforge" as Source)
              : sourceFilter === "modrinth"
                ? ("modrinth" as Source)
                : undefined
          }
          onClose={() => {
            setAdding(false);
            setDetail(null);
          }}
          onInstalled={() => load()}
          onUnlock={
            locked
              ? () => {
                  setAdding(false);
                  setDetail(null);
                  setConfirmUnlock(true);
                }
              : undefined
          }
        />
      )}

      {exporting && mods && (
        <ExportContentModal
          packName={packName?.trim() || t("mods.title")}
          instanceId={instanceId}
          mods={mods}
          onClose={() => setExporting(false)}
        />
      )}

      {confirmUnlock && (
        <div
          className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
            unlockClosing ? "modal-overlay-out" : ""
          }`}
          onMouseDown={(e) => e.target === e.currentTarget && closeUnlock()}
        >
          <div className="rise w-[440px] max-w-full rounded-xl border border-amber-500/30 bg-ink-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-amber-300">
              <AlertTriangle size={20} />
              <h2 className="font-mc text-lg tracking-wide">{t("mods.unlockTitleModal")}</h2>
            </div>
            <p className="text-sm leading-relaxed text-ink-600">
              {t("mods.unlockBody1")}
              <span className="text-amber-300/90">{t("mods.unlockPauses")}</span>
              {t("mods.unlockBody2")}
              <span className="text-amber-300/90">
                {t("mods.unlockPrevent")}
              </span>
              {t("mods.unlockBody3")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeUnlock}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  onToggleLock();
                  closeUnlock();
                }}
                className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-amber-400"
              >
                <Unlock size={15} /> {t("mods.unlockAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmUpdateAll && (
        <div
          className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
            updateAllClosing ? "modal-overlay-out" : ""
          }`}
          onMouseDown={(e) =>
            e.target === e.currentTarget && closeUpdateAll()
          }
        >
          <div className="rise flex max-h-[80vh] w-[480px] max-w-full flex-col rounded-xl border border-brass-600/30 bg-ink-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-edge px-5 py-3">
              <div className="flex items-center gap-2 text-brass-300">
                <ArrowUpCircle size={18} />
                <h2 className="font-mc text-base tracking-wide">
                  {t("mods.updateModsTitle")}
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-ink-600">
                <button
                  onClick={() =>
                    setUpdateSel(
                      new Set(userMods.map((m) => `${m.source}:${m.project_id}`)),
                    )
                  }
                  className="hover:text-brass-300"
                >
                  {t("mods.selectAll")}
                </button>
                <span>·</span>
                <button
                  onClick={() => setUpdateSel(new Set())}
                  className="hover:text-brass-300"
                >
                  {t("mods.none")}
                </button>
              </div>
            </div>
            <p className="px-5 pt-3 text-xs text-ink-600">
              {t("mods.updatePickDesc")}
            </p>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {userMods.map((m) => {
                const key = `${m.source}:${m.project_id}`;
                const on = updateSel.has(key);
                return (
                  <button
                    key={m.path}
                    onClick={() =>
                      setUpdateSel((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-ink-800/60"
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                        on
                          ? "border-brass-500 bg-brass-500 text-ink-950"
                          : "border-ink-600"
                      }`}
                    >
                      {on && <Check size={11} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                      {m.title ?? m.name}
                      {m.version && (
                        <span className="ml-1.5 font-mono text-[10px] text-ink-600">
                          {m.version}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-600">
                      {m.source}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-3">
              <button
                onClick={closeUpdateAll}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={runUpdate}
                disabled={updateSel.size === 0}
                className="flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-40"
              >
                <ArrowUpCircle size={15} /> {t("mods.updateN", { n: updateSel.size || "" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-ink-600">{label}</span>
      <SegmentedTabs size="sm" value={value} onChange={onChange} options={options} />
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
  const t = useT();
  const [iconFailed, setIconFailed] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const title = mod.title ?? mod.name;
  const hasSource = !!mod.project_id;
  const sourceLabel = api.sourceLabel(mod.source);
  const controllable = !mod.managed || unlocked;
  const canVersion = hasSource && controllable;
  const open = () => hasSource && onOpenDetail();

  return (
    <div
      onClick={open}
      role={hasSource ? "button" : undefined}
      tabIndex={hasSource ? 0 : undefined}
      onKeyDown={(e) => {
        if (hasSource && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      title={hasSource ? t("mods.viewOn", { source: sourceLabel }) : undefined}
      className={`cv-auto group/row rounded-lg border transition ${
        hasSource ? "cursor-pointer" : ""
      } ${
        mod.enabled
          ? "border-edge bg-ink-900/50 hover:border-brass-600/40 hover:bg-brass-500/[0.04]"
          : "border-edge/60 bg-ink-900/30 opacity-60 hover:opacity-100"
      }`}
    >
      <div className="flex items-center gap-3 p-2.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-ink-600">
          {mod.icon_url && !iconFailed ? (
            <img
              src={mod.icon_url}
              alt={title}
              loading="eager"
              decoding="async"
              className="h-full w-full object-cover"
              onError={() => setIconFailed(true)}
            />
          ) : (
            categoryIcon(mod.category)
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-sm font-medium text-gray-100 ${
                hasSource ? "group-hover/row:text-brass-300" : ""
              }`}
            >
              {title}
            </span>
            {mod.version && (
              <span className="shrink-0 font-mono text-[11px] text-ink-600/80">
                {mod.version}
              </span>
            )}
            {hasSource && (
              <ExternalLink size={10} className="shrink-0 text-ink-600" />
            )}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-600">
            {hasSource && (
              <span
                className={`shrink-0 rounded px-1.5 text-[9px] font-medium ${
                  mod.source === "curseforge"
                    ? "badge-curseforge"
                    : "badge-modrinth"
                }`}
              >
                {sourceLabel}
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
                  ? t("mods.managedUnlocked")
                  : t("mods.managedLocked")
              }
              className="rounded-md border border-edge bg-ink-900/60 px-2 py-1 text-[10px] uppercase tracking-wide text-ink-600"
            >
              {t("mods.modpack")}
            </span>
          )}
          {canVersion && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowVersions((v) => !v);
              }}
              title={t("mods.changeVersion")}
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
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title={t("common.remove")}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={14} />
            </button>
          )}
          {controllable && (
            <span onClick={(e) => e.stopPropagation()}>
              <RowToggle checked={mod.enabled} onChange={onToggle} />
            </span>
          )}
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
      <Collapse open={showVersions && canVersion}>
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
      </Collapse>
      </div>
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
  const t = useT();
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const projectType = projectTypeOf(mod.category);

  useEffect(() => {
    let alive = true;
    api
      .contentVersions(instanceId, mod.project_id!, projectType, mod.source)
      .then((v) => alive && setVersions(v))
      .catch((e) => alive && onError(String(e)));
    return () => {
      alive = false;
    };
  }, [instanceId, mod.project_id, mod.source, projectType, onError]);

  const pick = (versionId: string) => {
    setBusy(versionId);
    api
      .installContentVersion(
        instanceId,
        mod.project_id!,
        versionId,
        projectType,
        mod.source,
      )
      .then((res) => {
        const n = res.dependencies.length;
        const name = mod.title ?? mod.name;
        toast(
          n
            ? t("mods.contentUpdatedDeps", { name, n })
            : t("mods.contentUpdated", { name }),
          "success",
        );
        onPicked();
      })
      .catch((e) => {
        onError(String(e));
        setBusy(null);
      });
  };

  return (
    <div className="border-t border-edge/60 px-3 py-2">
      {!versions ? (
        <div className="flex items-center gap-2 py-2 text-xs text-ink-600">
          <Loader2 size={13} className="animate-spin" /> {t("mods.loadingVersions")}
        </div>
      ) : versions.length === 0 ? (
        <div className="py-2 text-xs text-ink-600">{t("mods.noVersions")}</div>
      ) : (
        <div className="max-h-72 overflow-y-auto pr-0.5">
          <VersionList
            instanceId={instanceId}
            projectId={mod.project_id!}
            source={mod.source}
            versions={versions}
            actionLabel={t("mods.install")}
            busy={busy}
            installedVersion={mod.version_id}
            onPick={pick}
          />
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
  const t = useT();
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      title={checked ? t("mods.disable") : t("mods.enable")}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[4px] border transition-colors ${
        checked
          ? "border-brass-600/70 bg-gradient-to-b from-brass-400 to-brass-500"
          : "border-edge bg-ink-700"
      }`}
    >
      <span
        className={`flex h-[16px] w-[16px] items-center justify-center transition-transform duration-150 ${
          checked ? "translate-x-[25px]" : "translate-x-[3px]"
        }`}
      >
        <span
          className={`h-[14px] w-[4px] rounded-full transition-colors ${
            checked ? "bg-white shadow-[0_0_2px_rgba(0,0,0,0.25)]" : "bg-ink-600"
          }`}
        />
      </span>
    </button>
  );
}
