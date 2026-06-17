import type { CommandSpec } from "../types";
import type { View } from "@/components/Sidebar";

const VIEWS: { view: View; label: string; keywords?: string }[] = [
  { view: "play", label: "Play", keywords: "home launch" },
  { view: "instances", label: "Instances", keywords: "packs list" },
  { view: "mods", label: "Content", keywords: "mods resourcepacks shaders" },
  { view: "worlds", label: "Worlds", keywords: "saves singleplayer" },
  { view: "servers", label: "Servers", keywords: "multiplayer" },
  { view: "skin", label: "Skin", keywords: "appearance cape" },
  { view: "screenshots", label: "Screenshots", keywords: "images" },
  { view: "settings", label: "Settings", keywords: "preferences options" },
];

const GROUP = "Navigate";

export const navCommands: CommandSpec[] = [
  {
    path: ["go"],
    group: GROUP,
    summary: "Go to a view",
    keywords: "navigate open tab view",
    args: [
      {
        name: "view",
        type: "enum",
        required: true,
        description: "view to open",
        enumValues: VIEWS.map((v) => v.view),
      },
    ],
    listable: false,
    run: (args, ctx) => {
      const v = (args.get("view") ?? "").toLowerCase() as View;
      if (!VIEWS.some((x) => x.view === v))
        return { ok: false, message: `Unknown view "${args.get("view")}"` };
      ctx.nav(v);
    },
  },
  ...VIEWS.map<CommandSpec>((v) => ({
    path: [`open:${v.view}`],
    group: GROUP,
    summary: `Open ${v.label}`,
    keywords: `${v.label} ${v.keywords ?? ""} go to tab`,
    run: (_a, ctx) => ctx.nav(v.view),
  })),
];

export const NAV_LABELS: Record<string, string> = Object.fromEntries(
  VIEWS.map((v) => [`open:${v.view}`, v.label]),
);

export const NAV_VIEW_OF: Record<string, View> = Object.fromEntries(
  VIEWS.map((v) => [`open:${v.view}`, v.view]),
);
