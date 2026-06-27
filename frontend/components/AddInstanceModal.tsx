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
  DownloadCloud,
  AlertTriangle,
  Copy,
  MemoryStick,
  Terminal,
  Share2,
} from "lucide-react";
import * as api from "@/lib/api";
import type {
  BlockedMod,
  FlavorGroup,
  Instance,
  ManualMod,
  OptionalComponent,
  PreflightProgress,
  FeaturedPack,
  PackwizShare,
} from "@/lib/types";
import { VersionPicker, type LoaderStatus } from "@/components/VersionPicker";
import { useSupportedLoaders } from "@/lib/useSupportedLoaders";
import { ModpackBrowser } from "@/components/ModpackBrowser";
import { OptionalModsPicker } from "@/components/OptionalModsPicker";
import { FlavorPicker } from "@/components/FlavorPicker";
import { BlockedModsPicker } from "@/components/BlockedModsPicker";
import { SegmentedTabs, Dropdown, useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";


type PendingInstall =
  | {
      kind: "modpack";
      source: "modrinth" | "curseforge";
      projectId: string;
      versionId: string;
      name: string;
    }
  | { kind: "file"; source: "modrinth" | "curseforge"; path: string; name: string }
  | {
      kind: "packwiz";
      url: string;
      name: string;
      unsup: boolean;
      publicKey: string | null;
      icon?: string | null;
      banner?: string | null;
      description?: string | null;
      newsUrl?: string | null;
      playercountUrl?: string | null;
      minMemoryMb?: number | null;
      maxMemoryMb?: number | null;
      jvmArgs?: string[] | null;
      sharedBy?: string | null;
    };


type PickerData =
  | { kind: "optional"; components: OptionalComponent[] }
  | { kind: "flavors"; groups: FlavorGroup[] }
  | {
      kind: "blocked";
      mods: BlockedMod[];
      folders: string[];
      proceed: (manualMods: ManualMod[]) => void;
    };

type Tab = "custom" | "modrinth" | "curseforge" | "packwiz" | "import";

const TABS: { id: Tab; tkey: string }[] = [
  { id: "custom", tkey: "addInstance.tab.custom" },
  { id: "modrinth", tkey: "addInstance.tab.modrinth" },
  { id: "curseforge", tkey: "addInstance.tab.curseforge" },
  { id: "packwiz", tkey: "addInstance.tab.packwiz" },
  { id: "import", tkey: "addInstance.tab.import" },
];

const LOADERS: { id: string; tkey: string }[] = [
  { id: "vanilla", tkey: "instanceSettings.loader.vanilla" },
  { id: "fabric", tkey: "instanceSettings.loader.fabric" },
  { id: "quilt", tkey: "instanceSettings.loader.quilt" },
  { id: "forge", tkey: "instanceSettings.loader.forge" },
  { id: "neoforge", tkey: "instanceSettings.loader.neoforge" },
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


const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition caret-brass-400 focus:ring-brass-500/60";

export function AddInstanceModal({
  installing,
  detailInstanceId,
  initialTab,
  importOnly,
  initialPackwiz,
  onClose,
  onCreated,
  onInstallModpack,
  onInstallModpackFile,
  onError,
  featured,
  featuredEnabled,
  onOpenFeatured,
  onEnableFeatured,
}: {
  installing: boolean;
  detailInstanceId: string | null;
  initialTab?: Tab;

  importOnly?: boolean;
  initialPackwiz?: PackwizShare | null;
  onClose: () => void;
  onCreated: (instance: Instance) => void;
  onInstallModpack: (
    source: "modrinth" | "curseforge",
    projectId: string,
    versionId: string,
    name: string,
    optional: string[],
    manualMods?: ManualMod[],
  ) => void;
  onInstallModpackFile: (
    source: "modrinth" | "curseforge",
    path: string,
    name: string,
    optional: string[],
    manualMods?: ManualMod[],
  ) => void;
  onError: (e: string) => void;
  featured?: FeaturedPack[];
  featuredEnabled?: boolean;
  onOpenFeatured?: (id: string) => void;
  onEnableFeatured?: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(
    importOnly ? "import" : initialTab ?? "custom",
  );
  const [browserFiltersOpen, setBrowserFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { closing, close } = useClosable(onClose);

  const [name, setName] = useState("");
  const [loader, setLoader] = useState("vanilla");
  const [mc, setMc] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("stable");
  
  
  const [loaderStatus, setLoaderStatus] = useState<LoaderStatus>("ok");
  
  
  const { supported: supportedLoaders } = useSupportedLoaders(mc);

  
  
  useEffect(() => {
    if (supportedLoaders && !supportedLoaders.includes(loader)) {
      setLoader("vanilla");
      setLoaderVersion("stable");
    }
  }, [supportedLoaders, loader]);

  
  const [pending, setPending] = useState<PendingInstall | null>(null);

  const [picker, setPicker] = useState<PickerData | null>(null);

  const [prefStage, setPrefStage] = useState<PreflightProgress | null>(null);

  const loading = pending !== null && picker === null;
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const inspectGen = useRef(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api.onPreflightProgress((p) => setPrefStage(p)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const saveWatchFolders = (folders: string[]) => {
    api
      .getSettings()
      .then((s) => api.saveSettings({ ...s, manual_download_folders: folders }))
      .catch(() => {});
  };

  const resolveWatchFolders = async (): Promise<string[]> => {
    const settings = await api.getSettings().catch(() => null);
    let folders = settings?.manual_download_folders ?? [];
    if (folders.length === 0) {
      const dl = await api.defaultDownloadDir().catch(() => null);
      if (dl) folders = [dl];
    }
    return folders;
  };

  
  const closePicker = () => {
    inspectGen.current++;
    setPending(null);
    setPicker(null);
  };

  const cancelPreflight = () => {
    inspectGen.current++;
    api.cancelPreflight().catch(() => {});
    setPending(null);
    setPicker(null);
    setPrefStage(null);
    setCancelConfirm(false);
    close();
  };

  const requestClose = () => {
    if (pending) setCancelConfirm(true);
    else close();
  };

  const prefBlockedRef = useRef<BlockedMod[]>([]);

  const launchModpack = (
    intent: Extract<PendingInstall, { kind: "modpack" | "file" }>,
    ids: string[],
    manualMods: ManualMod[],
  ) => {
    if (intent.kind === "modpack") {
      onInstallModpack(
        intent.source,
        intent.projectId,
        intent.versionId,
        intent.name,
        ids,
        manualMods,
      );
    } else {
      onInstallModpackFile(intent.source, intent.path, intent.name, ids, manualMods);
    }
    setPending(null);
    setPicker(null);
  };

  const finalize = async (intent: PendingInstall, ids: string[]) => {
    if (intent.kind === "modpack" || intent.kind === "file") {
      const relevant = prefBlockedRef.current.filter(
        (b) => b.required || ids.includes(b.id),
      );
      if (relevant.length > 0) {
        const folders = await resolveWatchFolders();
        setPicker({
          kind: "blocked",
          mods: relevant,
          folders,
          proceed: (manual) => launchModpack(intent, ids, manual),
        });
        return;
      }
      launchModpack(intent, ids, []);
    } else {
      setBusy(true);
      try {
        const meta = {
          icon: intent.icon,
          banner: intent.banner,
          description: intent.description,
          newsUrl: intent.newsUrl,
          playercountUrl: intent.playercountUrl,
          minMemoryMb: intent.minMemoryMb,
          maxMemoryMb: intent.maxMemoryMb,
          jvmArgs: intent.jvmArgs,
          sharedBy: intent.sharedBy,
        };
        const inst = intent.unsup
          ? await api.createPackwizInstance(intent.name, intent.url, [], true, ids, intent.publicKey, meta)
          : await api.createPackwizInstance(intent.name, intent.url, ids, false, [], null, meta);
        onCreated(inst);
      } catch (e) {
        onError(String(e));
      } finally {
        setBusy(false);
        setPending(null);
      }
    }
  };

  const beginInstall = async (intent: PendingInstall) => {
    const gen = ++inspectGen.current;
    setPending(intent);
    setPicker(null);
    setPrefStage(null);
    prefBlockedRef.current = [];
    try {
      if (intent.kind === "packwiz") {
        if (intent.unsup) {
          const groups = await api.inspectPackwizFlavors(intent.url);
          if (gen !== inspectGen.current) return;
          if (groups.length === 0) await finalize(intent, []);
          else setPicker({ kind: "flavors", groups });
          return;
        }
        const comps = await api.inspectPackwiz(intent.url);
        if (gen !== inspectGen.current) return;
        if (comps.length === 0) await finalize(intent, []);
        else setPicker({ kind: "optional", components: comps });
        return;
      }

      const pre =
        intent.kind === "modpack"
          ? await api.preflightModpack(intent.source, intent.projectId, intent.versionId)
          : await api.preflightModpackFile(intent.path, intent.source);
      if (gen !== inspectGen.current) return;
      setPrefStage(null);
      prefBlockedRef.current = pre.blocked;
      if (pre.optional.length === 0) {
        await finalize(intent, []);
      } else {
        setPicker({ kind: "optional", components: pre.optional });
      }
    } catch {
      if (gen !== inspectGen.current) return;
      setPrefStage(null);
      await finalize(intent, []);
    }
  };

  const pickFile = async () => {
    try {
      const picked = await api.pickModpackFile();
      if (!picked) return;
      const base = picked.path
        .replace(/^.*[\\/]/, "")
        .replace(/\.[^.]+$/, "");
      await beginInstall({ kind: "file", source: picked.source, path: picked.path, name: base });
    } catch (e) {
      onError(String(e));
    }
  };

  const [packUrl, setPackUrl] = useState("");
  const [packBranches, setPackBranches] = useState<api.PackwizBranch[] | null>(
    null,
  );
  const [packBranch, setPackBranch] = useState("");
  const [findingBranches, setFindingBranches] = useState(false);
  const [packUnsup, setPackUnsup] = useState(true);
  const [packPublicKey, setPackPublicKey] = useState("");

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
        onError(t("addInstance.noBranches"));
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cancelConfirm) setCancelConfirm(false);
      else if (loading) setCancelConfirm(true);
      else if (pending) closePicker();
      else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, pending, loading, cancelConfirm]);

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
    let url = packUrl.trim();
    if (packBranches && packBranch) {
      const b = packBranches.find((x) => x.name === packBranch);
      if (b) url = b.pack_url;
    }
    await beginInstall({
      kind: "packwiz",
      url,
      name: "",
      unsup: packUnsup,
      publicKey: packUnsup && packPublicKey.trim() ? packPublicKey.trim() : null,
    });
  };

  const importPackwizZip = async () => {
    const picked = await api.pickPackwizZip().catch(() => null);
    if (!picked) return;
    let url: string;
    try {
      url = await api.extractPackwizPack(picked);
    } catch (e) {
      onError(String(e));
      return;
    }
    await beginInstall({
      kind: "packwiz",
      url,
      name: "",
      unsup: packUnsup,
      publicKey: packUnsup && packPublicKey.trim() ? packPublicKey.trim() : null,
    });
  };

  const startShareInstall = () => {
    if (!initialPackwiz) return;
    const s = initialPackwiz;
    void beginInstall({
      kind: "packwiz",
      url: s.pack_url,
      name: s.name ?? "",
      unsup: s.unsup,
      publicKey: s.signing_key,
      icon: s.icon,
      banner: s.banner,
      description: s.description,
      newsUrl: s.news_url,
      playercountUrl: s.playercount_url,
      minMemoryMb: s.min_memory_mb,
      maxMemoryMb: s.max_memory_mb,
      jvmArgs: s.jvm_args,
      sharedBy: s.shared_by,
    });
  };

  const sharePreview = !!initialPackwiz && pending === null;

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (loading) return;
        if (pending) {
          setCancelConfirm(true);
          return;
        }
        close();
      }}
    >
      <div
        style={{
          width:
            (tab === "modrinth" || tab === "curseforge") && browserFiltersOpen
              ? "min(1040px, 96vw)"
              : "640px",
          ...(importOnly ? {} : (ACCENTS[tab] as React.CSSProperties | undefined)),
        }}
        className="rise relative flex h-[80vh] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            {importOnly ? (
              <>
                <DownloadCloud size={17} className="text-brass-400" />
                {t("addInstance.tab.import")}
              </>
            ) : (
              <>
                <Boxes size={17} className="text-brass-400" />
                {t("addInstance.newInstance")}
              </>
            )}
          </h2>
          <button
            onClick={requestClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        {!importOnly && !initialPackwiz && (
          <div className="border-b border-edge px-3 py-2">
            <SegmentedTabs
              value={tab}
              onChange={(v) => {
                if (pending) closePicker();
                setTab(v as Tab);
              }}
              options={TABS.map((tb) => ({ id: tb.id, label: t(tb.tkey) }))}
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col p-5">
          {sharePreview ? (
            <SharePreview
              share={initialPackwiz!}
              busy={busy || installing}
              onInstall={startShareInstall}
              onCancel={close}
            />
          ) : pending ? (
            picker === null ? (
              <PreflightLoading stage={prefStage} />
            ) : picker.kind === "flavors" ? (
              <FlavorPicker
                title={pending.name || t("addInstance.modpackFallback")}
                groups={picker.groups}
                busy={installing || busy}
                onBack={closePicker}
                onConfirm={(ids) => finalize(pending, ids)}
              />
            ) : picker.kind === "blocked" ? (
              <BlockedModsPicker
                title={pending.name || t("addInstance.modpackFallback")}
                blocked={picker.mods}
                initialFolders={picker.folders}
                busy={installing || busy}
                onBack={closePicker}
                onConfirm={picker.proceed}
                onFoldersChange={saveWatchFolders}
              />
            ) : (
              <OptionalModsPicker
                title={pending.name || t("addInstance.modpackFallback")}
                components={picker.components}
                busy={installing || busy}
                onBack={closePicker}
                onConfirm={(ids) => finalize(pending, ids)}
              />
            )
          ) : (
          <>
          {tab === "custom" && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-0.5">
              <div>
                <div className="mb-1.5 text-sm text-ink-600">{t("addInstance.name")}</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("addInstance.namePlaceholder")}
                  className={inputCls}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">{t("addInstance.modLoader")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {LOADERS.map((l) => {
                    const disabled =
                      supportedLoaders !== null && !supportedLoaders.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        disabled={disabled}
                        title={disabled ? t("addInstance.notAvailableFor", { mc }) : undefined}
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
                        {t(l.tkey)}
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
                onStatus={setLoaderStatus}
              />
              <button
                disabled={
                  busy ||
                  !mc ||
                  
                  
                  
                  loaderStatus === "unavailable" ||
                  loaderStatus === "checking"
                }
                onClick={createCustom}
                className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {t("addInstance.createInstance")}
              </button>
            </div>
          )}

          {tab === "packwiz" && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-0.5">
              <p className="text-xs text-ink-600">
                {t("addInstance.pwDesc1")}
                <span className="text-brass-300">pack.toml</span>
                {t("addInstance.pwDesc2")}
                <span className="text-brass-300">{t("addInstance.pwRepo")}</span>
                {t("addInstance.pwDesc3")}
              </p>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">
                  {t("addInstance.pwUrlLabel")}
                </div>
                <input
                  value={packUrl}
                  onChange={(e) => setPackUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo  or  …/pack.toml"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-ink-600">
                <span className="h-px flex-1 bg-edge" />
                {t("addInstance.orSeparator")}
                <span className="h-px flex-1 bg-edge" />
              </div>

              <button
                onClick={importPackwizZip}
                disabled={busy}
                className="flex items-center justify-center gap-2 self-start rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Upload size={15} />
                )}
                {t("addInstance.importPackwizZip")}
              </button>

              {looksLikeRepo(packUrl) && !packBranches && (
                <button
                  disabled={findingBranches || !packUrl.trim()}
                  onClick={findBranches}
                  className="flex items-center justify-center gap-2 self-start rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {findingBranches ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <GitBranch size={15} />
                  )}
                  {t("addInstance.findBranches")}
                </button>
              )}

              {packBranches && packBranches.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm text-ink-600">
                    <GitBranch size={13} /> {t("addInstance.branch")}
                  </div>
                  <Dropdown
                    value={packBranch}
                    onChange={setPackBranch}
                    accentStyle={ACCENTS.packwiz as React.CSSProperties}
                    options={packBranches.map((b) => ({
                      value: b.name,
                      label: b.name,
                    }))}
                  />
                </div>
              )}

              <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-edge bg-ink-900/40 p-3">
                <button
                  onClick={() => setPackUnsup((v) => !v)}
                  className="flex items-start gap-2.5 text-left"
                >
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded transition ${
                      packUnsup
                        ? "bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow"
                        : "border border-ink-600 text-transparent"
                    }`}
                  >
                    <Check size={12} strokeWidth={3.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-100">
                      {t("addInstance.unsupEnable")}
                    </span>
                    <span className="block text-xs text-ink-600">
                      {t("addInstance.unsupDesc1")}
                      <span className="text-brass-300">unsup.toml</span>
                      {t("addInstance.unsupDesc2")}
                      <span className="text-brass-300">unsup</span>
                      {t("addInstance.unsupDesc3")}
                    </span>
                  </span>
                </button>
                {packUnsup && (
                  <div className="swap-in">
                    <div className="mb-1.5 text-xs text-ink-600">
                      {t("addInstance.pubKeyLabel")}<span className="font-mono">unsup.sig</span>
                    </div>
                    <input
                      value={packPublicKey}
                      onChange={(e) => setPackPublicKey(e.target.value)}
                      placeholder="ed25519 …  or  signify …"
                      className={`${inputCls} font-mono text-xs`}
                      spellCheck={false}
                    />
                  </div>
                )}
                <button
                  onClick={() =>
                    api.openExternal("https://git.sleeping.town/exa/unsup/wiki").catch(() => {})
                  }
                  className="flex items-center gap-1.5 self-start text-xs text-brass-300 hover:text-brass-400"
                >
                  <BookOpen size={13} /> {t("addInstance.unsupWiki")}
                </button>
              </div>

              <button
                onClick={() =>
                  api.openExternal("https://packwiz.infra.link/").catch(() => {})
                }
                className="flex items-center gap-1.5 self-start text-xs text-brass-300 hover:text-brass-400"
              >
                <BookOpen size={13} /> {t("addInstance.packwizWiki")}
              </button>
              <button
                disabled={
                  busy ||
                  !packUrl.trim() ||
                  (looksLikeRepo(packUrl) && !packBranch)
                }
                onClick={createPackwiz}
                className="brass-btn flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Hammer size={16} />
                )}
                {t("addInstance.addPackwiz")}
              </button>
            </div>
          )}

          {tab === "import" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <p className="text-xs text-ink-600">
                {t("addInstance.importDesc")}
              </p>
              {scanningImports ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-600">
                  <Loader2 size={16} className="animate-spin" /> {t("addInstance.scanning")}
                </div>
              ) : !imports || imports.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-600">
                  {t("addInstance.noImports")}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs text-ink-600">
                    <span>
                      {t("addInstance.foundSelected", {
                        found: imports.length,
                        selected: selectedImports.size,
                      })}
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
                        ? t("addInstance.clearAll")
                        : t("addInstance.selectAll")}
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
                    {selectedImports.size > 0
                      ? t("addInstance.importSelected", {
                          count: selectedImports.size,
                        })
                      : t("addInstance.importSelectedNone")}
                  </button>
                </>
              )}
            </div>
          )}

          {(tab === "modrinth" || tab === "curseforge") && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <button
                onClick={pickFile}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
              >
                <Upload size={14} /> {t("addInstance.uploadInstead")}
              </button>
              <ModpackBrowser
                source={tab}
                detailInstanceId={detailInstanceId}
                installing={installing}
                featured={featured}
                featuredEnabled={featuredEnabled}
                onOpenFeatured={onOpenFeatured}
                onEnableFeatured={onEnableFeatured}
                onFiltersOpenChange={setBrowserFiltersOpen}
                onInstall={(projectId, versionId, packName2) =>
                  beginInstall({
                    kind: "modpack",
                    source: tab,
                    projectId,
                    versionId,
                    name: packName2,
                  })
                }
              />
            </div>
          )}
          </>
          )}
        </div>

        {cancelConfirm && (
          <div className="modal-overlay absolute inset-0 z-10 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
            <div className="w-[340px] max-w-[90%] rounded-xl border border-amber-600/30 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
                <AlertTriangle size={16} className="text-amber-400" />
                {t("addInstance.cancelDownload.title")}
              </div>
              <p className="mb-4 text-xs leading-relaxed text-ink-500">
                {t("addInstance.cancelDownload.body")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCancelConfirm(false)}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                >
                  {t("addInstance.cancelDownload.keep")}
                </button>
                <button
                  onClick={cancelPreflight}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-amber-400"
                >
                  {t("addInstance.cancelDownload.confirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreflightLoading({ stage }: { stage: PreflightProgress | null }) {
  const t = useT();
  const isDownload = stage?.stage === "download";
  const pct =
    isDownload && stage && stage.total > 0
      ? Math.round((stage.current / stage.total) * 100)
      : null;
  const label =
    stage?.stage === "download"
      ? t("preflight.downloading")
      : stage?.stage === "optional"
        ? t("preflight.checkingOptional")
        : stage?.stage === "blocked"
          ? t("preflight.checkingBlocked")
          : t("preflight.preparing");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-10 text-ink-600">
      <Loader2 size={22} className="animate-spin text-brass-400" />
      <span className="text-sm">{label}</span>
      {isDownload && (
        <div className="w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div
              className="progress-fill h-full rounded-full transition-[width] duration-200"
              style={{ width: pct !== null ? `${pct}%` : "40%" }}
            />
          </div>
          {pct !== null && (
            <div className="mt-1 text-center text-xs tabular-nums text-ink-600">
              {pct}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SharePreview({
  share,
  busy,
  onInstall,
  onCancel,
}: {
  share: PackwizShare;
  busy: boolean;
  onInstall: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const host = (() => {
    try {
      return new URL(share.pack_url).host;
    } catch {
      return share.pack_url;
    }
  })();
  const name = share.name?.trim() || host || t("addInstance.modpackFallback");
  const ram =
    share.max_memory_mb || share.min_memory_mb
      ? share.min_memory_mb && share.max_memory_mb
        ? `${share.min_memory_mb}–${share.max_memory_mb} MB`
        : `${share.max_memory_mb ?? share.min_memory_mb} MB`
      : null;
  const jvm = share.jvm_args?.length ? share.jvm_args.join(" ") : null;
  const copyUrl = () => {
    navigator.clipboard
      .writeText(share.pack_url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto pr-1 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brass-600/40 bg-brass-500/10 px-3 py-1 text-[11px] font-medium text-brass-300">
          <Share2 size={12} /> {t("addInstance.share.badge")}
        </span>
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-edge bg-ink-950/60">
          {share.icon ? (
            <img src={share.icon} alt="" className="h-full w-full object-cover" />
          ) : (
            <Boxes size={34} className="text-brass-400" />
          )}
        </div>
        <div>
          <div className="font-mc text-xl tracking-wide text-gray-100">{name}</div>
          <div className="mt-1 text-xs text-ink-600">{t("addInstance.share.subtitle")}</div>
          {share.shared_by && (
            <div className="mt-1.5 text-xs text-brass-300">
              {t("addInstance.share.sharedBy", { user: share.shared_by })}
            </div>
          )}
        </div>
        {share.description && (
          <p className="max-w-md text-sm leading-relaxed text-ink-500">
            {share.description}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-ink-900/50 px-2 py-1 text-ink-500">
            <GitBranch size={12} /> packwiz
          </span>
          {share.unsup && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">
              <AlertTriangle size={12} /> {t("addInstance.share.unsup")}
            </span>
          )}
          {ram && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-ink-900/50 px-2 py-1 text-ink-500">
              <MemoryStick size={12} /> {ram}
            </span>
          )}
        </div>
        {jvm && (
          <div className="w-full max-w-md text-left">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-600">
              <Terminal size={12} /> {t("addInstance.share.jvmArgs")}
            </div>
            <div className="break-all rounded-md border border-edge bg-ink-950/50 px-3 py-2 font-mono text-[11px] text-ink-500">
              {jvm}
            </div>
          </div>
        )}
        <div className="flex w-full max-w-md items-stretch gap-2">
          <div className="min-w-0 flex-1 break-all rounded-md border border-edge bg-ink-950/50 px-3 py-2 text-left font-mono text-[11px] text-ink-600">
            {share.pack_url}
          </div>
          <button
            onClick={copyUrl}
            title={t("addInstance.share.copyUrl")}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge px-2.5 text-xs text-ink-500 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t("addInstance.share.copied") : t("addInstance.share.copy")}
          </button>
        </div>
      </div>
      <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-500 transition hover:text-gray-200 disabled:opacity-40"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onInstall}
          disabled={busy}
          className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {t("addInstance.share.install")}
        </button>
      </div>
    </div>
  );
}
