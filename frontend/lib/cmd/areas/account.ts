import type { CommandSpec, CommandContext, Suggestion } from "../types";
import { matchByName, quote } from "../resolve";

const GROUP = "Account";

function accountSuggestions(ctx: CommandContext): Suggestion[] {
  const { accounts } = ctx.state();
  return accounts.accounts.map((a) => ({
    value: quote(a.username),
    label: a.username,
    hint: a.id === accounts.selected ? "active" : a.kind,
  }));
}

const accountArg = {
  name: "account",
  type: "account" as const,
  required: true,
  description: "account username",
  suggest: (ctx: CommandContext) => accountSuggestions(ctx),
};

export const accountCommands: CommandSpec[] = [
  {
    path: ["account", "list"],
    group: GROUP,
    summary: "List accounts",
    keywords: "profiles users ls",
    run: (_a, ctx) => {
      const { accounts } = ctx.state();
      return {
        ok: true,
        message: accounts.accounts.length
          ? accounts.accounts
              .map((a) =>
                a.id === accounts.selected ? `${a.username} *` : a.username,
              )
              .join(", ")
          : "No accounts.",
      };
    },
  },
  {
    path: ["account", "select"],
    group: GROUP,
    summary: "Switch active account",
    keywords: "use switch active",
    args: [accountArg],
    run: async (args, ctx) => {
      const { accounts } = ctx.state();
      const a = matchByName(accounts.accounts, args.get("account") ?? "", (x) => x.username);
      if (!a) return { ok: false, message: "No matching account." };
      await ctx.api.selectAccount(a.id);
      return { ok: true, message: `Now playing as ${a.username}.` };
    },
  },
  {
    path: ["account", "login"],
    group: GROUP,
    summary: "Sign in with Microsoft",
    keywords: "add microsoft msa signin",
    run: (_a, ctx) => {
      ctx.startMsLogin();
    },
  },
  {
    path: ["account", "remove"],
    group: GROUP,
    summary: "Remove an account",
    keywords: "delete signout logout",
    args: [accountArg],
    listable: false,
    run: async (args, ctx) => {
      const { accounts } = ctx.state();
      const a = matchByName(accounts.accounts, args.get("account") ?? "", (x) => x.username);
      if (!a) return { ok: false, message: "No matching account." };
      await ctx.api.removeAccount(a.id);
      return { ok: true, message: `Removed ${a.username}.` };
    },
  },
];
