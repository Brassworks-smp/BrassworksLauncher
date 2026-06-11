import { useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  Boxes,
  Hammer,
  Upload,
  BookOpen,
  GitBranch,
  Check,
  Box,
  Download,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Instance } from "@/lib/types";
import { VersionPicker } from "@/components/VersionPicker";
import { ModpackBrowser } from "@/components/ModpackBrowser";
import { SegmentedTabs, Dropdown, useClosable } from "@/components/ui";

type Tab = "custom" | "modrinth" | "curseforge" | "packwiz" | "import";

const TABS: { id: Tab; label: string }[] = [
  { id: "custom", label: "Custom" },
  { id: "modrinth", label: "Modrinth" },
  { id: "curseforge", label: "CurseForge" },
  { id: "packwiz", label: "packwiz" },
  { id: "import", label: "Import" },
];

const LOADERS: { id: string; label: string }[] = [
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "forge", label: "Forge" },
  { id: "neoforge", label: "NeoForge" },
];

const ACCENTS: Record<Tab, Record<string, string> | undefined> = {
  custom: undefined,
  modrinth: {
    "--color-brass-300": "#86efac",
    "--color-brass-400": "#4ade80",
    "--color-brass-500": "#22c55e",
    "--color-brass-600": "#16a34a",
    "--color-brass-700": "#15803d",
  },
  curseforge: {
    "--color-brass-300": "#fdba74",
    "--color-brass-400": "#fb923c",
    "--color-brass-500": "#f97316",
    "--color-brass-600": "#ea580c",
    "--color-brass-700": "#c2410c",
  },
  packwiz: {
    "--color-brass-300": "#f9a8d4",
    "--color-brass-400": "#f472b6",
    "--color-brass-500": "#ec4899",
    "--color-brass-600": "#db2777",
    "--color-brass-700": "#be185d",
  },
  import: {
    "--color-brass-300": "#93c5fd",
    "--color-brass-400": "#60a5fa",
    "--color-brass-500": "#3b82f6",
    "--color-brass-600": "#2563eb",
    "--color-brass-700": "#1d4ed8",
  },
};

/** Heuristic loader availability by Minecraft version (avoids a request storm). */
function loaderAllowed(loader: string, mc: string): boolean {
  if (loader === "vanilla") return true;
  const parts = mc.split(".");
  if (parts[0] !== "1") return true;
  const minor = Number(parts[1]);
  const patch = Number(parts[2] ?? "0");
  if (!Number.isFinite(minor)) return true; 
  if (loader === "neoforge") return minor > 20 || (minor === 20 && patch >= 1);
  if (loader === "fabric" || loader === "quilt") return minor >= 14;
  if (loader === "forge") return minor >= 1;
  return true;
}

const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

