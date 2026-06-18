import type { CommandSpec, CommandContext } from "../types";

const GROUP = "Modpack";

function selected(ctx: CommandContext) {
  const { instance } = ctx.state();
  if (!instance) throw new Error("No instance selected.");
  if (instance.pack.kind === "none")
    throw new Error(`${instance.name} is not a modpack instance.`);
  return instance;
}

export const modpackCommands: CommandSpec[] = [
  {
    path: ["modpack", "status"],
    group: GROUP,
    summary: "Show modpack status",
    keywords: "version update check",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      const s = await ctx.api.modpackStatus(inst.id);
      return {
        ok: true,
        message: `${s.name}: ${s.installed_version ?? "not installed"} → ${s.latest_version}${s.update_available ? " (update available)" : ""}`,
      };
    },
  },
  {
    path: ["modpack", "sync"],
    group: GROUP,
    summary: "Sync / update the modpack",
    keywords: "update download apply",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      await ctx.api.syncModpack(inst.id);
      return { ok: true, message: `Syncing ${inst.name}…` };
    },
  },
  {
    path: ["modpack", "repair"],
    group: GROUP,
    summary: "Repair the modpack files",
    keywords: "fix verify rehash",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      await ctx.api.repairModpack(inst.id);
      return { ok: true, message: `Repairing ${inst.name}…` };
    },
  },
  {
    path: ["modpack", "reinstall"],
    group: GROUP,
    summary: "Reinstall the modpack from scratch",
    keywords: "clean fresh",
    listable: false,
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      await ctx.api.reinstallModpack(inst.id);
      return { ok: true, message: `Reinstalling ${inst.name}…` };
    },
  },
  ...(["lock", "unlock"] as const).map<CommandSpec>((verb) => ({
    path: ["modpack", verb],
    group: GROUP,
    summary: `${verb[0].toUpperCase()}${verb.slice(1)} the modpack`,
    keywords: "managed auto-update protect",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      await ctx.api.setModpackLocked(inst.id, verb === "lock");
      await ctx.refreshInstances();
      return { ok: true, message: `Modpack ${verb}ed.` };
    },
  })),
  {
    path: ["modpack", "export"],
    group: GROUP,
    summary: "Export the modpack to Downloads",
    keywords: "share mrpack curseforge zip",
    args: [
      {
        name: "format",
        type: "enum",
        required: true,
        description: "modrinth | curseforge",
        enumValues: ["modrinth", "curseforge"],
      },
    ],
    listable: false,
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const fmt = (args.get("format") ?? "modrinth") as "modrinth" | "curseforge";
      const path = await ctx.api.exportModpack(inst.id, fmt);
      return { ok: true, message: `Exported to ${path}` };
    },
  },
];
