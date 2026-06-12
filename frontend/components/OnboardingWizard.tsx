import { useMemo, useState } from "react";
import {
  Palette,
  DownloadCloud,
  Star,
  MemoryStick,
  Plug,
  Languages,
  LogIn,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
  Plus,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { Select, Toggle } from "@/components/ui";
import { ACCENT_COLORS, DEFAULT_ACCENT } from "@/lib/colors";
import { useT, LOCALES, type TFunc } from "@/lib/i18n";
import type { AccountStore, LauncherSettings } from "@/lib/types";

export const ONBOARDED_KEY = "bw-onboarded";


export function OnboardingWizard({
  settings,
  onPatch,
  accounts,
  onMicrosoftLogin,
  onAddOffline,
  onOpenImport,
  onFinish,
}: {
  settings: LauncherSettings;
  onPatch: (p: Partial<LauncherSettings>) => void;
  accounts: AccountStore;
  onMicrosoftLogin: () => void;
  onAddOffline: (username: string) => void;
  onOpenImport: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const t = useT();

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {}
    onFinish();
  };

  const steps = [
    { key: "welcome", node: <WelcomeStep /> },
    { key: "theme", node: <ThemeStep settings={settings} onPatch={onPatch} /> },
    { key: "import", node: <ImportStep onOpenImport={onOpenImport} /> },
    { key: "featured", node: <FeaturedStep settings={settings} onPatch={onPatch} /> },
    { key: "ram", node: <RamStep settings={settings} onPatch={onPatch} /> },
    { key: "rpc", node: <RpcStep settings={settings} onPatch={onPatch} /> },
    { key: "language", node: <LanguageStep settings={settings} onPatch={onPatch} /> },
    {
      key: "signin",
      node: (
        <SignInStep
          accounts={accounts}
          onMicrosoftLogin={onMicrosoftLogin}
          onAddOffline={onAddOffline}
        />
      ),
    },
    { key: "done", node: <DoneStep /> },
  ];

  const isFirst = step === 0;
  const isLast = step === steps.length - 1;
  const next = () => (isLast ? finish() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="modal-overlay fixed inset-0 z-40 flex items-center justify-center bg-ink-950 p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--color-brass-500) 14%, transparent), transparent 70%)",
        }}
      />
      <div className="rise relative flex h-full max-h-[680px] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-edge bg-ink-900/95 shadow-2xl">
        {}
        <div className="flex items-center gap-2.5 border-b border-edge px-6 py-4">
          <Logo size={26} />
          <span className="font-mc text-sm tracking-wide text-gray-100">
            Brassworks
          </span>
        </div>

        {}
        <div
          key={steps[step].key}
          className="view-anim flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-7"
        >
          {steps[step].node}
        </div>

        {}
        <div className="flex items-center justify-between gap-3 border-t border-edge px-6 py-4">
          <button
            onClick={back}
            disabled={isFirst}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-600 transition hover:text-gray-200 disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeft size={16} /> {t("common.back")}
          </button>

          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === step
                    ? "w-5 bg-brass-400"
                    : "w-1.5 bg-ink-700 hover:bg-ink-600"
                }`}
              />
            ))}
          </div>

          <button
            onClick={next}
            className="brass-btn flex items-center gap-1.5 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            {isLast ? (
              <>
                <Check size={16} /> {t("onboarding.finish")}
              </>
            ) : isFirst ? (
              <>
                {t("onboarding.getStarted")} <ChevronRight size={16} />
              </>
            ) : (
              <>
                {t("common.next")} <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


function StepShell({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-5 flex flex-col items-center text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-brass-700/30 bg-brass-500/10 text-brass-300">
          {icon}
        </span>
        <h2 className="font-mc text-lg tracking-wide text-gray-100">{title}</h2>
        <p className="mt-1.5 max-w-[400px] text-sm leading-relaxed text-ink-600">
          {subtitle}
        </p>
      </div>
      {children && <div className="mx-auto w-full max-w-[420px]">{children}</div>}
    </div>
  );
}

function WelcomeStep() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <Logo size={72} className="mb-6 drop-shadow-lg" />
      <h1 className="font-mc text-2xl tracking-wide text-gray-100">
        {t("onboarding.welcomeTitle")}
      </h1>
      <p className="mt-3 max-w-[420px] text-sm leading-relaxed text-ink-600">
        {t("onboarding.welcomeBody")}
      </p>
    </div>
  );
}

function ThemeStep({
  settings,
  onPatch,
}: {
  settings: LauncherSettings;
  onPatch: (p: Partial<LauncherSettings>) => void;
}) {
  const t = useT();
  const themeValue = [
    "brass-light",
    "brass-dark",
    "brass-grey",
    "brass-ocean",
    "brass-mocha",
  ].includes(settings.theme)
    ? settings.theme
    : "system";
  return (
    <StepShell
      icon={<Palette size={26} />}
      title={t("onboarding.themeTitle")}
      subtitle={t("onboarding.themeBody")}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1.5 text-sm text-ink-600">{t("onboarding.theme")}</div>
          <Select
            value={themeValue}
            onChange={(v) => onPatch({ theme: v })}
            options={[
              { value: "system", label: t("theme.matchSystem") },
              { value: "brass-grey", label: t("theme.grey") },
              { value: "brass-dark", label: t("theme.oled") },
              { value: "brass-ocean", label: t("theme.ocean") },
              { value: "brass-mocha", label: t("theme.mocha") },
              { value: "brass-light", label: t("theme.light") },
            ]}
          />
        </div>
        <div>
          <div className="mb-2 text-sm text-ink-600">{t("onboarding.accentColour")}</div>
          <div className="flex flex-wrap gap-1.5">
            {[{ color: DEFAULT_ACCENT, isDefault: true }, ...ACCENT_COLORS.map((c) => ({ color: c, isDefault: false }))].map(
              (s) => {
                const active = s.isDefault
                  ? settings.accent_color == null
                  : settings.accent_color === s.color;
                return (
                  <button
                    key={s.isDefault ? "default" : s.color}
                    onClick={() => onPatch({ accent_color: s.isDefault ? null : s.color })}
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
              },
            )}
          </div>
        </div>
        <Toggle
          label={t("onboarding.highContrast")}
          description={t("onboarding.highContrastDesc")}
          checked={settings.high_contrast}
          onChange={(v) => onPatch({ high_contrast: v })}
        />
      </div>
    </StepShell>
  );
}

function ImportStep({ onOpenImport }: { onOpenImport: () => void }) {
  const t = useT();
  return (
    <StepShell
      icon={<DownloadCloud size={26} />}
      title={t("onboarding.importTitle")}
      subtitle={t("onboarding.importBody")}
    >
      <button
        onClick={onOpenImport}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-ink-950/50 px-4 py-3 text-sm font-medium text-gray-100 transition hover:border-brass-600/40 hover:bg-ink-900"
      >
        <DownloadCloud size={16} /> {t("onboarding.importButton")}
      </button>
      <p className="mt-3 text-center text-xs text-ink-600">
        {t("onboarding.importLater")}
      </p>
    </StepShell>
  );
}

function FeaturedStep({
  settings,
  onPatch,
}: {
  settings: LauncherSettings;
  onPatch: (p: Partial<LauncherSettings>) => void;
}) {
  const t = useT();
  return (
    <StepShell
      icon={<Star size={26} />}
      title={t("onboarding.featuredTitle")}
      subtitle={t("onboarding.featuredBody")}
    >
      <div className="rounded-xl border border-edge/60 bg-ink-950/30 p-4">
        <Toggle
          label={t("onboarding.featuredToggle")}
          description={t("onboarding.featuredToggleDesc")}
          checked={settings.show_featured}
          onChange={(v) => onPatch({ show_featured: v })}
        />
      </div>
    </StepShell>
  );
}

function RamStep({
  settings,
  onPatch,
}: {
  settings: LauncherSettings;
  onPatch: (p: Partial<LauncherSettings>) => void;
}) {
  
  
  const t = useT();
  const deviceGb = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const recommendedGb = useMemo(() => {
    if (!deviceGb) return 4;
    return Math.min(8, Math.max(2, Math.round(deviceGb / 2)));
  }, [deviceGb]);

  const options = [2, 4, 6, 8];
  const currentGb = Math.round(settings.default_max_memory_mb / 1024);

  return (
    <StepShell
      icon={<MemoryStick size={26} />}
      title={t("onboarding.ramTitle")}
      subtitle={t("onboarding.ramBody")}
    >
      <div className="grid grid-cols-2 gap-2.5">
        {options.map((gb) => {
          const active = currentGb === gb;
          const recommended = gb === recommendedGb;
          return (
            <button
              key={gb}
              onClick={() => onPatch({ default_max_memory_mb: gb * 1024 })}
              className={`relative flex flex-col items-center gap-0.5 rounded-xl border px-4 py-3 transition ${
                active
                  ? "border-brass-500/60 bg-brass-500/10"
                  : "border-edge hover:border-brass-600/40 hover:bg-ink-800/40"
              }`}
            >
              <span className="font-mc text-lg text-gray-100">{gb} GB</span>
              {recommended && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-brass-400">
                  {t("onboarding.recommended")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}

function RpcStep({
  settings,
  onPatch,
}: {
  settings: LauncherSettings;
  onPatch: (p: Partial<LauncherSettings>) => void;
}) {
  const t = useT();
  return (
    <StepShell
      icon={<Plug size={26} />}
      title={t("onboarding.rpcTitle")}
      subtitle={t("onboarding.rpcBody")}
    >
      <div className="rounded-xl border border-edge/60 bg-ink-950/30 p-4">
        <Toggle
          label={t("onboarding.rpcToggle")}
          description={t("onboarding.rpcToggleDesc")}
          checked={settings.discord_rpc}
          onChange={(v) => onPatch({ discord_rpc: v })}
        />
      </div>
    </StepShell>
  );
}

function LanguageStep({
  settings,
  onPatch,
}: {
  settings: LauncherSettings;
  onPatch: (p: Partial<LauncherSettings>) => void;
}) {
  const t = useT();
  return (
    <StepShell
      icon={<Languages size={26} />}
      title={t("onboarding.languageTitle")}
      subtitle={t("onboarding.languageBody")}
    >
      <div>
        <div className="mb-1.5 text-sm text-ink-600">{t("onboarding.displayLanguage")}</div>
        <Select
          value={settings.locale}
          onChange={(v) => onPatch({ locale: v })}
          options={LOCALES.map((l) => ({ value: l.id, label: l.label }))}
        />
      </div>
    </StepShell>
  );
}

function SignInStep({
  accounts,
  onMicrosoftLogin,
  onAddOffline,
}: {
  accounts: AccountStore;
  onMicrosoftLogin: () => void;
  onAddOffline: (username: string) => void;
}) {
  const t = useT();
  const [offlineName, setOfflineName] = useState("");
  const [adding, setAdding] = useState(false);
  const has = accounts.accounts.length > 0;

  const addOffline = () => {
    const n = offlineName.trim();
    if (!n) return;
    setAdding(true);
    onAddOffline(n);
    setOfflineName("");
    
    setTimeout(() => setAdding(false), 600);
  };

  return (
    <StepShell
      icon={<LogIn size={26} />}
      title={t("onboarding.signInTitle")}
      subtitle={t("onboarding.signInBody")}
    >
      <div className="flex flex-col gap-3 rounded-xl border border-edge/60 bg-ink-950/20 p-4">
        {has && (
          <div className="flex flex-col gap-1.5 border-b border-edge/60 pb-3">
            {accounts.accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <Check size={14} className="text-brass-400" />
                <span className="text-gray-100">{a.username}</span>
                <span className="text-xs text-ink-600">
                  {a.kind === "microsoft" ? t("account.microsoft") : t("account.offline")}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onMicrosoftLogin}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-ink-950/70 px-3 py-2.5 text-sm font-medium text-gray-100 transition hover:border-brass-600/40 hover:bg-ink-900"
        >
          <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden style={{ filter: "saturate(0.62)" }}>
            <rect x="1" y="1" width="10" height="10" fill="#f25022" />
            <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
            <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
            <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
          </svg>
          {has ? t("account.addAnotherMicrosoft") : t("account.signInMicrosoft")}
        </button>

        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-500">
            {t("account.addOffline")}
          </div>
          <div className="flex gap-2">
            <input
              value={offlineName}
              onChange={(e) => setOfflineName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOffline()}
              placeholder={t("account.username")}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md bg-ink-950/70 px-3 py-1.5 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
            />
            <button
              onClick={addOffline}
              disabled={!offlineName.trim() || adding}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-50"
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {t("common.add")}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-ink-600">
          {t("onboarding.signInLater")}
        </p>
      </div>
    </StepShell>
  );
}

function DoneStep() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <span className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-brass-700/30 bg-brass-500/10 text-brass-300">
        <Sparkles size={30} />
      </span>
      <h2 className="font-mc text-xl tracking-wide text-gray-100">
        {t("onboarding.doneTitle")}
      </h2>
      <p className="mt-3 max-w-[400px] text-sm leading-relaxed text-ink-600">
        {t("onboarding.doneBody")}
      </p>
    </div>
  );
}
