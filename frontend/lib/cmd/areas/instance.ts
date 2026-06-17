import type { CommandSpec, RunArgs, CommandContext } from "../types";
import type { Instance } from "@/lib/types";
import type { QuickPlay } from "@/lib/api";
import { resolveInstance, instanceSuggestions, matchByName } from "../resolve";

const GROUP = "Instance";

const instanceArg = {
  name: "instance",
  type: "instance" as const,
  required: true,
  description: "instance name or id",
  suggest: (ctx: CommandContext) => instanceSuggestions(ctx),
};

const SET_KEYS: Record<
  string,
  { apply: (v: string, i: Instance) => Partial<Instance> | string }
> = {
  name: { apply: (v) => (v ? { name: v } : "name cannot be empty") },
  "max-memory": {
    apply: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? { max_memory_mb: n } : "expected MB";
    },
  },
  "min-memory": {
    apply: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? { min_memory_mb: n } : "expected MB";
    },
  },
  "java-path": { apply: (v) => ({ java_path: v || null }) },
  "java-policy": {
    apply: (v) =>
      ["auto", "system", "custom"].includes(v)
        ? { java_policy: v }
        : "expected auto|system|custom",
  },
  resolution: {
    apply: (v) => {
      const m = v.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      return m
        ? { resolution: [Number(m[1]), Number(m[2])] as [number, number] }
        : "expected WIDTHxHEIGHT";
    },
  },
  "jvm-args": { apply: (v) => ({ extra_jvm_args: v ? v.split(/\s+/) : [] }) },
  notes: { apply: (v) => ({ notes: v || null }) },
};

async function quickPlayFor(
  ctx: CommandContext,
  inst: Instance,
  args: RunArgs,
): Promise<QuickPlay | undefined> {
  const serverRef = args.get("server");
  const worldRef = args.get("world");
  if (serverRef) {
    const servers = await ctx.api.listServers(inst.id);
    const s = matchByName(servers, serverRef, (x) => x.name);
    if (!s) throw new Error(`No server "${serverRef}" in ${inst.name}.`);
    return { kind: "server", ip: s.ip };
  }
  if (worldRef) {
    const worlds = await ctx.api.listWorlds(inst.id);
    const w = matchByName(worlds, worldRef, (x) => x.name);
    if (!w) throw new Error(`No world "${worldRef}" in ${inst.name}.`);
    return { kind: "world", folder: w.folder };
  }
  return undefined;
}

export const instanceCommands: CommandSpec[] = [
  {
    path: ["instance", "list"],
    group: GROUP,
    summary: "Show all instances",
    keywords: "instances packs ls browse",
    run: (_a, ctx) => {
      const { instances } = ctx.state();
      ctx.nav("instances");
      return {
        ok: true,
        message: `${instances.length} instance${instances.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    path: ["instance", "launch"],
    group: GROUP,
    summary: "Launch an instance (optionally into a world/server)",
    keywords: "play start run boot",
    args: [
      instanceArg,
      {
        name: "world",
        type: "world",
        flag: true,
        description: "join a singleplayer world",
      },
      {
        name: "server",
        type: "server",
        flag: true,
        description: "join a server",
      },
    ],
    run: async (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      const qp = await quickPlayFor(ctx, inst, args);
      await ctx.play(inst.id, qp);
      return { ok: true, message: `Launching ${inst.name}…` };
    },
  },
  {
    path: ["instance", "stop"],
    group: GROUP,
    summary: "Stop a running instance",
    keywords: "kill quit close",
    args: [instanceArg],
    run: async (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      const { runningIds } = ctx.state();
      if (!runningIds.has(inst.id))
        return { ok: false, message: `${inst.name} isn't running.` };
      await ctx.selectInstance(inst.id);
      ctx.stop();
      return { ok: true, message: `Stopping ${inst.name}…` };
    },
  },
  {
    path: ["instance", "select"],
    group: GROUP,
    summary: "Switch to an instance",
    keywords: "switch use active",
    args: [instanceArg],
    run: async (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      await ctx.selectInstance(inst.id);
      ctx.nav("play");
      return { ok: true, message: `Switched to ${inst.name}.` };
    },
  },
  {
    path: ["instance", "create"],
    group: GROUP,
    summary: "Add a new instance",
    keywords: "new add modpack import",
    run: (_a, ctx) => ctx.openModal("add-instance"),
  },
  {
    path: ["instance", "delete"],
    group: GROUP,
    summary: "Delete an instance",
    keywords: "remove destroy",
    args: [instanceArg],
    listable: false,
    run: async (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      await ctx.api.deleteInstance(inst.id);
      await ctx.refreshInstances();
      return { ok: true, message: `Deleted ${inst.name}.` };
    },
  },
  {
    path: ["instance", "open"],
    group: GROUP,
    summary: "Open an instance's game folder",
    keywords: "folder files explorer finder directory",
    args: [instanceArg],
    run: async (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      await ctx.api.openDir(inst.id);
    },
  },
  {
    path: ["instance", "info"],
    group: GROUP,
    summary: "Show instance details",
    keywords: "details about version",
    args: [instanceArg],
    run: (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      const mem = inst.max_memory_mb ? `${inst.max_memory_mb}MB` : "default";
      return {
        ok: true,
        message: `${inst.name} - ${inst.loader} ${inst.minecraft_version}, RAM ${mem}, ${inst.modpack_locked ? "locked" : "unlocked"}`,
      };
    },
  },
  {
    path: ["instance", "set"],
    group: GROUP,
    summary: "Change an instance setting",
    keywords: "config memory ram java resolution rename notes",
    args: [
      instanceArg,
      {
        name: "key",
        type: "enum",
        required: true,
        description: "setting to change",
        enumValues: Object.keys(SET_KEYS),
      },
      { name: "value", type: "rest", required: true, description: "new value" },
    ],
    listable: false,
    run: (args, ctx) => {
      const inst = resolveInstance(ctx, args.get("instance"));
      const key = args.get("key") ?? "";
      const def = SET_KEYS[key];
      if (!def)
        return {
          ok: false,
          message: `Unknown key "${key}". Options: ${Object.keys(SET_KEYS).join(", ")}`,
        };
      const out = def.apply(args.get("value") ?? "", inst);
      if (typeof out === "string") return { ok: false, message: out };
      ctx.saveInstance({ ...inst, ...out });
      return { ok: true, message: `${inst.name}: set ${key}.` };
    },
  },
];
