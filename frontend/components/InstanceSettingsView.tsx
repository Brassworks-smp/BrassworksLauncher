import { useEffect, useMemo, useState } from "react";
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
  StickyNote,
  X,
  Share2,
  GitBranch,
  Copy,
  Lock,
  Pin,
} from "lucide-react";
import { appliedPins, QuickSettingsPicker } from "@/lib/quickSettings";
import { useT } from "@/lib/i18n";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import {
  buildInstanceIcons,
  currentPalette,
  DEFAULT_INSTANCE_ICON,
  iconSrc,
  isBuiltinIcon,
} from "@/lib/instanceIcons";
import { VersionList } from "@/components/VersionList";
import { VersionPicker, type LoaderStatus } from "@/components/VersionPicker";
import { useSupportedLoaders } from "@/lib/useSupportedLoaders";
import { FlavorPicker } from "@/components/FlavorPicker";
import type {
  Instance,
  LauncherSettings,
  LaunchProgress,
  ModpackStatus,
  ContentVersion,
  FlavorGroup,
  JavaReport,
  LoaderKind,
  LoaderVersion,
} from "@/lib/types";
import {
  Card,
  Field,
  Select,
  Dropdown,
  MemorySettings,
  Toggle,
  Row,
  ActionButton,
  inputCls,
  CardColumns,
  NumberField,
} from "@/components/ui";

