import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Github,
  Share2,
  Link2,
  Copy,
  FileDown,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Loader2,
  Unplug,
  KeyRound,
  Check,
  DownloadCloud,
  UploadCloud,
  Files,
  Settings2,
  GitCompare,
  HardDrive,
  Star,
  GitFork,
  Lock,
  Globe,
  FilePlus2,
  FileMinus2,
  FilePen,
  Save,
} from "lucide-react";
import * as api from "@/lib/api";
import { useClosable } from "./ui";
import { useT } from "@/lib/i18n";
import { toast, toastProgress, dismissToast } from "@/lib/toast";
import { PackContentEditor, type PackContentValue } from "./PackContentEditor";
import type {
  Instance,
  PackShare,
  PushProgress,
  SharePackParams,
  ShareRepoInfo,
  ShareDiffEntry,
} from "@/lib/types";

const TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=Brassworks%20Launcher";

const PACK_SETTINGS_DIFF_PATH = "__pack_settings__";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ShareModal({
  instance,
  onChanged,
  onClose,
}: {
  instance: Instance;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [remember, setRemember] = useState(true);

  const [share, setShare] = useState<PackShare | null>(instance.share);
  const [link, setLink] = useState("");
  const [pending, setPending] = useState(false);

  const [configLoaded, setConfigLoaded] = useState(false);
  const [initialValue, setInitialValue] = useState<PackContentValue | null>(null);
  const valueRef = useRef<PackContentValue | null>(null);
  const cancelledRef = useRef(false);
  const saveCfgRef = useRef<() => Promise<string>>(async () => "");

  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<PushProgress | null>(null);
  const [embeddedConfirm, setEmbeddedConfirm] = useState<string[] | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncConfirm, setSyncConfirm] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);

  const [relinkOpen, setRelinkOpen] = useState(false);
  const [relinkUrl, setRelinkUrl] = useState("");
  const [relinking, setRelinking] = useState(false);

  const [tab, setTab] = useState<"content" | "details" | "diff">("content");

  const [params, setParams] = useState<SharePackParams | null>(null);
  const [savedParams, setSavedParams] = useState<SharePackParams | null>(null);
  const [savingParams, setSavingParams] = useState(false);

  const [repoInfo, setRepoInfo] = useState<ShareRepoInfo | null>(null);
  const [repoInfoLoading, setRepoInfoLoading] = useState(false);

  const [diff, setDiff] = useState<ShareDiffEntry[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    api
      .githubTokenPresent()
      .then(setConnected)
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    api
      .listExportConfigs(instance.id)
      .then((cfgs) => {
        const c =
          cfgs.find((x) => x.id === share?.config_id) ??
          cfgs.find((x) => x.format === "packwiz");
        if (c) {
          setInitialValue({
            mods: c.selection.mods,
            files: c.selection.files,
            known_mods: c.selection.known_mods ?? [],
            optional: c.selection.optional,
            flavor_groups: c.selection.flavor_groups,
            flavor_assignments: c.selection.flavor_assignments,
            unsup: c.unsup,
            sign: c.sign,
            sign_format: c.sign_format || "signify",
          });
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  const loadShareInfo = useCallback(() => {
    if (!share) return;
    api.shareLink(instance.id).then(setLink).catch(() => {});
    api
      .sharePendingChanges(instance.id)
      .then(setPending)
      .catch(() => setPending(false));
    api
      .shareParams(instance.id)
      .then((p) => {
        setParams(p);
        setSavedParams(p);
      })
      .catch(() => {});
  }, [instance.id, share]);

  useEffect(() => loadShareInfo(), [loadShareInfo]);

  const loadRepoInfo = useCallback(() => {
    setRepoInfoLoading(true);
    api
      .shareRepoInfo(instance.id)
      .then(setRepoInfo)
      .catch(() => setRepoInfo(null))
      .finally(() => setRepoInfoLoading(false));
  }, [instance.id]);

  const loadDiff = useCallback(() => {
    setDiffLoading(true);
    saveCfgRef
      .current()
      .catch(() => "")
      .then(() => api.shareDiff(instance.id))
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setDiffLoading(false));
  }, [instance.id]);

  useEffect(() => {
    if (tab === "details" && !repoInfo && !repoInfoLoading) loadRepoInfo();
    if (tab === "diff" && !diffLoading) loadDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if ((!share || share.incomplete) && tab !== "content") setTab("content");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share]);

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onPublishProgress((p) => setProgress(p)).then((u) => (un = u));
    return () => un?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (embeddedConfirm) setEmbeddedConfirm(null);
      else if (syncConfirm) setSyncConfirm(false);
      else if (disconnectConfirm) setDisconnectConfirm(false);
      else if (relinkOpen) setRelinkOpen(false);
      else if (!publishing && !syncing) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const connect = async () => {
    if (!token.trim()) return;
    setConnecting(true);
    try {
      const login = await api.githubConnect(token.trim(), remember);
      setConnected(true);
      setToken("");
      toast(t("share.connectedToast", { login }), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setConnecting(false);
    }
  };

  const saveEditorConfig = async (): Promise<string> => {
    const v = valueRef.current;
    if (!v) return share?.config_id ?? "";
    const saved = await api.saveExportConfig(instance.id, {
      id: share?.config_id ?? "",
      name: `${instance.name} (shared)`,
      format: "packwiz",
      pack_name: instance.name,
      author: "",
      version: "1.0.0",
      selection: {
        mods: v.mods,
        files: v.files,
        known_mods: v.known_mods,
        optional: v.optional,
        flavor_groups: v.flavor_groups,
        flavor_assignments: v.flavor_assignments,
      },
      created_at: 0,
      unsup: v.unsup,
      sign: v.sign,
      sign_format: v.sign_format,
    });
    return saved.id;
  };
  saveCfgRef.current = saveEditorConfig;

  const doPublish = async (confirmEmbedded: boolean) => {
    setEmbeddedConfirm(null);
    setPublishing(true);
    setProgress(null);
    cancelledRef.current = false;
    try {
      const configId = await saveEditorConfig();
      const res = await api.publishPack(instance.id, configId, confirmEmbedded);
      if (res.needs_confirm) {
        setEmbeddedConfirm(res.embedded);
        return;
      }
      setShare(res.share);
      onChanged();
      if (cancelledRef.current) {
        toast(t("share.publishCancelled"), "error");
        return;
      }
      setPending(false);
      setRepoInfo(null);
      setDiff(null);
      if (tab === "details") loadRepoInfo();
      if (tab === "diff") loadDiff();
      if (res.share) api.shareLink(instance.id).then(setLink).catch(() => {});
      toast(t("share.publishedToast"), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setPublishing(false);
      setProgress(null);
    }
  };

  const doSync = () => {
    setSyncConfirm(false);
    setSyncing(true);
    const key = `sync:${instance.id}`;
    toastProgress(key, t("share.syncingToast"), null);
    let un: (() => void) | undefined;
    api
      .onModpackDone((d) => {
        if (d.instance_id !== instance.id) return;
        un?.();
        dismissToast(key);
        setSyncing(false);
        onChanged();
        if (d.error) toast(d.error, "error");
        else if (!d.cancelled) toast(t("share.syncedToast"), "success");
      })
      .then((u) => (un = u));
    api.syncFromShared(instance.id).catch((e) => {
      un?.();
      dismissToast(key);
      setSyncing(false);
      toast(String(e), "error");
    });
  };

  const doRelink = async () => {
    if (!relinkUrl.trim()) return;
    setRelinking(true);
    try {
      const s = await api.relinkShare(instance.id, relinkUrl.trim());
      setShare(s);
      setRelinkOpen(false);
      setRelinkUrl("");
      onChanged();
      api.shareLink(instance.id).then(setLink).catch(() => {});
      toast(t("share.relinkedToast"), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setRelinking(false);
    }
  };

  const doSaveParams = async () => {
    if (!params) return;
    setSavingParams(true);
    try {
      await api.setShareParams(instance.id, params);
      setSavedParams(params);
      onChanged();
      api.shareLink(instance.id).then(setLink).catch(() => {});
      api.sharePendingChanges(instance.id).then(setPending).catch(() => {});
      setDiff(null);
      toast(t("share.paramsSaved"), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSavingParams(false);
    }
  };

  const disconnect = async () => {
    setDisconnectConfirm(false);
    try {
      await api.disconnectShare(instance.id);
      setShare(null);
      setLink("");
      onChanged();
      toast(t("share.disconnectedToast"), "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const cancelPublish = () => {
    cancelledRef.current = true;
    api.cancelOp(instance.id).catch(() => {});
  };

  const stageLabel = (p: PushProgress | null): string => {
    switch (p?.stage) {
      case "writing":
        return t("share.stageWriting");
      case "commit":
        return t("share.stageCommit");
      case "ref":
        return t("share.stageRef");
      default:
        return t("share.stageStart");
    }
  };

  const copyLink = () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link);
    toast(t("share.linkCopied"), "success");
  };

  const copyText = (text: string, msg: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    toast(t(msg), "success");
  };

  const saveFile = async () => {
    try {
      const path = await api.writeShareFile(instance.id);
      toast(t("share.fileSaved", { path }), "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const primaryBtn =
    "brass-btn flex w-full items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50";
  const railBtn =
    "flex w-full items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50";
  const inputCls =
    "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

  const lastPublished = share?.last_published
    ? new Date(share.last_published).toLocaleString()
    : "—";

  const paramsDirty = JSON.stringify(params) !== JSON.stringify(savedParams);
  const showTabs = !!share && !share.incomplete;
  const patchParams = (p: Partial<SharePackParams>) =>
    setParams((prev) => ({ ...(prev ?? emptyParams()), ...p }));

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[55] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) =>
        e.target === e.currentTarget && !publishing && !syncing && close()
      }
    >
      <div className="relative flex h-[86vh] max-h-[760px] w-[920px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/40 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Share2 size={17} className="text-brass-400" />
            {t("share.title")}
          </h2>
          <button
            onClick={() => !publishing && !syncing && close()}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        {connected === null ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="animate-spin text-ink-600" size={20} />
          </div>
        ) : !connected ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <ConnectView
              token={token}
              setToken={setToken}
              connecting={connecting}
              onConnect={connect}
              remember={remember}
              setRemember={setRemember}
              inputCls={inputCls}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-edge bg-ink-950/40 p-4">
              {share ? (
                <>
                  {share.incomplete ? (
                    <div className="flex items-start gap-2 rounded-lg border border-red-600/30 bg-red-500/[0.06] px-3 py-2.5">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-100">
                          {t("share.incompleteTitle")}
                        </div>
                        <div className="text-[11px] leading-snug text-ink-500">
                          {t("share.incompleteBanner")}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-brass-600/30 bg-brass-500/[0.06] px-3 py-2.5">
                      <Check size={15} className="shrink-0 text-brass-300" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-100">
                          {t("share.liveTitle")}
                        </div>
                        <button
                          onClick={() =>
                            api.openExternal(share.repo_url).catch(() => {})
                          }
                          className="flex max-w-full items-center gap-1 truncate text-[11px] text-ink-500 transition hover:text-brass-300"
                        >
                          {share.repo_owner}/{share.repo_name}
                          <ExternalLink size={10} className="shrink-0" />
                        </button>
                      </div>
                    </div>
                  )}

                  {!share.incomplete && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-600">
                        <Link2 size={12} />
                        {t("share.shareLinkLabel")}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          readOnly
                          value={link}
                          onFocus={(e) => e.currentTarget.select()}
                          className="min-w-0 flex-1 rounded-md bg-ink-950/70 px-2 py-1.5 text-[11px] text-gray-300 outline-none ring-1 ring-edge"
                        />
                        <button
                          onClick={copyLink}
                          title={t("share.copy")}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                  {pending && !share.incomplete && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-snug text-amber-300/90">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      {t("share.pendingChanges")}
                    </div>
                  )}

                  {publishing ? (
                    <ProgressBar
                      progress={progress}
                      label={stageLabel(progress)}
                      onCancel={cancelPublish}
                      cancelLabel={t("share.cancelPublish")}
                    />
                  ) : (
                    <button onClick={() => doPublish(false)} className={primaryBtn}>
                      <UploadCloud size={15} />
                      {share.incomplete
                        ? t("share.finishPublishing")
                        : t("share.publishUpdate")}
                    </button>
                  )}

                  {!share.incomplete && (
                    <>
                      <button
                        onClick={() => setSyncConfirm(true)}
                        disabled={syncing || publishing}
                        className={railBtn}
                      >
                        {syncing ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <DownloadCloud size={14} />
                        )}
                        {t("share.syncFromShared")}
                      </button>

                      <button onClick={saveFile} className={railBtn}>
                        <FileDown size={14} />
                        {t("share.saveFile")}
                      </button>

                      <div className="mt-1 rounded-lg border border-edge bg-ink-950/30 p-2.5 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-ink-600">
                            {t("share.lastPublished")}
                          </span>
                          <span className="text-gray-300">{lastPublished}</span>
                        </div>
                        <div className="mt-1 flex justify-between">
                          <span className="text-ink-600">{t("share.version")}</span>
                          <span className="text-gray-300">
                            {share.published_version ?? "—"}
                          </span>
                        </div>
                      </div>

                      <details className="rounded-lg border border-edge bg-ink-950/20">
                        <summary className="cursor-pointer px-3 py-2 text-[11px] text-ink-600 transition hover:text-brass-300">
                          {t("share.advanced")}
                        </summary>
                        <div className="flex flex-col gap-1.5 border-t border-edge p-2.5">
                          <button
                            onClick={() =>
                              api.openExternal(share.repo_url).catch(() => {})
                            }
                            className={railBtn}
                          >
                            <Github size={13} />
                            {t("share.openRepo")}
                          </button>
                          <button
                            onClick={() =>
                              copyText(share.pack_url, "share.packUrlCopied")
                            }
                            className={railBtn}
                          >
                            <Copy size={13} />
                            {t("share.copyPackUrl")}
                          </button>
                        </div>
                      </details>
                    </>
                  )}

                  <button
                    onClick={() => setDisconnectConfirm(true)}
                    className="mt-auto flex items-center justify-center gap-2 text-[11px] text-ink-600 transition hover:text-red-300"
                  >
                    <Unplug size={12} />
                    {t("share.disconnect")}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-2 py-2 text-center">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-brass-500/15 text-brass-300">
                      <Share2 size={20} />
                    </span>
                    <h3 className="text-sm font-medium text-gray-100">
                      {t("share.readyTitle", { name: instance.name })}
                    </h3>
                    <p className="text-[11px] leading-relaxed text-ink-500">
                      {t("share.readyBody")}
                    </p>
                  </div>

                  {publishing ? (
                    <ProgressBar
                      progress={progress}
                      label={stageLabel(progress)}
                      onCancel={cancelPublish}
                      cancelLabel={t("share.cancelPublish")}
                    />
                  ) : (
                    <button onClick={() => doPublish(false)} className={primaryBtn}>
                      <Share2 size={15} />
                      {t("share.shareNow")}
                    </button>
                  )}

                  <details className="rounded-lg border border-edge bg-ink-950/20">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] text-ink-600 transition hover:text-brass-300">
                      {t("share.advanced")}
                    </summary>
                    <div className="border-t border-edge p-2.5">
                      <button onClick={() => setRelinkOpen(true)} className={railBtn}>
                        <Link2 size={14} />
                        {t("share.relink")}
                      </button>
                      <p className="mt-1.5 text-[10px] leading-snug text-ink-600">
                        {t("share.relinkHint")}
                      </p>
                    </div>
                  </details>

                  <button
                    onClick={async () => {
                      await api.githubDisconnect();
                      setConnected(false);
                    }}
                    className="mt-auto text-center text-[11px] text-ink-600 transition hover:text-brass-300"
                  >
                    {t("share.changeAccount")}
                  </button>
                </>
              )}
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              {showTabs ? (
                <div className="flex items-center gap-1 border-b border-edge px-3">
                  <TabBtn
                    active={tab === "content"}
                    onClick={() => setTab("content")}
                    icon={<Files size={13} />}
                    label={t("share.tabContent")}
                  />
                  <TabBtn
                    active={tab === "details"}
                    onClick={() => setTab("details")}
                    icon={<Settings2 size={13} />}
                    label={t("share.tabDetails")}
                  />
                  <TabBtn
                    active={tab === "diff"}
                    onClick={() => setTab("diff")}
                    icon={<GitCompare size={13} />}
                    label={t("share.tabChanges")}
                  />
                </div>
              ) : (
                <div className="border-b border-edge px-5 py-2.5 text-xs text-ink-600">
                  {t("share.whatToShare")}
                </div>
              )}

              <div
                className={`min-h-0 flex-1 overflow-y-auto p-5 ${
                  publishing || syncing
                    ? "pointer-events-none select-none opacity-60"
                    : ""
                }`}
              >
                <div className={tab === "content" ? "" : "hidden"}>
                  {configLoaded && (
                    <PackContentEditor
                      instanceId={instance.id}
                      initial={initialValue}
                      onChange={(v) => (valueRef.current = v)}
                    />
                  )}
                </div>

                {tab === "details" && (
                  <DetailsTab
                    info={repoInfo}
                    loading={repoInfoLoading}
                    onRefresh={loadRepoInfo}
                    params={params}
                    patch={patchParams}
                    dirty={paramsDirty}
                    saving={savingParams}
                    onSave={doSaveParams}
                    inputCls={inputCls}
                  />
                )}

                {tab === "diff" && (
                  <DiffTab
                    diff={diff}
                    loading={diffLoading}
                    onRefresh={loadDiff}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {embeddedConfirm && (
          <Overlay>
            <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
              <AlertTriangle size={16} className="text-amber-400" />
              {t("share.embeddedTitle")}
            </div>
            <p className="mb-2 text-xs leading-relaxed text-ink-500">
              {t("share.embeddedBody")}
            </p>
            <ul className="mb-4 max-h-32 overflow-y-auto rounded-md bg-ink-950/60 p-2 text-xs text-amber-300/90">
              {embeddedConfirm.map((m) => (
                <li key={m} className="truncate">
                  • {m}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEmbeddedConfirm(null)} className={cancelBtn}>
                {t("share.cancel")}
              </button>
              <button onClick={() => doPublish(true)} className={amberBtn}>
                {t("share.publishAnyway")}
              </button>
            </div>
          </Overlay>
        )}

        {syncConfirm && (
          <Overlay>
            <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
              <DownloadCloud size={16} className="text-amber-400" />
              {t("share.syncTitle")}
            </div>
            <p className="mb-4 text-xs leading-relaxed text-ink-500">
              {t("share.syncBody")}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSyncConfirm(false)} className={cancelBtn}>
                {t("share.cancel")}
              </button>
              <button onClick={doSync} className={amberBtn}>
                {t("share.syncFromShared")}
              </button>
            </div>
          </Overlay>
        )}

        {disconnectConfirm && (
          <Overlay red>
            <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
              <Unplug size={16} className="text-red-400" />
              {t("share.disconnectTitle")}
            </div>
            <p className="mb-4 text-xs leading-relaxed text-ink-500">
              {t("share.disconnectBody")}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDisconnectConfirm(false)} className={cancelBtn}>
                {t("share.cancel")}
              </button>
              <button
                onClick={disconnect}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-red-400"
              >
                {t("share.disconnect")}
              </button>
            </div>
          </Overlay>
        )}

        {relinkOpen && (
          <Overlay>
            <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
              <Link2 size={16} className="text-brass-400" />
              {t("share.relinkTitle")}
            </div>
            <p className="mb-3 text-xs leading-relaxed text-ink-500">
              {t("share.relinkBody")}
            </p>
            <input
              value={relinkUrl}
              onChange={(e) => setRelinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doRelink()}
              placeholder="https://github.com/you/your-pack"
              className={inputCls}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRelinkOpen(false)} className={cancelBtn}>
                {t("share.cancel")}
              </button>
              <button
                onClick={doRelink}
                disabled={relinking || !relinkUrl.trim()}
                className="flex items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-50"
              >
                {relinking && <Loader2 size={12} className="animate-spin" />}
                {t("share.relink")}
              </button>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );
}

const cancelBtn =
  "rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200";
const amberBtn =
  "rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-amber-400";

function ProgressBar({
  progress,
  label,
  onCancel,
  cancelLabel,
}: {
  progress: PushProgress | null;
  label: string;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const finalizing = !!progress && progress.stage !== "upload" && progress.stage !== "start";
  const pct =
    progress && progress.total_bytes > 0
      ? Math.min(100, (progress.done_bytes / progress.total_bytes) * 100)
      : 0;
  return (
    <div className="rounded-lg border border-edge bg-ink-950/40 p-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-500">
        <span className="flex min-w-0 items-center gap-1.5">
          <Loader2 size={12} className="shrink-0 animate-spin text-brass-400" />
          <span className="truncate">{label}</span>
        </span>
        {progress && progress.total_bytes > 0 && !finalizing && (
          <span className="shrink-0">
            {fmtBytes(progress.done_bytes)} / {fmtBytes(progress.total_bytes)}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full rounded-full bg-brass-500 ${finalizing ? "animate-pulse" : "transition-all"}`}
          style={{ width: `${finalizing ? 100 : pct}%` }}
        />
      </div>
      <button
        onClick={onCancel}
        className="mt-2 w-full rounded-md border border-edge py-1 text-[11px] text-ink-600 transition hover:border-red-500/40 hover:text-red-300"
      >
        {cancelLabel}
      </button>
    </div>
  );
}

function emptyParams(): SharePackParams {
  return {
    description: null,
    min_memory_mb: null,
    max_memory_mb: null,
    jvm_args: [],
    news_url: null,
    playercount_url: null,
  };
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs transition ${
        active
          ? "border-brass-500 text-brass-300"
          : "border-transparent text-ink-600 hover:text-gray-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function InfoStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge bg-ink-950/30 px-3 py-2">
      <span className="text-ink-600">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-ink-600">
          {label}
        </div>
        <div className="truncate text-xs text-gray-200">{value}</div>
      </div>
    </div>
  );
}

function DetailsTab({
  info,
  loading,
  onRefresh,
  params,
  patch,
  dirty,
  saving,
  onSave,
  inputCls,
}: {
  info: ShareRepoInfo | null;
  loading: boolean;
  onRefresh: () => void;
  params: SharePackParams | null;
  patch: (p: Partial<SharePackParams>) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  inputCls: string;
}) {
  const t = useT();
  const p = params ?? emptyParams();
  const label = "mb-1.5 block text-xs text-ink-600";
  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {t("share.repoInfoTitle")}
          </h4>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:text-brass-300 disabled:opacity-50"
            title={t("share.refresh")}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {loading && !info ? (
          <div className="grid h-20 place-items-center">
            <Loader2 size={18} className="animate-spin text-ink-600" />
          </div>
        ) : info ? (
          <div className="grid grid-cols-2 gap-2">
            <InfoStat
              icon={<HardDrive size={14} />}
              label={t("share.repoSize")}
              value={fmtBytes(info.size_kb * 1024)}
            />
            <InfoStat
              icon={<Files size={14} />}
              label={t("share.repoFiles")}
              value={String(info.file_count)}
            />
            <InfoStat
              icon={info.private ? <Lock size={14} /> : <Globe size={14} />}
              label={t("share.repoVisibility")}
              value={
                info.private ? t("share.private") : t("share.public")
              }
            />
            <InfoStat
              icon={<RefreshCw size={14} />}
              label={t("share.repoPushed")}
              value={
                info.pushed_at
                  ? new Date(info.pushed_at).toLocaleString()
                  : "—"
              }
            />
            <InfoStat
              icon={<Star size={14} />}
              label={t("share.repoStars")}
              value={String(info.stargazers)}
            />
            <InfoStat
              icon={<GitFork size={14} />}
              label={t("share.repoForks")}
              value={String(info.forks)}
            />
          </div>
        ) : (
          <p className="text-xs text-ink-600">{t("share.repoInfoError")}</p>
        )}
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {t("share.paramsTitle")}
        </h4>
        <p className="mb-3 text-[11px] leading-snug text-ink-600">
          {t("share.paramsHint")}
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className={label}>{t("share.paramDescription")}</label>
            <textarea
              value={p.description ?? ""}
              onChange={(e) =>
                patch({ description: e.target.value || null })
              }
              rows={3}
              placeholder={t("share.paramDescriptionPlaceholder")}
              className={`${inputCls} resize-y`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>{t("share.paramMinRam")}</label>
              <input
                type="number"
                min={0}
                step={256}
                value={p.min_memory_mb ?? ""}
                onChange={(e) =>
                  patch({
                    min_memory_mb: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                placeholder="—"
                className={inputCls}
              />
            </div>
            <div>
              <label className={label}>{t("share.paramMaxRam")}</label>
              <input
                type="number"
                min={0}
                step={256}
                value={p.max_memory_mb ?? ""}
                onChange={(e) =>
                  patch({
                    max_memory_mb: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                placeholder="—"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={label}>{t("share.paramJvmArgs")}</label>
            <JvmArgsField
              value={p.jvm_args}
              onChange={(v) => patch({ jvm_args: v })}
              inputCls={inputCls}
              placeholder={t("share.paramJvmArgsPlaceholder")}
            />
            <p className="mt-1 text-[10px] text-ink-600">
              {t("share.paramJvmArgsHint")}
            </p>
          </div>

          <div>
            <label className={label}>{t("share.paramNewsUrl")}</label>
            <input
              value={p.news_url ?? ""}
              onChange={(e) => patch({ news_url: e.target.value || null })}
              placeholder="https://…"
              className={inputCls}
            />
          </div>

          <div>
            <label className={label}>{t("share.paramPlayercountUrl")}</label>
            <input
              value={p.playercount_url ?? ""}
              onChange={(e) =>
                patch({ playercount_url: e.target.value || null })
              }
              placeholder="https://…"
              className={inputCls}
            />
          </div>

          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className="brass-btn flex items-center justify-center gap-2 self-start rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {t("share.saveParams")}
          </button>
        </div>
      </section>
    </div>
  );
}

function JvmArgsField({
  value,
  onChange,
  inputCls,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  inputCls: string;
  placeholder: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
      rows={3}
      spellCheck={false}
      placeholder={placeholder}
      className={`${inputCls} resize-y font-mono text-[11px]`}
    />
  );
}

function DiffTab({
  diff,
  loading,
  onRefresh,
}: {
  diff: ShareDiffEntry[] | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const t = useT();
  const rank = (s: string) =>
    s === "added" ? 0 : s === "modified" ? 1 : 2;
  const rows = (diff ?? [])
    .slice()
    .sort((a, b) =>
      rank(a.status) - rank(b.status) || a.path.localeCompare(b.path),
    );
  const counts = {
    added: rows.filter((r) => r.status === "added").length,
    modified: rows.filter((r) => r.status === "modified").length,
    removed: rows.filter((r) => r.status === "removed").length,
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1 text-green-400">
            <FilePlus2 size={12} />+{counts.added}
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <FilePen size={12} />~{counts.modified}
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <FileMinus2 size={12} />−{counts.removed}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:text-brass-300 disabled:opacity-50"
          title={t("share.refresh")}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <p className="text-[10px] leading-snug text-ink-600">{t("share.diffHint")}</p>

      {loading && diff === null ? (
        <div className="grid h-24 place-items-center">
          <Loader2 size={18} className="animate-spin text-ink-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Check size={22} className="text-brass-400" />
          <p className="text-sm text-gray-200">{t("share.diffInSync")}</p>
          <p className="text-[11px] text-ink-600">{t("share.diffInSyncBody")}</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-edge font-mono text-[11px]">
          {rows.map((r) => (
            <li
              key={`${r.status}:${r.path}`}
              className="flex items-center gap-2 border-b border-edge/60 px-3 py-1.5 last:border-b-0"
            >
              {r.status === "added" ? (
                <FilePlus2 size={12} className="shrink-0 text-green-400" />
              ) : r.status === "modified" ? (
                <FilePen size={12} className="shrink-0 text-amber-400" />
              ) : (
                <FileMinus2 size={12} className="shrink-0 text-red-400" />
              )}
              <span
                className={`truncate ${
                  r.path === PACK_SETTINGS_DIFF_PATH
                    ? "font-sans text-brass-200"
                    : r.status === "removed"
                      ? "text-ink-500 line-through"
                      : "text-gray-300"
                }`}
              >
                {r.path === PACK_SETTINGS_DIFF_PATH
                  ? t("share.diffPackSettings")
                  : r.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Overlay({
  children,
  red,
}: {
  children: React.ReactNode;
  red?: boolean;
}) {
  return (
    <div className="modal-overlay absolute inset-0 z-20 grid place-items-center bg-ink-950/70 p-5 backdrop-blur-sm">
      <div
        className={`w-full max-w-[380px] rounded-xl border bg-ink-900 p-5 shadow-2xl ${
          red ? "border-red-600/30" : "border-amber-600/30"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function ConnectView({
  token,
  setToken,
  connecting,
  onConnect,
  remember,
  setRemember,
  inputCls,
}: {
  token: string;
  setToken: (v: string) => void;
  connecting: boolean;
  onConnect: () => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  inputCls: string;
}) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brass-500/15 text-brass-300">
          <Github size={24} />
        </span>
        <h3 className="text-sm font-medium text-gray-100">
          {t("share.connectTitle")}
        </h3>
        <p className="text-xs leading-relaxed text-ink-500">
          {t("share.connectBody")}
        </p>
      </div>
      <ol className="flex flex-col gap-1.5 rounded-lg border border-edge bg-ink-950/30 p-3 text-xs text-ink-400">
        <li>1. {t("share.step1")}</li>
        <li>2. {t("share.step2")}</li>
        <li>3. {t("share.step3")}</li>
      </ol>
      <button
        onClick={() => api.openExternal(TOKEN_URL).catch(() => {})}
        className="flex items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300"
      >
        <ExternalLink size={14} />
        {t("share.createToken")}
      </button>
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-600">
          <KeyRound size={12} />
          {t("share.tokenLabel")}
        </div>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConnect()}
          placeholder="ghp_…"
          className={inputCls}
        />
        <p className="mt-1.5 text-[10px] leading-snug text-ink-600">
          {t("share.tokenHint")}
        </p>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-edge bg-ink-950/30 p-3 text-left transition hover:border-brass-600/40">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brass-500"
        />
        <span>
          <span className="block text-xs font-medium text-gray-200">
            {t("share.rememberKey")}
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-ink-600">
            {t("share.rememberKeyHint")}
          </span>
        </span>
      </label>
      <button
        onClick={onConnect}
        disabled={connecting || !token.trim()}
        className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-50"
      >
        {connecting ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Github size={15} />
        )}
        {t("share.connect")}
      </button>
    </div>
  );
}
