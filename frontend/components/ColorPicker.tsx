import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { placeMenu, useMenuDismiss } from "./ui";
import { useT } from "@/lib/i18n";
import { DEFAULT_ACCENT } from "@/lib/colors";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const HEX6 = /^#?[0-9a-fA-F]{6}$/;

export const swatchBg = (c: string) =>
  `linear-gradient(to bottom right, color-mix(in srgb, ${c} 88%, #fff), color-mix(in srgb, ${c} 78%, #000))`;
const RAINBOW =
  "conic-gradient(from 0deg,#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#a855f7,#f43f5e)";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full || "000000", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
const hsvToHex = (h: number, s: number, v: number) => {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
};
const hexToHsv = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
};

export function ColorPicker({
  anchor,
  value,
  onChange,
  onClose,
  accent,
}: {
  anchor: DOMRect;
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  accent?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(value.replace("#", ""));
  useMenuDismiss(true, onClose, ref);

  useEffect(() => {
    if (dragging.current) return;
    setHsv(hexToHsv(value));
    setDraft(value.replace("#", ""));
  }, [value]);

  const emit = (h: number, s: number, v: number) => {
    setHsv({ h, s, v });
    const hex = hsvToHex(h, s, v);
    setDraft(hex.replace("#", ""));
    onChange(hex);
  };

  const drag = (
    elRef: React.RefObject<HTMLElement | null>,
    handler: (px: number, py: number) => void,
  ) =>
    (e: React.PointerEvent) => {
      const el = elRef.current;
      if (!el) return;
      const apply = (cx: number, cy: number) => {
        const r = el.getBoundingClientRect();
        handler(clamp01((cx - r.left) / r.width), clamp01((cy - r.top) / r.height));
      };
      dragging.current = true;
      apply(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
      const up = () => {
        dragging.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  const pos = placeMenu(anchor, 280);
  const hueHex = hsvToHex(hsv.h, 1, 1);
  const current = hsvToHex(hsv.h, hsv.s, hsv.v);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <div
        ref={ref}
        className={`fixed z-[96] w-60 rounded-xl border bg-ink-900/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-sm ${
          accent ? "" : "border-brass-700/40"
        }`}
        style={{
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - 248)),
          ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
          ...(accent
            ? ({
                "--cc-accent": accent,
                borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
              } as React.CSSProperties)
            : {}),
        }}
      >
        <div
          ref={svRef}
          onPointerDown={drag(svRef, (x, y) => emit(hsv.h, x, 1 - y))}
          className="relative h-36 w-full cursor-crosshair touch-none rounded-lg"
          style={{
            backgroundColor: hueHex,
            backgroundImage:
              "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))",
          }}
        >
          <span
            className="pointer-events-none absolute h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-[5px] ring-2 ring-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.7)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundImage: swatchBg(current) }}
          />
        </div>

        <div
          ref={hueRef}
          onPointerDown={drag(hueRef, (x) => emit(x * 360, hsv.s, hsv.v))}
          className="group relative mt-3 flex h-[18px] w-full cursor-pointer touch-none items-center"
        >
          <div
            className="absolute inset-x-0 h-2 overflow-hidden rounded-full border border-edge"
            style={{
              backgroundImage:
                "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
            }}
          />
          <span
            className="pointer-events-none absolute h-[20px] w-[20px] -translate-x-1/2 rounded-[5px] ring-2 ring-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.7)]"
            style={{ left: `${(hsv.h / 360) * 100}%`, backgroundImage: swatchBg(hueHex) }}
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="h-8 w-8 shrink-0 rounded-[5px] shadow-sm"
            style={{ backgroundImage: swatchBg(current) }}
          />
          <div
            className={`flex flex-1 items-center rounded-[5px] bg-ink-950/50 px-2 font-mono text-xs ring-1 ring-edge transition ${
              accent ? "focus-within:ring-[var(--cc-accent)]" : "focus-within:ring-brass-500/60"
            }`}
          >
            <span className="text-ink-600">#</span>
            <input
              value={draft}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                setDraft(v);
                if (HEX6.test(v)) {
                  setHsv(hexToHsv(`#${v}`));
                  onChange(`#${v}`);
                }
              }}
              spellCheck={false}
              className="w-full bg-transparent py-1.5 uppercase tracking-wider text-gray-100 outline-none"
            />
          </div>
          <button
            onClick={onClose}
            title="Done"
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border border-edge text-ink-600 transition ${
              accent
                ? "hover:border-[var(--cc-accent)] hover:text-[var(--cc-accent)]"
                : "hover:border-brass-600/40 hover:text-brass-300"
            }`}
          >
            <Check size={15} strokeWidth={3} />
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function CustomColorChip({
  selected,
  active,
  onPick,
  storageKey,
  compact = false,
  fullWidth = false,
  accent,
}: {
  selected: string | null;
  active: boolean;
  onPick: (hex: string | null) => void;
  storageKey: string;
  compact?: boolean;
  fullWidth?: boolean;
  accent?: string;
}) {
  const t = useT();
  const dotRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [stored, setStored] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (active && selected && selected.toLowerCase() !== stored) {
      setStored(selected.toLowerCase());
      try {
        localStorage.setItem(storageKey, selected.toLowerCase());
      } catch {
        return;
      }
    }
  }, [active, selected, stored, storageKey]);

  const effective = (active && selected ? selected : stored).toLowerCase();
  const [draft, setDraft] = useState(effective.replace("#", ""));
  useEffect(() => setDraft(effective.replace("#", "")), [effective]);

  const apply = (hex: string) => {
    if (!HEX6.test(hex)) return;
    const h = (hex.startsWith("#") ? hex : `#${hex}`).toLowerCase();
    setStored(h);
    try {
      localStorage.setItem(storageKey, h);
    } catch {

    }
    onPick(h);
  };

  const clear = () => {
    setStored("");
    try {
      localStorage.removeItem(storageKey);
    } catch {

    }
    if (active) onPick(null);
  };

  const openPicker = () => {
    if (effective) apply(effective);
    if (dotRef.current) setAnchor(dotRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const dotSize = compact ? "h-5 w-5" : "h-7 w-7";

  return (
    <div
      className={
        fullWidth
          ? "flex w-full items-center gap-2"
          : `flex items-center gap-1.5 rounded-md border py-0.5 pl-0.5 pr-1.5 transition ${
              active
                ? "border-brass-500/70 bg-brass-500/10 ring-1 ring-brass-500/40"
                : "border-edge bg-ink-950/40 hover:border-brass-600/40"
            }`
      }
    >
      <button
        ref={dotRef}
        onClick={openPicker}
        title={t("theme.accentCustom")}
        style={effective ? { backgroundImage: swatchBg(effective) } : { backgroundImage: RAINBOW }}
        className={`grid ${dotSize} shrink-0 place-items-center rounded-md shadow-sm transition hover:scale-110 ${
          active ? "scale-110" : ""
        }`}
      >
        {active && (
          <Check
            size={compact ? 11 : 14}
            strokeWidth={3.5}
            className="text-white [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.6))]"
          />
        )}
      </button>
      <div
        style={accent ? ({ "--cc-accent": accent } as React.CSSProperties) : undefined}
        className={`flex items-center font-mono text-[11px] text-gray-200 ${
          fullWidth
            ? `flex-1 rounded-md bg-ink-950/40 px-2 py-1 ring-1 ring-edge transition ${
                accent ? "focus-within:ring-[var(--cc-accent)]" : "focus-within:ring-brass-500/60"
              }`
            : ""
        }`}
      >
        <span className="text-ink-600">#</span>
        <input
          value={draft}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
            setDraft(v);
            if (v.length === 0) clear();
            else if (v.length === 6) apply(`#${v}`);
          }}
          placeholder="rrggbb"
          spellCheck={false}
          className={`bg-transparent uppercase tracking-wide outline-none placeholder:normal-case placeholder:text-ink-600 ${
            fullWidth ? "w-full" : "w-[4.2rem]"
          }`}
        />
      </div>
      {open && anchor && (
        <ColorPicker
          anchor={anchor}
          value={effective || DEFAULT_ACCENT}
          onChange={apply}
          onClose={() => setOpen(false)}
          accent={accent}
        />
      )}
    </div>
  );
}