export function AddInstanceModal({
  installing,
  detailInstanceId,
  onClose,
  onCreated,
  onInstallModpack,
  onUploadModpack,
  onError,
}: {
  installing: boolean;
  detailInstanceId: string | null;
  onClose: () => void;
  onCreated: (instance: Instance) => void;
  onInstallModpack: (
    source: "modrinth" | "curseforge",
    projectId: string,
    versionId: string,
    name: string,
  ) => void;
  onUploadModpack: (
    source: "modrinth" | "curseforge",
    data: number[],
    name: string,
  ) => void;
  onError: (e: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("custom");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { closing, close } = useClosable(onClose);

  const [name, setName] = useState("");
  const [loader, setLoader] = useState("fabric");
  const [mc, setMc] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("stable");

  useEffect(() => {
    if (mc && !loaderAllowed(loader, mc)) {
      setLoader("vanilla");
      setLoaderVersion("stable");
    }
  }, [mc, loader]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const source: "modrinth" | "curseforge" = file.name.endsWith(".mrpack")
      ? "modrinth"
      : "curseforge";
    const buf = await file.arrayBuffer();
    onUploadModpack(source, Array.from(new Uint8Array(buf)), file.name.replace(/\.[^.]+$/, ""));
  };

  const [packName, setPackName] = useState("");
  const [packUrl, setPackUrl] = useState("");
  const [packBranches, setPackBranches] = useState<api.PackwizBranch[] | null>(
    null,
  );
  const [packBranch, setPackBranch] = useState("");
  const [findingBranches, setFindingBranches] = useState(false);

  const looksLikeRepo = (s: string) =>
      /github\.com\//.test(s);

  useEffect(() => {
    setPackBranches(null);
    setPackBranch("");
  }, [packUrl]);

  const [imports, setImports] = useState<api.ImportCandidate[] | null>(null);
  const [scanningImports, setScanningImports] = useState(false);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const importKey = (c: api.ImportCandidate) => `${c.source}:${c.key}`;

  useEffect(() => {
    if (tab !== "import" || imports || scanningImports) return;
    setScanningImports(true);
    api
      .scanImportable()
      .then(setImports)
      .catch((e) => {
        onError(String(e));
        setImports([]);
      })
      .finally(() => setScanningImports(false));
  }, [tab, imports, scanningImports, onError]);

  const toggleImport = (k: string) =>
    setSelectedImports((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const runImport = async () => {
    if (selectedImports.size === 0) return;
    setBusy(true);
    try {
      const created = await api.importExternal(Array.from(selectedImports));
      if (created.length > 0) onCreated(created[created.length - 1]);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const findBranches = async () => {
    setFindingBranches(true);
    setPackBranches(null);
    try {
      const list = await api.listPackwizBranches(packUrl.trim());
      setPackBranches(list);
      if (list.length === 0) {
        onError("No branches with a pack.toml found in that repo.");
      } else {
        const pref =
          list.find((b) => b.name === "main" || b.name === "master") ?? list[0];
        setPackBranch(pref.name);
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setFindingBranches(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const createCustom = async () => {
    setBusy(true);
    try {
      const inst = await api.createCustomInstance(name, mc, loader, loaderVersion);
      onCreated(inst);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const createPackwiz = async () => {
    setBusy(true);
    try {
      let url = packUrl.trim();
      if (packBranches && packBranch) {
        const b = packBranches.find((x) => x.name === packBranch);
        if (b) url = b.pack_url;
      }
      const inst = await api.createPackwizInstance(packName, url);
      onCreated(inst);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={ACCENTS[tab] as React.CSSProperties | undefined}
        className="rise flex h-[80vh] w-[640px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl"
      >
        <input
          ref={fileInput}
          type="file"
          accept=".mrpack,.zip"
          onChange={onPickFile}
          className="hidden"
        />
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Boxes size={17} className="text-brass-400" />
            New instance
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-edge px-3 py-2">
          <SegmentedTabs
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            options={TABS.map((t) => ({ id: t.id, label: t.label }))}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-5">
          {tab === "custom" && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
              <div>
                <div className="mb-1.5 text-sm text-ink-600">Name</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My instance"
                  className={inputCls}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">Mod loader</div>
                <div className="flex flex-wrap gap-1.5">
                  {LOADERS.map((l) => {
                    const disabled = !!mc && !loaderAllowed(l.id, mc);
                    return (
                      <button
                        key={l.id}
                        disabled={disabled}
                        title={disabled ? `Not available for ${mc}` : undefined}
                        onClick={() => {
                          setLoader(l.id);
                          setLoaderVersion("stable");
                        }}
                        className={`rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          loader === l.id
                            ? "border-brass-500 bg-brass-500/15 text-brass-200"
                            : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
                        }`}
                      >
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <VersionPicker
                loader={loader}
                mc={mc}
                setMc={setMc}
                loaderVersion={loaderVersion}
                setLoaderVersion={setLoaderVersion}
              />
              <button
                disabled={busy || !mc}
                onClick={createCustom}
                className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Create instance
              </button>
            </div>
          )}

          {tab === "packwiz" && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
              <p className="text-xs text-ink-600">
                Point at a <span className="text-brass-300">pack.toml</span> URL,
                or a <span className="text-brass-300">GitHub repo</span> to pick a
                branch. The launcher detects the loader + Minecraft version and
                syncs on launch.
              </p>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">Name (optional)</div>
                <input
                  value={packName}
                  onChange={(e) => setPackName(e.target.value)}
                  placeholder="Leave blank to use the pack's name"
                  className={inputCls}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">
                  pack.toml URL or GitHub repo
                </div>
                <input
                  value={packUrl}
                  onChange={(e) => setPackUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo  or  …/pack.toml"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </div>

              {looksLikeRepo(packUrl) && !packBranches && (
                <button
                  disabled={findingBranches || !packUrl.trim()}
                  onClick={findBranches}
                  className="flex items-center justify-center gap-2 self-start rounded-lg border border-brass-600/40 px-3 py-2 text-sm text-brass-200 transition hover:bg-brass-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {findingBranches ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <GitBranch size={15} />
                  )}
                  Find branches
                </button>
              )}

              {packBranches && packBranches.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm text-ink-600">
                    <GitBranch size={13} /> Branch
                  </div>
                  <Dropdown
                    value={packBranch}
                    onChange={setPackBranch}
                    options={packBranches.map((b) => ({
                      value: b.name,
                      label: b.name,
                    }))}
                  />
                </div>
              )}

              <button
                onClick={() =>
                  api.openExternal("https://packwiz.infra.link/").catch(() => {})
                }
                className="flex items-center gap-1.5 self-start text-xs text-brass-300 hover:text-brass-400"
              >
                <BookOpen size={13} /> What is packwiz? Read the wiki →
              </button>
              <button
                disabled={
                  busy ||
                  !packUrl.trim() ||
                  (looksLikeRepo(packUrl) && !packBranch)
                }
                onClick={createPackwiz}
                className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Hammer size={16} />
                )}
                Add packwiz instance
              </button>
            </div>
          )}

          {tab === "import" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <p className="text-xs text-ink-600">
                Instances found in Prism Launcher and the Modrinth App. Importing
                copies their mods, configs, and worlds into a new Brassworks
                instance (Prism groups become folders).
              </p>
              {scanningImports ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-600">
                  <Loader2 size={16} className="animate-spin" /> Scanning launchers…
                </div>
              ) : !imports || imports.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-600">
                  No Prism Launcher or Modrinth App instances found.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs text-ink-600">
                    <span>
                      {imports.length} found · {selectedImports.size} selected
                    </span>
                    <button
                      onClick={() =>
                        setSelectedImports(
                          selectedImports.size === imports.length
                            ? new Set()
                            : new Set(imports.map(importKey)),
                        )
                      }
                      className="text-brass-300 hover:text-brass-400"
                    >
                      {selectedImports.size === imports.length
                        ? "Clear all"
                        : "Select all"}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                    {imports.map((c) => {
                      const k = importKey(c);
                      const on = selectedImports.has(k);
                      return (
                        <button
                          key={k}
                          onClick={() => toggleImport(k)}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                            on
                              ? "border-brass-500/60 bg-brass-500/10"
                              : "border-edge hover:border-brass-600/40"
                          }`}
                        >
                          <span
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                              on
                                ? "border-brass-500 bg-brass-500 text-ink-950"
                                : "border-edge"
                            }`}
                          >
                            {on && <Check size={12} />}
                          </span>
                          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-edge bg-ink-950/60 text-brass-400">
                            {c.icon ? (
                              <img
                                src={c.icon}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Box size={18} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-gray-100">
                              {c.name}
                            </span>
                            <span className="block truncate text-[11px] text-ink-600">
                              {c.loader} · {c.minecraft}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {c.group && (
                              <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-500">
                                {c.group}
                              </span>
                            )}
                            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
                              {c.source}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    disabled={busy || selectedImports.size === 0}
                    onClick={runImport}
                    className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Download size={16} />
                    )}
                    Import{" "}
                    {selectedImports.size > 0 ? `${selectedImports.size} ` : ""}
                    selected
                  </button>
                </>
              )}
            </div>
          )}

          {(tab === "modrinth" || tab === "curseforge") && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <button
                onClick={() => fileInput.current?.click()}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
              >
                <Upload size={14} /> Upload a .mrpack / CurseForge .zip instead
              </button>
              <ModpackBrowser
                source={tab}
                detailInstanceId={detailInstanceId}
                installing={installing}
                onInstall={(projectId, versionId, packName2) =>
                  onInstallModpack(tab, projectId, versionId, packName2)
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
