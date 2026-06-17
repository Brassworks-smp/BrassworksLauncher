import type { ReactNode } from "react";
import type * as api from "@/lib/api";
import type { QuickPlay } from "@/lib/api";
import type { View } from "@/components/Sidebar";
import type { toast as toastFn } from "@/lib/toast";
import type { Instance, LauncherSettings, AccountStore } from "@/lib/types";

export interface Suggestion {
  value: string;
  label?: string;
  hint?: string;
}

export type ArgType =
  | "string"
  | "int"
  | "bool"
  | "enum"
  | "rest"
  | "instance"
  | "world"
  | "server"
  | "skin"
  | "account"
  | "settingKey";

export interface CmdArg {
  name: string;
  type: ArgType;
  required?: boolean;
  description?: string;
  flag?: boolean;
  enumValues?: string[] | ((ctx: CommandContext) => string[]);
  suggest?: (
    ctx: CommandContext,
    partial: string,
    args: RunArgs,
  ) => Suggestion[] | Promise<Suggestion[]>;
}

export interface RunArgs {
  get(name: string): string | undefined;
  int(name: string): number | undefined;
  bool(name: string): boolean | undefined;
  has(name: string): boolean;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export type CmdResult =
  | { ok: true; message?: string }
  | { ok: false; message: string }
  | void;

export interface CommandSpec {
  path: string[];
  group: string;
  summary: string;
  keywords?: string;
  icon?: ReactNode;
  args?: CmdArg[];
  listable?: boolean;
  run: (args: RunArgs, ctx: CommandContext) => CmdResult | Promise<CmdResult>;
}

export interface CmdState {
  instances: Instance[];
  selectedId: string | null;
  instance: Instance | null;
  settings: LauncherSettings | null;
  accounts: AccountStore;
  runningIds: Set<string>;
  skinsAvailable: boolean;
  featuredEnabled: boolean;
}

export type ModalName = "add-instance" | "about" | "log" | "ms-login";

export interface CommandContext {
  api: typeof api;
  toast: typeof toastFn;
  state: () => CmdState;
  nav: (v: View) => void;
  selectInstance: (id: string) => Promise<void>;
  play: (id?: string, qp?: QuickPlay) => Promise<void> | void;
  stop: () => void;
  applySettings: (patch: Partial<LauncherSettings>) => void;
  saveInstance: (i: Instance) => void;
  refreshInstances: () => Promise<Instance[]>;
  openModal: (m: ModalName) => void;
  startMsLogin: () => void;
}
