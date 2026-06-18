import type { CommandSpec } from "../types";

const GROUP = "Help";

export const helpCommands: CommandSpec[] = [
  {
    path: ["help"],
    group: GROUP,
    summary: "Browse every command",
    keywords: "commands usage cheatsheet list ? what can you do",
    args: [
      {
        name: "area",
        type: "string",
        description: "optional: filter by area or keyword",
      },
    ],
    run: () => ({
      ok: true,
      message: "Type / to browse commands · Tab to complete · Enter to run",
    }),
  },
];
