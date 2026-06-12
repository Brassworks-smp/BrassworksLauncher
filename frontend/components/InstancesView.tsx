import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Settings,
  Plus,
  Box,
  Star,
  Circle,
  Loader2,
  X,
  ChevronRight,
  FolderPlus,
  Folder as FolderIcon,
  FolderOpen,
  MoreVertical,
  Trash2,
  Check,
  Tag,
  Pencil,
  LayoutGrid,
  LayoutList,
} from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Collapse, placeMenu, useMenuDismiss, Toggle } from "./ui";

type MenuPos = { top?: number; bottom?: number; right: number; maxHeight: number };
import { ACCENT_COLORS as FOLDER_COLORS, DEFAULT_ACCENT } from "@/lib/colors";
import { iconSrc } from "@/lib/instanceIcons";
import type { Instance, InstanceFolder } from "@/lib/types";


function useClickOrRename(
  onSingle: () => void,
  onRename: () => void,
  enabled: boolean,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onClick: () => {
      if (!enabled) {
        onSingle();
        return;
      }
      if (timer.current) {
        
        clear();
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        onSingle();
      }, 220);
    },
    onDoubleClick: enabled
      ? () => {
          clear();
          onRename();
        }
      : undefined,
  };
}

const LOADER_LABEL: Record<string, string> = {
  neo_forge: "NeoForge",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  vanilla: "Vanilla",
};


function loaderLabel(i: Instance): string {
  return LOADER_LABEL[i.loader] ?? i.loader;
}

const byPinned = (a: Instance, b: Instance) =>
  Number(b.pinned ?? false) - Number(a.pinned ?? false);


const COMPACT_KEY = "bw-instances-compact";

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `f${Date.now()}${Math.random()}`).slice(
    0,
    12,
  );

