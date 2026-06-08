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
} from "lucide-react";
import * as api from "@/lib/api";
import type {
  Instance,
  LaunchProgress,
  LauncherSettings,
  ModpackStatus,
} from "@/lib/types";

type Tab = "game" | "modpack" | "launcher";

const TABS: { id: Tab; label: string; icon: typeof Gamepad2 }[] = [
  { id: "game", label: "Game", icon: Gamepad2 },
  { id: "modpack", label: "Modpack", icon: Package },
  { id: "launcher", label: "Launcher", icon: SlidersHorizontal },
];

const PRIMARY_ID = "brassworks";
const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";


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
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 border-2 transition-colors ${
          checked
            ? "border-brass-700 bg-brass-500/80"
            : "border-ink-700 bg-ink-900"
        }`}
        style={{ borderRadius: 3 }}
      >
        <span
          className={`absolute top-[2px] h-[18px] w-[18px] border-2 transition-all ${
            checked
              ? "left-[22px] border-brass-300 bg-brass-400"
              : "left-[2px] border-ink-600 bg-ink-700"
          }`}
          style={{ borderRadius: 2 }}
        />
      </button>
    </label>
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
  maintaining,
  progress,
}: {
  settings: LauncherSettings | null;
  instance: Instance | null;
  modStatus: ModpackStatus | null;
  onSaveSettings: (s: LauncherSettings) => void;
  onSaveInstance: (i: Instance) => void;
  onError: (e: string) => void;
  maintaining: boolean;
  progress: LaunchProgress | null;
}) {
  const [tab, setTab] = useState<Tab>("game");
  const [packDraft, setPackDraft] = useState<string>("");
  useEffect(() => setPackDraft(settings?.pack_url ?? ""), [settings?.pack_url]);

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
                onChange={(v) => patchInstance({ max_memory_mb: v })}
              />
              <Slider
                label="Minimum memory (-Xms)"
                value={instMin}
                max={8192}
                onChange={(v) => patchInstance({ min_memory_mb: v })}
              />
              <p className="text-xs text-ink-600">
                4–8 GB is recommended for the Brassworks modpack. Changes save
                automatically.
              </p>
            </Card>

            <Card title="Java" icon={<Gamepad2 size={14} />}>
              <Field label="Java override (path)">
                <input
                  defaultValue={instance.java_path ?? ""}
                  onBlur={(e) =>
                    patchInstance({ java_path: e.target.value || null })
                  }
                  placeholder="Auto-detect / bundled"
                  className={inputCls}
                />
              </Field>
              <Field label="Extra JVM arguments">
                <textarea
                  rows={3}
                  defaultValue={instance.extra_jvm_args.join(" ")}
                  onBlur={(e) =>
                    patchInstance({
                      extra_jvm_args: e.target.value
                        .split(/\s+/)
                        .filter((x) => x.length > 0),
                    })
                  }
                  placeholder="-XX:+UseG1GC"
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
            </Card>
          </div>
        )}

        {tab === "modpack" && (
          <ModpackTab
            modStatus={modStatus}
            onError={onError}
            maintaining={maintaining}
            progress={progress}
          />
        )}

        {tab === "launcher" && (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Behaviour" icon={<SlidersHorizontal size={14} />}>
              <Toggle
                label="Keep launcher open"
                description="Stay open after the game starts."
                checked={settings.keep_open}
                onChange={(v) => patchSettings({ keep_open: v })}
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


function ModpackTab({
  modStatus,
  onError,
  maintaining,
  progress,
}: {
  modStatus: ModpackStatus | null;
  onError: (e: string) => void;
  maintaining: boolean;
  progress: LaunchProgress | null;
}) {
  const [loaderBusy, setLoaderBusy] = useState(false);
  const [confirmReinstall, setConfirmReinstall] = useState(false);
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
