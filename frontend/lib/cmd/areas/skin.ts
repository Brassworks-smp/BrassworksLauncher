import type { CommandSpec, CommandContext, Suggestion } from "../types";
import { activeAccount, matchByName, quote } from "../resolve";

const GROUP = "Skin";

function msAccount(ctx: CommandContext) {
  const acc = activeAccount(ctx);
  if (!acc) throw new Error("No account signed in.");
  if (acc.kind !== "microsoft")
    throw new Error("Skins require a Microsoft account.");
  return acc;
}

async function skinSuggestions(ctx: CommandContext): Promise<Suggestion[]> {
  const acc = activeAccount(ctx);
  if (!acc || acc.kind !== "microsoft") return [];
  try {
    const lib = await ctx.api.listSkins(acc.id);
    return lib.skins.map((s) => ({
      value: quote(s.name),
      label: s.name,
      hint: s.id === lib.selected ? "active" : s.model,
    }));
  } catch {
    return [];
  }
}

const skinArg = {
  name: "skin",
  type: "skin" as const,
  required: true,
  description: "saved skin name",
  suggest: (ctx: CommandContext) => skinSuggestions(ctx),
};

export const skinCommands: CommandSpec[] = [
  {
    path: ["skin", "list"],
    group: GROUP,
    summary: "Show saved skins",
    keywords: "appearance presets ls browse",
    run: async (_a, ctx) => {
      const acc = msAccount(ctx);
      const lib = await ctx.api.listSkins(acc.id);
      ctx.nav("skin");
      return {
        ok: true,
        message: `${lib.skins.length} saved skin${lib.skins.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    path: ["skin", "apply"],
    group: GROUP,
    summary: "Apply a saved skin",
    keywords: "wear use set equip",
    args: [skinArg],
    run: async (args, ctx) => {
      const acc = msAccount(ctx);
      const lib = await ctx.api.listSkins(acc.id);
      const s = matchByName(lib.skins, args.get("skin") ?? "", (x) => x.name);
      if (!s) return { ok: false, message: "No matching skin." };
      await ctx.api.applySavedSkin(acc.id, s.id);
      return { ok: true, message: `Applied ${s.name}.` };
    },
  },
  {
    path: ["skin", "delete"],
    group: GROUP,
    summary: "Delete a saved skin",
    keywords: "remove",
    args: [skinArg],
    listable: false,
    run: async (args, ctx) => {
      const acc = msAccount(ctx);
      const lib = await ctx.api.listSkins(acc.id);
      const s = matchByName(lib.skins, args.get("skin") ?? "", (x) => x.name);
      if (!s) return { ok: false, message: "No matching skin." };
      await ctx.api.deleteSkin(acc.id, s.id);
      return { ok: true, message: `Deleted ${s.name}.` };
    },
  },
  {
    path: ["skin", "cape"],
    group: GROUP,
    summary: "Equip a cape (or 'none')",
    keywords: "cloak back",
    args: [
      {
        name: "cape",
        type: "string",
        required: true,
        description: "cape name or 'none'",
        suggest: async (ctx: CommandContext) => {
          const acc = activeAccount(ctx);
          if (!acc || acc.kind !== "microsoft") return [];
          try {
            const p = await ctx.api.skinProfile(acc.id);
            return [
              { value: "none" },
              ...p.capes.map((c) => ({ value: quote(c.name), label: c.name })),
            ];
          } catch {
            return [];
          }
        },
      },
    ],
    run: async (args, ctx) => {
      const acc = msAccount(ctx);
      const ref = args.get("cape") ?? "";
      if (ref.toLowerCase() === "none") {
        await ctx.api.setCape(acc.id, null);
        return { ok: true, message: "Cape removed." };
      }
      const p = await ctx.api.skinProfile(acc.id);
      const cape = matchByName(p.capes, ref, (c) => c.name);
      if (!cape) return { ok: false, message: "No matching cape." };
      await ctx.api.setCape(acc.id, cape.id);
      return { ok: true, message: `Equipped ${cape.name}.` };
    },
  },
];