export function InstancesView({
  instances,
  showFeatured = true,
  folders,
  settingsAccent,
  selectedId,
  runningIds,
  maintainingIds,
  workingIds,
  installingId,
  onCancelInstall,
  onSelect,
  onOpenSettings,
  onStar,
  onAdd,
  onSaveFolders,
  onSaveInstance,
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
  onCancelInstall?: () => void;
  onSelect: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onStar: (instance: Instance) => void;
  onAdd: () => void;
  onSaveFolders: (folders: InstanceFolder[]) => void;
  onSaveInstance: (instance: Instance) => void;
}) {
  const tr = useT();
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  
  
  
  const [draggingFrom, setDraggingFrom] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      setCompact(localStorage.getItem(COMPACT_KEY) === "1");
    } catch {
      
    }
  }, []);
  const setDensity = (next: boolean) => {
    setCompact(next);
    try {
      localStorage.setItem(COMPACT_KEY, next ? "1" : "0");
    } catch {
      
    }
  };

  const allTags = useMemo(
    () => [...new Set(instances.flatMap((i) => i.tags ?? []))].sort(),
    [instances],
  );
  const matches = (i: Instance) =>
    !tagFilter || (i.tags ?? []).includes(tagFilter);

  const featured = showFeatured
    ? instances.filter((i) => i.featured && matches(i))
    : [];
  const visible = instances.filter((i) => !i.featured && matches(i));
  const inFolder = (fid: string) =>
    visible.filter((i) => i.folder_id === fid).sort(byPinned);
  const ungrouped = visible
    .filter((i) => !i.folder_id || !folders.some((f) => f.id === i.folder_id))
    .sort(byPinned);

  const updateFolder = (id: string, patch: Partial<InstanceFolder>) =>
    onSaveFolders(folders.map((f) => (f.id === id ? { ...f, ...patch } : f)));
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
  const deleteFolder = (id: string) => {
    instances
      .filter((i) => i.folder_id === id)
      .forEach((i) => onSaveInstance({ ...i, folder_id: null }));
    onSaveFolders(folders.filter((f) => f.id !== id));
  };
  const assignById = (id: string, fid: string | null) => {
    const inst = instances.find((x) => x.id === id);
    if (inst && !inst.featured) onSaveInstance({ ...inst, folder_id: fid });
  };

  const card = (i: Instance, accent?: string) => (
    <InstanceCard
      key={i.id}
      instance={i}
      folders={folders}
      selected={i.id === selectedId}
      running={runningIds.has(i.id)}
      updating={
        (maintainingIds.has(i.id) || workingIds.has(i.id)) && i.id !== installingId
      }
      installing={i.id === installingId}
      onCancelInstall={onCancelInstall}
      onSelect={() => onSelect(i.id)}
      onSettings={() => onOpenSettings(i.id)}
      onStar={() => onStar(i)}
      onAssign={(fid) => onSaveInstance({ ...i, folder_id: fid })}
      onNewFolder={() => onSaveInstance({ ...i, folder_id: createFolder() })}
      onRename={(name) => onSaveInstance({ ...i, name })}
      onTagClick={setTagFilter}
      onDragStateChange={setDraggingFrom}
      accent={accent}
      compact={compact}
    />
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-3">
        <h1 className="font-mc text-2xl tracking-wide text-gray-100">{tr("instances.title")}</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-edge p-0.5">
            {[
              { c: false, icon: <LayoutGrid size={15} />, label: tr("instances.gridView") },
              { c: true, icon: <LayoutList size={15} />, label: tr("instances.compactView") },
            ].map((m) => (
              <button
                key={m.label}
                onClick={() => setDensity(m.c)}
                title={m.label}
                aria-label={m.label}
                aria-pressed={compact === m.c}
                className={`grid h-7 w-7 place-items-center rounded-md transition ${
                  compact === m.c
                    ? "bg-brass-500/20 text-brass-300"
                    : "text-ink-600 hover:text-brass-300"
                }`}
              >
                {m.icon}
              </button>
            ))}
          </div>
          <button
            onClick={() => createFolder()}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderPlus size={16} /> {tr("instances.newFolder")}
          </button>
          <button
            onClick={onAdd}
            className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            <Plus size={16} /> {tr("instances.newInstance")}
          </button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Tag size={13} className="text-ink-600" />
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                tagFilter === t
                  ? "border-brass-500/50 bg-brass-500/15 text-brass-300"
                  : "border-edge text-ink-600 hover:text-brass-300"
              }`}
            >
              {t}
            </button>
          ))}
          {tagFilter && (
            <button
              onClick={() => setTagFilter(null)}
              className="flex items-center gap-1 text-[11px] text-ink-600 hover:text-red-300"
            >
              <X size={11} /> {tr("instances.clear")}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2.5">
        {featured.length > 0 && (
          <Section title={tr("instances.featured")} icon={<Star size={13} />} compact={compact}>
            {featured.map((i) => card(i))}
          </Section>
        )}

        {folders.map((f) => (
          <FolderGroup
            key={f.id}
            folder={f}
            compact={compact}
            draggingFrom={draggingFrom}
            settingsAccent={settingsAccent}
            count={inFolder(f.id).length}
            onToggle={() => updateFolder(f.id, { collapsed: !f.collapsed })}
            onRename={(name) => updateFolder(f.id, { name })}
            onColor={(color) => updateFolder(f.id, { color })}
            onDelete={() => deleteFolder(f.id)}
            onDropInstance={(id) => assignById(id, f.id)}
          >
            {inFolder(f.id).length > 0 ? (
              inFolder(f.id).map((i) => card(i, f.color ?? undefined))
            ) : (
              <div className="col-span-full rounded-lg border border-dashed border-edge px-3 py-5 text-center text-xs text-ink-600">
                {tr("instances.emptyFolder")}
              </div>
            )}
          </FolderGroup>
        ))}

        <Section
          title={tr("instances.yourInstances")}
          icon={<Box size={13} />}
          compact={compact}
          dropFolderId={null}
          draggingFrom={draggingFrom}
          onDropInstance={(id) => assignById(id, null)}
        >
          {ungrouped.map((i) => card(i))}
          <button
            onClick={onAdd}
            className={`order-last flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge text-ink-600 transition hover:border-brass-600/50 hover:text-brass-300 ${
              compact ? "min-h-[52px] flex-row gap-1.5 text-sm" : "min-h-[150px]"
            }`}
          >
            <Plus size={compact ? 16 : 22} />
            <span className="text-sm">{tr("instances.newInstance")}</span>
          </button>
        </Section>
      </div>
    </div>
  );
}


function DropPlaceholder({ color, compact }: { color: string; compact?: boolean }) {
  const tr = useT();
  return (
    <div
      className={`density-swap pointer-events-none grid place-items-center rounded-xl border-2 border-dashed text-xs font-medium ${
        compact ? "min-h-[58px]" : "min-h-[150px]"
      }`}
      style={{ borderColor: color, color, background: `${color}12` }}
    >
      {tr("instances.dropHere")}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  compact,
  dropFolderId,
  draggingFrom,
  onDropInstance,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
  dropFolderId?: string | null;
  draggingFrom?: string | null;
  onDropInstance?: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  
  const sameOrigin = draggingFrom !== undefined && draggingFrom === dropFolderId;
  const showDrop = over && !!onDropInstance && !sameOrigin;
  const drop = onDropInstance
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData("text/instance");
          if (id) onDropInstance(id);
        },
      }
    : {};
  return (
    <section className="mb-6" {...drop}>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brass-400/80">
        {icon}
        {title}
      </h2>
      <div
        key={compact ? "compact" : "comfortable"}
        className={`density-swap stagger grid gap-2 rounded-xl border border-edge bg-ink-900/30 p-3 transition ${
          compact
            ? "grid-cols-[repeat(auto-fill,minmax(215px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
        } ${showDrop ? "ring-2 ring-brass-500/40 ring-offset-4 ring-offset-ink-950" : ""}`}
      >
        {children}
        {showDrop && <DropPlaceholder color="var(--color-brass-400)" compact={compact} />}
      </div>
    </section>
  );
}

function FolderGroup({
  folder,
  compact,
  draggingFrom,
  settingsAccent,
  count,
  onToggle,
  onRename,
  onColor,
  onDelete,
  onDropInstance,
  children,
}: {
  folder: InstanceFolder;
  compact?: boolean;
  draggingFrom?: string | null;
  settingsAccent?: string | null;
  count: number;
  onToggle: () => void;
  onRename: (name: string) => void;
  onColor: (color: string | null) => void;
  onDelete: () => void;
  onDropInstance: (id: string) => void;
  children: React.ReactNode;
}) {
  const tr = useT();
  const [menu, setMenu] = useState<MenuPos | null>(null);
  useMenuDismiss(!!menu, useCallback(() => setMenu(null), []));
  const [name, setName] = useState(folder.name);
  const [editingHeader, setEditingHeader] = useState(false);
  const [over, setOver] = useState(false);
  const color = folder.color ?? settingsAccent ?? DEFAULT_ACCENT;
  
  const showDrop = over && draggingFrom !== folder.id;
  const startRename = () => {
    setName(folder.name);
    setEditingHeader(true);
  };
  const headerClick = useClickOrRename(onToggle, startRename, true);

  return (
    <section
      className="mb-4 overflow-hidden rounded-xl border border-edge transition"
      style={{
        borderColor: showDrop ? color : undefined,
        background: showDrop ? `${color}1f` : `${color}0d`,
        boxShadow: showDrop ? `0 0 0 1px ${color}` : undefined,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/instance");
        if (id) onDropInstance(id);
      }}
    >
      <div
        className="group/fh relative flex items-center gap-2 px-3 py-2 transition-colors"
        style={{
          background: `${color}1a`,
          borderBottom: `1px solid ${folder.collapsed ? "transparent" : `${color}33`}`,
        }}
      >
        <button
          onClick={editingHeader ? undefined : onToggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            size={15}
            className={`text-ink-600 transition-transform duration-200 ${
              folder.collapsed ? "" : "rotate-90"
            }`}
          />
          <FolderIcon size={16} style={{ color }} className="shrink-0" />
          {editingHeader ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => {
                if (name.trim()) onRename(name.trim());
                setEditingHeader(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (name.trim()) onRename(name.trim());
                  setEditingHeader(false);
                } else if (e.key === "Escape") {
                  setName(folder.name);
                  setEditingHeader(false);
                }
              }}
              style={{ "--tw-ring-color": color } as React.CSSProperties}
              className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mc text-sm tracking-wide text-gray-100 outline-none ring-1"
            />
          ) : (
            <span
              onClick={(e) => {
                e.stopPropagation();
                headerClick.onClick();
              }}
              onDoubleClick={headerClick.onDoubleClick}
              title={tr("instances.doubleClickRename")}
              className="font-mc text-sm tracking-wide text-gray-100"
            >
              {folder.name}
            </span>
          )}
          <span
            className="rounded-full px-2 text-[10px] font-semibold tabular-nums"
            style={{ background: `${color}26`, color }}
          >
            {count}
          </span>
        </button>
        <button
          onClick={(e) => {
            if (menu) {
              setMenu(null);
              return;
            }
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ ...placeMenu(r, 320), right: window.innerWidth - r.right });
          }}
          style={{ "--accent": color } as React.CSSProperties}
          className={`grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:bg-ink-700 hover:text-[var(--accent)] group-hover/fh:opacity-100 ${
            menu ? "opacity-100" : "opacity-0"
          }`}
        >
          <MoreVertical size={15} />
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
                onClick={(e) => e.stopPropagation()}
                className="rise fixed z-[61] w-56 overflow-y-auto rounded-lg border border-edge bg-ink-850 p-2.5 shadow-2xl"
              >
              <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-600">
                {tr("common.rename")}
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && onRename(name.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (name.trim()) onRename(name.trim());
                    setMenu(null);
                  }
                }}
                style={{ "--accent": color } as React.CSSProperties}
                className="w-full rounded-md bg-ink-950/70 px-2.5 py-1.5 text-sm outline-none ring-1 ring-edge focus:ring-[var(--accent)]"
              />
              <div className="mb-2 mt-2.5 border-b border-edge pb-2">
                <Toggle
                  label={tr("instances.launcherDefault")}
                  checked={folder.color === null}
                  onChange={(checked) => onColor(checked ? null : FOLDER_COLORS[0])}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 transition-opacity">
                {FOLDER_COLORS.map((c) => {
                  const active = folder.color === c;
                  return (
                    <button
                      key={c}
                      onClick={() => onColor(c)}
                      title={c}
                      style={{
                        backgroundImage: `linear-gradient(to bottom right, color-mix(in srgb, ${c} 88%, #fff), color-mix(in srgb, ${c} 78%, #000))`,
                      }}
                      className={`grid h-5 w-5 place-items-center rounded-md transition hover:scale-110 ${
                        active ? "scale-110" : ""
                      }`}
                    >
                      {active && (
                        <Check
                          size={11}
                          strokeWidth={3.5}
                          className="text-white [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.6))]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  onDelete();
                  setMenu(null);
                }}
                className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10"
              >
                <Trash2 size={13} /> {tr("instances.deleteFolder")}
              </button>
              </div>
            </>,
            document.body,
          )}
      </div>

      <Collapse open={!folder.collapsed}>
        <div
          key={compact ? "compact" : "comfortable"}
          className={`density-swap stagger grid p-3 ${
            compact
              ? "grid-cols-[repeat(auto-fill,minmax(215px,1fr))] gap-2"
              : "grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
          }`}
        >
          {children}
          {showDrop && <DropPlaceholder color={color} compact={compact} />}
        </div>
      </Collapse>
    </section>
  );
}

