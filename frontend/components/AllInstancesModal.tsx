import { createPortal } from "react-dom";
import { useEffect } from "react";
import { FolderPlus, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { InstancesView } from "./InstancesView";
import type { Instance, InstanceFolder } from "@/lib/types";

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `f${Date.now()}${Math.random()}`).slice(
    0,
    12,
  );

export function AllInstancesModal({
  instances,
  showFeatured,
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
  onImportFile,
  onSaveFolders,
  onSaveInstance,
  onPlay,
  onDelete,
  onClose,
}: {
  instances: Instance[];
  showFeatured: boolean;
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
  onImportFile?: (file: File) => void;
  onSaveFolders: (folders: InstanceFolder[]) => void;
  onSaveInstance: (instance: Instance) => void;
  onPlay?: (id: string) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const createFolder = () => {
    const id = uid();
    onSaveFolders([
      ...folders,
      {
        id,
        name: t("instances.newFolder"),
        color: null,
        collapsed: false,
      },
    ]);
  };
  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-[70] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise flex h-[82vh] w-[min(880px,94vw)] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="font-mc text-lg tracking-wide text-gray-100">
            {t("instances.title")}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={createFolder}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <FolderPlus size={15} />
              {t("instances.newFolder")}
            </button>
            <button
              onClick={onAdd}
              className="brass-btn flex items-center gap-1.5 rounded-lg bg-brass-500 px-3 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
            >
              {t("instances.newInstance")}
            </button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
            >
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <InstancesView
            embedded
            instances={instances}
            showFeatured={showFeatured}
            foldersAboveInstances={false}
            folders={folders}
            settingsAccent={settingsAccent}
            onSaveFolders={onSaveFolders}
            onSaveInstance={onSaveInstance}
            selectedId={selectedId}
            runningIds={runningIds}
            maintainingIds={maintainingIds}
            workingIds={workingIds}
            installingId={installingId}
            onSelect={onSelect}
            onOpenSettings={onOpenSettings}
            onStar={onStar}
            onAdd={onAdd}
            onImportFile={onImportFile}
            onPlay={onPlay}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
