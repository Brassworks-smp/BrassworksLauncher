import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { SegmentedTabs, StarButton } from "./ui";
import { DatapacksModal } from "./DatapacksModal";
import type { WorldInfo } from "@/lib/types";

const worldsCache = new Map<string, WorldInfo[]>();

const GAME_MODES = ["Survival", "Creative", "Adventure", "Spectator"];
const DIFFICULTIES = ["Peaceful", "Easy", "Normal", "Hard"];

function relativeTime(ms: number): string {
  if (!ms) return "Never played";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
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

export function WorldsView({ instanceId }: { instanceId: string }) {
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
        toast(`Deleted “${w.name}”`, "success");
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

  const starredCount = (worlds ?? []).filter((w) => w.starred).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">Worlds</h1>
          <p className="text-sm text-ink-600">
            {worlds ? `${worlds.length} world${worlds.length === 1 ? "" : "s"}` : "Loading…"}
          </p>
        </div>
        <button
          onClick={load}
          title="Refresh"
          className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
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
            placeholder="Search worlds…"
            className="w-56 rounded-lg bg-ink-900/50 py-2 pl-8 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
        <SegmentedTabs
          size="sm"
          value={modeFilter}
          onChange={setModeFilter}
          options={[
            { id: "all", label: "All" },
            { id: "0", label: "Survival" },
            { id: "1", label: "Creative" },
            { id: "2", label: "Adventure" },
            { id: "3", label: "Spectator" },
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
            Starred
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {worlds === null ? null : filtered.length === 0 ? (
          <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
            <div>
              <Globe2 size={28} className="mx-auto mb-2 opacity-50" />
              {(worlds?.length ?? 0) === 0
                ? "No worlds yet — create one in-game and it'll show up here."
                : "No worlds match your filters."}
            </div>
          </div>
        ) : (
          <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {filtered.map((w) => (
              <WorldCard
                key={w.folder}
                instanceId={instanceId}
                world={w}
                onStar={() => toggleStar(w)}
                onDatapacks={() => setDatapacksFor(w)}
                onDelete={() => setConfirmDelete(w)}
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
              <h2 className="font-mc text-lg tracking-wide">Delete world?</h2>
            </div>
            <p className="text-sm leading-relaxed text-ink-600">
              “{confirmDelete.name}” will be{" "}
              <span className="text-red-300/90">permanently deleted</span> from
              this instance. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeDelete}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => doDelete(confirmDelete)}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                <Trash2 size={15} /> Delete
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
  onStar,
  onDatapacks,
  onDelete,
}: {
  instanceId: string;
  world: WorldInfo;
  onStar: () => void;
  onDatapacks: () => void;
  onDelete: () => void;
}) {
  const iconSrc = useWorldIcon(instanceId, world);
  return (
    <div className="group hover-lift relative flex flex-col overflow-hidden rounded-xl border border-edge bg-ink-900/40 hover:border-brass-600/40">
      <div className="relative h-28 overflow-hidden">
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
            <Skull size={10} /> Hardcore
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="truncate font-mc text-sm text-gray-100" title={world.name}>
          {world.name}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-600">
          {world.game_mode >= 0 && (
            <span className="flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-brass-300/90">
              <Swords size={9} /> {GAME_MODES[world.game_mode] ?? "?"}
            </span>
          )}
          {world.difficulty >= 0 && !world.hardcore && (
            <span>{DIFFICULTIES[world.difficulty] ?? ""}</span>
          )}
          {world.version_name && <span>· {world.version_name}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-600">
          <Clock size={11} /> {relativeTime(world.last_played)}
          <span className="ml-auto">{api.formatBytes(world.size_bytes)}</span>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            onClick={onDatapacks}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge px-2 py-1.5 text-xs font-medium text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Boxes size={13} /> Datapacks
            {world.datapack_count > 0 && (
              <span className="rounded bg-brass-500/15 px-1.5 text-[10px] text-brass-300">
                {world.datapack_count}
              </span>
            )}
          </button>
          <button
            onClick={() => api.openDir(instanceId, `saves/${world.folder}`).catch(() => {})}
            title="Open world folder"
            className="grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={13} />
          </button>
          <button
            onClick={onDelete}
            title="Delete world"
            className="grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-red-500/40 hover:text-red-300"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
