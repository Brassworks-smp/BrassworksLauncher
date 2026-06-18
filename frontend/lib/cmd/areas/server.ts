import type { CommandSpec, CommandContext, Suggestion } from "../types";
import { matchByName, quote } from "../resolve";

const GROUP = "Server";

function selected(ctx: CommandContext) {
  const { instance } = ctx.state();
  if (!instance) throw new Error("No instance selected.");
  return instance;
}

async function serverSuggestions(ctx: CommandContext): Promise<Suggestion[]> {
  const { instance } = ctx.state();
  if (!instance) return [];
  try {
    const servers = await ctx.api.listServers(instance.id);
    return servers.map((s) => ({
      value: quote(s.name),
      label: s.name,
      hint: s.ip,
    }));
  } catch {
    return [];
  }
}

const serverArg = {
  name: "server",
  type: "server" as const,
  required: true,
  description: "server name",
  suggest: (ctx: CommandContext) => serverSuggestions(ctx),
};

export const serverCommands: CommandSpec[] = [
  {
    path: ["server", "list"],
    group: GROUP,
    summary: "Show saved servers",
    keywords: "multiplayer ls browse",
    run: async (_a, ctx) => {
      const inst = selected(ctx);
      const servers = await ctx.api.listServers(inst.id);
      ctx.nav("servers");
      return {
        ok: true,
        message: `${servers.length} server${servers.length === 1 ? "" : "s"} in ${inst.name}`,
      };
    },
  },
  {
    path: ["server", "join"],
    group: GROUP,
    summary: "Launch & join a server",
    keywords: "connect play multiplayer",
    args: [serverArg],
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const servers = await ctx.api.listServers(inst.id);
      const s = matchByName(servers, args.get("server") ?? "", (x) => x.name);
      if (!s) return { ok: false, message: "No matching server." };
      await ctx.play(inst.id, { kind: "server", ip: s.ip });
      return { ok: true, message: `Joining ${s.name}…` };
    },
  },
  {
    path: ["server", "ping"],
    group: GROUP,
    summary: "Ping a server",
    keywords: "status online players",
    args: [serverArg],
    run: async (args, ctx) => {
      const inst = selected(ctx);
      const servers = await ctx.api.listServers(inst.id);
      const s = matchByName(servers, args.get("server") ?? "", (x) => x.name);
      if (!s) return { ok: false, message: "No matching server." };
      const status = await ctx.api.pingServer(s.ip);
      if (!status.online)
        return { ok: false, message: `${s.name} is offline.` };
      return {
        ok: true,
        message: `${s.name}: ${status.players_online}/${status.players_max} online · ${status.ping_ms}ms`,
      };
    },
  },
];
