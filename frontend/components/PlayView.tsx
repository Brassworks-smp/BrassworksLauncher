import { useEffect, useRef, useState } from "react";
import {
  Play,
  Loader2,
  Square,
  Box,
  Clock,
  Package,
  Download,
  ArrowUpCircle,
  X,
  AlertTriangle,
  Settings,
  ExternalLink,
  UserRound,
} from "lucide-react";
import * as api from "@/lib/api";
import { iconSrc, DEFAULT_INSTANCE_ICON } from "@/lib/instanceIcons";
import type {
  Instance,
  LaunchProgress,
  LauncherSettings,
  ModpackStatus,
  NewsItem,
  PlayerCount,
} from "@/lib/types";
import { ServerCard } from "./ServerCard";
import { NewsCard } from "./NewsCard";
import {
  appliedPins,
  QuickSettingsPicker,
} from "@/lib/quickSettings";
import { useT, type TFunc } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { FileFailure } from "@/lib/types";


const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 560;


const STAGE_LABEL: Record<string, string> = {
  resolving: "play.stage.resolving",
  checking_updates: "play.stage.checkingUpdates",
  syncing_modpack: "play.stage.syncingModpack",
  loading_version: "play.stage.loadingVersion",
  downloading: "play.stage.downloading",
  preparing_jvm: "play.stage.preparingJvm",
  installing_loader: "play.stage.installingLoader",
  launching: "play.stage.launching",
  running: "play.stage.running",
};


function stageLabelOf(t: TFunc, stage: string): string {
  const k = STAGE_LABEL[stage];
  return k ? t(k) : stage;
}

const baseName = (p: string) => p.split("/").pop() || p;

function failureSummary(t: TFunc, status: ModpackStatus): string {
  const failures: FileFailure[] =
    status.failures && status.failures.length > 0
      ? status.failures
      : status.failed.map((path) => ({ path, reason: t("play.failure.unknown") }));

  const groups = new Map<string, string[]>();
  for (const f of failures) {
    const list = groups.get(f.reason) ?? [];
    list.push(baseName(f.path));
    groups.set(f.reason, list);
  }

  const lines = [...groups.entries()].map(([reason, files]) => {
    const example = files[0];
    const more = files.length > 1 ? ` +${files.length - 1}` : "";
    return `• ${files.length}× ${reason}\n   ${example}${more}`;
  });

  return `${t("play.filesFailed", { count: failures.length })}\n${lines.join("\n")}`;
}


function loaderLabel(i: Instance): string {
  const map: Record<string, string> = {
    neo_forge: "NeoForge",
    forge: "Forge",
    fabric: "Fabric",
    quilt: "Quilt",
    vanilla: "Vanilla",
  };
  return map[i.loader] ?? i.loader;
}

function kindLabel(t: TFunc, i: Instance): string {
  if (i.featured) return t("play.featuredPack");
  switch (i.pack.kind) {
    case "modrinth":
      return t("play.modrinthModpack");
    case "curseforge":
      return t("play.curseforgeModpack");
    case "packwiz":
      return t("play.packwizModpack");
    default:
      return t("play.customInstance");
  }
}

