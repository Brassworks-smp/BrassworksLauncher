import { useEffect, useState } from "react";
import {
  ArrowLeft,
  SlidersHorizontal,
  Terminal,
  Coffee,
  Monitor,
  Package,
  Wrench,
  Hammer,
  Trash2,
  FolderOpen,
  RefreshCw,
  Loader2,
  Newspaper,
  Download,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { VersionList } from "@/components/VersionList";
import type {
  Instance,
  LauncherSettings,
  LaunchProgress,
  ModpackStatus,
  ContentVersion,
  JavaReport,
} from "@/lib/types";
import {
  Card,
  Field,
  Select,
  Slider,
  Toggle,
  Row,
  ActionButton,
  inputCls,
} from "@/components/ui";

const JVM_PRESETS: { id: string; label: string; args: string[] }[] = [
  { id: "none", label: "None (vanilla defaults)", args: [] },
  {
    id: "balanced",
    label: "Balanced — smooth G1GC (recommended)",
    args: [
      "-XX:+UseG1GC",
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=200",
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+DisableExplicitGC",
    ],
  },
  {
    id: "aikars",
    label: "Aikar's flags — heavy modpacks",
    args: [
      "-XX:+UseG1GC",
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=200",
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+DisableExplicitGC",
      "-XX:+AlwaysPreTouch",
      "-XX:G1NewSizePercent=30",
      "-XX:G1MaxNewSizePercent=40",
      "-XX:G1HeapRegionSize=8M",
      "-XX:G1ReservePercent=20",
      "-XX:G1HeapWastePercent=5",
      "-XX:G1MixedGCCountTarget=4",
      "-XX:InitiatingHeapOccupancyPercent=15",
      "-XX:G1MixedGCLiveThresholdPercent=90",
      "-XX:G1RSetUpdatingPauseTimePercent=5",
      "-XX:SurvivorRatio=32",
      "-XX:+PerfDisableSharedMem",
      "-XX:MaxTenuringThreshold=1",
    ],
  },
];

function presetIdForArgs(args: string[]): string {
  const norm = (a: string[]) => [...a].sort().join(" ");
  const target = norm(args);
  const match = JVM_PRESETS.find((p) => norm(p.args) === target);
  return match ? match.id : "custom";
}

export function InstanceSettingsView({
  instance,
  settings,
  modStatus,
  maintaining,
  progress,
  onBack,
  onSaveInstance,
  onDeleted,
  onError,
  onCheckUpdates,
}: {
  instance: Instance;
  settings: LauncherSettings;
  modStatus: ModpackStatus | null;
  maintaining: boolean;
  progress: LaunchProgress | null;
  onBack: () => void;
  onSaveInstance: (i: Instance) => void;
  onDeleted: (id: string) => void;
  onError: (e: string) => void;
  onCheckUpdates: () => void;
}) {
  const patch = (p: Partial<Instance>) => onSaveInstance({ ...instance, ...p });

  const [argsDraft, setArgsDraft] = useState("");
  useEffect(
    () => setArgsDraft(instance.extra_jvm_args.join(" ")),
    [instance.extra_jvm_args],
  );

  const memOverride = instance.max_memory_mb !== null;
  const effMax = instance.max_memory_mb ?? settings.default_max_memory_mb;
  const effMin = instance.min_memory_mb ?? settings.default_min_memory_mb;

  const javaChoice = instance.java_policy
    ? instance.java_path
      ? "custom"
      : instance.java_policy
    : "default";

  const managed = instance.pack.kind !== "none";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 pb-4">
        <button
          onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-3">
          {instance.icon && (
            <img src={instance.icon} alt="" className="h-9 w-9 rounded-md object-cover" />
          )}
          <div>
            <h1 className="font-mc text-2xl tracking-wide text-gray-100">
              {instance.name}
            </h1>
            <div className="text-xs text-ink-600">
              Instance settings — overrides apply only to this instance.
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-4">
          <Card title="Memory" icon={<SlidersHorizontal size={14} />}>
            <Toggle
              label="Override launcher default"
              description={`Default is ${(settings.default_max_memory_mb / 1024).toFixed(0)} GB max.`}
              checked={memOverride}
              onChange={(on) =>
                patch(
                  on
                    ? {
                        max_memory_mb: settings.default_max_memory_mb,
                        min_memory_mb: settings.default_min_memory_mb,
                      }
                    : { max_memory_mb: null, min_memory_mb: null },
                )
              }
            />
            {memOverride && (
              <>
                <Slider
                  label="Maximum memory (-Xmx)"
                  value={effMax}
                  onChange={(v) =>
                    patch({ max_memory_mb: v, min_memory_mb: Math.min(effMin, v) })
                  }
                />
                <Slider
                  label="Minimum memory (-Xms)"
                  value={effMin}
                  min={512}
                  max={effMax}
                  onChange={(v) => patch({ min_memory_mb: Math.min(v, effMax) })}
                />
              </>
            )}
          </Card>

          <JavaCard
            instance={instance}
            javaChoice={javaChoice}
            patch={patch}
            onError={onError}
          />

          <Card title="JVM arguments" icon={<Terminal size={14} />}>
            <Field label="Preset" hint="Pick tuned flags or Custom to edit them.">
              <Select
                value={presetIdForArgs(instance.extra_jvm_args)}
                onChange={(id) => {
                  if (id === "custom") return;
                  const p = JVM_PRESETS.find((x) => x.id === id);
                  if (!p) return;
                  setArgsDraft(p.args.join(" "));
                  patch({ extra_jvm_args: p.args });
                }}
                options={[
                  ...JVM_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                  { value: "custom", label: "Custom" },
                ]}
              />
            </Field>
            <Field label="Arguments">
              <textarea
                rows={3}
                value={argsDraft}
                onChange={(e) => setArgsDraft(e.target.value)}
                onBlur={() =>
                  patch({
                    extra_jvm_args: argsDraft.split(/\s+/).filter((x) => x.length > 0),
                  })
                }
                placeholder="-XX:+UseG1GC"
                className={`${inputCls} font-mono text-xs`}
                spellCheck={false}
              />
            </Field>
          </Card>

          <Card title="Game window" icon={<Monitor size={14} />}>
            <Field label="Resolution override" hint="Leave blank to use the launcher default.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={640}
                  defaultValue={instance.resolution?.[0] ?? ""}
                  onBlur={(e) => {
                    const w = Number(e.target.value) || 0;
                    const h = instance.resolution?.[1] ?? 0;
                    patch({ resolution: w && h ? [w, h] : w ? [w, 720] : null });
                  }}
                  placeholder="1280"
                  className={`${inputCls} w-24`}
                />
                <span className="text-ink-600">×</span>
                <input
                  type="number"
                  min={480}
                  defaultValue={instance.resolution?.[1] ?? ""}
                  onBlur={(e) => {
                    const h = Number(e.target.value) || 0;
                    const w = instance.resolution?.[0] ?? 0;
                    patch({ resolution: w && h ? [w, h] : h ? [1280, h] : null });
                  }}
                  placeholder="720"
                  className={`${inputCls} w-24`}
                />
              </div>
            </Field>
          </Card>

          <Card title="Commands" icon={<Terminal size={14} />}>
            <Field label="Pre-launch command" hint="Overrides the launcher default for this instance.">
              <input
                defaultValue={instance.pre_launch_command ?? ""}
                onBlur={(e) =>
                  patch({ pre_launch_command: e.target.value.trim() || null })
                }
                placeholder="e.g. /usr/bin/mangohud --version"
                className={`${inputCls} font-mono text-xs`}
                spellCheck={false}
              />
            </Field>
            <Field label="Post-exit command">
              <input
                defaultValue={instance.post_exit_command ?? ""}
                onBlur={(e) =>
                  patch({ post_exit_command: e.target.value.trim() || null })
                }
                placeholder="e.g. notify-send 'Closed'"
                className={`${inputCls} font-mono text-xs`}
                spellCheck={false}
              />
            </Field>
          </Card>

          {!instance.featured && (
            <Card title="Branding" icon={<ImageIcon size={14} />}>
              <Field label="Icon URL" hint="Square logo shown on the card and Play page.">
                <input
                  defaultValue={instance.icon ?? ""}
                  onBlur={(e) => patch({ icon: e.target.value.trim() || null })}
                  placeholder="https://… or /local.png"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Field label="Banner URL" hint="Wide image shown behind the Play hero.">
                <input
                  defaultValue={instance.banner ?? ""}
                  onBlur={(e) => patch({ banner: e.target.value.trim() || null })}
                  placeholder="https://… or /local.png"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>
          )}

          {managed && (
            <ModpackCard
              instance={instance}
              modStatus={modStatus}
              maintaining={maintaining}
              progress={progress}
              onError={onError}
              onCheckUpdates={onCheckUpdates}
              onSaveInstance={onSaveInstance}
            />
          )}

          {instance.featured && (
            <Card title="Server feeds" icon={<Newspaper size={14} />}>
              <Toggle
                label="Show news"
                checked={instance.show_news}
                onChange={(v) => patch({ show_news: v })}
              />
              <Field label="News URL">
                <input
                  defaultValue={instance.news_url ?? ""}
                  onBlur={(e) => patch({ news_url: e.target.value.trim() || null })}
                  placeholder="https://api.example.com/news/"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Toggle
                label="Show player count"
                checked={instance.show_playercount}
                onChange={(v) => patch({ show_playercount: v })}
              />
              <Field label="Player count URL">
                <input
                  defaultValue={instance.playercount_url ?? ""}
                  onBlur={(e) =>
                    patch({ playercount_url: e.target.value.trim() || null })
                  }
                  placeholder="https://api.example.com/playercount"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>
          )}

          {!instance.featured && (
            <Card title="Danger zone" icon={<Trash2 size={14} />}>
              <p className="text-xs text-ink-600">
                Permanently delete this instance and all its game files.
              </p>
              <DeleteButton instanceId={instance.id} onDeleted={onDeleted} onError={onError} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function JavaCard({
  instance,
  javaChoice,
  patch,
  onError,
}: {
  instance: Instance;
  javaChoice: string;
  patch: (p: Partial<Instance>) => void;
  onError: (e: string) => void;
}) {
  const [report, setReport] = useState<JavaReport | null>(null);
  const load = () => {
    if (api.isTauri()) api.javaInfo(instance.id).then(setReport).catch(() => {});
  };
  useEffect(load, [instance.id]);

  return (
    <Card title="Java" icon={<Coffee size={14} />}>
      <Field
        label="Java for this instance"
        hint="“Launcher default” uses your global policy. Auto downloads the exact version this build needs."
      >
        <Select
          value={javaChoice}
          onChange={(v) => {
            if (v === "default") patch({ java_policy: null, java_path: null });
            else if (v === "custom") patch({ java_policy: "custom" });
            else patch({ java_policy: v, java_path: null });
          }}
          options={[
            { value: "default", label: "Launcher default" },
            { value: "auto", label: "Auto-download" },
            { value: "system", label: "System Java" },
            { value: "custom", label: "Custom path…" },
          ]}
        />
      </Field>
      {javaChoice === "custom" && (
        <Field label="Java executable path">
          <input
            defaultValue={instance.java_path ?? ""}
            onBlur={(e) =>
              patch({ java_policy: "custom", java_path: e.target.value.trim() || null })
            }
            placeholder="/path/to/bin/java"
            className={`${inputCls} font-mono text-xs`}
            spellCheck={false}
          />
        </Field>
      )}
      {report && report.runtimes.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm text-ink-600">Downloaded runtimes</div>
          <div className="flex flex-col gap-1">
            {report.runtimes.map((r) => (
              <div
                key={r.path}
                className="group flex items-center gap-2 rounded-md border border-edge bg-ink-950/40 px-2.5 py-1.5 text-xs transition hover:border-brass-600/40 hover:bg-brass-500/5"
              >
                <Coffee size={12} className="text-brass-400" />
                <span className="flex-1 truncate text-gray-200">{r.label}</span>
                <button
                  onClick={() => api.revealPath(r.path).catch(() => {})}
                  title="Open folder"
                  className="text-ink-600 opacity-0 transition hover:text-brass-300 group-hover:opacity-100"
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  onClick={() =>
                    api
                      .deleteJavaRuntime(r.path)
                      .then(() => {
                        toast("Runtime deleted", "info");
                        load();
                      })
                      .catch((e) => onError(String(e)))
                  }
                  title="Uninstall"
                  className="text-ink-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ModpackCard({
  instance,
  modStatus,
  maintaining,
  progress,
  onError,
  onCheckUpdates,
  onSaveInstance,
}: {
  instance: Instance;
  modStatus: ModpackStatus | null;
  maintaining: boolean;
  progress: LaunchProgress | null;
  onError: (e: string) => void;
  onCheckUpdates: () => void;
  onSaveInstance: (i: Instance) => void;
}) {
  const id = instance.id;
  const pack = instance.pack;
  const isPackwiz = pack.kind === "packwiz" || instance.featured;
  const source = pack.kind === "curseforge" ? "curseforge" : "modrinth";
  const projectId =
    pack.kind === "modrinth"
      ? pack.project_id
      : pack.kind === "curseforge"
        ? pack.project_id
        : null;

  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const currentVersion =
    pack.kind === "modrinth"
      ? pack.version_id
      : pack.kind === "curseforge"
        ? pack.file_id
        : null;

  useEffect(() => {
    if (isPackwiz || !projectId) return;
    api.modpackVersions(source, projectId).then(setVersions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, source, isPackwiz]);

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;
  const run = (fn: () => Promise<void>) => fn().catch((e) => onError(String(e)));

  return (
    <Card title="Modpack" icon={<Package size={14} />}>
      <Row label="Installed version" value={modStatus?.installed_version ?? "—"} />
      {isPackwiz && (
        <Row label="Latest version" value={modStatus?.latest_version || "—"} />
      )}

      {maintaining && (
        <div className="rounded-lg border border-edge bg-ink-900/50 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-brass-300">
              <Loader2 size={13} className="animate-spin" /> Working
              {progress?.message ? (
                <span className="text-ink-600">· {progress.message}</span>
              ) : null}
            </span>
            {pct !== null && <span className="tabular-nums text-ink-600">{pct}%</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-800">
            <div
              className="progress-fill h-full rounded-full transition-[width] duration-300"
              style={{ width: pct !== null ? `${pct}%` : "40%" }}
            />
          </div>
        </div>
      )}

      <Toggle
        label="Lock modpack"
        description="Locked packs verify/update on launch and protect their mods."
        checked={instance.modpack_locked}
        onChange={(v) =>
          api
            .setModpackLocked(id, v)
            .then(() => api.getInstance(id).then(onSaveInstance))
            .catch((e) => onError(String(e)))
        }
      />

      {!isPackwiz && projectId ? (
        <div
          key={showVersions ? "versions" : "actions"}
          className="swap-in flex flex-col gap-3"
        >
          {showVersions ? (
            <>
              <button
                onClick={() => setShowVersions(false)}
                className="self-start text-xs text-ink-600 hover:text-brass-300"
              >
                ← Back
              </button>
              <div className="max-h-[320px] overflow-y-auto pr-1">
                <VersionList
                  instanceId={id}
                  projectId={projectId}
                  source={source}
                  versions={versions ?? []}
                  actionLabel={maintaining ? "Working…" : "Switch"}
                  busy={maintaining}
                  currentVersionId={currentVersion}
                  onPick={(vid) => {
                    setShowVersions(false);
                    run(() => api.updateModpack(id, vid));
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <ActionButton
                icon={<Download size={15} />}
                disabled={maintaining || !versions}
                onClick={() => setShowVersions(true)}
              >
                Change / update version
                {currentVersion && (
                  <span className="ml-auto text-[11px] text-ink-600">
                    current: {currentVersion}
                  </span>
                )}
              </ActionButton>
              <ActionButton
                icon={<Wrench size={15} />}
                disabled={maintaining}
                onClick={() => run(() => api.updateModpack(id, null))}
              >
                Verify &amp; repair
              </ActionButton>
            </>
          )}
        </div>
      ) : isPackwiz ? (
        <>
          <ActionButton
            icon={maintaining ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            disabled={maintaining}
            onClick={onCheckUpdates}
          >
            Check for updates
          </ActionButton>
          <ActionButton
            icon={<Wrench size={15} />}
            disabled={maintaining}
            onClick={() => run(() => api.repairModpack(id))}
          >
            Repair modpack
          </ActionButton>
          <ActionButton
            icon={<Hammer size={15} />}
            disabled={maintaining}
            onClick={() => run(() => api.reinstallLoader(id))}
          >
            Reinstall loader
          </ActionButton>
          <ActionButton
            danger
            icon={<Trash2 size={15} />}
            disabled={maintaining}
            onClick={() => run(() => api.reinstallModpack(id))}
          >
            Reinstall from scratch
          </ActionButton>
        </>
      ) : null}

      <ActionButton
        icon={<FolderOpen size={15} />}
        onClick={() => api.openInstanceDir(id).catch((e) => onError(String(e)))}
      >
        Open install folder
      </ActionButton>
      {(pack.kind === "modrinth" || pack.kind === "curseforge") && projectId && (
        <ActionButton
          icon={<ExternalLink size={15} />}
          onClick={() =>
            api
              .openExternal(
                pack.kind === "curseforge"
                  ? `https://www.curseforge.com/projects/${projectId}`
                  : `https://modrinth.com/modpack/${projectId}`,
              )
              .catch(() => {})
          }
        >
          View on {pack.kind === "curseforge" ? "CurseForge" : "Modrinth"}
        </ActionButton>
      )}
    </Card>
  );
}

function DeleteButton({
  instanceId,
  onDeleted,
  onError,
}: {
  instanceId: string;
  onDeleted: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirm) {
    return (
      <ActionButton danger icon={<Trash2 size={15} />} onClick={() => setConfirm(true)}>
        Delete instance
      </ActionButton>
    );
  }
  return (
    <div className="flex gap-2">
      <ActionButton
        danger
        icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        disabled={busy}
        onClickAsync={async () => {
          setBusy(true);
          try {
            await api.deleteInstance(instanceId);
            toast("Instance deleted", "info");
            onDeleted(instanceId);
          } catch (e) {
            onError(String(e));
          } finally {
            setBusy(false);
            setConfirm(false);
          }
        }}
      >
        Confirm delete
      </ActionButton>
      <button
        onClick={() => setConfirm(false)}
        className="rounded-lg border border-edge px-3 text-sm text-ink-600 hover:text-gray-200"
      >
        Cancel
      </button>
    </div>
  );
}
