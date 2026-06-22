import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";

export function AccountOverrideWarning({
  instanceName,
  accountName,
  onConfirm,
  onCancel,
}: {
  instanceName: string;
  accountName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onCancel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="w-[440px] max-w-full overflow-hidden rounded-xl border border-amber-600/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <AlertTriangle size={17} className="text-amber-400" />
            {t("accountOverride.title")}
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 text-sm leading-relaxed text-ink-500">
          {t("accountOverride.body", { instance: instanceName, account: accountName })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3">
          <button
            onClick={close}
            className="rounded-md border border-edge px-3 py-1.5 text-sm text-ink-600 transition hover:text-gray-200"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-amber-400"
          >
            {t("accountOverride.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
