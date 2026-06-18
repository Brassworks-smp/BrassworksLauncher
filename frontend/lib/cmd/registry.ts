import type { CommandSpec } from "./types";
import { navCommands } from "./areas/nav";
import { instanceCommands } from "./areas/instance";
import { contentCommands } from "./areas/content";
import { modpackCommands } from "./areas/modpack";
import { worldCommands } from "./areas/world";
import { serverCommands } from "./areas/server";
import { skinCommands } from "./areas/skin";
import { accountCommands } from "./areas/account";
import { settingsCommands } from "./areas/settings";
import { appCommands } from "./areas/app";
import { helpCommands } from "./areas/help";

export const REGISTRY: CommandSpec[] = [
  ...navCommands,
  ...instanceCommands,
  ...contentCommands,
  ...modpackCommands,
  ...worldCommands,
  ...serverCommands,
  ...skinCommands,
  ...accountCommands,
  ...settingsCommands,
  ...appCommands,
  ...helpCommands,
];

export const cmdPath = (spec: CommandSpec): string =>
  `/${spec.path.join(" ")}`;

export const isListable = (spec: CommandSpec): boolean => {
  if (spec.listable !== undefined) return spec.listable;
  const required = (spec.args ?? []).filter((a) => a.required && !a.flag);
  return required.length === 0;
};

export const hasRequiredArgs = (spec: CommandSpec): boolean =>
  (spec.args ?? []).some((a) => a.required && !a.flag);

export const cmdArgsLabel = (spec: CommandSpec): string =>
  (spec.args ?? [])
    .filter((a) => !a.flag)
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    .join(" ");

export type { CommandSpec, CommandContext, Suggestion } from "./types";
export {
  parse,
  complete,
  runScript,
  missingArgs,
  tokenize,
  stripSlash,
} from "./parser";
