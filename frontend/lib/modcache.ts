import type { ModInfo, ShareDiffEntry } from "./types";

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

const diffKey = (instanceId: string) => `sharediff:${instanceId}`;

export function getCachedDiff(instanceId: string): ShareDiffEntry[] | null {
  try {
    const raw = localStorage.getItem(diffKey(instanceId));
    return raw ? (JSON.parse(raw) as ShareDiffEntry[]) : null;
  } catch {
    return null;
  }
}

export function setCachedDiff(
  instanceId: string,
  diff: ShareDiffEntry[] | null,
): void {
  try {
    if (diff) localStorage.setItem(diffKey(instanceId), JSON.stringify(diff));
    else localStorage.removeItem(diffKey(instanceId));
  } catch {
  }
}
