import { RotateCw, X } from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";

export function RestartPrompt({
  version,
  onDismiss,
}: {
  version: string;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="rise fixed bottom-4 left-1/2 z-[58] flex w-[460px] max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-brass-600/40 bg-ink-850 px-4 py-3 shadow-2xl">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brass-500/15 text-brass-400">
        <RotateCw size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-100">
          {t("settings.updates.installedToast", { version })}
        </div>
        <div className="text-xs text-ink-600">
          {t("restartPrompt.body")}
        </div>
      </div>
      <button
        onClick={() => api.restartApp().catch(() => {})}
        className="shrink-0 rounded-lg bg-brass-500 px-3 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
      >
        {t("restartPrompt.restartNow")}
      </button>
      <button
        onClick={onDismiss}
        className="shrink-0 text-ink-600 transition hover:text-gray-200"
        title={t("restartPrompt.later")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
