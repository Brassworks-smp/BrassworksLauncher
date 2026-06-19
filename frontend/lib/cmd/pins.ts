import { REGISTRY, cmdPath } from "./registry";

const PINS_KEY = "bw.cmd.pins";
const EVENT = "bw:cmd-pins";

export function loadPins(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function savePins(pins: string[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onPinsChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Pinned command paths resolved to {id, label} for the native menu. */
export function pinnedMenuItems(): { id: string; label: string }[] {
  return loadPins()
    .map((p) => {
      const spec = REGISTRY.find((s) => cmdPath(s) === p);
      return spec ? { id: p, label: spec.summary } : null;
    })
    .filter((x): x is { id: string; label: string } => x !== null);
}
