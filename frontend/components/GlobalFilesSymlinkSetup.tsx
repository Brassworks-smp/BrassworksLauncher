import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldAlert, Unlink } from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import type { GlobalFilesSymlinkSupport } from "@/lib/types";

export function useGlobalFilesSymlinkSupport(
  checkOnMount = false,
  onDisableGlobalFiles?: () => void,
) {
  const [support, setSupport] = useState<GlobalFilesSymlinkSupport | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (force = false) => {
    if (!api.isTauri()) return true;
    if (!force && support?.supported) return true;
    setChecking(true);
    try {
      const next = await api.globalFilesSymlinkSupport();
      setSupport(next);
      const blocked = next.windows && !next.supported;
      setOpen(blocked);
      return !blocked;
    } catch (error) {
      toast(String(error), "error");
      return false;
    } finally {
      setChecking(false);
    }
  }, [support]);

  useEffect(() => {
    if (checkOnMount) void check(true);
  }, [checkOnMount]);

  return {
    ensureSymlinkSupport: () => check(false),
    symlinkSetupModal: (
      <WindowsSymlinkSetupModal
        open={open}
        checking={checking}
        error={support?.error ?? null}
        onClose={() => setOpen(false)}
        onRetry={() => void check(true)}
        onDisableGlobalFiles={onDisableGlobalFiles}
      />
    ),
  };
}

function WindowsSymlinkSetupModal({
  open,
  checking,
  error,
  onClose,
  onRetry,
  onDisableGlobalFiles,
}: {
  open: boolean;
  checking: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onDisableGlobalFiles?: () => void;
}) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-overlay fixed inset-0 z-[70] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="windows-symlink-setup-title"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="rise w-[500px] max-w-full rounded-xl border border-amber-500/30 bg-ink-900 p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-amber-300">
          <ShieldAlert size={21} />
          <h2 id="windows-symlink-setup-title" className="font-mc text-lg tracking-wide">
            {t("globalFiles.windowsSetupTitle")}
          </h2>
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-ink-600">
          <p>{t("globalFiles.windowsSetupBody")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-gray-300">
            <li>{t("globalFiles.windowsSetupStep1")}</li>
            <li>{t("globalFiles.windowsSetupStep2")}</li>
            <li>{t("globalFiles.windowsSetupStep3")}</li>
          </ol>
          <p className="text-xs">{t("globalFiles.windowsSetupAdminFallback")}</p>
          {error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 font-mono text-[11px] text-red-300/80">
              {error}
            </p>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {onDisableGlobalFiles && (
            <button
              onClick={() => {
                onDisableGlobalFiles();
                onClose();
              }}
              className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20"
            >
              <Unlink size={14} /> {t("globalFiles.turnOff")}
            </button>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => api.openWindowsDeveloperSettings().catch((cause) => toast(String(cause), "error"))}
              className="flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <ExternalLink size={14} /> {t("globalFiles.openDeveloperSettings")}
            </button>
            <button
              disabled={checking}
              onClick={onRetry}
              className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("globalFiles.checkAgain")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
