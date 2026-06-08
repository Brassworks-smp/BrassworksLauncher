
import type { ModInfo } from "./types";

const key = (id: string, version: string | null) => `mi:${id}:${version ?? ""}`;

export function getCachedInfo(
  id: string,
  version: string | null,
): ModInfo | null {
  try {
    const raw = localStorage.getItem(key(id, version));
    return raw ? (JSON.parse(raw) as ModInfo) : null;
  } catch {
    return null;
  }
}

export function setCachedInfo(
  id: string,
  version: string | null,
  info: ModInfo,
): void {
  try {
    localStorage.setItem(key(id, version), JSON.stringify(info));
  } catch {
  }
}