function InstanceCard({
  instance,
  folders,
  selected,
  running,
  updating,
  installing,
  onCancelInstall,
  onSelect,
  onSettings,
  onStar,
  onAssign,
  onNewFolder,
  onRename,
  onTagClick,
  onDragStateChange,
  accent,
  compact,
}: {
  instance: Instance;
  folders: InstanceFolder[];
  selected: boolean;
  running: boolean;
  updating?: boolean;
  installing?: boolean;
  onCancelInstall?: () => void;
  onSelect: () => void;
  onSettings: () => void;
  onStar: () => void;
  onAssign: (folderId: string | null) => void;
  onNewFolder: () => void;
  onRename: (name: string) => void;
  onTagClick: (tag: string) => void;
  onDragStateChange?: (from: string | null | undefined) => void;
  accent?: string;
  compact?: boolean;
}) {
  const tr = useT();
  const [folderMenu, setFolderMenu] = useState<MenuPos | null>(null);
  useMenuDismiss(!!folderMenu, useCallback(() => setFolderMenu(null), []));
  const [editingName, setEditingName] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [nameDraft, setNameDraft] = useState(instance.name);
  const tags = instance.tags ?? [];
  const canRename = !instance.featured;
  const startRename = () => {
    setNameDraft(instance.name);
    setEditingName(true);
  };
  
  
  
  const nameClick = useClickOrRename(onSelect, startRename, canRename);
  const nameClickProps = canRename
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          nameClick.onClick();
        },
        onDoubleClick: nameClick.onDoubleClick,
      }
    : {};

  
  const stateCls = installing
    ? "border-brass-500/40 cursor-default transition"
    : selected
      ? accent
        ? "glow hover-lift cursor-pointer border-[var(--accent)]"
        : "border-brass-500/60 glow hover-lift cursor-pointer"
      : accent
        ? "border-edge hover-lift cursor-pointer hover:border-[var(--accent)]/50"
        : "border-edge hover-lift cursor-pointer hover:border-brass-600/40";

  
  
  
  const dragProps = {
    draggable: !instance.featured && !installing,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/instance", instance.id);
      e.dataTransfer.effectAllowed = "move";
      setDragging(true);
      onDragStateChange?.(instance.folder_id ?? null);
    },
    onDragEnd: () => {
      setDragging(false);
      onDragStateChange?.(undefined);
    },
  };

  const openFolderMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (folderMenu) {
      setFolderMenu(null);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFolderMenu({ ...placeMenu(r, 320), right: window.innerWidth - r.right });
  };

  const folderMenuPortal =
    folderMenu &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[60]"
          onClick={(e) => {
            e.stopPropagation();
            setFolderMenu(null);
          }}
        />
        <div
          style={{
            ...(folderMenu.top != null
              ? { top: folderMenu.top }
              : { bottom: folderMenu.bottom }),
            right: folderMenu.right,
            maxHeight: folderMenu.maxHeight,
          }}
          className="rise fixed z-[61] w-48 overflow-y-auto rounded-lg border border-edge bg-ink-850 p-1.5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setFolderMenu(null);
              startRename();
            }}
            className="mb-0.5 flex w-full items-center gap-2 rounded-md border-b border-edge px-2 py-1.5 text-xs text-gray-200 transition hover:bg-ink-800"
          >
            <Pencil size={12} className="text-ink-600" /> {tr("common.rename")}
          </button>
          <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-ink-600">
            {tr("instances.moveToFolder")}
          </div>
          <button
            onClick={() => {
              onAssign(null);
              setFolderMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-200 transition hover:bg-ink-800"
          >
            <X size={12} className="text-ink-600" /> {tr("instances.noFolder")}
            {!instance.folder_id && <Check size={12} className="ml-auto text-brass-400" />}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                onAssign(f.id);
                setFolderMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-200 transition hover:bg-ink-800"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: f.color ?? "#9b9b9b" }}
              />
              <span className="truncate">{f.name}</span>
              {instance.folder_id === f.id && (
                <Check size={12} className="ml-auto shrink-0 text-brass-400" />
              )}
            </button>
          ))}
          <button
            onClick={() => {
              onNewFolder();
              setFolderMenu(null);
            }}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-edge px-2 py-1.5 text-xs text-brass-300 transition hover:bg-ink-800"
          >
            <FolderPlus size={12} /> {tr("instances.newFolderDots")}
          </button>
        </div>
      </>,
      document.body,
    );

  const nameInput = (
    <input
      autoFocus
      value={nameDraft}
      onChange={(e) => setNameDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        const v = nameDraft.trim();
        if (v && v !== instance.name) onRename(v);
        setEditingName(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = nameDraft.trim();
          if (v && v !== instance.name) onRename(v);
          setEditingName(false);
        } else if (e.key === "Escape") {
          setNameDraft(instance.name);
          setEditingName(false);
        }
      }}
      style={accent ? ({ "--tw-ring-color": accent } as React.CSSProperties) : undefined}
      className={`w-full rounded bg-ink-950/70 px-1.5 py-0.5 font-mc text-sm text-gray-100 outline-none ring-1 ${
        accent ? "" : "ring-brass-500/60"
      }`}
    />
  );

  if (compact) {
    return (
      <div
        onClick={installing || editingName ? undefined : onSelect}
        {...dragProps}
        style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
        className={`group relative flex items-center gap-2.5 overflow-hidden rounded-lg border bg-ink-900/40 px-2.5 py-2.5 transition-opacity ${stateCls} ${
          dragging ? "opacity-0" : ""
        }`}
      >
        {installing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-ink-950/75 backdrop-blur-[1px]">
            <Loader2 size={15} className="animate-spin text-brass-300" />
            <span className="font-mc text-[10px] tracking-wide text-brass-200">
              Downloading…
            </span>
            {onCancelInstall && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelInstall();
                }}
                className="flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300 transition hover:bg-red-500/20"
              >
                <X size={11} /> Cancel
              </button>
            )}
          </div>
        )}
        {instance.icon ? (
          <img
            src={iconSrc(instance.icon, accent) ?? undefined}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md object-cover shadow"
          />
        ) : (
          <span
            style={accent ? { borderColor: `${accent}59`, color: accent } : undefined}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-ink-950/60 text-brass-400"
          >
            <Box size={18} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          {editingName ? (
            nameInput
          ) : (
            <>
              <div
                {...nameClickProps}
                title={canRename ? tr("instances.doubleClickRename") : instance.name}
                className="inline-block max-w-full truncate font-mc text-[13px] leading-tight text-gray-100"
              >
                {instance.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-ink-600">
                <span
                  className="rounded bg-ink-800 px-1 py-0.5 text-brass-300/90"
                  style={accent ? { background: `${accent}26`, color: accent } : undefined}
                >
                  {loaderLabel(instance)}
                </span>
                <span className="truncate">{instance.minecraft_version}</span>
                {updating && <Loader2 size={10} className="animate-spin text-brass-300" />}
              </div>
            </>
          )}
        </div>

        {!editingName && (
          <div className="flex shrink-0 items-center gap-1">
            {}
            {running ? (
              <span
                title={tr("instances.running")}
                className="flex items-center gap-1 rounded-md border border-patina-500/40 bg-patina-500/10 px-1.5 py-0.5 text-[10px] text-patina-300"
              >
                <Circle size={8} className="animate-pulse fill-current" /> {tr("instances.running")}
              </span>
            ) : selected ? (
              <span
                className="grid h-5 w-5 place-items-center rounded-md border border-brass-500/50 bg-brass-500/15 text-brass-300"
                style={
                  accent
                    ? { borderColor: `${accent}80`, background: `${accent}26`, color: accent }
                    : undefined
                }
                title={tr("instances.selected")}
              >
                <Check size={12} />
              </span>
            ) : instance.pinned && !instance.featured ? (
              <Star
                size={13}
                className="fill-current text-brass-300 transition-[max-width,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:max-w-0 group-hover:opacity-0"
                style={accent ? { color: accent } : undefined}
              />
            ) : null}

            {}
            <div
              className={`flex items-center gap-1 overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100 ${
                folderMenu ? "max-w-[120px] opacity-100" : "max-w-0 group-hover:max-w-[120px]"
              }`}
            >
              {!instance.featured && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStar();
                  }}
                  title={instance.pinned ? tr("instances.unpin") : tr("instances.pin")}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition ${
                    instance.pinned
                      ? "text-brass-300"
                      : accent
                        ? "text-ink-600 hover:text-[var(--accent)]"
                        : "text-ink-600 hover:text-brass-300"
                  }`}
                >
                  <Star size={13} className={instance.pinned ? "fill-current" : ""} />
                </button>
              )}
              {!instance.featured && (
                <button
                  onClick={openFolderMenu}
                  title={tr("instances.moveToFolder")}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-600 transition ${
                    accent ? "hover:text-[var(--accent)]" : "hover:text-brass-300"
                  }`}
                >
                  <MoreVertical size={14} />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSettings();
                }}
                title={tr("instances.instanceSettings")}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-600 transition ${
                  accent ? "hover:text-[var(--accent)]" : "hover:text-brass-300"
                }`}
              >
                <Settings size={14} />
              </button>
            </div>
          </div>
        )}
        {folderMenuPortal}
      </div>
    );
  }

  return (
    <div
      onClick={installing || editingName ? undefined : onSelect}
      {...dragProps}
      style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-ink-900/40 transition-opacity ${stateCls} ${
        dragging ? "opacity-0" : ""
      }`}
    >
      {installing && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-ink-950/75 backdrop-blur-[1px]">
          <Loader2 size={22} className="animate-spin text-brass-300" />
          <span className="font-mc text-[11px] tracking-wide text-brass-200">
            Downloading…
          </span>
          {onCancelInstall && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancelInstall();
              }}
              className="mt-1 flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20"
            >
              <X size={12} /> Cancel
            </button>
          )}
        </div>
      )}
      <div className="relative flex h-24 items-center justify-center overflow-hidden">
        {instance.banner ? (
          <img src={instance.banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="schem-bg absolute inset-0" />
        )}
        <div className="absolute inset-0 bg-linear-to-b from-transparent to-ink-900/85" />
        {updating && (
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border border-brass-500/40 bg-ink-950/70 px-1.5 py-0.5 backdrop-blur-[1px]">
            <Loader2 size={11} className="animate-spin text-brass-300" />
            <span className="font-mc text-[10px] tracking-wide text-brass-200">
              Updating
            </span>
          </div>
        )}
        {instance.icon ? (
          <img
            src={iconSrc(instance.icon, accent) ?? undefined}
            alt=""
            className="relative h-14 w-14 rounded-lg object-cover shadow-lg"
          />
        ) : (
          <span
            style={accent ? { borderColor: `${accent}59`, color: accent } : undefined}
            className="relative grid h-14 w-14 place-items-center rounded-lg border border-edge bg-ink-950/60 text-brass-400"
          >
            <Box size={26} />
          </span>
        )}

        <div className="absolute right-2 top-2 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              api.openInstanceDir(instance.id).catch(() => {});
            }}
            title={tr("instances.openGameFolder")}
            className={`grid h-7 w-7 place-items-center rounded-md border border-edge bg-ink-950/60 text-ink-600 transition group-hover:opacity-100 ${
              folderMenu ? "opacity-100" : "opacity-0"
            } ${accent ? "hover:text-[var(--accent)]" : "hover:text-brass-300"}`}
          >
            <FolderOpen size={13} />
          </button>
          {!instance.featured && (
            <button
              onClick={openFolderMenu}
              title={tr("instances.moveToFolder")}
              className={`grid h-7 w-7 place-items-center rounded-md border border-edge bg-ink-950/60 text-ink-600 transition group-hover:opacity-100 ${
                folderMenu ? "opacity-100" : "opacity-0"
              } ${accent ? "hover:text-[var(--accent)]" : "hover:text-brass-300"}`}
            >
              <MoreVertical size={14} />
            </button>
          )}
          {!instance.featured && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStar();
              }}
              title={instance.pinned ? tr("instances.unpin") : tr("instances.pin")}
              style={
                accent && instance.pinned
                  ? { borderColor: `${accent}80`, background: `${accent}33`, color: accent }
                  : undefined
              }
              className={`grid h-7 w-7 place-items-center rounded-md border transition group-hover:opacity-100 ${
                instance.pinned
                  ? "border-brass-500/50 bg-brass-500/20 text-brass-300"
                  : `border-edge bg-ink-950/60 text-ink-600 ${
                      folderMenu ? "opacity-100" : "opacity-0"
                    } ${accent ? "hover:text-[var(--accent)]" : "hover:text-brass-300"}`
              }`}
            >
              <Star size={13} className={instance.pinned ? "fill-current" : ""} />
            </button>
          )}
        </div>

        {folderMenuPortal}
      </div>

      <div className="flex flex-1 flex-col p-3">
        {editingName ? (
          nameInput
        ) : (
          <div
            {...nameClickProps}
            className="inline-block max-w-full self-start truncate font-mc text-sm text-gray-100"
            title={canRename ? "Double-click to rename" : instance.name}
          >
            {instance.name}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-600">
          <span
            className="rounded bg-ink-800 px-1.5 py-0.5 text-brass-300/90"
            style={accent ? { background: `${accent}26`, color: accent } : undefined}
          >
            {loaderLabel(instance)}
          </span>
          <span>{instance.minecraft_version}</span>
        </div>

        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.slice(0, 4).map((t) => (
              <button
                key={t}
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick(t);
                }}
                className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[9px] text-ink-600 transition hover:text-brass-300"
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            style={
              accent && !running
                ? selected
                  ? { borderColor: `${accent}80`, background: `${accent}26`, color: accent }
                  : { background: accent, color: "#15110b" }
                : undefined
            }
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              running
                ? "border border-patina-500/40 bg-patina-500/10 text-patina-300"
                : selected
                  ? "border border-brass-500/50 bg-brass-500/15 text-brass-200"
                  : "brass-btn bg-brass-500 text-ink-950 hover:bg-brass-400"
            }`}
          >
            {running ? (
              <>
                <Circle size={9} className="animate-pulse fill-current" /> {tr("instances.running")}
              </>
            ) : selected ? (
              tr("instances.selected")
            ) : (
              tr("instances.select")
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSettings();
            }}
            title={tr("instances.instanceSettings")}
            className={`grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-600 transition ${
              accent
                ? "hover:border-[var(--accent)] hover:text-[var(--accent)]"
                : "hover:border-brass-600/40 hover:text-brass-300"
            }`}
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
