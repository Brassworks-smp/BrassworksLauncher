import type {
  CommandContext,
  CommandSpec,
  CmdArg,
  RunArgs,
  Suggestion,
} from "./types";

export function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

export function stripSlash(input: string): string {
  return input.replace(/^\s*\//, "");
}

const positionalArgs = (spec: CommandSpec): CmdArg[] =>
  (spec.args ?? []).filter((a) => !a.flag);
const flagArgs = (spec: CommandSpec): CmdArg[] =>
  (spec.args ?? []).filter((a) => a.flag);

export function resolve(
  tokens: string[],
  registry: CommandSpec[],
): { spec: CommandSpec | null; pathLen: number } {
  let best: CommandSpec | null = null;
  let bestLen = 0;
  for (const spec of registry) {
    const p = spec.path;
    if (p.length > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].toLowerCase() !== tokens[i].toLowerCase()) {
        ok = false;
        break;
      }
    }
    if (ok && p.length > bestLen) {
      best = spec;
      bestLen = p.length;
    }
  }
  return { spec: best, pathLen: bestLen };
}

function splitRest(
  spec: CommandSpec,
  rest: string[],
): { positional: string[]; flags: Record<string, string | boolean> } {
  const flagDefs = flagArgs(spec);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith("--")) {
      const name = t.slice(2);
      const def = flagDefs.find((f) => f.name === name);
      if (def && def.type === "bool") {
        flags[name] = true;
      } else {
        flags[name] = rest[i + 1] ?? "";
        i++;
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}

function buildRunArgs(spec: CommandSpec, rest: string[]): RunArgs {
  const { positional, flags } = splitRest(spec, rest);
  const posDefs = positionalArgs(spec);
  const values: Record<string, string> = {};
  posDefs.forEach((def, idx) => {
    if (def.type === "rest") {
      const joined = positional.slice(idx).join(" ");
      if (joined) values[def.name] = joined;
    } else if (positional[idx] !== undefined) {
      values[def.name] = positional[idx];
    }
  });
  const lookup = (name: string): string | undefined => {
    if (name in values) return values[name];
    const f = flags[name];
    return typeof f === "string" ? f : undefined;
  };
  return {
    positional,
    flags,
    get: lookup,
    has: (name) => lookup(name) !== undefined || flags[name] === true,
    int: (name) => {
      const v = lookup(name);
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
    bool: (name) => {
      if (flags[name] === true) return true;
      const v = lookup(name);
      if (v === undefined) return undefined;
      return /^(1|true|yes|on)$/i.test(v);
    },
  };
}

export interface Parsed {
  spec: CommandSpec;
  args: RunArgs;
}

export function parse(
  input: string,
  registry: CommandSpec[],
): Parsed | { error: string } | null {
  const cmd = stripSlash(input).trim();
  if (!cmd) return null;
  const tokens = tokenize(cmd);
  const { spec, pathLen } = resolve(tokens, registry);
  if (!spec) return { error: `Unknown command: ${cmd}` };
  return { spec, args: buildRunArgs(spec, tokens.slice(pathLen)) };
}

export function missingArgs(parsed: Parsed): string | null {
  const posDefs = positionalArgs(parsed.spec);
  const missing = posDefs
    .filter((a) => a.required && parsed.args.get(a.name) === undefined)
    .map((a) => `<${a.name}>`);
  return missing.length ? `Missing: ${missing.join(" ")}` : null;
}

export interface Signature {
  path: string[];
  summary: string;
  args: { label: string; required: boolean; active: boolean }[];
}

export interface ActiveArgInfo {
  name: string;
  description?: string;
  required: boolean;
  isFlag: boolean;
}

export interface Completion {
  kind: "path" | "arg" | "none";
  signature: Signature | null;
  suggestions: Suggestion[];
  activeArg: ActiveArgInfo | null;
}

const filterPrefix = (s: Suggestion[], partial: string): Suggestion[] => {
  if (!partial) return s;
  const p = partial.toLowerCase();
  const starts = s.filter((x) => x.value.toLowerCase().startsWith(p));
  const contains = s.filter(
    (x) =>
      !x.value.toLowerCase().startsWith(p) &&
      (x.value.toLowerCase().includes(p) ||
        (x.label ?? "").toLowerCase().includes(p)),
  );
  return [...starts, ...contains];
};

export async function complete(
  input: string,
  registry: CommandSpec[],
  ctx: CommandContext,
): Promise<Completion> {
  const cmd = stripSlash(input);
  const endsSpace = /\s$/.test(cmd);
  const all = tokenize(cmd);
  const active = endsSpace ? "" : (all[all.length - 1] ?? "");
  const committed = endsSpace ? all : all.slice(0, -1);

  const { spec, pathLen } = resolve(committed, registry);

  if (!spec) {
    const depth = committed.length;
    const seen = new Set<string>();
    const sugg: Suggestion[] = [];
    for (const s of registry) {
      if (s.path.length <= depth) continue;
      let ok = true;
      for (let i = 0; i < depth; i++) {
        if (s.path[i].toLowerCase() !== committed[i].toLowerCase()) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const word = s.path[depth];
      if (word.includes(":")) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      const isLeaf = s.path.length === depth + 1;
      sugg.push({ value: word, hint: isLeaf ? s.summary : "›" });
    }
    return {
      kind: "path",
      signature: null,
      suggestions: filterPrefix(sugg, active),
      activeArg: null,
    };
  }

  const rest = committed.slice(pathLen);
  const { positional, flags } = splitRest(spec, rest);
  const posDefs = positionalArgs(spec);
  const args = buildRunArgs(spec, [...rest, ...(active ? [active] : [])]);

  const activeIsFlag = active.startsWith("--");
  let activeIndex = positional.length;
  const activeArg = activeIsFlag ? null : posDefs[activeIndex];

  const signature: Signature = {
    path: spec.path,
    summary: spec.summary,
    args: posDefs.map((a, i) => ({
      label: a.required ? `<${a.name}>` : `[${a.name}]`,
      required: !!a.required,
      active: !activeIsFlag && i === activeIndex,
    })),
  };

  let suggestions: Suggestion[] = [];
  if (activeIsFlag) {
    const partial = active.slice(2);
    suggestions = flagArgs(spec)
      .filter((f) => !(f.name in flags))
      .map((f) => ({ value: `--${f.name}`, hint: f.description }));
    suggestions = filterPrefix(suggestions, partial).map((s) => ({
      ...s,
      value: s.value,
    }));
  } else if (activeArg) {
    if (activeArg.enumValues) {
      const vals =
        typeof activeArg.enumValues === "function"
          ? activeArg.enumValues(ctx)
          : activeArg.enumValues;
      suggestions = vals.map((v) => ({ value: v }));
    } else if (activeArg.suggest) {
      try {
        suggestions = await activeArg.suggest(ctx, active, args);
      } catch {
        suggestions = [];
      }
    }
    suggestions = filterPrefix(suggestions, active);
  }

  const activeArgInfo: ActiveArgInfo | null = activeIsFlag
    ? { name: "flag", required: false, isFlag: true }
    : activeArg
      ? {
          name: activeArg.name,
          description: activeArg.description,
          required: !!activeArg.required,
          isFlag: false,
        }
      : null;

  return { kind: "arg", signature, suggestions, activeArg: activeArgInfo };
}

export function splitScript(input: string): string[] {
  return input
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runScript(
  input: string,
  registry: CommandSpec[],
  ctx: CommandContext,
): Promise<void> {
  const parts = splitScript(input);
  for (const part of parts) {
    const p = parse(part, registry);
    if (!p) continue;
    if ("error" in p) {
      ctx.toast(p.error, "error");
      break;
    }
    const missing = missingArgs(p);
    if (missing) {
      ctx.toast(`${p.spec.path.join(" ")} - ${missing}`, "error");
      break;
    }
    try {
      const res = await p.spec.run(p.args, ctx);
      if (res && res.ok === false) {
        ctx.toast(res.message, "error");
        break;
      }
      if (res && res.ok && res.message) ctx.toast(res.message, "success");
    } catch (e) {
      ctx.toast(String(e), "error");
      break;
    }
  }
}
