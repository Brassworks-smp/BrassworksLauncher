import { useEffect, useState } from "react";
import {
  Trash2,
  Loader2,
  Gamepad2,
  SlidersHorizontal,
  Globe,
  Github,
  FlaskConical,
  RefreshCw,
  HardDrive,
  Coffee,
  Monitor,
  Terminal,
  Clock,
  Palette,
  Plug,
  Download,
  ScrollText,
  ArrowUpCircle,
  FolderOpen,
  Check,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { ACCENT_COLORS, DEFAULT_ACCENT } from "@/lib/colors";
import type { JavaReport, JavaInstall, LauncherSettings, UpdateInfo } from "@/lib/types";
import {
  Card,
  Field,
  Select,
  MemorySettings,
  Toggle,
  Row,
  ActionButton,
  LinkButton,
  SegmentedTabs,
  inputCls,
} from "@/components/ui";

type Tab = "defaults" | "java" | "launcher";

const TABS: { id: Tab; label: string; icon: typeof Gamepad2 }[] = [
  { id: "defaults", label: "Defaults", icon: Gamepad2 },
  { id: "java", label: "Java", icon: Coffee },
  { id: "launcher", label: "Launcher", icon: SlidersHorizontal },
];

export function SettingsView({
  settings,
  javaInstanceId,
  appVersion,
  onSaveSettings,
  onError,
  onShowChangelog,
  onUpdateInstalled,
}: {
  settings: LauncherSettings | null;
  javaInstanceId: string | null;
  appVersion: string | null;
  onSaveSettings: (s: LauncherSettings) => void;
  onError: (e: string) => void;
  onShowChangelog: () => void;
  onUpdateInstalled: (version: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("defaults");
  const [cfKeyDraft, setCfKeyDraft] = useState("");
  useEffect(
    () => setCfKeyDraft(settings?.curseforge_api_key ?? ""),
    [settings?.curseforge_api_key],
  );
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (tab === "launcher" && api.isTauri())
      api.cacheSize().then(setCacheBytes).catch(() => {});
  }, [tab]);

  if (!settings) {
    return (
      <div className="grid flex-1 place-items-center text-ink-600">
        Loading settings…
      </div>
    );
  }

  const patch = (p: Partial<LauncherSettings>) =>
    onSaveSettings({ ...settings, ...p });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <h1 className="pb-1 font-mc text-2xl tracking-wide text-gray-100">
        Settings
      </h1>
      <p className="pb-4 text-xs text-ink-600">
        These are launcher-wide defaults. Per-instance overrides live on each
        instance&apos;s gear (Instances → ⚙).
      </p>

      <SegmentedTabs
        className="mb-4 self-start"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={TABS.map(({ id, label, icon: Icon }) => ({
          id,
          label,
          icon: <Icon size={15} />,
        }))}
      />

      <div className="flex-1 overflow-y-auto pr-1">
        {tab === "defaults" && (
          <div className="reveal-down grid grid-cols-2 gap-4">
            <Card title="Default memory" icon={<SlidersHorizontal size={14} />}>
              <MemorySettings
                max={settings.default_max_memory_mb}
                min={settings.default_min_memory_mb}
                onChange={(mx, mn) =>
                  patch({
                    default_max_memory_mb: mx,
                    default_min_memory_mb: mn,
                  })
                }
                note={
                  <p className="text-xs text-ink-600">
                    New instances inherit these. Override memory per instance on
                    its gear.
                  </p>
                }
              />
            </Card>

            <Card title="When the game starts" icon={<Monitor size={14} />}>
              <Field label="Launcher window">
                <Select
                  value={settings.launch_behavior}
                  onChange={(v) => patch({ launch_behavior: v })}
                  options={[
                    { value: "keep", label: "Keep it open" },
                    { value: "hide", label: "Minimize it" },
                    { value: "quit", label: "Quit the launcher" },
                  ]}
                />
              </Field>
              <Toggle
                label="Open the console on launch"
                checked={settings.console_on_launch}
                onChange={(v) => patch({ console_on_launch: v })}
              />
              <Toggle
                label="Open the console on crash"
                checked={settings.console_on_crash}
                onChange={(v) => patch({ console_on_crash: v })}
              />
              <Toggle
                label="Open the console on quit"
                checked={settings.console_on_quit}
                onChange={(v) => patch({ console_on_quit: v })}
              />
            </Card>

            <Card title="Default game window" icon={<Monitor size={14} />}>
              <Field label="Window size" hint="The size Minecraft opens at by default.">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={640}
                    defaultValue={settings.default_resolution?.[0] ?? ""}
                    onBlur={(e) => {
                      const w = Number(e.target.value) || 0;
                      const h = settings.default_resolution?.[1] ?? 0;
                      patch({
                        default_resolution: w && h ? [w, h] : w ? [w, 720] : null,
                      });
                    }}
                    placeholder="1280"
                    className={`${inputCls} w-24`}
                  />
                  <span className="text-ink-600">×</span>
                  <input
                    type="number"
                    min={480}
                    defaultValue={settings.default_resolution?.[1] ?? ""}
                    onBlur={(e) => {
                      const h = Number(e.target.value) || 0;
                      const w = settings.default_resolution?.[0] ?? 0;
                      patch({
                        default_resolution: w && h ? [w, h] : h ? [1280, h] : null,
                      });
                    }}
                    placeholder="720"
                    className={`${inputCls} w-24`}
                  />
                </div>
              </Field>
              <Toggle
                label="Start minimized"
                checked={settings.start_minimized}
                onChange={(v) => patch({ start_minimized: v })}
              />
            </Card>

            <Card title="Commands" icon={<Terminal size={14} />}>
              <Field label="Pre-launch command" hint="Runs in a shell before the game starts.">
                <input
                  defaultValue={settings.pre_launch_command ?? ""}
                  onBlur={(e) =>
                    patch({ pre_launch_command: e.target.value.trim() || null })
                  }
                  placeholder="e.g. /usr/bin/mangohud --version"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Field label="Post-exit command" hint="Runs in a shell after the game closes.">
                <input
                  defaultValue={settings.post_exit_command ?? ""}
                  onBlur={(e) =>
                    patch({ post_exit_command: e.target.value.trim() || null })
                  }
                  placeholder="e.g. notify-send 'Minecraft closed'"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>
          </div>
        )}

        {tab === "java" && (
          <div className="reveal-down">
            <JavaTab
              instanceId={javaInstanceId}
              settings={settings}
              patchSettings={patch}
            />
          </div>
        )}

        {tab === "launcher" && (
          <div className="reveal-down grid grid-cols-2 gap-4">
            <UpdatesCard
              appVersion={appVersion}
              autoUpdate={settings.auto_update}
              onToggleAuto={(v) => patch({ auto_update: v })}
              onShowChangelog={onShowChangelog}
              onUpdateInstalled={onUpdateInstalled}
              onError={onError}
            />

            <Card title="Appearance" icon={<Palette size={14} />}>
              <Field
                label="Theme"
                hint="“Match system” follows your OS light/dark setting. “Grey” is a softer dark theme."
              >
                <Select
                  value={
                    ["brass-light", "brass-dark", "brass-grey"].includes(
                      settings.theme,
                    )
                      ? settings.theme
                      : "system"
                  }
                  onChange={(v) => patch({ theme: v })}
                  options={[
                    { value: "system", label: "Match system" },
                    { value: "brass-light", label: "Light" },
                    { value: "brass-dark", label: "Dark" },
                    { value: "brass-grey", label: "Grey (soft dark)" },
                  ]}
                />
              </Field>
              <Field
                label="Accent colour"
                hint="Recolours buttons, sliders and highlights across the app and every theme."
              >
                <AccentPicker
                  value={settings.accent_color}
                  onChange={(c) => patch({ accent_color: c })}
                />
              </Field>
              <Toggle
                label="Reduce motion"
                description="Tone down animations and transitions."
                checked={settings.reduce_motion}
                onChange={(v) => patch({ reduce_motion: v })}
              />
              <Toggle
                label="Close to tray"
                description="Keep running in the system tray when you close the window."
                checked={settings.close_to_tray}
                onChange={(v) => patch({ close_to_tray: v })}
              />
            </Card>

            <Card title="Playtime" icon={<Clock size={14} />}>
              <Toggle
                label="Record playtime"
                checked={settings.record_playtime}
                onChange={(v) => patch({ record_playtime: v })}
              />
              <Toggle
                label="Show playtime"
                checked={settings.show_playtime}
                onChange={(v) => patch({ show_playtime: v })}
              />
              <Toggle
                label="Always show hours"
                checked={settings.playtime_in_hours}
                onChange={(v) => patch({ playtime_in_hours: v })}
              />
            </Card>

            <Card title="Integrations" icon={<Plug size={14} />}>
              <Toggle
                label="Discord Rich Presence"
                description="Show what you're doing in your Discord status."
                checked={settings.discord_rpc}
                onChange={(v) => patch({ discord_rpc: v })}
              />
            </Card>

            <Card title="CurseForge" icon={<FlaskConical size={14} />}>
              <Field
                label="CurseForge API key"
                hint="Browsing works out of the box. Set your own key only if you'd rather not use the bundled one."
              >
                <input
                  value={cfKeyDraft}
                  onChange={(e) => setCfKeyDraft(e.target.value)}
                  onBlur={() =>
                    patch({ curseforge_api_key: cfKeyDraft.trim() || null })
                  }
                  type="password"
                  placeholder="$2a$10$…"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
              <button
                onClick={() =>
                  api.openExternal("https://console.curseforge.com/").catch(() => {})
                }
                className="text-left text-xs text-brass-300 hover:text-brass-400"
              >
                Get a CurseForge API key →
              </button>
            </Card>

            <Card title="Cache" icon={<HardDrive size={14} />}>
              <Row
                label="Cached metadata"
                value={cacheBytes === null ? "…" : api.formatBytes(cacheBytes)}
              />
              <p className="text-xs text-ink-600">
                Modrinth &amp; CurseForge data the launcher re-downloads as
                needed. Safe to clear.
              </p>
              <ActionButton
                icon={
                  clearing ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Trash2 size={15} />
                  )
                }
                disabled={clearing || cacheBytes === 0}
                onClickAsync={async () => {
                  setClearing(true);
                  try {
                    setCacheBytes(await api.clearCache());
                  } catch (e) {
                    onError(String(e));
                  } finally {
                    setClearing(false);
                  }
                }}
              >
                Clear cache
              </ActionButton>
            </Card>

            <Card title="About">
              <div className="text-sm text-ink-600">
                Brassworks Launcher
                {appVersion && (
                  <div className="mt-1 text-xs">v{appVersion}</div>
                )}
              </div>
              <div className="flex gap-2">
                <LinkButton
                  icon={<Globe size={15} />}
                  onClick={() =>
                    api.openExternal(api.BRASSWORKS_WEBSITE).catch(() => {})
                  }
                >
                  Website
                </LinkButton>
                <LinkButton
                  icon={<Github size={15} />}
                  onClick={() =>
                    api.openExternal(api.BRASSWORKS_GITHUB).catch(() => {})
                  }
                >
                  GitHub
                </LinkButton>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function UpdatesCard({
  appVersion,
  autoUpdate,
  onToggleAuto,
  onShowChangelog,
  onUpdateInstalled,
  onError,
}: {
  appVersion: string | null;
  autoUpdate: boolean;
  onToggleAuto: (v: boolean) => void;
  onShowChangelog: () => void;
  onUpdateInstalled: (version: string) => void;
  onError: (e: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    try {
      const result = await api.checkForUpdate();
      setInfo(result);
      setCheckedAt(Date.now());
      if (result.available) setBlockReason(await api.updateBlockReason().catch(() => null));
      else toast("You're on the latest version", "success");
    } catch (e) {
      onError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    if (!info?.available) return;
    setDownloading(true);
    setPct(0);
    let total = 0;
    let downloaded = 0;
    const un = await api.onUpdaterProgress((p) => {
      if (p.done) {
        setPct(100);
        return;
      }
      downloaded = p.downloaded;
      if (p.total) total = p.total;
      if (total > 0) setPct(Math.min(100, Math.round((downloaded / total) * 100)));
    });
    try {
      toast(`Downloading update v${info.version}…`, "info");
      await api.installUpdate();
      toast(`Update v${info.version} installed`, "success");
      onUpdateInstalled(info.version);
      setInfo(null);
    } catch (e) {
      onError(String(e));
    } finally {
      un();
      setDownloading(false);
      setPct(null);
    }
  };

  return (
    <Card title="Updates" icon={<ArrowUpCircle size={14} />}>
      <Row label="Current version" value={appVersion ? `v${appVersion}` : "-"} />
      <Toggle
        label="Automatic updates"
        description="Check for and install launcher updates on startup."
        checked={autoUpdate}
        onChange={onToggleAuto}
      />

      {info?.available && !downloading && (
        <div className="rounded-lg border border-brass-500/40 bg-brass-500/10 px-3 py-2 text-xs text-brass-200">
          Version {info.version} is available.
        </div>
      )}

      {info?.available && blockReason && !downloading && (
        <div className="dup-warn rounded-lg border px-3 py-2 text-xs leading-relaxed">
          {blockReason}
        </div>
      )}

      {downloading && (
        <div className="rounded-lg border border-edge bg-ink-900/50 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-brass-300">
              <Loader2 size={13} className="animate-spin" /> Downloading update
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

      {info?.available && !downloading ? (
        <ActionButton
          icon={<Download size={15} />}
          onClickAsync={download}
          disabled={!!blockReason}
        >
          Download &amp; install v{info.version}
        </ActionButton>
      ) : (
        <ActionButton
          icon={
            checking ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )
          }
          disabled={checking || downloading}
          onClickAsync={check}
        >
          Check for updates
          {!checking && checkedAt !== null && !info?.available && (
            <span className="ml-auto text-[11px] text-patina-400">Up to date</span>
          )}
        </ActionButton>
      )}

      <ActionButton icon={<ScrollText size={15} />} onClick={onShowChangelog}>
        Changelog
        <span className="ml-auto text-[11px] text-ink-600">what&apos;s new</span>
      </ActionButton>
    </Card>
  );
}

function AccentPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (c: string | null) => void;
}) {
  const swatches: { color: string; key: string; isDefault?: boolean }[] = [
    { color: DEFAULT_ACCENT, key: "default", isDefault: true },
    ...ACCENT_COLORS.map((c) => ({ color: c, key: c })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {swatches.map((s) => {
        const active = s.isDefault ? value === null : value === s.color;
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.isDefault ? null : s.color)}
            title={s.isDefault ? "Default (green)" : s.color}
            style={{ background: s.color }}
            className={`grid h-6 w-6 place-items-center rounded-md transition hover:scale-110 ${
              active
                ? "ring-2 ring-white/80 ring-offset-1 ring-offset-ink-850"
                : ""
            }`}
          >
            {active && <Check size={12} className="text-ink-950" />}
          </button>
        );
      })}
    </div>
  );
}

const javaReportCache = new Map<string, JavaReport>();
let javaRuntimesCache: JavaInstall[] | null = null;

function JavaTab({
  instanceId,
  settings,
  patchSettings,
}: {
  instanceId: string | null;
  settings: LauncherSettings;
  patchSettings: (p: Partial<LauncherSettings>) => void;
}) {
  const [report, setReport] = useState<JavaReport | null>(() =>
    instanceId ? javaReportCache.get(instanceId) ?? null : null,
  );
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState(settings.java_path ?? "");
  const [runtimes, setRuntimes] = useState<JavaInstall[]>(
    () => javaRuntimesCache ?? [],
  );
  const [downloading, setDownloading] = useState<number | null>(null);

  const reloadRuntimes = () => {
    if (api.isTauri())
      api
        .listJavaRuntimes()
        .then((r) => {
          javaRuntimesCache = r;
          setRuntimes(r);
        })
        .catch(() => {});
  };

  const load = () => {
    if (!api.isTauri()) return;
    reloadRuntimes();
    if (!instanceId) return;
    if (!javaReportCache.has(instanceId)) setLoading(true);
    api
      .javaInfo(instanceId)
      .then((r) => {
        javaReportCache.set(instanceId, r);
        setReport(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(load);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const download = (major: number) => {
    setDownloading(major);
    api
      .downloadJava(major)
      .then(() => {
        toast(`Java ${major} downloaded`, "success");
        reloadRuntimes();
      })
      .catch((e) => toast(String(e), "error"))
      .finally(() => setDownloading(null));
  };

  const MAJORS = [8, 17, 21, 25];

  const current =
    settings.java_policy === "system"
      ? "system"
      : settings.java_policy === "custom" && settings.java_path
        ? `path:${settings.java_path}`
        : settings.java_policy === "custom"
          ? "custom"
          : "auto";

  const pick = (choice: string) => {
    if (choice === "auto") patchSettings({ java_policy: "auto" });
    else if (choice === "system") patchSettings({ java_policy: "system" });
    else if (choice === "custom")
      patchSettings({ java_policy: "custom", java_path: customDraft || null });
    else if (choice.startsWith("path:"))
      patchSettings({ java_policy: "custom", java_path: choice.slice(5) });
  };

  const options = [
    { value: "auto", label: "Automatic - download the right Java (recommended)" },
    ...(report?.system
      ? [
          {
            value: "system",
            label: `System Java${report.system.major ? " " + report.system.major : ""}`,
          },
        ]
      : []),
    ...(report?.runtimes ?? []).map((r) => ({
      value: `path:${r.path}`,
      label: r.label,
    })),
    { value: "custom", label: "Custom path…" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="Default Java policy" icon={<Coffee size={14} />}>
        <Field
          label="Which Java to use"
          hint="Automatic downloads and caches the exact version each instance needs. Override this per instance on its gear."
        >
          <Select value={current} onChange={pick} options={options} />
        </Field>
        {current === "custom" && (
          <Field label="Java executable path">
            <input
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() =>
                patchSettings({
                  java_policy: "custom",
                  java_path: customDraft.trim() || null,
                })
              }
              placeholder="/path/to/bin/java"
              className={`${inputCls} font-mono text-xs`}
              spellCheck={false}
            />
          </Field>
        )}
        <button
          onClick={load}
          className="flex items-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Rescan
        </button>
      </Card>

      <Card title="Runtimes" icon={<Coffee size={14} />}>
        <Row
          label="System Java"
          value={
            report?.system
              ? report.system.version ?? `Java ${report.system.major ?? "?"}`
              : "Not found"
          }
        />
        <div>
          <div className="mb-1.5 text-sm text-ink-600">Downloaded runtimes</div>
          {runtimes.length > 0 ? (
            <div className="flex flex-col gap-1">
              {runtimes.map((r) => (
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
                          reloadRuntimes();
                        })
                        .catch((e) => toast(String(e), "error"))
                    }
                    title="Uninstall"
                    className="text-ink-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-600">
              None yet - the right runtime downloads automatically on first
              launch.
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-sm text-ink-600">Download a version</div>
          <div className="flex flex-wrap gap-1.5">
            {MAJORS.map((m) => {
              const have = runtimes.some((r) => r.major === m);
              return (
                <button
                  key={m}
                  disabled={downloading !== null || have}
                  onClick={() => download(m)}
                  className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {downloading === m ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} />
                  )}
                  Java {m}
                  {have ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-ink-600">
            Temurin (Adoptium) JREs. The correct version also downloads
            automatically per instance.
          </p>
        </div>
      </Card>
    </div>
  );
}
