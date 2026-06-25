import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Package,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  FolderOpen,
  Folder,
  FileText,
  Box as BoxIcon,
  Image as ImageIcon,
  Sparkles,
  Check,
  Minus,
  AlertTriangle,
  Search,
  RefreshCw,
} from "lucide-react";
import * as api from "@/lib/api";
import { useClosable, Collapse, BrassSwitch } from "./ui";
import { useT } from "@/lib/i18n";
import { toast, toastProgress, dismissToast } from "@/lib/toast";
import { getCachedInfo, setCachedInfo } from "@/lib/modcache";
import type {
  ExportFormat,
  ExportNode,
  ExportTree,
  ExportTreeMod,
} from "@/lib/types";

const FORMATS: ExportFormat[] = ["packwiz", "modrinth", "curseforge"];

const ACCENTS: Record<ExportFormat, React.CSSProperties> = {
  packwiz: {
    "--color-brass-300": "#f9a8d4",
    "--color-brass-400": "#f472b6",
    "--color-brass-500": "#ec4899",
    "--color-brass-600": "#db2777",
    "--color-brass-700": "#be185d",
  } as React.CSSProperties,
  modrinth: {
    "--color-brass-300": "#86efac",
    "--color-brass-400": "#4ade80",
    "--color-brass-500": "#22c55e",
    "--color-brass-600": "#16a34a",
    "--color-brass-700": "#15803d",
  } as React.CSSProperties,
  curseforge: {
    "--color-brass-300": "#fdba74",
    "--color-brass-400": "#fb923c",
    "--color-brass-500": "#f97316",
    "--color-brass-600": "#ea580c",
    "--color-brass-700": "#c2410c",
  } as React.CSSProperties,
};

const FORMAT_SUPPORTS_AUTHOR: Record<ExportFormat, boolean> = {
  packwiz: true,
  modrinth: false,
  curseforge: true,
};

const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

function categoryIcon(category: string) {
  if (category === "resourcepacks") return <ImageIcon size={16} />;
  if (category === "shaderpacks") return <Sparkles size={16} />;
  return <BoxIcon size={16} />;
}

function leafPaths(node: ExportNode, out: string[]) {
  if (node.is_dir) {
    for (const c of node.children) leafPaths(c, out);
  } else {
    out.push(node.rel_path);
  }
}

function defaultLeaves(nodes: ExportNode[], out: string[]) {
  for (const n of nodes) {
    if (n.is_dir) defaultLeaves(n.children, out);
    else if (n.default_selected) out.push(n.rel_path);
  }
}

