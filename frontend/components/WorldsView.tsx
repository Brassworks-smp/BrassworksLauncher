import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Globe2,
  Loader2,
  Search,
  RefreshCw,
  FolderOpen,
  Trash2,
  Boxes,
  Clock,
  Swords,
  Skull,
  AlertTriangle,
  X,
  Sprout,
  Copy,
  Play,
  MoreVertical,
  Archive,
  Download,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useT, type TFunc } from "@/lib/i18n";
import {
  SegmentedTabs,
  StarButton,
  useProgressive,
  useClosable,
  placeMenu,
  useMenuDismiss,
} from "./ui";
import { DatapacksModal } from "./DatapacksModal";
import type { WorldInfo, WorldBackup } from "@/lib/types";

const worldsCache = new Map<string, WorldInfo[]>();

const GAME_MODE_KEYS = [
  "worlds.mode.survival",
  "worlds.mode.creative",
  "worlds.mode.adventure",
  "worlds.mode.spectator",
];
const DIFFICULTY_KEYS = [
  "worlds.diff.peaceful",
  "worlds.diff.easy",
  "worlds.diff.normal",
  "worlds.diff.hard",
];

function relativeTime(ms: number, t: TFunc): string {
  if (!ms) return t("worlds.time.never");
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("worlds.time.justNow");
  if (mins < 60) return t("worlds.time.minsAgo", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("worlds.time.hoursAgo", { n: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 30) return t("worlds.time.daysAgo", { n: days });
  return new Date(ms).toLocaleDateString();
}

function DefaultWorldIcon() {
  return (
    <svg viewBox="0 0 16 16" className="pixelated h-full w-full" aria-hidden>
      <rect width="16" height="16" fill="#6b4a2b" />
      <rect width="16" height="6" fill="#6a8d3a" />
      <rect y="5" width="16" height="2" fill="#5a7a30" />
      <rect x="2" y="1" width="2" height="2" fill="#7da046" />
      <rect x="8" y="2" width="2" height="2" fill="#7da046" />
      <rect x="12" y="1" width="2" height="2" fill="#7da046" />
      <rect x="3" y="9" width="2" height="2" fill="#7a5532" />
      <rect x="9" y="11" width="2" height="2" fill="#7a5532" />
      <rect x="6" y="13" width="2" height="2" fill="#5d3f25" />
    </svg>
  );
}

function useWorldIcon(instanceId: string, world: WorldInfo): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (world.icon && api.isTauri()) {
      api
        .worldIcon(instanceId, world.folder)
        .then((p) => alive && setSrc(p ? api.fileSrc(p) : null))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [instanceId, world.folder, world.icon]);
  return src;
}

function WorldThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="pixelated h-full w-full object-cover"
      />
    );
  }
  return <DefaultWorldIcon />;
}

