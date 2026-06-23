import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  FilePlus,
  Check,
  Loader2,
  Trash2,
  Download,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { BlockedMod, ManualMod } from "@/lib/types";

const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;

export function BlockedModsPicker({
  title,
  blocked,
  initialFolders,
  busy,
  onBack,
  onConfirm,
  onFoldersChange,
}: {
  title: string;
  blocked: BlockedMod[];
  initialFolders: string[];
  busy: boolean;
  onBack: () => void;
  onConfirm: (mods: ManualMod[]) => void;
  onFoldersChange: (folders: string[]) => void;
}) {
  const t = useT();
  const [folders, setFolders] = useState<string[]>(initialFolders);
  const [found, setFound] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string | null>(null);

  const wanted = blocked.map((b) => b.filename);
  const missing = wanted.filter((f) => !found[f]);
  const allFound = missing.length === 0;

  const byName: Record<string, BlockedMod> = Object.fromEntries(
    blocked.map((b) => [b.filename, b]),
  );

  const missingRef = useRef(missing);
  missingRef.current = missing;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const byNameRef = useRef(byName);
  byNameRef.current = byName;

  const poll = useCallback(async () => {
    const want = missingRef.current.map((f) => ({
      filename: f,
      sha1: byNameRef.current[f]?.sha1 ?? null,
    }));
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
    if (!match) return;
    const ok = await api
      .validateManualMod(picked, byName[match]?.sha1 ?? null)
      .catch(() => false);
    if (ok) {
      setRejected(null);
      setFound((prev) => ({ ...prev, [match]: picked }));
    } else {
      setRejected(match);
    }
  };

  const confirm = () => {
    if (!allFound || busy) return;
    onConfirm(wanted.map((f) => [f, found[f]] as ManualMod));
  };

  return (
    <div className="swap-in flex min-h-0 flex-1 flex-col gap-3">
      <button
        onClick={onBack}
        disabled={busy}
        className="flex shrink-0 items-center gap-1 self-start text-xs text-ink-600 transition hover:text-brass-300 disabled:opacity-50"
      >
        <ChevronLeft size={14} /> {t("common.back")}
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-ink-800 text-amber-400">
          <AlertTriangle size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-mc text-sm text-gray-100">
            {t("blockedMods.title")}
          </div>
          <div className="truncate text-xs text-ink-600">
            {t("blockedMods.subtitle", { title, count: blocked.length })}
          </div>
        </div>
      </div>

      <p className="shrink-0 text-xs leading-relaxed text-ink-600">
        {t("blockedMods.explain", { count: blocked.length })}
      </p>

      <div className="shrink-0">
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

      <div className="flex shrink-0 items-center justify-between">
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

      {rejected && (
        <p className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {t("blockedMods.invalidFile", { name: rejected })}
        </p>
      )}

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {blocked.map((b) => {
          const done = !!found[b.filename];
          return (
            <li
              key={b.id}
              className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition ${
                done ? "border-brass-600/30 bg-brass-600/5" : "border-edge bg-ink-950/40"
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

      <button
        onClick={confirm}
        disabled={!allFound || busy}
        className="brass-btn flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {allFound ? t("blockedMods.continue") : t("blockedMods.waiting")}
      </button>
    </div>
  );
}
