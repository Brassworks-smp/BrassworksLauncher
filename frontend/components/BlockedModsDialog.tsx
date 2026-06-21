import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  FilePlus,
  Check,
  Loader2,
  Trash2,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import * as api from "@/lib/api";
import { useClosable } from "./ui";
import { useT } from "@/lib/i18n";
import type { BlockedMod, ManualMod } from "@/lib/types";

const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;

export function BlockedModsDialog({
  blocked,
  initialFolders,
  onCancel,
  onContinue,
  onFoldersChange,
}: {
  blocked: BlockedMod[];
  initialFolders: string[];
  onCancel: () => void;
  onContinue: (mods: ManualMod[]) => void;
  onFoldersChange: (folders: string[]) => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onCancel);
  const [folders, setFolders] = useState<string[]>(initialFolders);
  const [found, setFound] = useState<Record<string, string>>({});

  const wanted = blocked.map((b) => b.filename);
  const missing = wanted.filter((f) => !found[f]);
  const allFound = missing.length === 0;

  const missingRef = useRef(missing);
  missingRef.current = missing;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  const poll = useCallback(async () => {
    const want = missingRef.current;
    const dirs = foldersRef.current;
    if (want.length === 0 || dirs.length === 0) return;
    const hits = await api.scanManualMods(dirs, want).catch(() => []);
    if (hits.length > 0) {
      setFound((prev) => {
        const next = { ...prev };
        for (const [filename, path] of hits) next[filename] = path;
        return next;
      });
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(poll, 1200);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const openAll = () => {
    for (const b of blocked) api.openExternal(b.url).catch(() => {});
  };

  const addFolder = async () => {
    const picked = await openFileDialog({ directory: true, multiple: false });
    if (typeof picked !== "string" || folders.includes(picked)) return;
    const next = [...folders, picked];
    setFolders(next);
    onFoldersChange(next);
  };

  const removeFolder = (folder: string) => {
    const next = folders.filter((f) => f !== folder);
    setFolders(next);
    onFoldersChange(next);
  };

  const addFileManually = async () => {
    const picked = await openFileDialog({
      multiple: false,
      filters: [{ name: "Mods", extensions: ["jar"] }],
    });
    if (typeof picked !== "string") return;
    const name = baseName(picked);
    const match = wanted.find((f) => f.toLowerCase() === name.toLowerCase());
    if (match) setFound((prev) => ({ ...prev, [match]: picked }));
  };

  const onContinueClick = () => {
    if (!allFound) return;
    onContinue(wanted.map((f) => [f, found[f]] as ManualMod));
    close();
  };

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[58] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex max-h-[88vh] w-[620px] max-w-full flex-col overflow-hidden rounded-xl border border-amber-600/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <AlertTriangle size={17} className="text-amber-400" />
            {t("blockedMods.title")}
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <p className="text-sm leading-relaxed text-ink-600">
            {t("blockedMods.explain", { count: blocked.length })}
          </p>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-600">
                {t("blockedMods.watchFolders")}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={addFolder}
                  className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <FolderPlus size={12} /> {t("blockedMods.addFolder")}
                </button>
                <button
                  onClick={addFileManually}
                  className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <FilePlus size={12} /> {t("blockedMods.addFile")}
                </button>
              </div>
            </div>
            {folders.length === 0 ? (
              <p className="rounded-md border border-dashed border-edge px-3 py-2 text-xs text-ink-600">
                {t("blockedMods.noFolders")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {folders.map((f) => (
                  <li
                    key={f}
                    className="group flex items-center gap-2 rounded-md border border-edge bg-ink-950/40 px-2.5 py-1.5 text-xs transition hover:border-brass-600/40 hover:bg-brass-500/5"
                  >
                    <FolderOpen size={12} className="shrink-0 text-brass-400" />
                    <span className="flex-1 truncate text-gray-200" title={f}>
                      {f}
                    </span>
                    <button
                      onClick={() => removeFolder(f)}
                      title={t("blockedMods.removeFolder")}
                      className="text-ink-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-600">
                {t("blockedMods.filesNeeded")} ({wanted.length - missing.length}/{wanted.length})
              </span>
              <button
                onClick={openAll}
                className="flex items-center gap-1 rounded-md border border-brass-600/40 px-2 py-1 text-xs text-brass-300 transition hover:bg-brass-600/10"
              >
                <ExternalLink size={12} /> {t("blockedMods.openAll")}
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {blocked.map((b) => {
                const done = !!found[b.filename];
                return (
                  <li
                    key={`${b.project_id}:${b.file_id}`}
                    className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition ${
                      done
                        ? "border-brass-600/30 bg-brass-600/5"
                        : "border-edge bg-ink-950/40"
                    }`}
                  >
                    <span className="shrink-0">
                      {done ? (
                        <Check size={15} className="text-brass-400" />
                      ) : (
                        <Loader2 size={15} className="animate-spin text-ink-600" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-200" title={b.name}>
                        {b.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-ink-600" title={b.filename}>
                        {b.filename}
                      </div>
                    </div>
                    <button
                      onClick={() => api.openExternal(b.url).catch(() => {})}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                    >
                      <ExternalLink size={11} /> {t("blockedMods.open")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-edge px-5 py-3">
          <span className="text-xs text-ink-600">
            {allFound ? t("blockedMods.allReady") : t("blockedMods.waiting")}
          </span>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-ink-600 transition hover:text-gray-200"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={onContinueClick}
              disabled={!allFound}
              className="flex items-center gap-1.5 rounded-md bg-brass-600 px-4 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-brass-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={14} /> {t("blockedMods.continue")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
