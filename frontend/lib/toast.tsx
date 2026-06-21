import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X, Download } from "lucide-react";
import { useT } from "@/lib/i18n";

export type ToastKind = "success" | "error" | "info" | "progress";

interface Toast {
  id: number;
  key?: string;
  kind: ToastKind;
  message: string;

  progress?: number | null;
  sticky?: boolean;
  onCancel?: () => void;
}

type Action =
  | { type: "add"; toast: Toast }
  | { type: "upsert"; toast: Toast }
  | { type: "remove"; key: string };

let counter = 0;
const listeners = new Set<(a: Action) => void>();
const emit = (a: Action) => listeners.forEach((l) => l(a));


export function toast(message: string, kind: ToastKind = "info") {
  emit({ type: "add", toast: { id: ++counter, kind, message } });
}


export function toastProgress(
  key: string,
  message: string,
  progress: number | null,
  onCancel?: () => void,
) {
  emit({
    type: "upsert",
    toast: {
      id: ++counter,
      key,
      kind: "progress",
      message,
      progress,
      sticky: true,
      onCancel,
    },
  });
}

export function dismissToast(key: string) {
  emit({ type: "remove", key });
}

const STYLE: Record<
  ToastKind,
  { icon: typeof Info; cls: string; iconCls: string }
> = {
  success: {
    icon: CheckCircle2,
    cls: "border-brass-600/40 bg-ink-850",
    iconCls: "text-brass-400",
  },
  error: {
    icon: AlertTriangle,
    cls: "border-red-500/40 bg-ink-850",
    iconCls: "text-red-400",
  },
  info: {
    icon: Info,
    cls: "border-edge bg-ink-850",
    iconCls: "text-patina-400",
  },
  progress: {
    icon: Download,
    cls: "border-brass-600/40 bg-ink-850",
    iconCls: "text-brass-400",
  },
};

export function ToastHost() {
  const tr = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const arm = (t: Toast) => {
      if (t.sticky) return;
      const h = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
        timers.current.delete(t.id);
      }, 4500);
      timers.current.set(t.id, h);
    };

    const handle = (a: Action) => {
      if (a.type === "add") {
        setToasts((prev) => [...prev.slice(-4), a.toast]);
        arm(a.toast);
      } else if (a.type === "upsert") {
        setToasts((prev) => {
          const idx = prev.findIndex((x) => x.key && x.key === a.toast.key);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...a.toast, id: prev[idx].id };
            return next;
          }
          return [...prev.slice(-4), a.toast];
        });
      } else {
        setToasts((prev) => prev.filter((x) => x.key !== a.key));
      }
    };

    listeners.add(handle);
    return () => {
      listeners.delete(handle);
    };
  }, []);

  const dismiss = (t: Toast) => {
    const h = timers.current.get(t.id);
    if (h) {
      clearTimeout(h);
      timers.current.delete(t.id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== t.id));
  };

  const pause = (t: Toast) => {
    const h = timers.current.get(t.id);
    if (h) {
      clearTimeout(h);
      timers.current.delete(t.id);
    }
  };
  const resume = (t: Toast) => {
    if (t.sticky || timers.current.has(t.id)) return;
    const h = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
      timers.current.delete(t.id);
    }, 2500);
    timers.current.set(t.id, h);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, cls, iconCls } = STYLE[t.kind];
        const isProgress = t.kind === "progress";
        return (
          <div
            key={t.id}
            onMouseEnter={() => pause(t)}
            onMouseLeave={() => resume(t)}
            className={`rise group pointer-events-auto flex flex-col gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-xl transition-transform hover:-translate-y-0.5 hover:border-brass-500/60 ${cls}`}
          >
            <div className="flex items-start gap-2.5">
              <Icon
                size={16}
                className={`mt-0.5 shrink-0 ${iconCls} ${
                  isProgress && t.progress === null ? "animate-pulse" : ""
                }`}
              />
              <span className="flex-1 whitespace-pre-line leading-snug text-gray-200">
                {t.message}
              </span>
              {isProgress && t.progress !== null && (
                <span className="shrink-0 text-xs tabular-nums text-ink-600">
                  {t.progress}%
                </span>
              )}
              <button
                onClick={() => dismiss(t)}
                className="shrink-0 text-ink-600 opacity-0 transition hover:text-gray-200 group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
            {isProgress && (
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="progress-fill h-full rounded-full transition-[width] duration-300"
                  style={{ width: t.progress !== null ? `${t.progress}%` : "40%" }}
                />
              </div>
            )}
            {isProgress && t.onCancel && (
              <button
                onClick={() => t.onCancel?.()}
                className="self-end text-xs font-medium text-ink-600 transition hover:text-red-400"
              >
                {tr("common.cancel")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
