import { convertFileSrc } from "@tauri-apps/api/core";

const GLYPHS: { id: string; glyph: string }[] = [
  {
    id: "box",
    glyph:
      '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
      '<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  },
  {
    id: "gem",
    glyph:
      '<path d="M6 3h12l4 6-10 13L2 9Z"/>' +
      '<path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  },
  {
    id: "sword",
    glyph:
      '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>' +
      '<line x1="13" x2="19" y1="19" y2="13"/>' +
      '<line x1="16" x2="20" y1="16" y2="20"/>' +
      '<line x1="19" x2="21" y1="21" y2="19"/>',
  },
  {
    id: "heart",
    glyph:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  },
  {
    id: "star",
    glyph:
      '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  },
  {
    id: "zap",
    glyph: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  },
  {
    id: "crown",
    glyph:
      '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>' +
      '<path d="M5 21h14"/>',
  },
  {
    id: "shield",
    glyph:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  },
];

export interface Palette {
  accent: string; 
  bg: string; 
}

const DEFAULTS: Palette = {
  accent: "#34d27a",
  bg: "#080808",
};

const svg = (glyph: string, p: Palette) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56">' +
  `<rect width="56" height="56" rx="8" fill="${p.bg}" fill-opacity="0.6"/>` +
  `<rect x="0.5" y="0.5" width="55" height="55" rx="7.5" fill="none" ` +
  `stroke="${p.accent}" stroke-opacity="0.4"/>` +
  `<g transform="translate(16 16)" fill="none" stroke="${p.accent}" ` +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  `${glyph}</g></svg>`;

export interface InstanceIcon {
  id: string;
  uri: string; 
  value: string; 
}

const BUILTIN_PREFIX = "builtin:";
const BY_ID = new Map(GLYPHS.map((g) => [g.id, g.glyph]));


export const DEFAULT_INSTANCE_ICON = BUILTIN_PREFIX + GLYPHS[0].id;

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}


export function currentPalette(): Palette {
  return {
    accent: cssVar("--color-brass-400", DEFAULTS.accent),
    bg: cssVar("--color-ink-950", DEFAULTS.bg),
  };
}

const uriFor = (glyph: string, p: Palette) =>
  "data:image/svg+xml," + encodeURIComponent(svg(glyph, p));


export function buildInstanceIcons(p: Palette): InstanceIcon[] {
  return GLYPHS.map((g) => ({
    id: g.id,
    uri: uriFor(g.glyph, p),
    value: BUILTIN_PREFIX + g.id,
  }));
}

export const isBuiltinIcon = (icon: string | null | undefined): boolean =>
  !!icon && icon.startsWith(BUILTIN_PREFIX);


export function brandingSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  
  
  
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
  const isUnixFsPath = /^\/[^/]+\/.+/.test(value);
  if (isWindowsPath || isUnixFsPath) {
    try {
      return convertFileSrc(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function iconSrc(
  icon: string | null | undefined,
  accent?: string,
): string | null {
  if (!icon) return null;
  if (icon.startsWith(BUILTIN_PREFIX)) {
    const glyph = BY_ID.get(icon.slice(BUILTIN_PREFIX.length));
    if (!glyph) return null;
    const p = currentPalette();
    return uriFor(glyph, { accent: accent || p.accent, bg: p.bg });
  }
  return brandingSrc(icon);
}