const JVM_PRESETS: { id: string; tkey: string; args: string[] }[] = [
  { id: "none", tkey: "instanceSettings.jvm.presetNone", args: [] },
  {
    id: "balanced",
    tkey: "instanceSettings.jvm.presetBalanced",
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
    tkey: "instanceSettings.jvm.presetAikars",
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
  const t = useT();
  const patch = (p: Partial<Instance>) => onSaveInstance({ ...instance, ...p });

  
  
  const [resetNonce, setResetNonce] = useState(0);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const resetInstance = (p: Partial<Instance>) => {
    patch(p);
    setResetNonce((n) => n + 1);
  };

  const defaultIcons = useMemo(
    () => buildInstanceIcons(currentPalette()),
    [settings.accent_color],
  );

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
  
  
  const canEditVersion = !managed || !instance.modpack_locked;

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
          <img
            src={iconSrc(instance.icon ?? DEFAULT_INSTANCE_ICON) ?? undefined}
            alt=""
            className="h-9 w-9 rounded-md object-cover"
          />
          <div>
            {instance.featured ? (
              <div
                title={t("instanceSettings.featuredNameLocked")}
                className="-mx-1.5 max-w-md truncate px-1.5 font-mc text-2xl tracking-wide text-gray-100"
              >
                {instance.name}
              </div>
            ) : (
              <input
                defaultValue={instance.name}
                key={instance.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== instance.name) patch({ name: v });
                  else e.target.value = instance.name;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.currentTarget.value = instance.name;
                    e.currentTarget.blur();
                  }
                }}
                title={t("instanceSettings.renameInstance")}
                spellCheck={false}
                className="-mx-1.5 w-full max-w-md rounded-md bg-transparent px-1.5 font-mc text-2xl tracking-wide text-gray-100 outline-none transition hover:bg-ink-800/60 focus:bg-ink-800 focus:ring-1 focus:ring-brass-500/50"
              />
            )}
            <div className="text-xs text-ink-600">
              {t("instanceSettings.subtitle")}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <CardColumns>
          <Card title={t("instanceSettings.details.title")} icon={<StickyNote size={14} />}>
            <Field
              label={t("instanceSettings.details.name")}
              hint={
                instance.featured
                  ? t("instanceSettings.featuredNameLockedHint")
                  : undefined
              }
            >
              <input
                key={instance.name}
                defaultValue={instance.name}
                disabled={instance.featured}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== instance.name) patch({ name: v });
                  else e.target.value = instance.name;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.currentTarget.value = instance.name;
                    e.currentTarget.blur();
                  }
                }}
                spellCheck={false}
                className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`}
              />
            </Field>
            <Field label={t("instanceSettings.details.notes")}>
              <textarea
                defaultValue={instance.notes ?? ""}
                onBlur={(e) => patch({ notes: e.target.value.trim() || null })}
                placeholder={t("instanceSettings.details.notesPlaceholder")}
                rows={3}
                className={`${inputCls} resize-none leading-relaxed`}
                spellCheck={false}
              />
            </Field>
            <div>
              <div className="mb-1.5 text-sm text-ink-600">{t("instanceSettings.details.tags")}</div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-ink-950/70 px-2 py-1.5 ring-1 ring-edge">
                {(instance.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full bg-brass-500/15 px-2 py-0.5 text-xs text-brass-300"
                  >
                    {tag}
                    <button
                      onClick={() =>
                        patch({ tags: (instance.tags ?? []).filter((x) => x !== tag) })
                      }
                      className="text-brass-300/70 hover:text-red-300"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  placeholder={t("instanceSettings.details.addTag")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = e.currentTarget.value.trim().toLowerCase();
                      if (v && !(instance.tags ?? []).includes(v))
                        patch({ tags: [...(instance.tags ?? []), v] });
                      e.currentTarget.value = "";
                    }
                  }}
                  className="min-w-[80px] flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-ink-600"
                  spellCheck={false}
                />
              </div>
            </div>
          </Card>
          <ExportCard instanceId={instance.id} />
          {canEditVersion && <VersionLoaderCard instance={instance} onSave={patch} />}
          <Card
            title={t("instanceSettings.memory.title")}
            icon={<SlidersHorizontal size={14} />}
            onReset={() =>
              resetInstance({ max_memory_mb: null, min_memory_mb: null })
            }
            resetTitle={t("instanceSettings.resetToDefault")}
          >
            <Toggle
              label={t("instanceSettings.memory.override")}
              description={t("instanceSettings.memory.overrideDesc", {
                gb: (settings.default_max_memory_mb / 1024).toFixed(0),
              })}
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
              <MemorySettings
                max={effMax}
                min={effMin}
                onChange={(mx, mn) =>
                  patch({ max_memory_mb: mx, min_memory_mb: mn })
                }
              />
            )}
          </Card>

          <Card title={t("instanceSettings.quick.title")} icon={<Pin size={14} />}>
            <p className="text-xs text-ink-600">
              {t("instanceSettings.quick.desc")}
            </p>
            {appliedPins(instance).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {appliedPins(instance).map((s) => (
                  <span
                    key={s.id}
                    className="flex items-center gap-1 rounded-full bg-brass-500/15 px-2 py-0.5 text-xs text-brass-300"
                  >
                    <Pin size={10} /> {t(s.tkey)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-600">{t("instanceSettings.quick.empty")}</p>
            )}
            <button
              onClick={() => setPinPickerOpen(true)}
              className="flex items-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Pin size={13} /> {t("instanceSettings.quick.choose")}
            </button>
          </Card>

          <JavaCard
            instance={instance}
            javaChoice={javaChoice}
            patch={patch}
            onError={onError}
            onReset={() =>
              resetInstance({ java_policy: null, java_path: null })
            }
          />

          <Card
            title={t("instanceSettings.jvm.title")}
            icon={<Terminal size={14} />}
            onReset={() => {
              setArgsDraft("");
              resetInstance({ extra_jvm_args: [] });
            }}
          >
            <Field label={t("instanceSettings.jvm.preset")} hint={t("instanceSettings.jvm.presetHint")}>
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
                  ...JVM_PRESETS.map((p) => ({ value: p.id, label: t(p.tkey) })),
                  { value: "custom", label: t("instanceSettings.jvm.custom") },
                ]}
              />
            </Field>
            <Field label={t("instanceSettings.jvm.arguments")}>
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

          <Card
            title={t("instanceSettings.window.title")}
            icon={<Monitor size={14} />}
            onReset={() => resetInstance({ resolution: null })}
            resetTitle={t("instanceSettings.resetToDefault")}
          >
            <Field label={t("instanceSettings.window.resOverride")} hint={t("instanceSettings.window.resHint")}>
              <div className="flex items-center gap-2">
                <NumberField
                  min={640}
                  value={instance.resolution?.[0] ?? null}
                  onChange={(w) => {
                    const h = instance.resolution?.[1] ?? 0;
                    patch({ resolution: w && h ? [w, h] : w ? [w, 720] : null });
                  }}
                  placeholder="1280"
                  className="w-24"
                />
                <span className="text-ink-600">×</span>
                <NumberField
                  min={480}
                  value={instance.resolution?.[1] ?? null}
                  onChange={(h) => {
                    const w = instance.resolution?.[0] ?? 0;
                    patch({ resolution: w && h ? [w, h] : h ? [1280, h] : null });
                  }}
                  placeholder="720"
                  className="w-24"
                />
              </div>
            </Field>
          </Card>

          <Card
            title={t("instanceSettings.commands.title")}
            icon={<Terminal size={14} />}
            onReset={() =>
              resetInstance({
                pre_launch_command: null,
                post_exit_command: null,
              })
            }
            resetTitle={t("instanceSettings.resetToDefault")}
          >
            <Field label={t("instanceSettings.commands.pre")} hint={t("instanceSettings.commands.preHint")}>
              <input
                key={`pre-${resetNonce}`}
                defaultValue={instance.pre_launch_command ?? ""}
                onBlur={(e) =>
                  patch({ pre_launch_command: e.target.value.trim() || null })
                }
                placeholder={t("instanceSettings.commands.prePlaceholder")}
                className={`${inputCls} font-mono text-xs`}
                spellCheck={false}
              />
            </Field>
            <Field label={t("instanceSettings.commands.post")}>
              <input
                key={`post-${resetNonce}`}
                defaultValue={instance.post_exit_command ?? ""}
                onBlur={(e) =>
                  patch({ post_exit_command: e.target.value.trim() || null })
                }
                placeholder={t("instanceSettings.commands.postPlaceholder")}
                className={`${inputCls} font-mono text-xs`}
                spellCheck={false}
              />
            </Field>
          </Card>

          {!instance.featured && (
            <Card
              title={t("instanceSettings.branding.title")}
              icon={<ImageIcon size={14} />}
              onReset={() =>
                resetInstance({ icon: null, banner: null, logo: null })
              }
            >
              <Field label={t("instanceSettings.branding.defaultIcons")} hint={t("instanceSettings.branding.defaultIconsHint")}>
                <div className="flex flex-wrap gap-2">
                  {defaultIcons.map((ic) => (
                    <button
                      key={ic.id}
                      type="button"
                      onClick={() => patch({ icon: ic.value })}
                      title={ic.id}
                      className={`grid h-10 w-10 place-items-center rounded-lg border bg-ink-950/40 transition hover:border-brass-500/60 ${
                        instance.icon === ic.value
                          ? "border-brass-500 ring-1 ring-brass-500/60"
                          : "border-edge"
                      }`}
                    >
                      <img src={ic.uri} alt="" className="h-7 w-7" />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t("instanceSettings.branding.iconUrl")} hint={t("instanceSettings.branding.iconUrlHint")}>
                <input
                  key={`icon-${instance.icon ?? "none"}-${resetNonce}`}
                  defaultValue={
                    isBuiltinIcon(instance.icon) ? "" : (instance.icon ?? "")
                  }
                  onBlur={(e) => patch({ icon: e.target.value.trim() || null })}
                  placeholder={t("instanceSettings.branding.urlPlaceholder")}
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Field label={t("instanceSettings.branding.bannerUrl")} hint={t("instanceSettings.branding.bannerUrlHint")}>
                <input
                  key={`banner-${resetNonce}`}
                  defaultValue={instance.banner ?? ""}
                  onBlur={(e) => patch({ banner: e.target.value.trim() || null })}
                  placeholder={t("instanceSettings.branding.urlPlaceholder")}
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t("instanceSettings.branding.logoUrl")}
                hint={t("instanceSettings.branding.logoUrlHint")}
              >
                <input
                  key={`logo-${resetNonce}`}
                  defaultValue={instance.logo ?? ""}
                  onBlur={(e) => patch({ logo: e.target.value.trim() || null })}
                  placeholder={t("instanceSettings.branding.urlPlaceholder")}
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
            <Card title={t("instanceSettings.feeds.title")} icon={<Newspaper size={14} />}>
              <Toggle
                label={t("instanceSettings.feeds.showNews")}
                checked={instance.show_news}
                onChange={(v) => patch({ show_news: v })}
              />
              <Field label={t("instanceSettings.feeds.newsUrl")}>
                <input
                  defaultValue={instance.news_url ?? ""}
                  onBlur={(e) => patch({ news_url: e.target.value.trim() || null })}
                  placeholder={t("instanceSettings.feeds.newsPlaceholder")}
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Toggle
                label={t("instanceSettings.feeds.showPlayers")}
                checked={instance.show_playercount}
                onChange={(v) => patch({ show_playercount: v })}
              />
              <Field label={t("instanceSettings.feeds.playersUrl")}>
                <input
                  defaultValue={instance.playercount_url ?? ""}
                  onBlur={(e) =>
                    patch({ playercount_url: e.target.value.trim() || null })
                  }
                  placeholder={t("instanceSettings.feeds.playersPlaceholder")}
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>
          )}

          {!instance.featured && (
            <Card title={t("instanceSettings.danger.title")} icon={<Trash2 size={14} />}>
              <p className="text-xs text-ink-600">
                {t("instanceSettings.danger.desc")}
              </p>
              <DeleteButton instanceId={instance.id} onDeleted={onDeleted} onError={onError} />
            </Card>
          )}
        </CardColumns>
      </div>

      {pinPickerOpen && (
        <QuickSettingsPicker
          instance={instance}
          onSaveInstance={onSaveInstance}
          onClose={() => setPinPickerOpen(false)}
        />
      )}
    </div>
  );
}

function JavaCard({
  instance,
  javaChoice,
  patch,
  onError,
  onReset,
}: {
  instance: Instance;
  javaChoice: string;
  patch: (p: Partial<Instance>) => void;
  onError: (e: string) => void;
  onReset?: () => void;
}) {
  const t = useT();
  const [report, setReport] = useState<JavaReport | null>(null);
  const load = () => {
    if (api.isTauri()) api.javaInfo(instance.id).then(setReport).catch(() => {});
  };
  useEffect(load, [instance.id]);

  return (
    <Card
      title={t("instanceSettings.java.title")}
      icon={<Coffee size={14} />}
      onReset={onReset}
      resetTitle={t("instanceSettings.resetToDefault")}
    >
      <Field
        label={t("instanceSettings.java.forThis")}
        hint={t("instanceSettings.java.forThisHint")}
      >
        <Select
          value={javaChoice}
          onChange={(v) => {
            if (v === "default") patch({ java_policy: null, java_path: null });
            else if (v === "custom") patch({ java_policy: "custom" });
            else patch({ java_policy: v, java_path: null });
          }}
          options={[
            { value: "default", label: t("instanceSettings.java.default") },
            { value: "auto", label: t("instanceSettings.java.auto") },
            { value: "system", label: t("instanceSettings.java.system") },
            { value: "custom", label: t("instanceSettings.java.custom") },
          ]}
        />
      </Field>
      {javaChoice === "custom" && (
        <Field label={t("instanceSettings.java.execPath")}>
          <input
            defaultValue={instance.java_path ?? ""}
            onBlur={(e) =>
              patch({ java_policy: "custom", java_path: e.target.value.trim() || null })
            }
            placeholder={t("instanceSettings.java.pathPlaceholder")}
            className={`${inputCls} font-mono text-xs`}
            spellCheck={false}
          />
        </Field>
      )}
      {report && report.runtimes.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm text-ink-600">{t("instanceSettings.java.downloaded")}</div>
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
                  title={t("instanceSettings.java.openFolder")}
                  className="text-ink-600 opacity-0 transition hover:text-brass-300 group-hover:opacity-100"
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  onClick={() =>
                    api
                      .deleteJavaRuntime(r.path)
                      .then(() => {
                        toast(t("instanceSettings.java.runtimeDeleted"), "info");
                        load();
                      })
                      .catch((e) => onError(String(e)))
                  }
                  title={t("instanceSettings.java.uninstall")}
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
  const t = useT();
  const id = instance.id;
  const pack = instance.pack;
  const loaderEntry = VL_LOADERS.find((l) => l.kind === instance.loader);
  const isPackwiz = pack.kind === "packwiz" || instance.featured;
  
  
  const urlEditable = !instance.featured && !instance.modpack_locked;
  const source = pack.kind === "curseforge" ? "curseforge" : "modrinth";
  const projectId =
    pack.kind === "modrinth"
      ? pack.project_id
      : pack.kind === "curseforge"
        ? pack.project_id
        : null;

  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [branches, setBranches] = useState<api.PackwizBranch[] | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  
  const [flavorGroups, setFlavorGroups] = useState<FlavorGroup[] | "loading" | null>(null);
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
    <Card title={t("instanceSettings.modpack.title")} icon={<Package size={14} />}>
      <Row label={t("instanceSettings.modpack.installedVersion")} value={modStatus?.installed_version ?? "-"} />
      {isPackwiz && (
        <Row label={t("instanceSettings.modpack.latestVersion")} value={modStatus?.latest_version || "-"} />
      )}
      <Row label={t("instanceSettings.modpack.minecraft")} value={instance.minecraft_version} />
      <Row
        label={t("instanceSettings.modpack.loaderRow")}
        value={loaderEntry ? t(loaderEntry.tkey) : instance.loader}
      />
      {instance.loader !== "vanilla" && (
        <Row label={t("instanceSettings.modpack.loaderVersion")} value={lvToStr(instance.loader_version)} />
      )}

      {pack.kind === "packwiz" && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-ink-900/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-600">
            <GitBranch size={13} /> {t("instanceSettings.modpack.source")}
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={pack.url}
              className="min-w-0 flex-1 truncate rounded-md bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] text-ink-500 outline-none ring-1 ring-edge transition-colors caret-brass-400 hover:text-ink-400 hover:ring-brass-600/40 focus:text-ink-300 focus:ring-2 focus:ring-brass-500/70"
            />
            <button
              title={t("instanceSettings.modpack.copyUrl")}
              onClick={() => navigator.clipboard?.writeText(pack.url)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Copy size={14} />
            </button>
            <button
              title={t("instanceSettings.modpack.openBrowser")}
              onClick={() => api.openExternal(pack.url).catch(() => {})}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <ExternalLink size={14} />
            </button>
          </div>
          {!urlEditable ? (
            <div className="flex items-center gap-1.5 text-[11px] text-ink-600">
              <Lock size={12} />
              {instance.featured
                ? t("instanceSettings.modpack.sourceFixedFeatured")
                : t("instanceSettings.modpack.unlockToSwitch")}
            </div>
          ) : branches && branches.length > 0 ? (
            <Dropdown
              value={pack.url}
              onChange={(v) => {
                if (v === pack.url) return;
                run(async () => {
                  await api.switchPackwizBranch(id, v);
                  
                  
                  await api.syncModpack(id);
                  const updated = await api.getInstance(id);
                  onSaveInstance(updated);
                });
              }}
              options={branches.map((b) => ({ value: b.pack_url, label: b.name }))}
            />
          ) : (
            <button
              disabled={loadingBranches || maintaining}
              onClick={() => {
                setLoadingBranches(true);
                api
                  .listPackwizBranches(pack.url)
                  .then((list) => {
                    setBranches(list);
                    if (list.length === 0)
                      onError(t("instanceSettings.modpack.noBranches"));
                  })
                  .catch((e) => onError(String(e)))
                  .finally(() => setLoadingBranches(false));
              }}
              className="flex items-center justify-center gap-2 self-start rounded-md border border-brass-600/40 px-3 py-1.5 text-xs text-brass-200 transition hover:bg-brass-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingBranches ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitBranch size={14} />
              )}
              {t("instanceSettings.modpack.switchBranch")}
            </button>
          )}

          {pack.unsup && (
            <button
              disabled={flavorGroups === "loading" || maintaining}
              onClick={() => {
                setFlavorGroups("loading");
                api
                  .inspectPackwizFlavors(pack.url)
                  .then((groups) => {
                    if (groups.length === 0) {
                      setFlavorGroups(null);
                      onError(t("instanceSettings.modpack.noFlavors"));
                    } else {
                      setFlavorGroups(groups);
                    }
                  })
                  .catch((e) => {
                    setFlavorGroups(null);
                    onError(String(e));
                  });
              }}
              className="flex items-center justify-center gap-2 self-start rounded-md border border-brass-600/40 px-3 py-1.5 text-xs text-brass-200 transition hover:bg-brass-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {flavorGroups === "loading" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <SlidersHorizontal size={14} />
              )}
              {t("instanceSettings.modpack.changeFlavors")}
            </button>
          )}
        </div>
      )}

      {flavorGroups && (
        <div
          className="modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setFlavorGroups(null)
          }
        >
          <div className="rise flex h-[70vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 p-5 shadow-2xl">
            {flavorGroups === "loading" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-600">
                <Loader2 size={22} className="animate-spin text-brass-400" />
                <span className="text-sm">{t("instanceSettings.modpack.readingFlavors")}</span>
              </div>
            ) : (
              <FlavorPicker
                title={instance.name}
                groups={flavorGroups}
                preset={instance.unsup_flavors ?? undefined}
                busy={maintaining}
                confirmLabel={t("instanceSettings.modpack.applyFlavors")}
                onBack={() => setFlavorGroups(null)}
                onConfirm={(ids) => {
                  setFlavorGroups(null);
                  run(async () => {
                    await api.setPackwizFlavors(id, ids);
                    onSaveInstance(await api.getInstance(id));
                    
                    
                    await api.syncModpack(id);
                  });
                }}
              />
            )}
          </div>
        </div>
      )}

      {maintaining && (
        <div className="rounded-lg border border-edge bg-ink-900/50 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-brass-300">
              <Loader2 size={13} className="animate-spin" /> {t("instanceSettings.modpack.working")}
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
        label={t("instanceSettings.modpack.lock")}
        description={t("instanceSettings.modpack.lockDesc")}
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
                ← {t("common.back")}
              </button>
              <div className="max-h-[320px] overflow-y-auto pr-1">
                <VersionList
                  instanceId={id}
                  projectId={projectId}
                  source={source}
                  versions={versions ?? []}
                  actionLabel={maintaining ? t("instanceSettings.modpack.workingEllipsis") : t("instanceSettings.modpack.switch")}
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
                {t("instanceSettings.modpack.changeVersion")}
                {currentVersion && (
                  <span className="ml-auto text-[11px] text-ink-600">
                    {t("instanceSettings.modpack.current", { version: currentVersion })}
                  </span>
                )}
              </ActionButton>
              <ActionButton
                icon={<Wrench size={15} />}
                disabled={maintaining}
                onClick={() => run(() => api.updateModpack(id, null))}
              >
                {t("instanceSettings.modpack.verifyRepair")}
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
            {t("instanceSettings.modpack.checkUpdates")}
          </ActionButton>
          <ActionButton
            icon={<Wrench size={15} />}
            disabled={maintaining}
            onClick={() => run(() => api.repairModpack(id))}
          >
            {t("instanceSettings.modpack.repair")}
          </ActionButton>
          <ActionButton
            icon={<Hammer size={15} />}
            disabled={maintaining}
            onClick={() => run(() => api.reinstallLoader(id))}
          >
            {t("instanceSettings.modpack.reinstallLoader")}
          </ActionButton>
          <ActionButton
            danger
            icon={<Trash2 size={15} />}
            disabled={maintaining}
            onClick={() => run(() => api.reinstallModpack(id))}
          >
            {t("instanceSettings.modpack.reinstallScratch")}
          </ActionButton>
        </>
      ) : null}

      <ActionButton
        icon={<FolderOpen size={15} />}
        onClick={() => api.openInstanceDir(id).catch((e) => onError(String(e)))}
      >
        {t("instanceSettings.modpack.openFolder")}
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
          {t("instanceSettings.modpack.viewOn", {
            provider: pack.kind === "curseforge" ? "CurseForge" : "Modrinth",
          })}
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
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirm) {
    return (
      <ActionButton danger icon={<Trash2 size={15} />} onClick={() => setConfirm(true)}>
        {t("instanceSettings.danger.deleteInstance")}
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
            toast(t("instanceSettings.danger.deletedToast"), "info");
            onDeleted(instanceId);
          } catch (e) {
            onError(String(e));
          } finally {
            setBusy(false);
            setConfirm(false);
          }
        }}
      >
        {t("instanceSettings.danger.confirmDelete")}
      </ActionButton>
      <button
        onClick={() => setConfirm(false)}
        className="rounded-lg border border-edge px-3 text-sm text-ink-600 hover:text-gray-200"
      >
        {t("common.cancel")}
      </button>
    </div>
  );
}

function ExportCard({ instanceId }: { instanceId: string }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (format: "modrinth" | "curseforge") => {
    setBusy(format);
    api
      .exportModpack(instanceId, format)
      .then((path) => toast(t("instanceSettings.export.exportedToast", { path }), "success"))
      .catch((e) => toast(String(e), "error"))
      .finally(() => setBusy(null));
  };
  const btn =
    "flex flex-1 items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <Card title={t("instanceSettings.export.title")} icon={<Share2 size={14} />}>
      <p className="text-xs text-ink-600">
        {t("instanceSettings.export.desc")}
      </p>
      <div className="flex gap-2">
        <button onClick={() => run("modrinth")} disabled={!!busy} className={btn}>
          {busy === "modrinth" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
          {t("instanceSettings.export.mrpack")}
        </button>
        <button
          onClick={() => run("curseforge")}
          disabled={!!busy}
          className={btn}
        >
          {busy === "curseforge" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
          {t("instanceSettings.export.cfzip")}
        </button>
      </div>
    </Card>
  );
}

const VL_LOADERS: { id: string; kind: LoaderKind; tkey: string }[] = [
  { id: "vanilla", kind: "vanilla", tkey: "instanceSettings.loader.vanilla" },
  { id: "neoforge", kind: "neo_forge", tkey: "instanceSettings.loader.neoforge" },
  { id: "forge", kind: "forge", tkey: "instanceSettings.loader.forge" },
  { id: "fabric", kind: "fabric", tkey: "instanceSettings.loader.fabric" },
  { id: "quilt", kind: "quilt", tkey: "instanceSettings.loader.quilt" },
];

const lvToStr = (lv: LoaderVersion): string =>
  lv.channel === "exact" ? lv.value : lv.channel;
const strToLv = (s: string): LoaderVersion =>
  s === "stable" || s === "unstable"
    ? { channel: s }
    : { channel: "exact", value: s };

function VersionLoaderCard({
  instance,
  onSave,
}: {
  instance: Instance;
  onSave: (p: Partial<Instance>) => void;
}) {
  const t = useT();
  const kindToPicker = (k: string) => (k === "neo_forge" ? "neoforge" : k);
  const [pickerLoader, setPickerLoader] = useState(kindToPicker(instance.loader));
  const [mc, setMc] = useState(instance.minecraft_version);
  const [lv, setLv] = useState(lvToStr(instance.loader_version));
  
  
  const [loaderStatus, setLoaderStatus] = useState<LoaderStatus>("ok");
  
  
  const { supported: supportedLoaders } = useSupportedLoaders(mc);
  const kind = VL_LOADERS.find((l) => l.id === pickerLoader)?.kind ?? "vanilla";
  const changed =
    kind !== instance.loader ||
    mc !== instance.minecraft_version ||
    lvToStr(instance.loader_version) !== lv;

  return (
    <Card title={t("instanceSettings.version.title")} icon={<Hammer size={14} />}>
      <Field
        label={t("instanceSettings.version.modLoader")}
        hint={t("instanceSettings.version.modLoaderHint")}
      >
        <div className="flex flex-wrap gap-1.5">
          {VL_LOADERS.map((l) => {
            const disabled =
              supportedLoaders !== null && !supportedLoaders.includes(l.id);
            return (
              <button
                key={l.id}
                disabled={disabled}
                title={disabled ? t("versionPicker.loaderUnavailable", { loader: t(l.tkey), mc }) : undefined}
                onClick={() => {
                  setPickerLoader(l.id);
                  if (l.id !== pickerLoader) setLv("stable");
                }}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  pickerLoader === l.id
                    ? "border-brass-500/50 bg-brass-500/15 text-brass-300"
                    : "border-edge text-ink-600 hover:text-brass-300"
                }`}
              >
                {t(l.tkey)}
              </button>
            );
          })}
        </div>
      </Field>
      <VersionPicker
        loader={pickerLoader}
        mc={mc}
        setMc={setMc}
        loaderVersion={lv}
        setLoaderVersion={setLv}
        onStatus={setLoaderStatus}
      />
      <button
        onClick={() => {
          onSave({
            minecraft_version: mc,
            loader: kind,
            loader_version: strToLv(lv),
          });
          toast(t("instanceSettings.version.updatedToast"), "info");
        }}
        disabled={
          !changed ||
          loaderStatus === "unavailable" ||
          loaderStatus === "checking"
        }
        className="brass-btn flex items-center justify-center gap-2 self-start rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Wrench size={15} /> {t("instanceSettings.version.apply")}
      </button>
      <p className="text-xs text-ink-600">
        {t("instanceSettings.version.modsNote")}
      </p>
    </Card>
  );
}
