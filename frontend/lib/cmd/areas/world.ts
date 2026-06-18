import type { CommandSpec, CommandContext, Suggestion } from "../types";
import { matchByName, quote } from "../resolve";

const GROUP = "World";

function selected(ctx: CommandContext) {
  const { instance } = ctx.state();
  if (!instance) throw new Error("No instance selected.");
  return instance;
}

async function worldSuggestions(ctx: CommandContext): Promise<Suggestion[]> {
  const { instance } = ctx.state();
  if (!instance) return [];
  try {
    const worlds = await ctx.api.listWorlds(instance.id);
    return worlds.map((w) => ({
      value: quote(w.name),
      label: w.name,
      hint: w.folder,
    }));
  } catch {
    return [];
  }
}

const worldArg = {
  name: "world",
  type: "world" as const,
  required: true,
  description: "world name",
  suggest: (ctx: CommandContext) => worldSuggestions(ctx),
};

export const worldCommands: CommandSpec[] = [
  {
    path: ["world", "list"],
    group: GROUP,
    summary: "Show singleplayer worlds",
    keywords: "saves ls browse",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      const worlds = await ctx.api.listWorlds(inst.id);
      ctx.nav("worlds");
      return {
        ok: true,
        message: `${worlds.length} world${worlds.length === 1 ? "" : "s"} in ${inst.name}`,
      };
    },
  },
  {
    path: ["world", "play"],
    group: GROUP,
    summary: "Launch directly into a world",
    keywords: "open join singleplayer",
    args: [worldArg],
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const worlds = await ctx.api.listWorlds(inst.id);
      const w = matchByName(worlds, args.get("world") ?? "", (x) => x.name);
      if (!w) return { ok: false, message: "No matching world." };
      await ctx.play(inst.id, { kind: "world", folder: w.folder });
      return { ok: true, message: `Launching into ${w.name}…` };
    },
  },
  {
    path: ["world", "backup"],
    group: GROUP,
    summary: "Back up a world",
    keywords: "save copy zip archive",
    args: [worldArg],
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const worlds = await ctx.api.listWorlds(inst.id);
      const w = matchByName(worlds, args.get("world") ?? "", (x) => x.name);
      if (!w) return { ok: false, message: "No matching world." };
      const path = await ctx.api.backupWorld(inst.id, w.folder);
      return { ok: true, message: `Backed up ${w.name} → ${path}` };
    },
  },
  {
    path: ["world", "delete"],
    group: GROUP,
    summary: "Delete a world",
    keywords: "remove destroy",
    args: [worldArg],
    listable: false,
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const worlds = await ctx.api.listWorlds(inst.id);
      const w = matchByName(worlds, args.get("world") ?? "", (x) => x.name);
      if (!w) return { ok: false, message: "No matching world." };
      await ctx.api.deleteWorld(inst.id, w.folder);
      return { ok: true, message: `Deleted ${w.name}.` };
    },
  },
];
