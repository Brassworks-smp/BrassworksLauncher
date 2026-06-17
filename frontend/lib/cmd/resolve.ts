import type { CommandContext, Suggestion } from "./types";
import type { Instance } from "@/lib/types";

const norm = (s: string) => s.trim().toLowerCase();

export function resolveInstance(ctx: CommandContext, ref?: string): Instance {
  const { instances, selectedId, instance } = ctx.state();
  if (!ref) {
    if (instance) return instance;
    throw new Error("No instance selected - pass an instance name.");
  }
  const r = norm(ref);
  const byId = instances.find((i) => i.id.toLowerCase() === r);
  if (byId) return byId;
  const exact = instances.find((i) => norm(i.name) === r);
  if (exact) return exact;
  const prefix = instances.filter((i) => norm(i.name).startsWith(r));
  if (prefix.length === 1) return prefix[0];
  const sub = instances.filter((i) => norm(i.name).includes(r));
  if (sub.length === 1) return sub[0];
  if (prefix.length > 1 || sub.length > 1)
    throw new Error(`Ambiguous instance "${ref}" - be more specific.`);
  if (selectedId) {
    const sel = instances.find((i) => i.id === selectedId);
    if (sel) return sel;
  }
  throw new Error(`No instance matching "${ref}".`);
}

export function instanceSuggestions(ctx: CommandContext): Suggestion[] {
  const { instances, featuredEnabled } = ctx.state();
  return instances
    .filter((i) => featuredEnabled || !i.featured)
    .map((i) => ({
      value: i.name.includes(" ") ? `"${i.name}"` : i.name,
      label: i.name,
      hint: i.id,
    }));
}

export function matchByName<T>(
  items: T[],
  ref: string,
  nameOf: (t: T) => string,
): T | null {
  const r = norm(ref);
  return (
    items.find((t) => norm(nameOf(t)) === r) ??
    items.find((t) => norm(nameOf(t)).startsWith(r)) ??
    items.find((t) => norm(nameOf(t)).includes(r)) ??
    null
  );
}

export function activeAccount(ctx: CommandContext) {
  const { accounts } = ctx.state();
  return (
    accounts.accounts.find((a) => a.id === accounts.selected) ??
    accounts.accounts[0] ??
    null
  );
}

export const quote = (s: string): string => (s.includes(" ") ? `"${s}"` : s);
