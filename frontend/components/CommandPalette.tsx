import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft, Command as CommandIcon } from "lucide-react";
import { useClosable } from "./ui";
import { useT } from "@/lib/i18n";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: React.ReactNode;
  keywords?: string;
  hint?: string;
  run: () => void;
}

function score(query: string, text: string): number {
  const t = text.toLowerCase();
  let ti = 0;
  let s = 0;
  let prev = -1;
  for (const ch of query) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return -1;
    s += idx - ti;
    if (prev >= 0 && idx === prev + 1) s -= 1.6; 
    if (idx === 0 || /\s/.test(t[idx - 1])) s -= 1.2; 
    prev = idx;
    ti = idx + 1;
  }
  return s;
}


export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose, 140);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const slash = query.startsWith("/");
  const q = query.replace(/^\//, "").trim().toLowerCase();

  const results = useMemo(() => {
    const pool = slash
      ? commands.filter((c) => c.group !== "Navigate")
      : commands;
    if (!q) return pool;
    return pool
      .map((c) => ({
        c,
        s: score(q, `${c.label} ${c.keywords ?? ""} ${c.id}`),
      }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s)
      .map((r) => r.c);
  }, [commands, q, slash]);

  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${sel}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (c?: Command) => {
    if (!c) return;
    close();
    setTimeout(() => c.run(), 0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  let flat = -1;
  const groups: { name: string; items: { c: Command; idx: number }[] }[] = [];
  for (const c of results) {
    flat += 1;
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.items.push({ c, idx: flat });
    else groups.push({ name: c.group, items: [{ c, idx: flat }] });
  }

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-6 pt-[14vh] backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex max-h-[64vh] w-[600px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/40 bg-ink-900/95 shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2.5 border-b border-edge px-4">
          <Search size={16} className="shrink-0 text-ink-600" />
          {slash && (
            <span className="shrink-0 rounded bg-brass-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brass-300">
              {t("commandPalette.actions")}
            </span>
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("commandPalette.searchPlaceholder")}
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-ink-600"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 items-center gap-1 rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] text-ink-600 sm:flex">
            {IS_MAC ? <CommandIcon size={10} /> : "Ctrl"} K
          </kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-600">
              {t("commandPalette.noMatch", { query })}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="px-2 pb-1">
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
                  {g.name}
                </div>
                {g.items.map(({ c, idx }) => {
                  const active = idx === sel;
                  return (
                    <button
                      key={c.id}
                      data-idx={idx}
                      onMouseMove={() => setSel(idx)}
                      onClick={() => run(c)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-brass-500/15 text-brass-200"
                          : "text-gray-200 hover:bg-ink-800/60"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                          active ? "text-brass-300" : "text-ink-600"
                        }`}
                      >
                        {c.icon ?? <CommandIcon size={14} />}
                      </span>
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && (
                        <span className="shrink-0 truncate text-[11px] text-ink-600">
                          {c.hint}
                        </span>
                      )}
                      {active && (
                        <CornerDownLeft size={13} className="shrink-0 text-brass-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-edge px-4 py-2 text-[10px] text-ink-600">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("commandPalette.navigate")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t("commandPalette.select")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> {t("commandPalette.close")}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>/</Kbd> {t("commandPalette.actionsHint")}
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-edge bg-ink-850 px-1 py-0.5 font-mono text-[10px] text-ink-600">
      {children}
    </kbd>
  );
}
