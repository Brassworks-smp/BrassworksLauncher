import { useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, X, Check } from "lucide-react";
import * as api from "@/lib/api";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { LogUpload } from "@/lib/types";

export function LogUploadModal({
  upload,
  onClose,
}: {
  upload: LogUpload;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const { closing, close } = useClosable(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const copy = () => {
    api.copyText(upload.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="rise w-[440px] max-w-full overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="font-mc text-base tracking-wide text-gray-100">
            {t("logUpload.title")}
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 p-6">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-patina-500/15 text-patina-400">
            <CheckCircle2 size={26} />
          </span>
          <div className="text-center">
            <div className="font-mc text-sm text-gray-100">{t("logUpload.success")}</div>
            <div className="mt-0.5 text-xs text-ink-600">
              {t("logUpload.shareHint")}
            </div>
          </div>

          <div className="flex w-full items-center gap-2 rounded-lg border border-edge bg-ink-950/60 px-3 py-2">
            <span className="flex-1 truncate font-mono text-xs text-brass-300">
              {upload.url}
            </span>
          </div>

          <div className="flex w-full gap-2">
            <button
              onClick={copy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t("screenshots.copiedLabel") : t("screenshots.copy")}
            </button>
            <button
              onClick={() => api.openExternal(upload.url).catch(() => {})}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brass-500 px-3 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
            >
              <ExternalLink size={15} /> {t("screenshots.open")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
