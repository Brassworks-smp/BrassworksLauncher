import { useEffect, useState } from "react";
import {
  Trash2,
  Loader2,
  Gamepad2,
  SlidersHorizontal,
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
  Server,
  RotateCcw,
  Compass,
  Languages,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useT, LOCALES } from "@/lib/i18n";
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
  SegmentedTabs,
  inputCls,
  CardColumns,
  NumberField,
  Skeleton,
} from "@/components/ui";

type Tab = "defaults" | "java" | "launcher";

const TABS: { id: Tab; tkey: string; icon: typeof Gamepad2 }[] = [
  { id: "defaults", tkey: "settings.tab.defaults", icon: Gamepad2 },
  { id: "java", tkey: "settings.tab.java", icon: Coffee },
  { id: "launcher", tkey: "settings.tab.launcher", icon: SlidersHorizontal },
];

export function SettingsView({
  settings,
  javaInstanceId,
  appVersion,
  onSaveSettings,
  onError,
  onShowChangelog,
  onUpdateInstalled,
  onReplayOnboarding,
}: {
  settings: LauncherSettings | null;
  javaInstanceId: string | null;
  appVersion: string | null;
  onSaveSettings: (s: LauncherSettings) => void;
  onError: (e: string) => void;
  onShowChangelog: () => void;
  onUpdateInstalled: (version: string) => void;
  onReplayOnboarding?: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("defaults");
  const [cfKeyDraft, setCfKeyDraft] = useState("");
  useEffect(
    () => setCfKeyDraft(settings?.curseforge_api_key ?? ""),
    [settings?.curseforge_api_key],
  );
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  
  
  const [defaults, setDefaults] = useState<LauncherSettings | null>(null);
  
  
  const [resetNonce, setResetNonce] = useState(0);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  useEffect(() => {
    if (api.isTauri()) api.defaultSettings().then(setDefaults).catch(() => {});
  }, []);
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

  
  const resetCard = (keys: (keyof LauncherSettings)[]) => {
    if (!defaults) return;
    const p: Partial<LauncherSettings> = {};
    for (const k of keys) (p as Record<string, unknown>)[k] = defaults[k];
    patch(p);
    setResetNonce((n) => n + 1);
  };
  
  const cardReset = (keys: (keyof LauncherSettings)[]) =>
    defaults ? () => resetCard(keys) : undefined;

  
  
  
  const resetAll = () => {
    if (!defaults) return;
    onSaveSettings({
      ...defaults,
      selected_instance: settings.selected_instance,
      instance_folders: settings.instance_folders,
      last_version: settings.last_version,
    });
    setCfKeyDraft("");
    setResetNonce((n) => n + 1);
    setConfirmResetAll(false);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <h1 className="pb-1 font-mc text-2xl tracking-wide text-gray-100">
        {t("settings.title")}
      </h1>
      <p className="pb-4 text-xs text-ink-600">
        {t("settings.subtitle")}
      </p>

      <SegmentedTabs
        className="mb-4 self-start"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={TABS.map(({ id, tkey, icon: Icon }) => ({
          id,
          label: t(tkey),
          icon: <Icon size={15} />,
        }))}
      />

      <div className="flex-1 overflow-y-auto pr-1">
        {tab === "defaults" && (
          <CardColumns className="reveal-down">
            <Card
              title={t("settings.memory.title")}
              icon={<SlidersHorizontal size={14} />}
              onReset={cardReset([
                "default_max_memory_mb",
                "default_min_memory_mb",
              ])}
            >
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
                    {t("settings.memory.note")}
                  </p>
                }
              />
            </Card>

            <Card
              title={t("settings.start.title")}
              icon={<Monitor size={14} />}
              onReset={cardReset([
                "launch_behavior",
                "console_on_launch",
                "console_on_crash",
                "console_on_quit",
              ])}
            >
              <Field label={t("settings.start.window")}>
                <Select
                  value={settings.launch_behavior}
                  onChange={(v) => patch({ launch_behavior: v })}
                  options={[
                    { value: "keep", label: t("settings.start.keep") },
                    { value: "hide", label: t("settings.start.hide") },
                    { value: "quit", label: t("settings.start.quit") },
                  ]}
                />
              </Field>
              <Toggle
                label={t("settings.start.consoleLaunch")}
                checked={settings.console_on_launch}
                onChange={(v) => patch({ console_on_launch: v })}
              />
              <Toggle
                label={t("settings.start.consoleCrash")}
                checked={settings.console_on_crash}
                onChange={(v) => patch({ console_on_crash: v })}
              />
              <Toggle
                label={t("settings.start.consoleQuit")}
                checked={settings.console_on_quit}
                onChange={(v) => patch({ console_on_quit: v })}
              />
            </Card>

            <Card
              title={t("settings.window.title")}
              icon={<Monitor size={14} />}
              onReset={cardReset(["default_resolution", "start_minimized"])}
            >
              <Field label={t("settings.window.size")} hint={t("settings.window.sizeHint")}>
                <div className="flex items-center gap-2">
                  <NumberField
                    min={640}
                    value={settings.default_resolution?.[0] ?? null}
                    onChange={(w) => {
                      const h = settings.default_resolution?.[1] ?? 0;
                      patch({
                        default_resolution: w && h ? [w, h] : w ? [w, 720] : null,
                      });
                    }}
                    placeholder="1280"
                    className="w-24"
                  />
                  <span className="text-ink-600">×</span>
                  <NumberField
                    min={480}
                    value={settings.default_resolution?.[1] ?? null}
                    onChange={(h) => {
                      const w = settings.default_resolution?.[0] ?? 0;
                      patch({
                        default_resolution: w && h ? [w, h] : h ? [1280, h] : null,
                      });
                    }}
                    placeholder="720"
                    className="w-24"
                  />
                </div>
              </Field>
              <Toggle
                label={t("settings.window.startMin")}
                checked={settings.start_minimized}
                onChange={(v) => patch({ start_minimized: v })}
              />
            </Card>

            <Card
              title={t("settings.commands.title")}
              icon={<Terminal size={14} />}
              onReset={cardReset(["pre_launch_command", "post_exit_command"])}
            >
              <Field label={t("settings.commands.pre")} hint={t("settings.commands.preHint")}>
                <input
                  key={`pre-${resetNonce}`}
                  defaultValue={settings.pre_launch_command ?? ""}
                  onBlur={(e) =>
                    patch({ pre_launch_command: e.target.value.trim() || null })
                  }
                  placeholder={t("settings.commands.prePlaceholder")}
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
              <Field label={t("settings.commands.post")} hint={t("settings.commands.postHint")}>
                <input
                  key={`post-${resetNonce}`}
                  defaultValue={settings.post_exit_command ?? ""}
                  onBlur={(e) =>
                    patch({ post_exit_command: e.target.value.trim() || null })
                  }
                  placeholder={t("settings.commands.postPlaceholder")}
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </Field>
            </Card>
          </CardColumns>
        )}

        {tab === "java" && (
          <div className="reveal-down">
            <JavaTab
              instanceId={javaInstanceId}
              settings={settings}
              patchSettings={patch}
              onResetPolicy={cardReset(["java_policy", "java_path"])}
              defaultJavaPath={defaults?.java_path ?? ""}
            />
          </div>
        )}

        {tab === "launcher" && (
          <div className="reveal-down">
          <CardColumns>
            <UpdatesCard
              appVersion={appVersion}
              autoUpdate={settings.auto_update}
              onToggleAuto={(v) => patch({ auto_update: v })}
              onShowChangelog={onShowChangelog}
              onUpdateInstalled={onUpdateInstalled}
              onError={onError}
            />

            <Card
              title={t("settings.appearance.title")}
              icon={<Palette size={14} />}
              onReset={cardReset([
                "theme",
                "accent_color",
                "reduce_motion",
                "high_contrast",
                "close_to_tray",
              ])}
            >
              <Field
                label={t("settings.appearance.theme")}
                hint={t("settings.appearance.themeHint")}
              >
                <Select
                  value={
                    [
                      "brass-light",
                      "brass-dark",
                      "brass-grey",
                      "brass-ocean",
                      "brass-mocha",
                    ].includes(settings.theme)
                      ? settings.theme
                      : "system"
                  }
                  onChange={(v) => patch({ theme: v })}
                  options={[
                    { value: "system", label: t("theme.matchSystem") },
                    { value: "brass-grey", label: t("theme.grey") },
                    { value: "brass-dark", label: t("theme.oled") },
                    { value: "brass-ocean", label: t("theme.ocean") },
                    { value: "brass-mocha", label: t("theme.mocha") },
                    { value: "brass-light", label: t("theme.light") },
                  ]}
                />
              </Field>
              <Field
                label={t("settings.appearance.accent")}
                hint={t("settings.appearance.accentHint")}
              >
                <AccentPicker
                  value={settings.accent_color}
                  onChange={(c) => patch({ accent_color: c })}
                />
              </Field>
              <Toggle
                label={t("settings.appearance.reduceMotion")}
                description={t("settings.appearance.reduceMotionDesc")}
                checked={settings.reduce_motion}
                onChange={(v) => patch({ reduce_motion: v })}
              />
              <Toggle
                label={t("settings.appearance.highContrast")}
                description={t("settings.appearance.highContrastDesc")}
                checked={settings.high_contrast}
                onChange={(v) => patch({ high_contrast: v })}
              />
              <Toggle
                label={t("settings.appearance.closeTray")}
                description={t("settings.appearance.closeTrayDesc")}
                checked={settings.close_to_tray}
                onChange={(v) => patch({ close_to_tray: v })}
              />
            </Card>

            <Card
              title={t("settings.language.title")}
              icon={<Languages size={14} />}
              onReset={cardReset(["locale", "pseudo_localize"])}
            >
              <Field label={t("settings.language.field")} hint={t("settings.language.hint")}>
                <Select
                  value={settings.locale}
                  onChange={(v) => patch({ locale: v })}
                  options={LOCALES.map((l) => ({
                    value: l.id,
                    label: l.complete
                      ? l.label
                      : `${l.label} (${t("settings.language.notComplete")})`,
                  }))}
                />
              </Field>
              <Toggle
                label={t("settings.language.pseudo")}
                description={t("settings.language.pseudoDesc")}
                checked={settings.pseudo_localize}
                onChange={(v) => patch({ pseudo_localize: v })}
              />
            </Card>

            <Card
              title={t("settings.playtime.title")}
              icon={<Clock size={14} />}
              onReset={cardReset([
                "record_playtime",
                "show_playtime",
                "playtime_in_hours",
              ])}
            >
              <Toggle
                label={t("settings.playtime.record")}
                checked={settings.record_playtime}
                onChange={(v) => patch({ record_playtime: v })}
              />
              <Toggle
                label={t("settings.playtime.show")}
                checked={settings.show_playtime}
                onChange={(v) => patch({ show_playtime: v })}
              />
              <Toggle
                label={t("settings.playtime.hours")}
                checked={settings.playtime_in_hours}
                onChange={(v) => patch({ playtime_in_hours: v })}
              />
            </Card>

            <Card
              title={t("settings.integrations.title")}
              icon={<Plug size={14} />}
              onReset={cardReset(["discord_rpc"])}
            >
              <Toggle
                label={t("settings.integrations.rpc")}
                description={t("settings.integrations.rpcDesc")}
                checked={settings.discord_rpc}
                onChange={(v) => patch({ discord_rpc: v })}
              />
            </Card>

            <Card
              title={t("settings.featured.title")}
              icon={<Server size={14} />}
              onReset={cardReset(["show_featured"])}
            >
              <Toggle
                label={t("settings.featured.toggle")}
                description={t("settings.featured.toggleDesc")}
                checked={settings.show_featured}
                onChange={(v) => patch({ show_featured: v })}
              />
            </Card>

            <Card
              title={t("settings.curseforge.title")}
              icon={<FlaskConical size={14} />}
              onReset={
                defaults
                  ? () => {
                      patch({ curseforge_api_key: defaults.curseforge_api_key });
                      setCfKeyDraft(defaults.curseforge_api_key ?? "");
                    }
                  : undefined
              }
            >
              <Field
                label={t("settings.curseforge.key")}
                hint={t("settings.curseforge.keyHint")}
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
                {t("settings.curseforge.getKey")}
              </button>
            </Card>

            <Card
              title={t("settings.downloads.title")}
              icon={<Download size={14} />}
              onReset={cardReset(["download_concurrency"])}
            >
              <Field
                label={t("settings.downloads.parallel")}
                hint={t("settings.downloads.parallelHint")}
              >
                <Select
                  value={String(settings.download_concurrency)}
                  onChange={(v) =>
                    patch({ download_concurrency: Math.max(1, Number(v) || 16) })
                  }
                  options={[
                    { value: "1", label: t("settings.downloads.sequential") },
                    { value: "4", label: "4" },
                    { value: "8", label: "8" },
                    { value: "16", label: t("settings.downloads.def16") },
                    { value: "24", label: "24" },
                    { value: "32", label: "32" },
                  ]}
                />
              </Field>
            </Card>

            <Card title={t("settings.cache.title")} icon={<HardDrive size={14} />}>
              <Row
                label={t("settings.cache.cached")}
                value={cacheBytes === null ? "…" : api.formatBytes(cacheBytes)}
              />
              <p className="text-xs text-ink-600">
                {t("settings.cache.desc")}
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
                {t("settings.cache.clear")}
              </ActionButton>
            </Card>

          </CardColumns>

            {onReplayOnboarding && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge/60 bg-ink-950/30 px-5 py-4">
                <div>
                  <div className="text-sm font-medium text-gray-200">
                    {t("settings.replay.title")}
                  </div>
                  <p className="text-xs text-ink-600">
                    {t("settings.replay.desc")}
                  </p>
                </div>
                <button
                  onClick={onReplayOnboarding}
                  title={t("settings.replay.tooltip")}
                  className="flex items-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
                >
                  <Compass size={13} /> {t("settings.replay.button")}
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge/60 bg-ink-950/30 px-5 py-4">
              <div>
                <div className="text-sm font-medium text-gray-200">
                  {t("settings.resetAll.title")}
                </div>
                <p className="text-xs text-ink-600">
                  {t("settings.resetAll.desc")}
                </p>
              </div>
              {confirmResetAll ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={resetAll}
                    disabled={!defaults}
                    className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-500/20 disabled:opacity-40"
                  >
                    <RotateCcw size={13} /> {t("settings.resetAll.confirm")}
                  </button>
                  <button
                    onClick={() => setConfirmResetAll(false)}
                    className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmResetAll(true)}
                  disabled={!defaults}
                  title={t("settings.resetAll.tooltip")}
                  className="flex items-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-40"
                >
                  <RotateCcw size={13} /> {t("settings.resetAll.button")}
                </button>
              )}
            </div>
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
  const t = useT();
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
      else toast(t("settings.updates.latestToast"), "success");
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
      toast(t("settings.updates.downloadingToast", { version: info.version }), "info");
      await api.installUpdate();
      toast(t("settings.updates.installedToast", { version: info.version }), "success");
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
    <Card title={t("settings.updates.title")} icon={<ArrowUpCircle size={14} />}>
      <Row label={t("settings.updates.current")} value={appVersion ? `v${appVersion}` : "-"} />
      <Toggle
        label={t("settings.updates.auto")}
        description={t("settings.updates.autoDesc")}
        checked={autoUpdate}
        onChange={onToggleAuto}
      />

      {info?.available && !downloading && (
        <div className="rounded-lg border border-brass-500/40 bg-brass-500/10 px-3 py-2 text-xs text-brass-200">
          {t("settings.updates.available", { version: info.version })}
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
              <Loader2 size={13} className="animate-spin" /> {t("settings.updates.downloading")}
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
          {t("settings.updates.downloadInstall", { version: info.version })}
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
          {t("settings.updates.check")}
          {!checking && checkedAt !== null && !info?.available && (
            <span className="ml-auto text-[11px] text-patina-400">{t("settings.updates.upToDate")}</span>
          )}
        </ActionButton>
      )}

      <ActionButton icon={<ScrollText size={15} />} onClick={onShowChangelog}>
        {t("settings.updates.changelog")}
        <span className="ml-auto text-[11px] text-ink-600">{t("settings.updates.whatsNew")}</span>
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
  const t = useT();
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
            title={s.isDefault ? t("theme.accentDefault") : s.color}
            style={{
              backgroundImage: `linear-gradient(to bottom right, color-mix(in srgb, ${s.color} 88%, #fff), color-mix(in srgb, ${s.color} 78%, #000))`,
            }}
            className={`grid h-7 w-7 place-items-center rounded-md shadow-sm transition hover:scale-110 ${
              active ? "scale-110" : ""
            }`}
          >
            {active && (
              <Check
                size={14}
                strokeWidth={3.5}
                className="text-white [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.6))]"
              />
            )}
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
  onResetPolicy,
  defaultJavaPath,
}: {
  instanceId: string | null;
  settings: LauncherSettings;
  patchSettings: (p: Partial<LauncherSettings>) => void;
  onResetPolicy?: () => void;
  defaultJavaPath?: string;
}) {
  const t = useT();
  const [report, setReport] = useState<JavaReport | null>(() =>
    instanceId ? javaReportCache.get(instanceId) ?? null : null,
  );
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState(settings.java_path ?? "");
  const [runtimes, setRuntimes] = useState<JavaInstall[]>(
    () => javaRuntimesCache ?? [],
  );
  
  
  const [runtimesLoading, setRuntimesLoading] = useState(
    () => javaRuntimesCache === null,
  );
  const [downloading, setDownloading] = useState<number | null>(null);

  const reloadRuntimes = () => {
    if (!api.isTauri()) return;
    setRuntimesLoading(true);
    api
      .listJavaRuntimes()
      .then((r) => {
        javaRuntimesCache = r;
        setRuntimes(r);
      })
      .catch(() => {})
      .finally(() => setRuntimesLoading(false));
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
        toast(t("settings.java.downloadedToast", { major }), "success");
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
    { value: "auto", label: t("settings.java.auto") },
    ...(report?.system
      ? [
          {
            value: "system",
            label: `${t("settings.java.systemJava")}${report.system.major ? " " + report.system.major : ""}`,
          },
        ]
      : []),
    ...(report?.runtimes ?? []).map((r) => ({
      value: `path:${r.path}`,
      label: r.label,
    })),
    { value: "custom", label: t("settings.java.custom") },
  ];

  return (
    <CardColumns>
      <Card
        title={t("settings.java.policyTitle")}
        icon={<Coffee size={14} />}
        onReset={
          onResetPolicy
            ? () => {
                onResetPolicy();
                setCustomDraft(defaultJavaPath ?? "");
              }
            : undefined
        }
      >
        <Field
          label={t("settings.java.which")}
          hint={t("settings.java.whichHint")}
        >
          <Select value={current} onChange={pick} options={options} />
        </Field>
        {current === "custom" && (
          <Field label={t("settings.java.execPath")}>
            <input
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() =>
                patchSettings({
                  java_policy: "custom",
                  java_path: customDraft.trim() || null,
                })
              }
              placeholder={t("settings.java.pathPlaceholder")}
              className={`${inputCls} font-mono text-xs`}
              spellCheck={false}
            />
          </Field>
        )}
        <button
          onClick={load}
          className="flex items-center gap-2 self-start rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {t("settings.java.rescan")}
        </button>
      </Card>

      <Card title={t("settings.java.runtimesTitle")} icon={<Coffee size={14} />}>
        <Row
          label={t("settings.java.systemJava")}
          value={
            loading && !report ? (
              <Skeleton className="h-3.5 w-24" />
            ) : report?.system ? (
              report.system.version ?? t("settings.java.javaN", { n: report.system.major ?? "?" })
            ) : (
              t("settings.java.notFound")
            )
          }
        />
        <div>
          <div className="mb-1.5 text-sm text-ink-600">{t("settings.java.downloaded")}</div>
          {runtimesLoading && runtimes.length === 0 ? (
            <div className="flex flex-col gap-1">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-edge bg-ink-950/40 px-2.5 py-1.5"
                >
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3.5 flex-1" />
                </div>
              ))}
            </div>
          ) : runtimes.length > 0 ? (
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
                    title={t("settings.java.openFolder")}
                    className="text-ink-600 opacity-0 transition hover:text-brass-300 group-hover:opacity-100"
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    onClick={() =>
                      api
                        .deleteJavaRuntime(r.path)
                        .then(() => {
                          toast(t("settings.java.runtimeDeleted"), "info");
                          reloadRuntimes();
                        })
                        .catch((e) => toast(String(e), "error"))
                    }
                    title={t("settings.java.uninstall")}
                    className="text-ink-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-600">
              {t("settings.java.none")}
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-sm text-ink-600">{t("settings.java.downloadVersion")}</div>
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
                  {t("settings.java.javaN", { n: m })}
                  {have ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-ink-600">
            {t("settings.java.temurin")}
          </p>
        </div>
      </Card>
    </CardColumns>
  );
}
