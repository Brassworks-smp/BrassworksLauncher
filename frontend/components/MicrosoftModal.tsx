import { Loader2, X, AlertTriangle } from "lucide-react";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";

export type MsAuthState =
  | { status: "starting" }
  | {
      status: "code";
      user_code: string;
      verification_uri: string;
      message: string;
    }
  | { status: "error"; message: string };

export function MicrosoftModal({
  state,
  onClose,
}: {
  state: MsAuthState | null;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  if (!state) return null;

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
    >
      <div className="w-[400px] rounded-lg panel p-6 rise">
        <div className="flex items-start justify-between">
          <h2 className="font-mc text-base tracking-wide text-gray-100">
            {t("account.signInMicrosoft")}
          </h2>
          <button onClick={close} className="text-ink-600 hover:text-brass-300">
            <X size={18} />
          </button>
        </div>

        {state.status === "error" ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <AlertTriangle size={26} className="text-red-400" />
            <p className="text-sm text-red-300">{state.message}</p>
            <button
              onClick={close}
              className="mt-2 rounded-lg bg-ink-800 px-4 py-2 text-sm hover:bg-ink-700"
            >
              {t("common.close")}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <Loader2 size={26} className="animate-spin text-brass-400" />
            <p className="text-sm text-ink-600">
              {state.status === "code"
                ? t("microsoft.codeMessage")
                : t("microsoft.opening")}
            </p>
            {state.status === "code" && (
              <p className="text-xs text-ink-600">
                {t("microsoft.verificationCode")}{" "}
                <span className="font-mono tracking-[0.2em] text-brass-300">
                  {state.user_code}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
