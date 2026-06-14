export const ACCENT_COLORS = [
  "#34d27a",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#9b9b9b",
];

export const DEFAULT_ACCENT = "#1fbf63";







export const THEME_ACCENTS: Record<string, string | null> = {
  system: null,
  "brass-dark": null,
  "brass-light": null,
  "brass-grey": null,
  "brass-ocean": "#06b6d4",
  "brass-mocha": "#f97316",
  "brass-nord": "#3b82f6",
  "brass-rose": "#ec4899",
  "brass-amethyst": "#8b5cf6",
  "brass-crimson": "#ef4444",
  "brass-forest": "#10b981",
};

export function defaultAccentForTheme(theme: string): string | null {
  return THEME_ACCENTS[theme] ?? null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function hexToHsl(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      default:
        hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return [hue * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function accentScale(base: string): Record<300 | 400 | 500 | 600 | 700, string> {
  const [h, s, l] = hexToHsl(base);
  const mk = (dl: number, ds = 0) =>
    hslToHex(h, clamp(s + ds, 0, 100), clamp(l + dl, 4, 96));
  return {
    300: mk(16),
    400: mk(8),
    500: base,
    600: mk(-9, 2),
    700: mk(-19, 4),
  };
}

const BRASS_STOPS: (300 | 400 | 500 | 600 | 700)[] = [300, 400, 500, 600, 700];

export function applyAccent(accent: string | null | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!accent) {
    for (const stop of BRASS_STOPS)
      root.style.removeProperty(`--color-brass-${stop}`);
    return;
  }
  const scale = accentScale(accent);
  for (const stop of BRASS_STOPS)
    root.style.setProperty(`--color-brass-${stop}`, scale[stop]);
}
