import * as api from "@/lib/api";
import { dismissToast, toastProgress } from "@/lib/toast";
import type { UpdateProgress } from "@/lib/types";

const operationId = (prefix: string) =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random()}`;

export const operationWasCancelled = (reason: unknown) =>
  String(reason).toLowerCase().includes("cancel");

export async function runContentDownload<T>(
  label: string,
  run: (id: string) => Promise<T>,
): Promise<T> {
  const id = operationId("content");
  const key = `${id}:download`;
  const cancel = () => void api.cancelTransfer(id);
  const unlisten = await api.onContentProgress((event) => {
    if (event.operation_id !== id) return;
    const progress = event.total > 0
      ? Math.min(100, Math.round((event.current / event.total) * 100))
      : null;
    toastProgress(key, `Downloading ${label}`, progress, cancel);
  });
  toastProgress(key, `Downloading ${label}`, null, cancel);
  try {
    return await run(id);
  } finally {
    unlisten();
    dismissToast(key);
  }
}

export async function runLauncherUpdate(
  version: string,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  const id = operationId("launcher-update");
  const key = `${id}:update`;
  const cancel = () => void api.cancelTransfer(id);
  const unlisten = await api.onUpdaterProgress((event) => {
    if (event.operation_id !== id) return;
    onProgress?.(event);
    if (event.installing) {
      toastProgress(key, `Installing Brassworks Launcher v${version}`, 100);
      return;
    }
    const progress = event.total && event.total > 0
      ? Math.min(100, Math.round((event.downloaded / event.total) * 100))
      : null;
    toastProgress(key, `Downloading Brassworks Launcher v${version}`, progress, cancel);
  });
  toastProgress(key, `Downloading Brassworks Launcher v${version}`, null, cancel);
  try {
    await api.installUpdate(id);
  } finally {
    unlisten();
    dismissToast(key);
  }
}
