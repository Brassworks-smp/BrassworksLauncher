import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CornerDownLeft,
  Command as CommandIcon,
  ChevronRight,
  Package,
  Globe2,
  Server,
  Shirt,
  LayoutGrid,
  Settings as SettingsIcon,
  Box,
  UserRound,
  Compass,
  Terminal,
  HelpCircle,
  Star,
} from "lucide-react";
import { useClosable } from "./ui";
import { useT } from "@/lib/i18n";
import {
  REGISTRY,
  cmdPath,
  cmdArgsLabel,
  hasRequiredArgs,
  complete,
  parse,
  missingArgs,
  type CommandSpec,
  type CommandContext,
  type Suggestion,
} from "@/lib/cmd/registry";
import { type Signature, type ActiveArgInfo } from "@/lib/cmd/parser";
import { runScript } from "@/lib/cmd/parser";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

const PINS_KEY = "bw.cmd.pins";
const loadPins = (): string[] => {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};
const savePins = (p: string[]) => {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(p));
  } catch {
    return;
  }
};

const GROUP_ICON: Record<string, React.ReactNode> = {
  Navigate: <Compass size={14} />,
  Instance: <LayoutGrid size={14} />,
  Content: <Package size={14} />,
  Modpack: <Box size={14} />,
  World: <Globe2 size={14} />,
  Server: <Server size={14} />,
  Skin: <Shirt size={14} />,
  Account: <UserRound size={14} />,
  Settings: <SettingsIcon size={14} />,
  Launcher: <Terminal size={14} />,
  Help: <HelpCircle size={14} />,
  Pinned: <Star size={14} />,
};
const groupIcon = (g: string) => GROUP_ICON[g] ?? <CommandIcon size={14} />;

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

function applySuggestion(body: string, value: string): string {
  if (body === "" || /\s$/.test(body)) return `${body}${value} `;
  const start = body.search(/\S+$/);
  return `${body.slice(0, start < 0 ? body.length : start)}${value} `;
}

function isRunnable(query: string): boolean {
  const p = parse(query, REGISTRY);
  return !!p && !("error" in p) && !missingArgs(p);
}

const BROWSE_POOL = REGISTRY.filter(
  (c) => !(c.path.length === 1 && c.path[0] === "go"),
);

interface Row {
  c: CommandSpec;
  group: string;
  idx: number;
}

