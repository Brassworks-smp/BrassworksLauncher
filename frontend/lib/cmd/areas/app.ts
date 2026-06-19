import type { CommandSpec, CommandContext } from "../types";

const GROUP = "Launcher";

export const appCommands: CommandSpec[] = [
  {
    path: ["app", "check-update"],
    group: GROUP,
    summary: "Check for a launcher update",
    keywords: "version upgrade",
    run: async (_a, ctx) => {
      const info = await ctx.api.checkForUpdate();
      return {
        ok: true,
        message: info.available
          ? `Update available: v${info.version} (run /app update)`
          : `Up to date (v${info.current_version}).`,
      };
    },
  },
  {
    path: ["app", "update"],
    group: GROUP,
    summary: "Download & install the latest update",
    keywords: "upgrade install",
    listable: false,
    run: async (_a, ctx) => {
      const info = await ctx.api.checkForUpdate();
      if (!info.available) return { ok: true, message: "Already up to date." };
      ctx.toast(`Downloading v${info.version}…`, "info");
      await ctx.api.installUpdate();
      return { ok: true, message: `Installed v${info.version}. Restart to apply.` };
    },
  },
  {
    path: ["app", "restart"],
    group: GROUP,
    summary: "Restart the launcher",
    keywords: "reload reboot",
    listable: false,
    run: async (_a, ctx) => {
      await ctx.api.restartApp();
    },
  },
  {
    path: ["app", "about"],
    group: GROUP,
    summary: "About Brassworks Launcher",
    keywords: "version credits info",
    run: (_a, ctx) => ctx.openModal("about"),
  },
  {
    path: ["app", "view-log"],
    group: GROUP,
    summary: "Open the log viewer",
    keywords: "console output crash logs",
    run: (_a, ctx) => ctx.openModal("log"),
  },
  {
    path: ["app", "upload-log"],
    group: GROUP,
    summary: "Upload the latest log to mclo.gs",
    keywords: "share paste crash",
    run: async (_a, ctx) => {
      const { instance } = ctx.state();
      if (!instance) return { ok: false, message: "No instance selected." };
      const up = await ctx.api.uploadLog(instance.id);
      await ctx.api.copyText(up.url);
      return { ok: true, message: `Log uploaded (link copied): ${up.url}` };
    },
  },
  {
    path: ["app", "install-cli"],
    group: GROUP,
    summary: "Install the `brassworks` command-line tool",
    keywords: "cli terminal shell command path",
    run: async (_a, ctx) => {
      const where = await ctx.api.installCli();
      return { ok: true, message: `CLI installed: ${where}` };
    },
  },
  {
    path: ["app", "version"],
    group: GROUP,
    summary: "Show the launcher version",
    keywords: "about build number release",
    run: async (_a, ctx) => {
      const v = await ctx.api.appVersion();
      return { ok: true, message: `Brassworks Launcher ${v}` };
    },
  },
];
