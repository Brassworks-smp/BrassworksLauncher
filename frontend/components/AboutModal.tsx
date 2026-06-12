import { useEffect, useState } from "react";
import {
  Globe,
  Github,
  MessageCircle,
  Package,
  Heart,
  ScrollText,
  RefreshCw,
  Loader2,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Logo } from "@/components/Logo";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";

export function AboutModal({
  appVersion,
  onShowChangelog,
  onUpdateInstalled,
  onError,
  onClose,
}: {
  appVersion: string | null;
  onShowChangelog: () => void;
  onUpdateInstalled: (version: string) => void;
  onError: (e: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [upToDate, setUpToDate] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const checkAndInstall = async () => {
    setChecking(true);
    setUpToDate(false);
    try {
      const info = await api.checkForUpdate();
      if (!info.available) {
        setUpToDate(true);
        toast(t("settings.updates.latestToast"), "success");
        return;
      }
      const blocked = await api.updateBlockReason().catch(() => null);
      if (blocked) {
        onError(blocked);
        return;
      }
      setDownloading(true);
      setPct(0);
      let total = 0;
      const un = await api.onUpdaterProgress((p) => {
        if (p.done) {
          setPct(100);
          return;
        }
        if (p.total) total = p.total;
        if (total > 0)
          setPct(Math.min(100, Math.round((p.downloaded / total) * 100)));
      });
      try {
        toast(t("settings.updates.downloadingToast", { version: info.version }), "info");
        await api.installUpdate();
        toast(t("settings.updates.installedToast", { version: info.version }), "success");
        onUpdateInstalled(info.version);
      } finally {
        un();
        setDownloading(false);
        setPct(null);
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const links: { label: string; icon: React.ReactNode; url: string }[] = [
    { label: t("about.website"), icon: <Globe size={15} />, url: api.BRASSWORKS_WEBSITE },
    { label: "Discord", icon: <MessageCircle size={15} />, url: api.BRASSWORKS_DISCORD },
    { label: "Modrinth", icon: <Package size={15} />, url: api.BRASSWORKS_MODRINTH },
    { label: "GitHub", icon: <Github size={15} />, url: api.BRASSWORKS_GITHUB },
    { label: "Ko-fi", icon: <Heart size={15} />, url: api.BRASSWORKS_KOFI },
  ];

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[55] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="rise relative w-[420px] max-w-full overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <button
          onClick={close}
          title={t("common.close")}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col items-center gap-2 px-6 pb-5 pt-8 text-center">
          <Logo size={56} />
          <h2 className="font-mc text-xl tracking-widest text-gray-100">
            BRASSWORKS
          </h2>
          <div className="text-[11px] uppercase tracking-widest text-ink-600">
            {t("sidebar.brandSub")}
          </div>
          {appVersion && (
            <span className="mt-1 rounded-md bg-brass-500/10 px-2 py-0.5 text-xs text-brass-300">
              v{appVersion}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-edge px-5 py-4">
          {downloading ? (
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
          ) : (
            <button
              onClick={checkAndInstall}
              disabled={checking}
              className="flex items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {t("settings.updates.check")}
              {upToDate && !checking && (
                <span className="ml-1 text-[11px] text-patina-400">{t("settings.updates.upToDate")}</span>
              )}
            </button>
          )}

          <button
            onClick={() => {
              close();
              onShowChangelog();
            }}
            className="flex items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <ScrollText size={15} /> {t("settings.updates.changelog")}
          </button>
        </div>

        <div className="flex flex-wrap justify-center gap-2 border-t border-edge px-5 py-4">
          {links.map((l) => (
            <button
              key={l.label}
              onClick={() => api.openExternal(l.url).catch(() => {})}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              {l.icon}
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
