"use client";

import { useEffect, useState } from "react";
import {
  Wrench,
  Trash2,
  Hammer,
  Loader2,
  Gamepad2,
  Package,
  SlidersHorizontal,
  FolderOpen,
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
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import type {
  Instance,
  JavaReport,
  LaunchProgress,
  LauncherSettings,
  ModpackStatus,
} from "@/lib/types";

type Tab = "game" | "java" | "modpack" | "launcher";

const TABS: { id: Tab; label: string; icon: typeof Gamepad2 }[] = [
  { id: "game", label: "Game", icon: Gamepad2 },
  { id: "java", label: "Java", icon: Coffee },
  { id: "modpack", label: "Modpack", icon: Package },
  { id: "launcher", label: "Launcher", icon: SlidersHorizontal },
];

const PRIMARY_ID = "brassworks";
const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

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
  {
    id: "lowmem",
    label: "Low memory — older machines",
    args: ["-XX:+UseSerialGC", "-XX:+UseStringDeduplication"],
  },
];

function presetIdForArgs(args: string[]): string {
  const norm = (a: string[]) => [...a].sort().join(" ");
  const target = norm(args);
  const match = JVM_PRESETS.find((p) => norm(p.args) === target);
  return match ? match.id : "custom";
}


function Slider({
  label,
  value,
  onChange,
  min = 1024,
  max = 16384,
  step = 512,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-600">{label}</span>
        <span className="rounded-md bg-brass-500/10 px-2 py-0.5 font-mc text-xs tabular-nums text-brass-300">
          {(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="brass-range"
      />
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span>
        <span className="block text-gray-200">{label}</span>
        {description && (
          <span className="block text-xs text-ink-600">{description}</span>
        )}
      </span>
      <BrassSwitch checked={checked} onChange={onChange} />
    </label>
  );
}

function BrassSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-[4px] border transition-colors ${
        checked ? "border-brass-600 bg-brass-500" : "border-edge bg-ink-700"
      }`}
    >
      <span
        className={`h-[16px] w-[16px] rounded-[2px] transition-transform duration-150 ${
          checked
            ? "translate-x-[25px] bg-white"
            : "translate-x-[3px] bg-ink-600"
        }`}
      />
    </span>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-sm text-ink-600">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-ink-600">{hint}</div>}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} cursor-pointer appearance-none`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-ink-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Card({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl panel p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-brass-400/80">
        {icon}
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}


export function SettingsView({
  settings,
  instance,
  modStatus,
  onSaveSettings,
  onSaveInstance,
  onError,
  onCheckUpdates,
  maintaining,
  progress,
}: {
  settings: LauncherSettings | null;
  instance: Instance | null;
  modStatus: ModpackStatus | null;
  onSaveSettings: (s: LauncherSettings) => void;
  onSaveInstance: (i: Instance) => void;
  onError: (e: string) => void;
  onCheckUpdates: () => Promise<void>;
  maintaining: boolean;
  progress: LaunchProgress | null;
}) {
  const [tab, setTab] = useState<Tab>("game");
  const [packDraft, setPackDraft] = useState<string>("");
  useEffect(() => setPackDraft(settings?.pack_url ?? ""), [settings?.pack_url]);
  const [cfKeyDraft, setCfKeyDraft] = useState<string>("");
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
  const [argsDraft, setArgsDraft] = useState<string>("");
  useEffect(
    () => setArgsDraft(instance?.extra_jvm_args.join(" ") ?? ""),
    [instance?.extra_jvm_args],
  );

  if (!settings || !instance) {
    return (
      <div className="grid flex-1 place-items-center text-ink-600">
        Loading settings…
      </div>
    );
  }

  const patchSettings = (p: Partial<LauncherSettings>) =>
    onSaveSettings({ ...settings, ...p });
  const patchInstance = (p: Partial<Instance>) =>
    onSaveInstance({ ...instance, ...p });

  const instMax = instance.max_memory_mb ?? settings.default_max_memory_mb;
  const instMin = instance.min_memory_mb ?? settings.default_min_memory_mb;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <h1 className="pb-4 font-mc text-2xl tracking-wide text-gray-100">
        Settings
      </h1>

      {}
      <div className="mb-4 flex gap-1 self-start rounded-lg border border-edge bg-ink-900/50 p-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-brass-500/15 text-brass-300"
                  : "text-ink-600 hover:text-brass-300/80"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {tab === "game" && (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Memory" icon={<SlidersHorizontal size={14} />}>
              <Slider
                label="Maximum memory (-Xmx)"
                value={instMax}
                onChange={(v) =>
                  patchInstance({
                    max_memory_mb: v,
                    min_memory_mb: Math.min(instMin, v),
                  })
                }
              />
              <Slider
                label="Minimum memory (-Xms)"
                value={instMin}
                min={512}
                max={instMax}
                onChange={(v) =>
                  patchInstance({ min_memory_mb: Math.min(v, instMax) })
                }
              />
              <p className="text-xs text-ink-600">
                4–8 GB is recommended for the Brassworks modpack. Minimum can&apos;t
                exceed maximum. Changes save automatically.
              </p>
            </Card>

            <Card title="JVM arguments" icon={<Terminal size={14} />}>
              <Field
                label="Preset"
                hint="Pick a tuned set of flags, or choose Custom to edit them yourself."
              >
                <Select
                  value={presetIdForArgs(instance.extra_jvm_args)}
                  onChange={(id) => {
                    if (id === "custom") return;
                    const p = JVM_PRESETS.find((x) => x.id === id);
                    if (!p) return;
                    setArgsDraft(p.args.join(" "));
                    patchInstance({ extra_jvm_args: p.args });
                  }}
                  options={[
                    ...JVM_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                    { value: "custom", label: "Custom" },
                  ]}
                />
              </Field>
              <Field label="Arguments">
                <textarea
                  rows={4}
                  value={argsDraft}
                  onChange={(e) => setArgsDraft(e.target.value)}
                  onBlur={() =>
                    patchInstance({
                      extra_jvm_args: argsDraft
                        .split(/\s+/)
                        .filter((x) => x.length > 0),
                    })
                  }
                  placeholder="-XX:+UseG1GC"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>

            <Card title="When the game starts" icon={<Monitor size={14} />}>
              <Field
                label="Launcher window"
                hint="What the launcher does once Minecraft is running."
              >
                <Select
                  value={settings.launch_behavior}
                  onChange={(v) => patchSettings({ launch_behavior: v })}
                  options={[
                    { value: "keep", label: "Keep it open" },
                    { value: "hide", label: "Minimize it" },
                    { value: "quit", label: "Quit the launcher" },
                  ]}
                />
              </Field>
              <Toggle
                label="Open the console on launch"
                description="Show the live log window when the game starts."
                checked={settings.console_on_launch}
                onChange={(v) => patchSettings({ console_on_launch: v })}
              />
              <Toggle
                label="Open the console on crash"
                description="Pop up the last log if the game exits with an error."
                checked={settings.console_on_crash}
                onChange={(v) => patchSettings({ console_on_crash: v })}
              />
              <Toggle
                label="Open the console on quit"
                description="Show the log every time the game closes."
                checked={settings.console_on_quit}
                onChange={(v) => patchSettings({ console_on_quit: v })}
              />
            </Card>

            <Card title="Game window" icon={<Monitor size={14} />}>
              <Field
                label="Window size"
                hint="The size Minecraft opens at."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={640}
                    defaultValue={settings.default_resolution?.[0] ?? ""}
                    onBlur={(e) => {
                      const w = Number(e.target.value) || 0;
                      const h = settings.default_resolution?.[1] ?? 0;
                      patchSettings({
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
                      patchSettings({
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
                description="Ask Minecraft to open minimized (depends on OS support)."
                checked={settings.start_minimized}
                onChange={(v) => patchSettings({ start_minimized: v })}
              />
            </Card>

            <Card title="Commands" icon={<Terminal size={14} />}>
              <Field
                label="Pre-launch command"
                hint="Runs in a shell before the game starts."
              >
                <input
                  defaultValue={settings.pre_launch_command ?? ""}
                  onBlur={(e) =>
                    patchSettings({
                      pre_launch_command: e.target.value.trim() || null,
                    })
                  }
                  placeholder="e.g. /usr/bin/mangohud --version"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Post-exit command"
                hint="Runs in a shell after the game closes."
              >
                <input
                  defaultValue={settings.post_exit_command ?? ""}
                  onBlur={(e) =>
                    patchSettings({
                      post_exit_command: e.target.value.trim() || null,
                    })
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
          <JavaTab
            instanceId={instance.id}
            settings={settings}
            patchSettings={patchSettings}
          />
        )}

        {tab === "modpack" && (
          <ModpackTab
            modStatus={modStatus}
            onError={onError}
            onCheckUpdates={onCheckUpdates}
            maintaining={maintaining}
            progress={progress}
          />
        )}

        {tab === "launcher" && (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Appearance" icon={<Palette size={14} />}>
              <Field
                label="Theme"
                hint="“Match system” follows your OS light/dark setting automatically."
              >
                <Select
                  value={
                    settings.theme === "brass-light" ||
                    settings.theme === "brass-dark"
                      ? settings.theme
                      : "system"
                  }
                  onChange={(v) => patchSettings({ theme: v })}
                  options={[
                    { value: "system", label: "Match system" },
                    { value: "brass-light", label: "Light" },
                    { value: "brass-dark", label: "Dark" },
                  ]}
                />
              </Field>
              <Toggle
                label="Reduce motion"
                description="Tone down animations and transitions."
                checked={settings.reduce_motion}
                onChange={(v) => patchSettings({ reduce_motion: v })}
              />
            </Card>

            <Card title="Playtime" icon={<Clock size={14} />}>
              <Toggle
                label="Record playtime"
                description="Track how long you play each session."
                checked={settings.record_playtime}
                onChange={(v) => patchSettings({ record_playtime: v })}
              />
              <Toggle
                label="Show playtime"
                description="Display the playtime chip on the Play screen."
                checked={settings.show_playtime}
                onChange={(v) => patchSettings({ show_playtime: v })}
              />
              <Toggle
                label="Always show hours"
                description="Format playtime as decimal hours (e.g. 3.5h)."
                checked={settings.playtime_in_hours}
                onChange={(v) => patchSettings({ playtime_in_hours: v })}
              />
            </Card>

            <Card title="Integrations" icon={<Plug size={14} />}>
              <Toggle
                label="Discord Rich Presence"
                description="Show what you're doing in your Discord status."
                checked={settings.discord_rpc}
                onChange={(v) => patchSettings({ discord_rpc: v })}
              />
              <Toggle
                label="Developer mode"
                description="Pull the modpack from the repo's dev branch."
                checked={settings.dev_mode}
                onChange={(v) => patchSettings({ dev_mode: v })}
              />
            </Card>

            <Card title="Pack source" icon={<FlaskConical size={14} />}>
              <Field
                label="Custom pack.toml URL"
                hint="Overrides the default & dev branch. Leave empty for Brassworks."
              >
                <input
                  value={packDraft}
                  onChange={(e) => setPackDraft(e.target.value)}
                  onBlur={() =>
                    patchSettings({ pack_url: packDraft.trim() || null })
                  }
                  placeholder="https://example.com/pack.toml"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>

            <Card title="CurseForge" icon={<FlaskConical size={14} />}>
              <Field
                label="CurseForge API key"
                hint="CurseForge browsing works out of the box. Set your own key here only if you'd rather not use the bundled one."
              >
                <input
                  value={cfKeyDraft}
                  onChange={(e) => setCfKeyDraft(e.target.value)}
                  onBlur={() =>
                    patchSettings({
                      curseforge_api_key: cfKeyDraft.trim() || null,
                    })
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
                  api
                    .openExternal("https://console.curseforge.com/")
                    .catch(() => {})
                }
                className="text-left text-xs text-brass-300 hover:text-brass-400"
              >
                Get a CurseForge API key →
              </button>
            </Card>

            <Card title="Cache" icon={<HardDrive size={14} />}>
              <Row
                label="Cached metadata"
                value={
                  cacheBytes === null ? "…" : api.formatBytes(cacheBytes)
                }
              />
              <p className="text-xs text-ink-600">
                Modrinth &amp; CurseForge data the launcher re-downloads as
                needed. Safe to clear — your game files aren&apos;t touched.
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
                <div className="mt-1 text-xs">
                  NeoForge {modStatus?.neoforge_version ?? "—"} · Minecraft{" "}
                  {modStatus?.minecraft_version ?? "1.21.1"}
                </div>
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

function LinkButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-md border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
    >
      {icon}
      {children}
    </button>
  );
}


function JavaTab({
  instanceId,
  settings,
  patchSettings,
}: {
  instanceId: string;
  settings: LauncherSettings;
  patchSettings: (p: Partial<LauncherSettings>) => void;
}) {
  const [report, setReport] = useState<JavaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState(settings.java_path ?? "");

  const load = () => {
    if (!api.isTauri()) return;
    setLoading(true);
    api
      .javaInfo(instanceId)
      .then(setReport)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [instanceId]);

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
    { value: "auto", label: "Automatic — download the right Java (recommended)" },
    ...(report?.system
      ? [{ value: "system", label: `System Java${report.system.major ? " " + report.system.major : ""}` }]
      : []),
    ...(report?.runtimes ?? []).map((r) => ({
      value: `path:${r.path}`,
      label: r.label,
    })),
    { value: "custom", label: "Custom path…" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="Java runtime" icon={<Coffee size={14} />}>
        <Field
          label="Which Java to use"
          hint="Automatic downloads and caches the exact version this modpack needs — no system Java required."
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

      <Card title="Detected" icon={<Coffee size={14} />}>
        <Row
          label="This pack needs"
          value={report ? `Java ${report.required_major}` : "…"}
        />
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
          {report && report.runtimes.length > 0 ? (
            <div className="flex flex-col gap-1">
              {report.runtimes.map((r) => (
                <div
                  key={r.path}
                  className="flex items-center gap-2 rounded-md border border-edge bg-ink-950/40 px-2.5 py-1.5 text-xs"
                >
                  <Coffee size={12} className="text-brass-400" />
                  <span className="text-gray-200">{r.label}</span>
                  {r.major === report.required_major && (
                    <span className="ml-auto rounded bg-brass-500/15 px-1.5 text-[9px] text-brass-300">
                      matches pack
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-600">
              None yet — the right runtime downloads automatically the first time
              you launch.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function ModpackTab({
  modStatus,
  onError,
  onCheckUpdates,
  maintaining,
  progress,
}: {
  modStatus: ModpackStatus | null;
  onError: (e: string) => void;
  onCheckUpdates: () => Promise<void>;
  maintaining: boolean;
  progress: LaunchProgress | null;
}) {
  const [loaderBusy, setLoaderBusy] = useState(false);
  const [confirmReinstall, setConfirmReinstall] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const busy = maintaining || loaderBusy;

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;

  const run = (fn: () => Promise<void>) => {
    fn().catch((e) => onError(String(e)));
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="Status" icon={<Package size={14} />}>
        <Row label="Pack name" value={modStatus?.name ?? "—"} />
        <Row
          label="Installed version"
          value={modStatus?.installed_version ?? "Not installed"}
        />
        <Row label="Latest version" value={modStatus?.latest_version ?? "—"} />
        <Row label="NeoForge" value={modStatus?.neoforge_version ?? "—"} />
        {modStatus?.update_available && (
          <div className="rounded-lg border border-brass-500/40 bg-brass-500/10 px-3 py-2 text-xs text-brass-200">
            An update is available — press Play or Repair to install it.
          </div>
        )}
        <ActionButton
          icon={
            checking ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )
          }
          disabled={checking || busy}
          onClickAsync={async () => {
            setChecking(true);
            try {
              await onCheckUpdates();
              setCheckedAt(Date.now());
            } catch (e) {
              onError(String(e));
            } finally {
              setChecking(false);
            }
          }}
        >
          Check for updates
          {!checking && checkedAt !== null && !modStatus?.update_available && (
            <span className="ml-auto text-[11px] text-patina-400">
              Up to date
            </span>
          )}
        </ActionButton>
        <ActionButton
          icon={<FolderOpen size={15} />}
          onClick={() => api.openDir(PRIMARY_ID).catch((e) => onError(String(e)))}
        >
          Open game folder
        </ActionButton>
      </Card>

      <Card title="Repair & reinstall" icon={<Wrench size={14} />}>
        <p className="text-xs text-ink-600">
          Use these if the modpack is broken or won&apos;t launch.
        </p>

        {busy && (
          <div className="rounded-lg border border-edge bg-ink-900/50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-brass-300">
                <Loader2 size={13} className="animate-spin" />
                Working
                {progress?.message ? (
                  <span className="text-ink-600">· {progress.message}</span>
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
            <button
              onClick={() =>
                api.cancelOp(PRIMARY_ID).catch((e) => onError(String(e)))
              }
              className="mt-2 flex items-center gap-1.5 text-xs text-ink-600 transition hover:text-red-300"
            >
              <Trash2 size={12} /> Cancel
            </button>
          </div>
        )}

        <ActionButton
          icon={<Wrench size={15} />}
          disabled={busy}
          onClick={() => run(() => api.repairModpack(PRIMARY_ID))}
        >
          Repair modpack
          <span className="ml-auto text-[11px] text-ink-600">
            re-verify all files
          </span>
        </ActionButton>

        <ActionButton
          icon={<Hammer size={15} />}
          disabled={busy}
          onClickAsync={async () => {
            setLoaderBusy(true);
            try {
              await api.reinstallLoader(PRIMARY_ID);
            } catch (e) {
              onError(String(e));
            } finally {
              setLoaderBusy(false);
            }
          }}
        >
          Reinstall NeoForge
          <span className="ml-auto text-[11px] text-ink-600">on next launch</span>
        </ActionButton>

        {confirmReinstall ? (
          <div className="flex gap-2">
            <ActionButton
              danger
              icon={<Trash2 size={15} />}
              disabled={busy}
              onClick={() => {
                setConfirmReinstall(false);
                run(() => api.reinstallModpack(PRIMARY_ID));
              }}
            >
              Confirm wipe &amp; reinstall
            </ActionButton>
            <button
              onClick={() => setConfirmReinstall(false)}
              className="rounded-lg border border-edge px-3 text-sm text-ink-600 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <ActionButton
            danger
            icon={<Trash2 size={15} />}
            disabled={busy}
            onClick={() => setConfirmReinstall(true)}
          >
            Reinstall from scratch
            <span className="ml-auto text-[11px] text-red-300/70">
              deletes &amp; redownloads
            </span>
          </ActionButton>
        )}
      </Card>

      <Card title="Uninstall" icon={<Trash2 size={14} />}>
        <p className="text-xs text-ink-600">
          Removes the game files, NeoForge and the modpack from your computer.
          Your account and settings are kept — press Play any time to reinstall.
        </p>
        {confirmUninstall ? (
          <div className="flex gap-2">
            <ActionButton
              danger
              icon={
                uninstalling ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Trash2 size={15} />
                )
              }
              disabled={uninstalling}
              onClickAsync={async () => {
                setUninstalling(true);
                try {
                  await api.uninstallGame(PRIMARY_ID);
                  toast("Game, NeoForge and modpack removed", "info");
                  await onCheckUpdates();
                } catch (e) {
                  onError(String(e));
                } finally {
                  setUninstalling(false);
                  setConfirmUninstall(false);
                }
              }}
            >
              Yes, uninstall everything
            </ActionButton>
            <button
              onClick={() => setConfirmUninstall(false)}
              className="rounded-lg border border-edge px-3 text-sm text-ink-600 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <ActionButton
            danger
            icon={<Trash2 size={15} />}
            disabled={busy || uninstalling}
            onClick={() => setConfirmUninstall(true)}
          >
            Uninstall everything
            <span className="ml-auto text-[11px] text-red-300/70">
              game · NeoForge · modpack
            </span>
          </ActionButton>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-600">{label}</span>
      <span className="font-mc text-xs text-gray-200">{value}</span>
    </div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
  onClickAsync,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  onClickAsync?: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (onClickAsync) void onClickAsync();
        else onClick?.();
      }}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "border-red-500/30 text-red-300 hover:border-red-500/60 hover:bg-red-500/10"
          : "border-edge text-gray-200 hover:border-brass-600/40 hover:bg-brass-500/5 hover:text-brass-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
