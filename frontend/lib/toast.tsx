"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let counter = 0;
const listeners = new Set<(t: Toast) => void>();

/** Fire a toast from anywhere in the app (no provider/context needed). */
export function toast(message: string, kind: ToastKind = "info") {
  const t: Toast = { id: ++counter, kind, message };
  listeners.forEach((l) => l(t));
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
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const add = (t: Toast) => {
      setToasts((prev) => [...prev.slice(-3), t]);
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
        4500,
      );
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, cls, iconCls } = STYLE[t.kind];
        return (
          <div
            key={t.id}
            className={`rise pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-xl ${cls}`}
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${iconCls}`} />
            <span className="flex-1 leading-snug text-gray-200">
              {t.message}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-ink-600 transition hover:text-gray-200"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
