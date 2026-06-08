
import type { ModInfo } from "./types";

const key = (source: string, id: string, version: string | null) =>
  `mi:${source}:${id}:${version ?? ""}`;

export function getCachedInfo(
  source: string,
  id: string,
  version: string | null,
): ModInfo | null {
  try {
    const raw = localStorage.getItem(key(source, id, version));
    return raw ? (JSON.parse(raw) as ModInfo) : null;
  } catch {
    return null;
  }
}

export function setCachedInfo(
  source: string,
  id: string,
  version: string | null,
  info: ModInfo,
): void {
  try {
    localStorage.setItem(key(source, id, version), JSON.stringify(info));
  } catch {
  }
}