export function WorldsView({
  instanceId,
  canPlay,
  onQuickPlay,
}: {
  instanceId: string;
  canPlay: boolean;
  onQuickPlay: (qp: api.QuickPlay) => void;
}) {
  const t = useT();
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(
    () => worldsCache.get(instanceId) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [datapacksFor, setDatapacksFor] = useState<WorldInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorldInfo | null>(null);
  const [deleteClosing, setDeleteClosing] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [detail, setDetail] = useState<WorldInfo | null>(null);

  const backup = (w: WorldInfo) =>
    api
      .backupWorld(instanceId, w.folder)
      .then(() => toast(t("worlds.backedUp", { name: w.name }), "success"))
      .catch((e) => toast(String(e), "error"));
  const download = (w: WorldInfo) =>
    api
      .exportWorld(instanceId, w.folder)
      .then((p) => toast(t("worlds.savedTo", { path: p }), "success"))
      .catch((e) => toast(String(e), "error"));

  const load = useCallback(() => {
    if (!api.isTauri()) {
      setWorlds([]);
      return;
    }
    const cached = worldsCache.get(instanceId);
    if (cached) setWorlds(cached);
    else {
      setWorlds(null);
      setLoading(true);
    }
    api
      .listWorlds(instanceId)
      .then((list) => {
        worldsCache.set(instanceId, list);
        setWorlds(list);
      })
      .catch(() => setWorlds([]))
      .finally(() => setLoading(false));
  }, [instanceId]);
  useEffect(load, [load]);

  const update = (next: WorldInfo[]) => {
    worldsCache.set(instanceId, next);
    setWorlds(next);
  };

  const toggleStar = (w: WorldInfo) => {
    if (!worlds) return;
    update(
      worlds.map((x) =>
        x.folder === w.folder ? { ...x, starred: !x.starred } : x,
      ),
    );
    api.toggleStar(instanceId, "worlds", w.folder).catch(() => load());
  };

  const closeDelete = () => {
    setDeleteClosing(true);
    setTimeout(() => {
      setConfirmDelete(null);
      setDeleteClosing(false);
    }, 190);
  };
  const doDelete = (w: WorldInfo) => {
    api
      .deleteWorld(instanceId, w.folder)
      .then(() => {
        if (worlds) update(worlds.filter((x) => x.folder !== w.folder));
        toast(t("worlds.deletedToast", { name: w.name }), "success");
      })
      .catch((e) => toast(String(e), "error"));
    closeDelete();
  };

  const filtered = useMemo(() => {
    let list = worlds ?? [];
    if (starredOnly) list = list.filter((w) => w.starred);
    if (modeFilter !== "all")
      list = list.filter((w) => String(w.game_mode) === modeFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((w) => w.name.toLowerCase().includes(q));
    return [...list].sort(
      (a, b) => Number(b.starred) - Number(a.starred) || b.last_played - a.last_played,
    );
  }, [worlds, query, modeFilter, starredOnly]);
  const { shown } = useProgressive(filtered, 48, `${query}:${modeFilter}:${starredOnly}`);

  const starredCount = (worlds ?? []).filter((w) => w.starred).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden px-1 -mx-1">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">{t("worlds.title")}</h1>
          <p className="text-sm text-ink-600">
            {worlds ? t("worlds.count", { count: worlds.length }) : t("common.loading")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBackups(true)}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Archive size={15} /> {t("worlds.backups")}
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

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("worlds.searchPlaceholder")}
            className="w-56 rounded-lg bg-ink-900/50 py-2 pl-8 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
        <SegmentedTabs
          size="sm"
          value={modeFilter}
          onChange={setModeFilter}
          options={[
            { id: "all", label: t("worlds.all") },
            { id: "0", label: t("worlds.mode.survival") },
            { id: "1", label: t("worlds.mode.creative") },
            { id: "2", label: t("worlds.mode.adventure") },
            { id: "3", label: t("worlds.mode.spectator") },
          ]}
        />
        {starredCount > 0 && (
          <button
            onClick={() => setStarredOnly((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition ${
              starredOnly
                ? "border-brass-500/50 bg-brass-500/10 text-brass-300"
                : "border-edge text-ink-600 hover:text-brass-300"
            }`}
          >
            <StarButton starred={starredOnly} onClick={() => setStarredOnly((v) => !v)} size={12} />
            {t("worlds.starred")}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {worlds === null ? null : filtered.length === 0 ? (
          <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
            <div>
              <Globe2 size={28} className="mx-auto mb-2 opacity-50" />
              {(worlds?.length ?? 0) === 0
                ? t("worlds.emptyNone")
                : t("worlds.emptyFilter")}
            </div>
          </div>
        ) : (
          <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {shown.map((w) => (
              <WorldCard
                key={w.folder}
                instanceId={instanceId}
                world={w}
                canPlay={canPlay}
                onPlay={() => onQuickPlay({ kind: "world", folder: w.folder })}
                onStar={() => toggleStar(w)}
                onDatapacks={() => setDatapacksFor(w)}
                onBackup={() => backup(w)}
                onDownload={() => download(w)}
                onDelete={() => setConfirmDelete(w)}
                onOpen={() => setDetail(w)}
              />
            ))}
          </div>
        )}
      </div>

      {datapacksFor && (
        <DatapacksModal
          instanceId={instanceId}
          world={datapacksFor}
          onClose={() => {
            setDatapacksFor(null);
            load();
          }}
        />
      )}

      {showBackups && (
        <BackupsModal
          instanceId={instanceId}
          onClose={() => setShowBackups(false)}
        />
      )}

      {detail && (
        <WorldDetailModal
          instanceId={instanceId}
          world={detail}
          canPlay={canPlay}
          onPlay={() => {
            onQuickPlay({ kind: "world", folder: detail.folder });
            setDetail(null);
          }}
          onDatapacks={() => {
            setDatapacksFor(detail);
            setDetail(null);
          }}
          onBackup={() => backup(detail)}
          onDownload={() => download(detail)}
          onClose={() => setDetail(null)}
        />
      )}

      {confirmDelete && (
        <div
          className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
            deleteClosing ? "modal-overlay-out" : ""
          }`}
          onMouseDown={(e) => e.target === e.currentTarget && closeDelete()}
        >
          <div className="w-[420px] max-w-full rounded-xl border border-red-500/30 bg-ink-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-red-300">
              <AlertTriangle size={20} />
              <h2 className="font-mc text-lg tracking-wide">{t("worlds.deleteTitle")}</h2>
            </div>
            <p className="text-sm leading-relaxed text-ink-600">
              {t("worlds.deleteBody1", { name: confirmDelete.name })}
              <span className="text-red-300/90">{t("worlds.deletePermanent")}</span>
              {t("worlds.deleteBody2")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeDelete}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => doDelete(confirmDelete)}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                <Trash2 size={15} /> {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorldCard({
  instanceId,
  world,
  canPlay,
  onPlay,
  onStar,
  onDatapacks,
  onBackup,
  onDownload,
  onDelete,
  onOpen,
}: {
  instanceId: string;
  world: WorldInfo;
  canPlay: boolean;
  onPlay: () => void;
  onStar: () => void;
  onDatapacks: () => void;
  onBackup: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const iconSrc = useWorldIcon(instanceId, world);
  const [menu, setMenu] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  useMenuDismiss(!!menu, useCallback(() => setMenu(null), []));
  return (
    <div className="group hover-lift relative flex flex-col overflow-hidden rounded-xl border border-edge bg-ink-900/40 hover:border-brass-600/40">
      <div onClick={onOpen} className="relative h-28 cursor-pointer overflow-hidden">
        <div className="absolute inset-0 scale-110 blur-sm brightness-50">
          <WorldThumb src={iconSrc} />
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <div className="h-16 w-16 overflow-hidden rounded-md border border-black/30 shadow-lg">
            <WorldThumb src={iconSrc} />
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/90 to-transparent" />
        <StarButton
          starred={world.starred}
          onClick={onStar}
          size={15}
          className="absolute right-2 top-2 h-7 w-7 bg-ink-950/50 backdrop-blur-sm"
        />
        {world.hardcore && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-red-500/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <Skull size={10} /> {t("worlds.hardcore")}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <button
          onClick={onOpen}
          className="truncate text-left font-mc text-sm text-gray-100 transition hover:text-brass-200"
          title={world.name}
        >
          {world.name}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-600">
          {world.game_mode >= 0 && (
            <span className="flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-brass-300/90">
              <Swords size={9} /> {GAME_MODE_KEYS[world.game_mode] ? t(GAME_MODE_KEYS[world.game_mode]) : "?"}
            </span>
          )}
          {world.difficulty >= 0 && !world.hardcore && (
            <span>{DIFFICULTY_KEYS[world.difficulty] ? t(DIFFICULTY_KEYS[world.difficulty]) : ""}</span>
          )}
          {world.version_name && <span>· {world.version_name}</span>}
        </div>
        {world.seed != null && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              api.copyText(String(world.seed));
              toast(t("worlds.seedCopied"), "success");
            }}
            title={t("worlds.copySeed")}
            className="group/seed mt-1.5 flex w-full items-center gap-1.5 rounded-md border border-edge bg-ink-950/40 px-2 py-1 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Sprout size={11} className="shrink-0 text-brass-400/80" />
            <span className="truncate font-mono">{String(world.seed)}</span>
            <Copy size={11} className="ml-auto shrink-0 opacity-0 transition group-hover/seed:opacity-100" />
          </button>
        )}
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-600">
          <Clock size={11} /> {relativeTime(world.last_played, t)}
          <span className="ml-auto">{api.formatBytes(world.size_bytes)}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          disabled={!canPlay}
          title={t("worlds.playTitle")}
          className="brass-btn mt-3 flex items-center justify-center gap-1.5 rounded-md bg-brass-500 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={13} className="fill-current" /> {t("worlds.play")}
        </button>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={onDatapacks}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge px-2 py-1.5 text-xs font-medium text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Boxes size={13} /> {t("worlds.datapacks")}
            {world.datapack_count > 0 && (
              <span className="rounded bg-brass-500/15 px-1.5 text-[10px] text-brass-300">
                {world.datapack_count}
              </span>
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (menu) {
                setMenu(null);
                return;
              }
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ ...placeMenu(r, 300), right: window.innerWidth - r.right });
            }}
            title={t("worlds.more")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <MoreVertical size={14} />
          </button>
          {menu &&
            createPortal(
              <>
              <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} />
              <div
                style={{
                  ...(menu.top != null ? { top: menu.top } : { bottom: menu.bottom }),
                  right: menu.right,
                  maxHeight: menu.maxHeight,
                }}
                className="rise fixed z-[61] w-44 overflow-y-auto rounded-lg border border-edge bg-ink-850 p-1.5 shadow-2xl"
              >
                <MenuItem
                  icon={<Archive size={13} />}
                  label={t("worlds.backUpNow")}
                  onClick={() => {
                    onBackup();
                    setMenu(null);
                  }}
                />
                <MenuItem
                  icon={<Download size={13} />}
                  label={t("worlds.downloadZip")}
                  onClick={() => {
                    onDownload();
                    setMenu(null);
                  }}
                />
                <MenuItem
                  icon={<FolderOpen size={13} />}
                  label={t("worlds.openFolder")}
                  onClick={() => {
                    api.openDir(instanceId, `saves/${world.folder}`).catch(() => {});
                    setMenu(null);
                  }}
                />
                <MenuItem
                  icon={<Trash2 size={13} />}
                  label={t("worlds.deleteWorld")}
                  danger
                  onClick={() => {
                    onDelete();
                    setMenu(null);
                  }}
                />
              </div>
              </>,
              document.body,
            )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
        danger ? "text-red-300 hover:bg-red-500/10" : "text-gray-200 hover:bg-ink-800"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function BackupsModal({
  instanceId,
  onClose,
}: {
  instanceId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const [backups, setBackups] = useState<WorldBackup[] | null>(null);
  useEffect(() => {
    api.listWorldBackups(instanceId).then(setBackups).catch(() => setBackups([]));
  }, [instanceId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [close]);

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex max-h-[80vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Archive size={17} className="text-brass-400" /> {t("worlds.backupsTitle")}
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {backups === null ? (
            <div className="grid place-items-center py-10 text-ink-600">
              <Loader2 className="animate-spin" />
            </div>
          ) : backups.length === 0 ? (
            <div className="grid place-items-center py-10 text-center text-sm text-ink-600">
              <div>
                <Archive size={26} className="mx-auto mb-2 opacity-50" />
                {t("worlds.noBackups")}
              </div>
            </div>
          ) : (
            <div className="stagger flex flex-col gap-1.5">
              {backups.map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center gap-3 rounded-lg border border-edge bg-ink-800/50 px-3 py-2"
                >
                  <Archive size={15} className="shrink-0 text-brass-400/80" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-100">{b.filename}</div>
                    <div className="text-[11px] text-ink-600">
                      {new Date(b.modified).toLocaleString()} · {api.formatBytes(b.size_bytes)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-between border-t border-edge px-5 py-3">
          <button
            onClick={() => api.openDir(instanceId, "backups").catch(() => {})}
            className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={13} /> {t("worlds.openBackupsFolder")}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorldDetailModal({
  instanceId,
  world,
  canPlay,
  onPlay,
  onDatapacks,
  onBackup,
  onDownload,
  onClose,
}: {
  instanceId: string;
  world: WorldInfo;
  canPlay: boolean;
  onPlay: () => void;
  onDatapacks: () => void;
  onBackup: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const iconSrc = useWorldIcon(instanceId, world);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [close]);

  const facts: { label: string; value: string }[] = [
    {
      label: t("worlds.factGameMode"),
      value:
        world.game_mode >= 0 && GAME_MODE_KEYS[world.game_mode]
          ? t(GAME_MODE_KEYS[world.game_mode])
          : t("worlds.unknown"),
    },
    {
      label: t("worlds.factDifficulty"),
      value: world.hardcore
        ? t("worlds.hardcore")
        : world.difficulty >= 0 && DIFFICULTY_KEYS[world.difficulty]
          ? t(DIFFICULTY_KEYS[world.difficulty])
          : t("worlds.unknown"),
    },
    { label: t("worlds.factVersion"), value: world.version_name ?? t("worlds.unknown") },
    { label: t("worlds.factSize"), value: api.formatBytes(world.size_bytes) },
    { label: t("worlds.factLastPlayed"), value: relativeTime(world.last_played, t) },
    {
      label: t("worlds.factDatapacks"),
      value: world.datapack_count > 0 ? String(world.datapack_count) : t("worlds.none"),
    },
  ];

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex max-h-[85vh] w-[640px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="relative h-44 shrink-0 overflow-hidden">
          <div className="absolute inset-0 scale-110 blur-md brightness-50">
            <WorldThumb src={iconSrc} />
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="h-24 w-24 overflow-hidden rounded-lg border border-black/40 shadow-2xl">
              <WorldThumb src={iconSrc} />
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/30 to-transparent" />
          {world.hardcore && (
            <span className="absolute left-3 top-3 flex items-center gap-1 rounded bg-red-500/85 px-2 py-0.5 text-[11px] font-semibold text-white">
              <Skull size={11} /> Hardcore
            </span>
          )}
          <button
            onClick={close}
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md bg-ink-950/50 text-ink-400 backdrop-blur-sm transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <h2 className="truncate font-mc text-xl tracking-wide text-gray-50" title={world.name}>
              {world.name}
            </h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {world.seed != null && (
            <button
              onClick={() => {
                api.copyText(String(world.seed));
                toast(t("worlds.seedCopied"), "success");
              }}
              title={t("worlds.copySeed")}
              className="group/seed mb-4 flex w-full items-center gap-2 rounded-lg border border-edge bg-ink-950/50 px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Sprout size={15} className="shrink-0 text-brass-400/80" />
              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-600">
                {t("worlds.seed")}
              </span>
              <span className="truncate font-mono text-gray-200">{String(world.seed)}</span>
              <Copy size={14} className="ml-auto shrink-0 opacity-0 transition group-hover/seed:opacity-100" />
            </button>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label} className="rounded-lg border border-edge bg-ink-800/40 p-3">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                  {f.label}
                </div>
                <div className="truncate text-sm text-gray-100">{f.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 truncate font-mono text-[11px] text-ink-700" title={world.folder}>
            {world.folder}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-edge px-5 py-3">
          <button
            onClick={onPlay}
            disabled={!canPlay}
            className="brass-btn flex items-center gap-2 rounded-md bg-brass-500 px-4 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play size={14} className="fill-current" /> {t("worlds.play")}
          </button>
          <button
            onClick={onDatapacks}
            className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Boxes size={13} /> {t("worlds.datapacks")}
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={onBackup}
              className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Archive size={13} /> {t("worlds.backUp")}
            </button>
            <button
              onClick={onDownload}
              className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Download size={13} /> {t("worlds.export")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
