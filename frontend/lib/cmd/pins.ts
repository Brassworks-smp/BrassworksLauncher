import { REGISTRY, cmdPath, parse } from "./registry";

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

/** Pinned commands (paths or full command strings) resolved for the native menu. */
export function pinnedMenuItems(): { id: string; label: string }[] {
  return loadPins()
    .map((pin) => {
      const parsed = parse(pin, REGISTRY);
      if (!parsed || "error" in parsed) return null;
      const bare = cmdPath(parsed.spec);
      const label =
        pin.trim().toLowerCase() === bare.toLowerCase()
          ? parsed.spec.summary
          : pin.replace(/^\//, "");
      return { id: pin, label };
    })
    .filter((x): x is { id: string; label: string } => x !== null);
}