function dirState(
  node: ExportNode,
  selected: Set<string>,
): "all" | "some" | "none" {
  const leaves: string[] = [];
  leafPaths(node, leaves);
  if (leaves.length === 0) return "none";
  const picked = leaves.filter((p) => selected.has(p)).length;
  if (picked === 0) return "none";
  if (picked === leaves.length) return "all";
  return "some";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportModal({
  instanceId,
  mcVersion,
  loader,
  defaultName,
  onClose,
}: {
  instanceId: string;
  mcVersion: string;
  loader: string;
  defaultName: string;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [format, setFormat] = useState<ExportFormat>("packwiz");
  const [packName, setPackName] = useState(defaultName);
  const [author, setAuthor] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [tree, setTree] = useState<ExportTree | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [optional, setOptional] = useState<
    Record<string, { default: boolean; description: string }>
  >({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [modsOpen, setModsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [modQuery, setModQuery] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const goStep = (next: number) => {
    setDir(next > step ? "fwd" : "back");
    setStep(next);
  };

  const attemptClose = () => {
    if (busy) return;
    if (savePrompt) {
      close();
      return;
    }
    setCancelConfirm(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cancelConfirm) setCancelConfirm(false);
      else attemptClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const loadTree = useCallback(
    (initial: boolean) => {
      setRefreshing(true);
      api
        .exportTree(instanceId)
        .then((tr) => {
          setTree(tr);
          if (initial) {
            setSelectedMods(
              new Set(tr.mods.filter((m) => m.enabled).map((m) => m.path)),
            );
            const leaves: string[] = [];
            defaultLeaves(tr.files, leaves);
            setSelectedFiles(new Set(leaves));
          }
        })
        .catch((e) => toast(String(e), "error"))
        .finally(() => setRefreshing(false));
    },
    [instanceId],
  );

  useEffect(() => loadTree(true), [loadTree]);

  useEffect(() => {
    if (!tree) return;
    let alive = true;
    const queue = tree.mods.filter((m) => m.project_id && m.source !== "local");
    const seed: Record<string, string> = {};
    for (const m of queue) {
      const c = getCachedInfo(m.source, m.project_id!, m.version_id);
      if (c?.icon_url) seed[m.path] = c.icon_url;
    }
    if (Object.keys(seed).length) setIcons((prev) => ({ ...prev, ...seed }));
    let i = 0;
    const worker = async () => {
      while (i < queue.length && alive) {
        const m = queue[i++];
        if (seed[m.path]) continue;
        try {
          const info = await api.modInfo(
            instanceId,
            m.source,
            m.project_id!,
            m.version_id,
          );
          setCachedInfo(m.source, m.project_id!, m.version_id, info);
          if (info.icon_url && alive)
            setIcons((prev) => ({ ...prev, [m.path]: info.icon_url! }));
        } catch {
          /* ignore */
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      alive = false;
    };
  }, [tree, instanceId]);

  const toggleMod = useCallback(
    (path: string) =>
      setSelectedMods((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );

  const toggleOptional = useCallback(
    (path: string) =>
      setOptional((prev) => {
        const next = { ...prev };
        if (next[path]) delete next[path];
        else next[path] = { default: true, description: "" };
        return next;
      }),
    [],
  );

  const setOptionalDefault = useCallback(
    (path: string, def: boolean) =>
      setOptional((prev) => ({
        ...prev,
        [path]: { description: prev[path]?.description ?? "", default: def },
      })),
    [],
  );

  const setOptionalDesc = useCallback(
    (path: string, description: string) =>
      setOptional((prev) => ({
        ...prev,
        [path]: { default: prev[path]?.default ?? true, description },
      })),
    [],
  );

  const toggleFile = useCallback(
    (path: string) =>
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );

  const toggleDir = useCallback(
    (node: ExportNode) =>
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        const leaves: string[] = [];
        leafPaths(node, leaves);
        const allOn = leaves.every((p) => next.has(p));
        for (const p of leaves) {
          if (allOn) next.delete(p);
          else next.add(p);
        }
        return next;
      }),
    [],
  );

  const allFileLeaves = useMemo(() => {
    const out: string[] = [];
    if (tree) for (const n of tree.files) leafPaths(n, out);
    return out;
  }, [tree]);

  const filteredMods = useMemo(() => {
    const q = modQuery.trim().toLowerCase();
    const all = tree?.mods ?? [];
    return q ? all.filter((m) => m.name.toLowerCase().includes(q)) : all;
  }, [tree, modQuery]);

  const selectAllMods = () =>
    setSelectedMods(new Set((tree?.mods ?? []).map((m) => m.path)));
  const selectNoMods = () => setSelectedMods(new Set());
  const selectAllFiles = () => setSelectedFiles(new Set(allFileLeaves));
  const selectNoFiles = () => setSelectedFiles(new Set());

  const supportsAuthor = FORMAT_SUPPORTS_AUTHOR[format];
  const supportsOptionalMeta = format === "packwiz";

  const optionalForSelected = () => {
    const out: Record<string, { default: boolean; description: string }> = {};
    for (const [path, spec] of Object.entries(optional)) {
      if (selectedMods.has(path)) out[path] = spec;
    }
    return out;
  };

  const doExport = async () => {
    if (!packName.trim()) {
      toast(t("instanceSettings.export.modal.nameRequired"), "error");
      goStep(1);
      return;
    }
    setBusy(true);
    const key = `export:${instanceId}:${format}`;
    toastProgress(key, t("instanceSettings.export.exportingToast"), null);
    try {
      const path = await api.exportModpackSelected(
        instanceId,
        format,
        {
          mods: [...selectedMods],
          files: [...selectedFiles],
          optional: optionalForSelected(),
        },
        {
          name: packName.trim(),
          author: supportsAuthor ? author.trim() : "",
          version: version.trim() || "1.0.0",
          mc_version: mcVersion,
          loader,
          loader_version: null,
        },
      );
      dismissToast(key);
      toast(t("instanceSettings.export.exportedToast", { path }), "success");
      setSaveName(packName.trim());
      setSavePrompt(true);
    } catch (e) {
      dismissToast(key);
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    try {
      await api.saveExportConfig(instanceId, {
        id: "",
        name: saveName.trim() || packName.trim(),
        format,
        pack_name: packName.trim(),
        author: supportsAuthor ? author.trim() : "",
        version: version.trim() || "1.0.0",
        selection: {
          mods: [...selectedMods],
          files: [...selectedFiles],
          optional: optionalForSelected(),
        },
        created_at: 0,
      });
      toast(t("instanceSettings.export.modal.savedToast"), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      close();
    }
  };

  const primaryBtn =
    "brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50";
  const ghostBtn =
    "flex items-center gap-1 rounded-lg border border-edge px-4 py-2.5 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300";

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[55] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && attemptClose()}
    >
      <div
        className="relative flex max-h-[80vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/40 bg-ink-900 shadow-2xl"
        style={ACCENTS[format]}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Package size={17} className="text-brass-400" />
            {t("instanceSettings.export.modal.title")}
          </h2>
          <button
            onClick={attemptClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        {savePrompt ? (
          <div className="swap-in flex flex-col gap-4 p-5">
            <div className="grid h-12 w-12 place-items-center self-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow ring-1 ring-ink-950/30">
              <Check size={22} strokeWidth={3} />
            </div>
            <p className="text-center text-sm text-gray-200">
              {t("instanceSettings.export.modal.saveConfigPrompt")}
            </p>
            <div>
              <div className="mb-1.5 text-sm text-ink-600">
                {t("instanceSettings.export.modal.saveConfigName")}
              </div>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={close} className={`${ghostBtn} flex-1 justify-center`}>
                {t("instanceSettings.export.modal.skip")}
              </button>
              <button onClick={saveConfig} className={`${primaryBtn} flex-1`}>
                {t("instanceSettings.export.modal.saveConfig")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-1.5 px-5 pt-3.5">
              {[0, 1, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => goStep(s)}
                  aria-label={`Step ${s + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    s === step
                      ? "w-5 bg-brass-400"
                      : "w-1.5 bg-ink-700 hover:bg-ink-600"
                  }`}
                />
              ))}
            </div>

            <div
              className={`min-h-0 flex-1 overflow-y-auto p-5 ${
                busy ? "pointer-events-none select-none opacity-60" : ""
              }`}
              aria-disabled={busy}
            >
              <div
                key={step}
                className={dir === "back" ? "swap-in-back" : "swap-in"}
              >
                {step === 0 && (
                  <div className="flex flex-col gap-2.5">
                    <div className="mb-1 text-sm text-ink-600">
                      {t("instanceSettings.export.modal.stepFormat")}
                    </div>
                    {FORMATS.map((f) => {
                      const selected = f === format;
                      const label =
                        f === "packwiz"
                          ? "packwiz"
                          : f === "modrinth"
                            ? t("instanceSettings.export.mrpack")
                            : t("instanceSettings.export.cfzip");
                      const desc = t(
                        `instanceSettings.export.modal.format${
                          f[0].toUpperCase() + f.slice(1)
                        }Desc`,
                      );
                      return (
                        <button
                          key={f}
                          onClick={() => setFormat(f)}
                          style={ACCENTS[f]}
                          className={`group flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                            selected
                              ? "border-brass-500 bg-brass-500/15"
                              : "border-edge hover:border-brass-600/50 hover:bg-brass-500/5"
                          }`}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brass-500/20 text-brass-400 transition group-hover:bg-brass-500/30">
                            <Package size={17} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-gray-100">
                              {label}
                            </span>
                            <span className="block text-xs text-ink-600">
                              {desc}
                            </span>
                          </span>
                          {selected && (
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow ring-1 ring-ink-950/30">
                              <Check size={11} strokeWidth={3.5} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {step === 1 && (
                  <div className="flex flex-col gap-4">
                    <div className="mb-1 text-sm text-ink-600">
                      {t("instanceSettings.export.modal.stepDetails")}
                    </div>
                    <Labeled label={t("instanceSettings.export.modal.packName")}>
                      <input
                        value={packName}
                        onChange={(e) => setPackName(e.target.value)}
                        className={inputCls}
                      />
                    </Labeled>
                    <Labeled
                      label={t("instanceSettings.export.modal.author")}
                      hint={
                        supportsAuthor
                          ? undefined
                          : t("instanceSettings.export.modal.authorUnsupported")
                      }
                    >
                      <input
                        value={supportsAuthor ? author : ""}
                        disabled={!supportsAuthor}
                        onChange={(e) => setAuthor(e.target.value)}
                        className={`${inputCls} disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}
                      />
                    </Labeled>
                    <Labeled label={t("instanceSettings.export.modal.version")}>
                      <input
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        className={inputCls}
                      />
                    </Labeled>
                    <div className="flex gap-2 text-xs text-ink-600">
                      <span className="rounded-md bg-ink-800 px-2 py-1">
                        {mcVersion}
                      </span>
                      <span className="rounded-md bg-ink-800 px-2 py-1">
                        {loader}
                      </span>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-ink-600">
                        {t("instanceSettings.export.modal.stepFiles")}
                      </div>
                      <button
                        onClick={() => loadTree(false)}
                        disabled={refreshing}
                        title={t("instanceSettings.export.modal.refresh")}
                        className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
                      >
                        <RefreshCw
                          size={12}
                          className={refreshing ? "animate-spin" : ""}
                        />
                        {t("instanceSettings.export.modal.refresh")}
                      </button>
                    </div>

                    {!tree ? (
                      <div className="grid place-items-center py-8">
                        <Loader2
                          className="animate-spin text-ink-600"
                          size={20}
                        />
                      </div>
                    ) : (
                      <>
                        <CollapsibleSection
                          open={modsOpen}
                          onToggle={() => setModsOpen((o) => !o)}
                          title={t("instanceSettings.export.modal.mods")}
                          meta={t("instanceSettings.export.modal.modsCount", {
                            selected: selectedMods.size,
                            total: tree.mods.length,
                          })}
                          hint={t("instanceSettings.export.modal.expandHint")}
                        >
                          <div className="mb-2 flex items-center gap-1.5">
                            <SearchBox
                              value={modQuery}
                              onChange={setModQuery}
                              placeholder={t(
                                "instanceSettings.export.modal.searchMods",
                              )}
                            />
                            <SmallBtn onClick={selectAllMods}>
                              {t("instanceSettings.export.modal.selectAll")}
                            </SmallBtn>
                            <SmallBtn onClick={selectNoMods}>
                              {t("instanceSettings.export.modal.selectNone")}
                            </SmallBtn>
                          </div>
                          {tree.mods.length > 0 && (
                            <p className="mb-2 text-[11px] leading-snug text-ink-600">
                              {t("instanceSettings.export.modal.optionalHint")}
                              {!supportsOptionalMeta &&
                                ` ${t("instanceSettings.export.modal.optionalUnsupported")}`}
                            </p>
                          )}
                          <div className="stagger flex flex-col gap-1">
                            {filteredMods.map((m) => (
                              <ModRow
                                key={m.path}
                                mod={m}
                                icon={icons[m.path]}
                                checked={selectedMods.has(m.path)}
                                optional={optional[m.path]}
                                supportsMeta={supportsOptionalMeta}
                                onToggle={toggleMod}
                                onToggleOptional={toggleOptional}
                                onSetDefault={setOptionalDefault}
                                onSetDesc={setOptionalDesc}
                              />
                            ))}
                          </div>
                        </CollapsibleSection>

                        <CollapsibleSection
                          open={filesOpen}
                          onToggle={() => setFilesOpen((o) => !o)}
                          title={t("instanceSettings.export.modal.configs")}
                          meta={`${selectedFiles.size}`}
                          hint={t("instanceSettings.export.modal.expandHint")}
                        >
                          <div className="mb-2 flex items-center gap-1.5">
                            <SearchBox
                              value={query}
                              onChange={setQuery}
                              placeholder={t(
                                "instanceSettings.export.modal.search",
                              )}
                            />
                            <SmallBtn onClick={selectAllFiles}>
                              {t("instanceSettings.export.modal.selectAll")}
                            </SmallBtn>
                            <SmallBtn onClick={selectNoFiles}>
                              {t("instanceSettings.export.modal.selectNone")}
                            </SmallBtn>
                          </div>
                          <div className="stagger">
                            {tree.files.map((node) => (
                              <TreeRow
                                key={node.rel_path}
                                node={node}
                                depth={0}
                                query={query.toLowerCase()}
                                selected={selectedFiles}
                                onToggleFile={toggleFile}
                                onToggleDir={toggleDir}
                              />
                            ))}
                          </div>
                        </CollapsibleSection>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-edge px-5 py-3">
              <button
                onClick={() => (step === 0 ? attemptClose() : goStep(step - 1))}
                disabled={busy}
                className={`${ghostBtn} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {step === 0 ? (
                  t("instanceSettings.export.modal.cancel")
                ) : (
                  <>
                    <ChevronLeft size={15} />
                    {t("instanceSettings.export.modal.back")}
                  </>
                )}
              </button>
              {step < 2 ? (
                <button
                  onClick={() => goStep(step + 1)}
                  disabled={step === 1 && !packName.trim()}
                  className={primaryBtn}
                >
                  {t("instanceSettings.export.modal.next")}
                  <ChevronRight size={15} />
                </button>
              ) : (
                <button onClick={doExport} disabled={busy} className={primaryBtn}>
                  {busy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Download size={15} />
                  )}
                  {busy
                    ? t("instanceSettings.export.modal.exporting")
                    : t("instanceSettings.export.modal.export")}
                </button>
              )}
            </div>
          </>
        )}

        {cancelConfirm && (
          <div className="modal-overlay absolute inset-0 z-10 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
            <div className="w-[340px] max-w-[90%] rounded-xl border border-amber-600/30 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
                <AlertTriangle size={16} className="text-amber-400" />
                {t("instanceSettings.export.modal.cancelTitle")}
              </div>
              <p className="mb-4 text-xs leading-relaxed text-ink-500">
                {t("instanceSettings.export.modal.cancelBody")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCancelConfirm(false)}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                >
                  {t("instanceSettings.export.modal.cancelKeep")}
                </button>
                <button
                  onClick={close}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-amber-400"
                >
                  {t("instanceSettings.export.modal.cancelDiscard")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm text-ink-600">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-amber-400/80">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1">
      <Search
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md bg-ink-950/70 py-1.5 pl-7 pr-2 text-xs outline-none ring-1 ring-edge transition focus:ring-brass-500/60"
      />
    </div>
  );
}

function SmallBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
    >
      {children}
    </button>
  );
}

function CollapsibleSection({
  open,
  onToggle,
  title,
  meta,
  hint,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  meta: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-edge bg-ink-950/30">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-brass-500/[0.04]"
      >
        <ChevronRight
          size={15}
          className={`shrink-0 text-brass-400 transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-sm font-medium text-gray-200">{title}</span>
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-600">
          {meta}
        </span>
        <span className="ml-auto text-[11px] text-ink-600">
          {open ? "" : hint}
        </span>
      </button>
      <Collapse open={open}>
        <div className="border-t border-edge p-2.5">{children}</div>
      </Collapse>
    </div>
  );
}

function CheckBox({ state }: { state: "all" | "some" | "none" }) {
  const on = state !== "none";
  return (
    <span
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition ${
        on ? "border-brass-500 bg-brass-500" : "border-ink-600"
      }`}
    >
      {state === "all" && (
        <Check size={11} strokeWidth={3} className="text-ink-950" />
      )}
      {state === "some" && (
        <Minus size={11} strokeWidth={3} className="text-ink-950" />
      )}
    </span>
  );
}

const ModRow = memo(function ModRow({
  mod,
  icon,
  checked,
  optional,
  supportsMeta,
  onToggle,
  onToggleOptional,
  onSetDefault,
  onSetDesc,
}: {
  mod: ExportTreeMod;
  icon?: string;
  checked: boolean;
  optional?: { default: boolean; description: string };
  supportsMeta: boolean;
  onToggle: (path: string) => void;
  onToggleOptional: (path: string) => void;
  onSetDefault: (path: string, def: boolean) => void;
  onSetDesc: (path: string, desc: string) => void;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const isOptional = !!optional;
  const badge =
    mod.source === "modrinth"
      ? "Modrinth"
      : mod.source === "curseforge"
        ? "CurseForge"
        : t("instanceSettings.export.modal.sourceLocal");
  return (
    <div
      className={`rounded-md border transition ${
        isOptional && checked
          ? "border-brass-500/50 bg-brass-500/[0.06]"
          : "border-edge bg-ink-950/30"
      }`}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm">
        <button
          onClick={() => onToggle(mod.path)}
          className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <CheckBox state={checked ? "all" : "none"} />
          <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded bg-ink-900 text-ink-600">
            {icon && !failed ? (
              <img
                src={icon}
                alt=""
                loading="eager"
                decoding="async"
                className="h-full w-full object-cover"
                onError={() => setFailed(true)}
              />
            ) : (
              categoryIcon(mod.category)
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-gray-200" title={mod.name}>
            {mod.name}
          </span>
        </button>
        {checked && (
          <button
            onClick={() => onToggleOptional(mod.path)}
            title={t("instanceSettings.export.modal.optionalOn")}
            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
              isOptional
                ? "border-brass-500 bg-brass-500/20 text-brass-200"
                : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
            }`}
          >
            {t("instanceSettings.export.modal.makeOptional")}
          </button>
        )}
        <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-600">
          {badge}
        </span>
      </div>

      <Collapse open={isOptional && checked}>
        <div className="flex flex-col gap-2 border-t border-brass-600/20 px-2.5 py-2">
          {supportsMeta ? (
            <>
              <label className="flex items-center justify-between gap-3 text-xs text-gray-200">
                <span>{t("instanceSettings.export.modal.optionalDefaultOn")}</span>
                <BrassSwitch
                  checked={optional?.default ?? true}
                  onChange={(v) => onSetDefault(mod.path, v)}
                />
              </label>
              <div>
                <div className="mb-1 text-[11px] text-ink-600">
                  {t("instanceSettings.export.modal.optionalDescLabel")}
                </div>
                <textarea
                  value={optional?.description ?? ""}
                  onChange={(e) => onSetDesc(mod.path, e.target.value)}
                  placeholder={t(
                    "instanceSettings.export.modal.optionalDescPlaceholder",
                  )}
                  rows={2}
                  className="w-full resize-none rounded-md bg-ink-950/70 px-2.5 py-1.5 text-xs outline-none ring-1 ring-edge transition focus:ring-brass-500/60"
                />
              </div>
            </>
          ) : (
            <p className="text-[11px] leading-snug text-ink-600">
              {t("instanceSettings.export.modal.optionalUnsupported")}
            </p>
          )}
        </div>
      </Collapse>
    </div>
  );
});

type TreeRowProps = {
  node: ExportNode;
  depth: number;
  query: string;
  selected: Set<string>;
  onToggleFile: (p: string) => void;
  onToggleDir: (n: ExportNode) => void;
};

const TreeRow = memo(
  function TreeRow({
    node,
    depth,
    query,
    selected,
    onToggleFile,
    onToggleDir,
  }: TreeRowProps) {
    const [open, setOpen] = useState(false);
    const matches = query ? node.rel_path.toLowerCase().includes(query) : true;
    const childMatches =
      node.is_dir &&
      (matches || node.children.some((c) => deepMatch(c, query)));
    if (node.is_dir && !childMatches) return null;
    if (!node.is_dir && !matches) return null;
    const isOpen = open || query.length > 0;
    const indent = depth * 14;

    if (node.is_dir) {
      return (
        <div>
          <div
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition hover:bg-ink-800/40"
            style={{ marginLeft: indent }}
          >
            <button onClick={() => onToggleDir(node)}>
              <CheckBox state={dirState(node, selected)} />
            </button>
            <button
              onClick={() => setOpen(!open)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <ChevronRight
                size={13}
                className={`shrink-0 text-ink-600 transition-transform duration-200 ${
                  isOpen ? "rotate-90" : ""
                }`}
              />
              {isOpen ? (
                <FolderOpen size={14} className="shrink-0 text-brass-400" />
              ) : (
                <Folder size={14} className="shrink-0 text-brass-400" />
              )}
              <span className="truncate text-gray-200">{node.name}</span>
              <span className="text-[10px] text-ink-600">
                {formatBytes(node.size)}
              </span>
            </button>
          </div>
          {isOpen && (
            <div className="fade-in">
              {node.children.map((c) => (
                <TreeRow
                  key={c.rel_path}
                  node={c}
                  depth={depth + 1}
                  query={query}
                  selected={selected}
                  onToggleFile={onToggleFile}
                  onToggleDir={onToggleDir}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={() => onToggleFile(node.rel_path)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition hover:bg-ink-800/40"
        style={{ marginLeft: indent, width: `calc(100% - ${indent}px)` }}
      >
        <CheckBox state={selected.has(node.rel_path) ? "all" : "none"} />
        <FileText size={13} className="shrink-0 text-ink-600" />
        <span className="min-w-0 flex-1 truncate text-gray-300">{node.name}</span>
        <span className="text-[10px] text-ink-600">{formatBytes(node.size)}</span>
      </button>
    );
  },
  (a, b) => {
    if (
      a.node !== b.node ||
      a.depth !== b.depth ||
      a.query !== b.query ||
      a.onToggleFile !== b.onToggleFile ||
      a.onToggleDir !== b.onToggleDir
    )
      return false;
    if (a.node.is_dir) {
      return dirState(a.node, a.selected) === dirState(b.node, b.selected);
    }
    return a.selected.has(a.node.rel_path) === b.selected.has(b.node.rel_path);
  },
);

function deepMatch(node: ExportNode, query: string): boolean {
  if (!query) return true;
  if (node.rel_path.toLowerCase().includes(query)) return true;
  return node.is_dir && node.children.some((c) => deepMatch(c, query));
}
