import type { CommandSpec, CommandContext } from "../types";
import type { LauncherSettings } from "@/lib/types";
import {
  defaultAccentForTheme,
  DEFAULT_ACCENT,
  THEME_ACCENTS,
} from "@/lib/colors";

const GROUP = "Settings";

const THEMES = Object.keys(THEME_ACCENTS);

type Kind =
  | { t: "bool" }
  | { t: "int"; min?: number }
  | { t: "string" }
  | { t: "enum"; values: string[] }
  | { t: "resolution" };

interface SettingDef {
  key: keyof LauncherSettings;
  kind: Kind;
}

const SETTINGS: Record<string, SettingDef> = {
  "launch-behavior": {
    key: "launch_behavior",
    kind: { t: "enum", values: ["keep", "hide", "quit"] },
  },
  "java-policy": {
    key: "java_policy",
    kind: { t: "enum", values: ["auto", "system", "custom"] },
  },
  "max-memory": { key: "default_max_memory_mb", kind: { t: "int", min: 512 } },
  "min-memory": { key: "default_min_memory_mb", kind: { t: "int", min: 256 } },
  "download-concurrency": {
    key: "download_concurrency",
    kind: { t: "int", min: 1 },
  },
  resolution: { key: "default_resolution", kind: { t: "resolution" } },
  locale: { key: "locale", kind: { t: "string" } },
  "discord-rpc": { key: "discord_rpc", kind: { t: "bool" } },
  "reduce-motion": { key: "reduce_motion", kind: { t: "bool" } },
  "high-contrast": { key: "high_contrast", kind: { t: "bool" } },
  "close-to-tray": { key: "close_to_tray", kind: { t: "bool" } },
  "show-featured": { key: "show_featured", kind: { t: "bool" } },
  "record-playtime": { key: "record_playtime", kind: { t: "bool" } },
  "show-playtime": { key: "show_playtime", kind: { t: "bool" } },
  "playtime-hours": { key: "playtime_in_hours", kind: { t: "bool" } },
  "console-on-launch": { key: "console_on_launch", kind: { t: "bool" } },
  "console-on-crash": { key: "console_on_crash", kind: { t: "bool" } },
  "console-on-quit": { key: "console_on_quit", kind: { t: "bool" } },
  "auto-update": { key: "auto_update", kind: { t: "bool" } },
  "dev-mode": { key: "dev_mode", kind: { t: "bool" } },
};

function parseValue(kind: Kind, raw: string): unknown | string {
  switch (kind.t) {
    case "bool": {
      if (/^(1|true|yes|on)$/i.test(raw)) return true;
      if (/^(0|false|no|off)$/i.test(raw)) return false;
      return "expected true/false";
    }
    case "int": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return "expected a number";
      if (kind.min !== undefined && n < kind.min)
        return `must be ≥ ${kind.min}`;
      return Math.round(n);
    }
    case "enum":
      return kind.values.includes(raw)
        ? raw
        : `expected ${kind.values.join("|")}`;
    case "resolution": {
      const m = raw.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      return m
        ? [Number(m[1]), Number(m[2])]
        : "expected WIDTHxHEIGHT";
    }
    case "string":
      return raw;
  }
}

export const settingsCommands: CommandSpec[] = [
  {
    path: ["settings", "set"],
    group: GROUP,
    summary: "Change a launcher setting",
    keywords: "config preference option",
    args: [
      {
        name: "key",
        type: "enum",
        required: true,
        description: "setting key",
        enumValues: Object.keys(SETTINGS),
      },
      { name: "value", type: "rest", required: true, description: "new value" },
    ],
    listable: false,
    run: (args, ctx) => {
      const key = args.get("key") ?? "";
      const def = SETTINGS[key];
      if (!def)
        return { ok: false, message: `Unknown key. Try one of: ${Object.keys(SETTINGS).slice(0, 8).join(", ")}…` };
      const parsed = parseValue(def.kind, args.get("value") ?? "");
      if (typeof parsed === "string") return { ok: false, message: parsed };
      ctx.applySettings({ [def.key]: parsed } as Partial<LauncherSettings>);
      return { ok: true, message: `Set ${key} = ${args.get("value")}.` };
    },
  },
  {
    path: ["settings", "get"],
    group: GROUP,
    summary: "Read a launcher setting",
    keywords: "show value config",
    args: [
      {
        name: "key",
        type: "enum",
        required: true,
        description: "setting key",
        enumValues: Object.keys(SETTINGS),
      },
    ],
    listable: false,
    run: (args, ctx) => {
      const { settings } = ctx.state();
      const key = args.get("key") ?? "";
      const def = SETTINGS[key];
      if (!def || !settings) return { ok: false, message: `Unknown key "${key}".` };
      return { ok: true, message: `${key} = ${JSON.stringify(settings[def.key])}` };
    },
  },
  {
    path: ["theme"],
    group: GROUP,
    summary: "Set the theme",
    keywords: "appearance dark light grey ocean mocha nord rose color mode",
    args: [
      {
        name: "theme",
        type: "enum",
        required: true,
        description: "theme name",
        enumValues: THEMES,
      },
    ],
    listable: false,
    run: (args, ctx) => {
      const theme = args.get("theme") ?? "";
      if (!THEMES.includes(theme))
        return { ok: false, message: `Unknown theme. Try: ${THEMES.join(", ")}` };
      ctx.applySettings({ theme, accent_color: defaultAccentForTheme(theme) });
      return { ok: true, message: `Theme set to ${theme}.` };
    },
  },
  {
    path: ["accent"],
    group: GROUP,
    summary: "Set the accent color (hex or 'default')",
    keywords: "color highlight tint",
    args: [
      {
        name: "color",
        type: "string",
        required: true,
        description: "#rrggbb or 'default'",
      },
    ],
    listable: false,
    run: (args, ctx) => {
      const raw = (args.get("color") ?? "").trim();
      if (raw.toLowerCase() === "default") {
        ctx.applySettings({ accent_color: null });
        return { ok: true, message: "Accent reset to default." };
      }
      const hex = raw.startsWith("#") ? raw : `#${raw}`;
      if (!/^#[0-9a-f]{6}$/i.test(hex))
        return { ok: false, message: "Expected a #rrggbb hex color." };
      ctx.applySettings({ accent_color: hex });
      return { ok: true, message: `Accent set to ${hex}.` };
    },
  },
];

export { DEFAULT_ACCENT };
