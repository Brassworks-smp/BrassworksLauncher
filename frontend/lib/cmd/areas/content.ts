import type { CommandSpec, CommandContext, Suggestion } from "../types";
import type { InstalledMod } from "@/lib/types";
import { matchByName, quote } from "../resolve";

const GROUP = "Content";

function selected(ctx: CommandContext) {
  const { instance } = ctx.state();
  if (!instance) throw new Error("No instance selected.");
  return instance;
}

async function installedSuggestions(ctx: CommandContext): Promise<Suggestion[]> {
  const { instance } = ctx.state();
  if (!instance) return [];
  try {
    const mods = await ctx.api.listMods(instance.id);
    return mods.map((m) => ({
      value: quote(m.title || m.name),
      label: m.title || m.name,
      hint: m.enabled ? m.source : `${m.source} · off`,
    }));
  } catch {
    return [];
  }
}

const findMod = (mods: InstalledMod[], ref: string): InstalledMod | null =>
  matchByName(mods, ref, (m) => m.title || m.name) ??
  matchByName(mods, ref, (m) => m.filename);

const sourceFlag = {
  name: "source",
  type: "enum" as const,
  flag: true,
  description: "modrinth | curseforge",
  enumValues: ["modrinth", "curseforge"],
};

const nameArg = {
  name: "name",
  type: "string" as const,
  required: true,
  description: "installed mod name",
  suggest: (ctx: CommandContext) => installedSuggestions(ctx),
};

export const contentCommands: CommandSpec[] = [
  {
    path: ["content", "list"],
    group: GROUP,
    summary: "Show installed content",
    keywords: "mods ls installed browse",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      const mods = await ctx.api.listMods(inst.id);
      ctx.nav("mods");
      return { ok: true, message: `${mods.length} item(s) in ${inst.name}` };
    },
  },
  {
    path: ["content", "search"],
    group: GROUP,
    summary: "Search for mods",
    keywords: "find browse modrinth curseforge",
    args: [
      { name: "query", type: "rest", required: true, description: "search terms" },
      sourceFlag,
    ],
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const source = args.get("source") ?? "modrinth";
      const hits = await ctx.api.searchContent(
        inst.id,
        args.get("query") ?? "",
        "mod",
        source,
        0,
      );
      if (!hits.length) return { ok: true, message: "No results." };
      return {
        ok: true,
        message: hits
          .slice(0, 8)
          .map((h) => h.title)
          .join(", "),
      };
    },
  },
  {
    path: ["content", "install"],
    group: GROUP,
    summary: "Search & install the top match",
    keywords: "add mod modrinth curseforge",
    args: [
      { name: "query", type: "rest", required: true, description: "mod to install" },
      sourceFlag,
    ],
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const source = args.get("source") ?? "modrinth";
      const hits = await ctx.api.searchContent(
        inst.id,
        args.get("query") ?? "",
        "mod",
        source,
        0,
      );
      if (!hits.length) return { ok: false, message: "No matching mod." };
      const hit = hits[0];
      const res = await ctx.api.installContent(
        inst.id,
        hit.project_id,
        "mod",
        source,
      );
      const dep = res.dependencies.length
        ? ` (+${res.dependencies.length} deps)`
        : "";
      return { ok: true, message: `Installed ${hit.title}${dep}.` };
    },
  },
  {
    path: ["content", "remove"],
    group: GROUP,
    summary: "Remove installed content",
    keywords: "delete uninstall",
    args: [nameArg],
    listable: false,
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const mods = await ctx.api.listMods(inst.id);
      const mod = findMod(mods, args.get("name") ?? "");
      if (!mod) return { ok: false, message: `No content matching that name.` };
      if (mod.managed)
        return { ok: false, message: `${mod.name} is managed by the modpack.` };
      await ctx.api.removeContent(inst.id, mod.path);
      return { ok: true, message: `Removed ${mod.title || mod.name}.` };
    },
  },
  ...(["enable", "disable"] as const).map<CommandSpec>((verb) => ({
    path: ["content", verb],
    group: GROUP,
    summary: `${verb[0].toUpperCase()}${verb.slice(1)} a mod`,
    keywords: "toggle on off",
    args: [nameArg],
    listable: false,
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const mods = await ctx.api.listMods(inst.id);
      const mod = findMod(mods, args.get("name") ?? "");
      if (!mod) return { ok: false, message: `No content matching that name.` };
      await ctx.api.setContentEnabled(inst.id, mod.path, verb === "enable");
      return { ok: true, message: `${verb}d ${mod.title || mod.name}.` };
    },
  })),
  {
    path: ["content", "update-all"],
    group: GROUP,
    summary: "Update all added content",
    keywords: "upgrade latest bump",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      const updated = await ctx.api.updateAllContent(inst.id);
      return {
        ok: true,
        message: updated.length
          ? `Updated ${updated.length} item(s).`
          : "Everything up to date.",
      };
    },
  },
];
