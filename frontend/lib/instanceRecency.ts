const KEY = "bw-instance-last-clicked";

export function getLastClicked(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function recordLastClicked(id: string): void {
  try {
    const cur = getLastClicked();
    cur[id] = Date.now();
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {}
}