export function CommandPalette({
  ctx,
  onClose,
}: {
  ctx: CommandContext;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose, 140);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [pins, setPins] = useState<string[]>(loadPins);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const compose = query.startsWith("/");
  const body = compose ? query.slice(1) : query;
  const helpMatch = compose ? /^help(\s+(.*))?$/i.exec(body) : null;
  const helpMode = !!helpMatch;
  const browseMode = !compose || helpMode;
  const browseFilter = helpMode ? (helpMatch?.[2] ?? "") : compose ? "" : query;

  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [activeArg, setActiveArg] = useState<ActiveArgInfo | null>(null);
  useEffect(() => {
    if (!compose || helpMode) {
      setSugg([]);
      setSignature(null);
      setActiveArg(null);
      return;
    }
    let alive = true;
    complete(query, REGISTRY, ctx)
      .then((c) => {
        if (!alive) return;
        setSugg(c.suggestions);
        setSignature(c.signature);
        setActiveArg(c.activeArg);
      })
      .catch(() => {
        if (alive) {
          setSugg([]);
          setSignature(null);
          setActiveArg(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [query, compose, helpMode, ctx]);

  const browseRows = useMemo<Row[]>(() => {
    const q = browseFilter.trim().toLowerCase();
    let list = BROWSE_POOL;
    if (q) {
      list = BROWSE_POOL.map((c) => ({
        c,
        s: score(q, `${c.summary} ${c.keywords ?? ""} ${c.path.join(" ")}`),
      }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => a.s - b.s)
        .map((r) => r.c);
    }
    const showPinned = !q && pins.length > 0;
    const rows: Row[] = [];
    let i = 0;
    if (showPinned) {
      const pinned = pins
        .map((p) => list.find((c) => cmdPath(c) === p))
        .filter((c): c is CommandSpec => !!c);
      for (const c of pinned) rows.push({ c, group: "Pinned", idx: i++ });
      for (const c of list)
        if (!pins.includes(cmdPath(c)))
          rows.push({ c, group: c.group, idx: i++ });
    } else {
      for (const c of list) rows.push({ c, group: c.group, idx: i++ });
    }
    return rows;
  }, [browseFilter, pins]);

  const runnable = compose && !helpMode && isRunnable(query);
  const rowCount = browseMode ? browseRows.length : sugg.length;

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const togglePin = (path: string) => {
    setPins((p) => {
      const next = p.includes(path) ? p.filter((x) => x !== path) : [...p, path];
      savePins(next);
      return next;
    });
  };

  const pickBrowse = (c?: CommandSpec) => {
    if (!c) return;
    if (hasRequiredArgs(c)) {
      setQuery(`${cmdPath(c)} `);
      inputRef.current?.focus();
      return;
    }
    close();
    setTimeout(() => void runScript(cmdPath(c), REGISTRY, ctx), 0);
  };

  const exec = () => {
    const q = query;
    close();
    setTimeout(() => void runScript(q, REGISTRY, ctx), 0);
  };

  const accept = (s?: Suggestion) => {
    const pick = s ?? sugg[sel];
    if (!pick) return;
    setQuery((q) => `/${applySuggestion(q.slice(1), pick.value)}`);
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (rowCount ? (s + 1) % rowCount : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (rowCount ? (s - 1 + rowCount) % rowCount : 0));
    } else if (e.key === "Tab" || (e.key === "ArrowRight" && compose && !helpMode)) {
      if (compose && !helpMode && sugg.length) {
        e.preventDefault();
        accept();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (browseMode) {
        pickBrowse(browseRows[sel]?.c);
      } else if (runnable || query.includes(";")) {
        exec();
      } else {
        accept();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const sections: { name: string; items: Row[] }[] = [];
  for (const r of browseRows) {
    const last = sections[sections.length - 1];
    if (last && last.name === r.group) last.items.push(r);
    else sections.push({ name: r.group, items: [r] });
  }

  const showSuggest = compose && !helpMode;

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
          {compose && (
            <span className="shrink-0 rounded bg-brass-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brass-300">
              {helpMode ? "help" : t("commandPalette.actions")}
            </span>
          )}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("commandPalette.searchPlaceholder")}
            className="flex-1 bg-transparent py-3.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-600"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <kbd className="hidden shrink-0 items-center gap-1 rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] text-ink-600 sm:flex">
            {IS_MAC ? <CommandIcon size={10} /> : "Ctrl"} K
          </kbd>
        </div>

        {showSuggest && signature && (
          <div className="border-b border-edge bg-ink-850/50 px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
              <span className="text-brass-300">/{signature.path.join(" ")}</span>
              {signature.args.map((a, i) => (
                <span
                  key={i}
                  className={
                    a.active
                      ? "rounded bg-brass-500/20 px-1 text-brass-200"
                      : "text-ink-600"
                  }
                >
                  {a.label}
                </span>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-ink-600">
              {activeArg && !activeArg.isFlag ? (
                <span>
                  <span className="text-brass-300">{activeArg.name}</span>
                  {activeArg.required ? " (required)" : " (optional)"}
                  {activeArg.description ? ` - ${activeArg.description}` : ""}
                </span>
              ) : (
                signature.summary
              )}
            </div>
          </div>
        )}

        <div ref={listRef} className="flex-1 overflow-y-auto py-2">
          {showSuggest ? (
            sugg.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-ink-600">
                {runnable ? (
                  <span className="flex items-center justify-center gap-1.5 text-brass-300">
                    <CornerDownLeft size={13} /> Press Enter to run
                  </span>
                ) : (
                  t("commandPalette.noMatch", { query })
                )}
              </div>
            ) : (
              <div className="px-2">
                {sugg.map((s, idx) => {
                  const active = idx === sel;
                  return (
                    <button
                      key={`${s.value}-${idx}`}
                      data-idx={idx}
                      onMouseMove={() => setSel(idx)}
                      onClick={() => accept(s)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-brass-500/15 text-brass-200"
                          : "text-gray-200 hover:bg-ink-800/60"
                      }`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center text-ink-600">
                        <ChevronRight size={14} />
                      </span>
                      <span className="flex-1 truncate font-mono">
                        {s.label ?? s.value}
                      </span>
                      {s.hint && (
                        <span className="shrink-0 truncate text-[11px] text-ink-600">
                          {s.hint}
                        </span>
                      )}
                      {active && (
                        <kbd className="shrink-0 rounded border border-edge px-1 font-mono text-[10px] text-ink-600">
                          tab
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          ) : browseRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-600">
              {t("commandPalette.noMatch", { query })}
            </div>
          ) : (
            sections.map((g) => (
              <div key={g.name} className="px-2 pb-1">
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
                  {g.name}
                </div>
                {g.items.map(({ c, idx }) => {
                  const active = idx === sel;
                  const path = cmdPath(c);
                  const pinned = pins.includes(path);
                  const argsLabel = cmdArgsLabel(c);
                  return (
                    <div
                      key={path}
                      data-idx={idx}
                      onMouseMove={() => setSel(idx)}
                      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-brass-500/15 text-brass-200"
                          : "text-gray-200 hover:bg-ink-800/60"
                      }`}
                    >
                      <button
                        onClick={() => pickBrowse(c)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                            active ? "text-brass-300" : "text-ink-600"
                          }`}
                        >
                          {groupIcon(c.group)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{c.summary}</span>
                        <span className="shrink-0 truncate font-mono text-[11px] text-ink-600">
                          {path}
                          {argsLabel && (
                            <span className="text-brass-400/70"> {argsLabel}</span>
                          )}
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePin(path);
                        }}
                        title={pinned ? "Unpin" : "Pin"}
                        className={`shrink-0 rounded p-0.5 transition ${
                          pinned
                            ? "text-brass-300"
                            : "text-ink-600 opacity-0 hover:text-brass-300 group-hover:opacity-100"
                        }`}
                      >
                        <Star size={13} className={pinned ? "fill-current" : ""} />
                      </button>
                    </div>
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
          {showSuggest ? (
            <>
              <span className="flex items-center gap-1">
                <Kbd>tab</Kbd> complete
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> run
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> {t("commandPalette.select")}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Star size={9} /> pin
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
