"use client";

import {
  Play,
  Loader2,
  Square,
  Box,
  Clock,
  Download,
  ArrowUpCircle,
  X,
  AlertTriangle,
} from "lucide-react";
import type {
  Instance,
  LaunchProgress,
  ModpackStatus,
  NewsItem,
  PlayerCount,
} from "@/lib/types";
import { ServerCard } from "./ServerCard";
import { NewsCard } from "./NewsCard";

const STAGE_LABEL: Record<string, string> = {
  resolving: "Resolving",
  checking_updates: "Checking for updates",
  syncing_modpack: "Updating modpack",
  loading_version: "Loading version",
  downloading: "Downloading",
  preparing_jvm: "Preparing Java",
  installing_loader: "Installing NeoForge",
  launching: "Launching",
  running: "Running",
};

function loaderLabel(i: Instance): string {
  const map: Record<string, string> = {
    neo_forge: "NeoForge",
    forge: "Forge",
    fabric: "Fabric",
    vanilla: "Vanilla",
  };
  return map[i.loader] ?? i.loader;
}

function formatPlaytime(seconds: number, alwaysHours = false): string {
  if (alwaysHours) {
    const hrs = seconds / 3600;
    return `${hrs.toFixed(1)}h`;
  }
  if (!seconds || seconds < 60) return "Under a minute";
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
}) {
  if (!instance) {
    return (
      <div className="grid flex-1 place-items-center text-ink-600">
        Loading instance…
      </div>
    );
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;

  const hasUpdate = !!modStatus?.update_available && !running && !busy;
  const updateAvailable = hasUpdate && locked;

  return (
    <div className="flex flex-1 gap-4">
      {}
      <div className="schem-bg relative flex flex-1 overflow-hidden rounded-lg border border-edge">
        <div
          className="play-hero-overlay pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 70% at 50% 0%, rgba(31,191,99,0.16), transparent 60%), linear-gradient(180deg, transparent, rgba(8,8,8,0.85))",
          }}
        />

        <div className="relative z-10 flex h-full w-full flex-col p-7">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-edge bg-ink-900/50 px-3 py-1 text-[11px] text-brass-300">
              <span className="h-1.5 w-1.5 rounded-full bg-patina-400" />
              Featured pack
            </div>
            <h1 className="font-mc text-4xl tracking-wide text-gray-100">
              {instance.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
              <Chip icon={<Box size={13} />}>
                {loaderLabel(instance)} {instance.minecraft_version}
              </Chip>
              {showPlaytime && (
                <Chip icon={<Clock size={13} />}>
                  {formatPlaytime(instance.playtime_seconds, playtimeHours)}{" "}
                  played
                </Chip>
              )}
              {modStatus?.installed_version && (
                <Chip>Pack v{modStatus.installed_version}</Chip>
              )}
              {instance.last_played && (
                <Chip>
                  Last played{" "}
                  {new Date(instance.last_played).toLocaleDateString()}
                </Chip>
              )}
            </div>
          </div>

          <div className="mt-auto">
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
                    ? `Modpack update available${
                        modStatus?.latest_version
                          ? ` — v${modStatus.latest_version}`
                          : ""
                      }`
                    : "Update available — lock the modpack to install it."}
                </span>
              </div>
            )}

            {}
            {busy && (
              <div className="mb-4 rise">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-brass-300">
                    {progress
                      ? STAGE_LABEL[progress.stage] ?? progress.stage
                      : "Preparing"}
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
                progress ? STAGE_LABEL[progress.stage] ?? "Working" : "Preparing"
              }
            />
            {busy && (
              <button
                onClick={onCancel}
                className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs text-ink-600 transition hover:text-red-300"
              >
                <X size={13} /> Cancel download
              </button>
            )}
            {!canPlay && (
              <p className="mt-2 text-center text-xs text-amber-400/80">
                Sign in with Microsoft to start playing.
              </p>
            )}
            {!busy &&
              !running &&
              modStatus &&
              !modStatus.complete &&
              modStatus.failed.length > 0 && (
                <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-amber-400/80">
                  <AlertTriangle size={12} />
                  {modStatus.failed.length} file
                  {modStatus.failed.length === 1 ? "" : "s"} couldn&apos;t
                  download — they&apos;ll retry on next launch.
                </p>
              )}
          </div>
        </div>
      </div>

      {}
      <div className="flex w-[240px] shrink-0 flex-col gap-4 overflow-y-auto">
        <ServerCard
          address="brassworks.opnsoc.org"
          data={players}
          error={playersError}
          onRefresh={onRefreshPlayers}
        />
        <NewsCard news={news} error={newsError} onRefresh={onRefreshNews} />
      </div>
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
  if (running) {
    return (
      <button
        onClick={onStop}
        className="group font-mc tracking-wide flex h-14 w-full items-center justify-center gap-3 rounded-lg border border-patina-500/40 bg-patina-500/10 text-lg text-patina-400 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
      >
        <span className="inline-flex items-center gap-2 group-hover:hidden">
          <span className="h-2.5 w-2.5 rounded-full bg-patina-400 animate-pulse" />
          Game running
        </span>
        <span className="hidden items-center gap-2 group-hover:inline-flex">
          <Square size={16} className="fill-current" />
          Stop game
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
        className="group font-mc tracking-widest flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-linear-to-b from-amber-400 to-amber-500 text-xl text-ink-950 shadow-[0_5px_0_#b45309] transition-all hover:from-amber-300 active:translate-y-[3px] active:shadow-[0_2px_0_#b45309] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        <Download size={22} />
        UPDATE
      </button>
    );
  }

  return (
    <button
      disabled={!canPlay}
      onClick={onPlay}
      className="brass-btn group font-mc tracking-widest flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-brass-500 text-xl text-ink-950 shadow-[0_5px_0_var(--color-brass-700)] transition-all hover:bg-brass-400 active:translate-y-[3px] active:shadow-[0_2px_0_var(--color-brass-700)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      {notInstalled ? (
        <>
          <Download size={22} />
          INSTALL
        </>
      ) : (
        <>
          <Play size={22} className="fill-current" />
          PLAY
        </>
      )}
    </button>
  );
}
