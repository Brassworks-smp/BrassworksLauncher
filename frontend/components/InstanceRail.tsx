import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Play, Square, Settings, LayoutGrid } from "lucide-react";
import { useT } from "@/lib/i18n";
import { getLastClicked } from "@/lib/instanceRecency";
import { InstanceCard } from "./InstancesView";
import { ExportModal } from "./ExportModal";
import { ShareModal } from "./ShareModal";
import type { Instance, InstanceFolder } from "@/lib/types";

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `f${Date.now()}${Math.random()}`).slice(
    0,
    12,
  );

const byRecent = (a: Instance, b: Instance, lastClicked: Record<string, number>) => {
  const pa = Number(a.pinned ?? false);
  const pb = Number(b.pinned ?? false);
  if (pa !== pb) return pb - pa;
  const ta = lastClicked[a.id] ?? -Infinity;
  const tb = lastClicked[b.id] ?? -Infinity;
  if (ta !== tb) return tb - ta;
  return a.name.localeCompare(b.name);
};

export function InstanceRail({
  instances,
  showFeatured = true,
  folders,
  settingsAccent,
  selectedId,
  runningIds,
  maintainingIds,
  workingIds,
  installingId,
  onSelect,
  onOpenSettings,
  onStar,
  onAdd,
  onSaveFolders,
  onSaveInstance,
  onPlay,
  onDelete,
  onStop,
  canPlay = true,
  bare = false,
  recencyVersion = 0,
  allOpen,
  onAllOpenChange,
}: {
  instances: Instance[];
  showFeatured?: boolean;
  folders: InstanceFolder[];
  settingsAccent?: string | null;
  selectedId: string | null;
  runningIds: Set<string>;
  maintainingIds: Set<string>;
  workingIds: Set<string>;
  installingId?: string | null;
  onSelect: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onStar: (instance: Instance) => void;
  onAdd: () => void;
  onSaveFolders: (folders: InstanceFolder[]) => void;
  onSaveInstance: (instance: Instance) => void;
  onPlay?: (id: string) => void;
  onDelete?: (id: string) => void;
  onStop?: () => void;
  canPlay?: boolean;
  bare?: boolean;
  recencyVersion?: number;
  allOpen?: boolean;
  onAllOpenChange?: (open: boolean) => void;
}) {
  const tr = useT();
  const [exportTarget, setExportTarget] = useState<Instance | null>(null);
  const [shareTarget, setShareTarget] = useState<Instance | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(8);

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ROW = 54;
    const measure = () => {
      const count = Math.max(1, Math.floor((el.clientHeight - 8 - 46) / ROW));
      setFit((cur) => (cur === count ? cur : count));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const list = useMemo(() => {
    const lastClicked = getLastClicked();
    return [...instances.filter((i) => showFeatured || !i.featured)].sort(
      (a, b) => byRecent(a, b, lastClicked),
    );
  }, [instances, showFeatured, recencyVersion]);

  const selected = selectedId
    ? instances.find((i) => i.id === selectedId) ?? null
    : null;
  const selectedRunning = !!selected && runningIds.has(selected.id);

  const visible = useMemo(() => {
    const top = list.slice(0, fit);
    if (
      selected &&
      list.length > fit &&
      !top.some((i) => i.id === selected.id)
    ) {
      return [...top.slice(0, -1), selected];
    }
    return top;
  }, [list, fit, selected]);
  const hasMore = list.length > visible.length;

  const createFolder = (): string => {
    const id = uid();
    onSaveFolders([
      ...folders,
      {
        id,
        name: tr("instances.newFolder"),
        color: null,
        collapsed: false,
      },
    ]);
    return id;
  };

  const listEl = (
    <div
      ref={listRef}
      className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto ${
        bare ? "p-1" : "p-1.5"
      }`}
    >
      <div
        key={`${instances.length}:${selectedId ?? ""}:${recencyVersion}`}
        className="rail-swap flex flex-col gap-1"
      >
        {visible.map((i) => {
          const folder = folders.find((f) => f.id === i.folder_id);
          return (
            <InstanceCard
              key={i.id}
              instance={i}
              folders={folders}
              selected={i.id === selectedId}
              running={runningIds.has(i.id)}
              updating={maintainingIds.has(i.id) || workingIds.has(i.id)}
              installing={i.id === installingId}
              onSelect={() => onSelect(i.id)}
              onSettings={() => onOpenSettings(i.id)}
              onStar={() => onStar(i)}
              onAssign={(fid) => onSaveInstance({ ...i, folder_id: fid })}
              onNewFolder={() => onSaveInstance({ ...i, folder_id: createFolder() })}
              onRename={(name) => onSaveInstance({ ...i, name })}
              onTagClick={() => {}}
              onPlay={onPlay ? () => onPlay(i.id) : undefined}
              onDelete={onDelete ? () => onDelete(i.id) : undefined}
              onExport={() => setExportTarget(i)}
              onShare={
                !i.modpack_locked && !i.featured
                  ? () => setShareTarget(i)
                  : undefined
              }
              accent={folder?.color ?? undefined}
              compact
              rail
            />
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => onAllOpenChange?.(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-2 py-2 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:bg-ink-800/40 hover:text-brass-300"
        >
          <LayoutGrid size={13} />
          {tr("instances.viewAll", {
            count: list.length - visible.length,
          })}
        </button>
      )}

      {list.length === 0 && (
        <button
          onClick={onAdd}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge py-8 text-xs text-ink-600 transition hover:border-brass-600/50 hover:text-brass-300"
        >
          <Plus size={16} />
          {tr("instances.newInstance")}
        </button>
      )}
    </div>
  );

  const footerEl = (
    <div className="shrink-0 border-t border-edge/60 p-2">
      {selected && (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={selectedRunning ? onStop : () => onPlay?.(selected.id)}
            disabled={!selectedRunning && (!onPlay || !canPlay)}
            title={!canPlay ? tr("play.signInToPlay") : undefined}
            className={`font-mc flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
              selectedRunning
                ? "border border-patina-500/40 bg-patina-500/10 text-patina-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                : "brass-btn bg-brass-500 text-ink-950 hover:bg-brass-400"
            }`}
          >
            {selectedRunning ? (
              <>
                <Square size={13} className="fill-current" />
                {tr("sidebar.stop")}
              </>
            ) : (
              <>
                <Play size={13} className="fill-current" />
                {tr("instances.play")}
              </>
            )}
          </button>
          <button
            onClick={() => onOpenSettings(selected.id)}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-edge text-xs text-ink-600 transition hover:border-brass-600/40 hover:bg-ink-800/50 hover:text-brass-300"
          >
            <Settings size={13} />
            {tr("instances.instanceSettings")}
          </button>
        </div>
      )}
    </div>
  );

  const modals = (
    <>
      {exportTarget && (
        <ExportModal
          instanceId={exportTarget.id}
          mcVersion={exportTarget.minecraft_version}
          loader={exportTarget.loader.replace("_", "")}
          defaultName={exportTarget.name}
          onClose={() => setExportTarget(null)}
        />
      )}

      {shareTarget && (
        <ShareModal
          instance={shareTarget}
          onChanged={() => {}}
          onClose={() => setShareTarget(null)}
        />
      )}
    </>
  );

  if (bare) {
    return (
      <>
        {listEl}
        {footerEl}
        {modals}
      </>
    );
  }

  return (
    <div className="flex w-[264px] shrink-0 flex-col overflow-hidden rounded-xl border border-edge bg-ink-900/30">
      <div className="flex items-center justify-between gap-2 border-b border-edge/60 px-3 py-2.5">
        <span className="font-mc text-xs uppercase tracking-widest text-brass-400/80">
          {tr("instances.title")}
        </span>
        <button
          onClick={onAdd}
          title={tr("instances.newInstance")}
          className="grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:bg-ink-800/50 hover:text-brass-300"
        >
          <Plus size={15} />
        </button>
      </div>

      {listEl}

      {footerEl}

      {modals}
    </div>
  );
}