function formatPlaytime(t: TFunc, seconds: number, alwaysHours = false): string {
  if (alwaysHours) {
    const hrs = seconds / 3600;
    return `${hrs.toFixed(1)}h`;
  }
  if (!seconds || seconds < 60) return t("play.underMinute");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function PlayView({
  instance,
  busy,
  running,
  progress,
  canPlay,
  modStatus,
  locked,
  notInstalled,
  showPlaytime,
  playtimeHours,
  featuredEnabled,
  players,
  playersError,
  news,
  newsError,
  onRefreshPlayers,
  onRefreshNews,
  onPlay,
  onUpdate,
  onStop,
  onCancel,
  onSaveInstance,
  onOpenSettings,
  launcherSettings,
  overrideAccount,
}: {
  instance: Instance | null;
  busy: boolean;
  running: boolean;
  progress: LaunchProgress | null;
  canPlay: boolean;
  modStatus: ModpackStatus | null;
  locked: boolean;
  notInstalled: boolean;
  showPlaytime: boolean;
  playtimeHours: boolean;
  featuredEnabled: boolean;
  players: PlayerCount | null;
  playersError: boolean;
  news: NewsItem | null;
  newsError: boolean;
  onRefreshPlayers: () => Promise<void> | void;
  onRefreshNews: () => Promise<void> | void;
  onPlay: () => void;
  onUpdate: () => void;
  onStop: () => void;
  onCancel: () => void;
  onSaveInstance: (i: Instance) => void;
  onOpenSettings: () => void;
  launcherSettings: LauncherSettings | null;
  overrideAccount?: string | null;
}) {
  const t = useT();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("bw-play-sidebar-w"));
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 0;
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (sidebarWidth) localStorage.setItem("bw-play-sidebar-w", String(sidebarWidth));
  }, [sidebarWidth]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current?.offsetWidth ?? SIDEBAR_MIN;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (startX - ev.clientX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setResizing(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  if (!instance) {
    return (
      <div className="grid flex-1 place-items-center text-ink-600">
        {t("play.loadingInstance")}
      </div>
    );
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;

  
  const hasUpdate =
    !!modStatus?.update_available && !notInstalled && !running && !busy;
  const updateAvailable = hasUpdate && locked;

  const showPlayers =
    featuredEnabled && instance.show_playercount && !!instance.playercount_url;
  const showNews = featuredEnabled && instance.show_news && !!instance.news_url;

  
  const sidebarPx = sidebarWidth || (appliedPins(instance).length > 0 ? 300 : 248);

  return (
    <div className={`flex min-h-0 flex-1 ${resizing ? "cursor-col-resize select-none" : ""}`}>
      {}
      <div className="play-hero-glass relative flex flex-1 overflow-hidden rounded-lg border border-edge">
        <div className="play-hero-overlay pointer-events-none absolute inset-0 z-[2]" />

        <div className="relative z-10 flex h-full w-full flex-col p-7">
          {}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex items-center gap-3">
              <img
                src={iconSrc(instance.icon ?? DEFAULT_INSTANCE_ICON) ?? undefined}
                alt=""
                className="h-12 w-12 rounded-lg object-cover shadow-lg"
              />
              <h1 className="font-mc text-4xl tracking-wide text-gray-100">
                {instance.name}
              </h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
              <Chip icon={<Package size={13} />}>{kindLabel(t, instance)}</Chip>
              <Chip icon={<Box size={13} />}>
                {loaderLabel(instance)} {instance.minecraft_version}
              </Chip>
              {instance.account_override && (
                <Chip icon={<UserRound size={13} />}>
                  {overrideAccount ?? t("play.accountMissing")}
                </Chip>
              )}
              {showPlaytime && (
                <Chip icon={<Clock size={13} />}>
                  {t("play.played", {
                    time: formatPlaytime(t, instance.playtime_seconds, playtimeHours),
                  })}
                </Chip>
              )}
              {modStatus?.installed_version && (
                <Chip>{t("play.packChip", { version: modStatus.installed_version })}</Chip>
              )}
              {instance.last_played && (
                <Chip>
                  {t("play.lastPlayedChip", {
                    date: new Date(instance.last_played).toLocaleDateString(),
                  })}
                </Chip>
              )}
            </div>
          </div>


          <div className="shrink-0 pt-4">
            {hasUpdate && (
              <div
                className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm rise ${
                  locked
                    ? "border-brass-500/40 bg-brass-500/10 text-brass-200"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                <ArrowUpCircle size={16} />
                <span className="flex-1">
                  {locked
                    ? modStatus?.latest_version
                      ? t("play.updateAvailableVersion", {
                          version: modStatus.latest_version,
                        })
                      : t("play.updateAvailable")
                    : t("play.updateLockHint")}
                </span>
              </div>
            )}

            {}
            {busy && (
              <div className="mb-4 rise">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-brass-300">
                    {progress
                      ? stageLabelOf(t, progress.stage)
                      : t("play.preparing")}
                    {progress?.message ? (
                      <span className="ml-2 text-ink-600">
                        {progress.message}
                      </span>
                    ) : null}
                  </span>
                  {pct !== null && (
                    <span className="tabular-nums text-ink-600">{pct}%</span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="progress-fill h-full rounded-full transition-[width] duration-300"
                    style={{ width: pct !== null ? `${pct}%` : "40%" }}
                  />
                </div>
              </div>
            )}

            <MainButton
              busy={busy}
              running={running}
              canPlay={canPlay}
              updateAvailable={updateAvailable}
              notInstalled={notInstalled}
              onPlay={onPlay}
              onUpdate={onUpdate}
              onStop={onStop}
              stageLabel={
                progress ? stageLabelOf(t, progress.stage) : t("play.preparing")
              }
            />
            {busy && (
              <button
                onClick={onCancel}
                className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs text-ink-600 transition hover:text-red-300"
              >
                <X size={13} /> {t("play.cancelDownload")}
              </button>
            )}
            {!canPlay && (
              <p className="mt-2 text-center text-xs text-amber-400/80">
                {t("play.signInToPlay")}
              </p>
            )}
            {!busy &&
              !running &&
              modStatus &&
              !modStatus.complete &&
              modStatus.failed.length > 0 && (
                <button
                  type="button"
                  onClick={() => toast(failureSummary(t, modStatus), "error")}
                  title={t("play.filesFailedDetails")}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 text-center text-xs text-amber-400/80 transition hover:text-amber-300"
                >
                  <AlertTriangle size={12} />
                  {t("play.filesFailed", { count: modStatus.failed.length })}
                </button>
              )}
          </div>
        </div>
      </div>

      <div
        onPointerDown={startResize}
        title={t("sidebar.resize")}
        className="group/resize relative w-4 shrink-0 cursor-col-resize touch-none"
      >
        <div
          className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors ${
            resizing ? "bg-brass-500" : "bg-transparent group-hover/resize:bg-brass-600/50"
          }`}
        />
      </div>

      <div
        ref={sidebarRef}
        style={{ width: sidebarPx }}
        className={`flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto pr-1 ${
          resizing ? "" : "transition-[width] duration-200"
        }`}
      >
        <QuickSettingsCard
          instance={instance}
          settings={launcherSettings}
          onSaveInstance={onSaveInstance}
          onOpenSettings={onOpenSettings}
        />
        {showPlayers && (
          <ServerCard
            address="brassworks.opnsoc.org"
            data={players}
            error={playersError}
            onRefresh={onRefreshPlayers}
          />
        )}
        {showNews && (
          <NewsCard news={news} error={newsError} onRefresh={onRefreshNews} />
        )}
        <InstanceMetaCard instance={instance} modStatus={modStatus} />
      </div>
    </div>
  );
}


function SideCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge bg-ink-900/50 p-4 transition-colors hover:border-brass-600/40">
      <div className="mb-2.5 font-mc text-xs tracking-wide text-brass-300">
        {title}
      </div>
      {children}
    </div>
  );
}


function QuickSettingsCard({
  instance,
  settings,
  onSaveInstance,
  onOpenSettings,
}: {
  instance: Instance;
  settings: LauncherSettings | null;
  onSaveInstance: (i: Instance) => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const patch = (p: Partial<Instance>) => onSaveInstance({ ...instance, ...p });
  const pinned = appliedPins(instance);

  return (
    <div className="rounded-xl border border-edge bg-ink-900/50 p-4 transition-colors hover:border-brass-600/40">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mc text-xs tracking-wide text-brass-300">
          {t("instanceSettings.quick.title")}
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          title={t("play.customizeTitle")}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink-600 transition hover:bg-ink-800/70 hover:text-brass-300"
        >
          <Settings size={12} /> {t("play.customize")}
        </button>
      </div>

      {pinned.length === 0 || !settings ? (
        <button
          onClick={() => setPickerOpen(true)}
          className="w-full rounded-lg border border-dashed border-edge/70 px-3 py-4 text-center text-[11px] leading-snug text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
        >
          {t("play.pinHint")}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {pinned.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-edge/60 bg-ink-950/40 p-2.5"
            >
              {!s.selfLabeled && (
                <div className="mb-1.5 text-[11px] font-medium text-ink-500">
                  {t(s.tkey)}
                </div>
              )}
              {settings && (
                <s.Control
                  instance={instance}
                  patch={patch}
                  settings={settings}
                  onSaveInstance={onSaveInstance}
                  onOpenSettings={onOpenSettings}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {pickerOpen && (
        <QuickSettingsPicker
          instance={instance}
          onSaveInstance={onSaveInstance}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}


function InstanceMetaCard({
  instance,
  modStatus,
}: {
  instance: Instance;
  modStatus: ModpackStatus | null;
}) {
  const t = useT();
  const [modCount, setModCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setModCount(null);
    if (api.isTauri()) {
      api
        .listMods(instance.id)
        .then((m) => alive && setModCount(m.length))
        .catch(() => alive && setModCount(null));
    }
    return () => {
      alive = false;
    };
  }, [instance.id]);

  const pack = instance.pack;
  const sourceId =
    pack.kind === "modrinth" || pack.kind === "curseforge"
      ? pack.project_id
      : null;
  const sourceUrl =
    pack.kind === "modrinth" && pack.project_id
      ? `https://modrinth.com/modpack/${pack.project_id}`
      : pack.kind === "curseforge"
        ? `https://www.curseforge.com/projects/${pack.project_id}`
        : null;

  
  if (!sourceId && pack.kind === "none") return null;

  return (
    <SideCard title={t("instanceSettings.details.title")}>
      <dl className="flex flex-col gap-2 text-xs">
        {pack.kind !== "none" && (
          <InfoRow
            label={t("play.mods")}
            value={modCount === null ? "…" : `${modCount}`}
          />
        )}
        {modStatus?.installed_version && pack.kind !== "none" && (
          <InfoRow label={t("play.packVersion")} value={modStatus.installed_version} />
        )}
        {sourceId && (
          <InfoRow
            label={pack.kind === "curseforge" ? t("play.curseforgeId") : t("play.modrinthId")}
            value={sourceId}
          />
        )}
      </dl>
      {sourceUrl && (
        <button
          onClick={() => api.openExternal(sourceUrl).catch(() => {})}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-edge/60 px-3 py-1.5 text-xs text-brass-300 transition hover:border-brass-600/40 hover:bg-brass-500/5"
        >
          <ExternalLink size={12} /> {t("play.viewModpackPage")}
        </button>
      )}
    </SideCard>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-600">{label}</dt>
      <dd className="truncate font-mc text-[11px] text-gray-200">{value}</dd>
    </div>
  );
}

function Chip({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-ink-900/40 px-2 py-1">
      {icon}
      {children}
    </span>
  );
}

function MainButton({
  busy,
  running,
  canPlay,
  updateAvailable,
  notInstalled,
  onPlay,
  onUpdate,
  onStop,
  stageLabel,
}: {
  busy: boolean;
  running: boolean;
  canPlay: boolean;
  updateAvailable: boolean;
  notInstalled: boolean;
  onPlay: () => void;
  onUpdate: () => void;
  onStop: () => void;
  stageLabel: string;
}) {
  const t = useT();
  if (running) {
    return (
      <button
        onClick={onStop}
        className="group font-mc tracking-wide flex h-14 w-full items-center justify-center gap-3 rounded-lg border border-patina-500/40 bg-patina-500/10 text-lg text-patina-400 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
      >
        <span className="inline-flex items-center gap-2 group-hover:hidden">
          <span className="h-2.5 w-2.5 rounded-full bg-patina-400 animate-pulse" />
          {t("sidebar.gameRunning")}
        </span>
        <span className="hidden items-center gap-2 group-hover:inline-flex">
          <Square size={16} className="fill-current" />
          {t("play.stopGame")}
        </span>
      </button>
    );
  }

  if (busy) {
    return (
      <button
        disabled
        className="font-mc tracking-wide flex h-14 w-full items-center justify-center gap-3 rounded-lg border border-brass-600/40 bg-brass-600/10 text-lg text-brass-300"
      >
        <Loader2 size={20} className="animate-spin" />
        {stageLabel}…
      </button>
    );
  }

  if (updateAvailable) {
    return (
      <button
        disabled={!canPlay}
        onClick={onUpdate}
        className="group font-mc tracking-widest flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-amber-500 text-xl text-ink-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Download size={22} />
        {t("play.update")}
      </button>
    );
  }

  return (
    <button
      disabled={!canPlay}
      onClick={onPlay}
      className="brass-btn group font-mc tracking-widest flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-brass-500 text-xl text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {notInstalled ? (
        <>
          <Download size={22} />
          {t("play.install")}
        </>
      ) : (
        <>
          <Play size={22} className="fill-current" />
          {t("play.play")}
        </>
      )}
    </button>
  );
}
