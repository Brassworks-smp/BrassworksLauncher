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
import { loadPins, savePins } from "@/lib/cmd/pins";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

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
  idx: number;
  group: string;
  pin: string;
  label: string;
  pathHint: string;
  iconGroup: string;
  needsArgs: boolean;
  mono: boolean;
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

  const norm = query.replace(/^\s+/, "");
  const compose = norm.startsWith("/");
  const cmd = compose ? norm : query;
  const body = compose ? norm.slice(1) : query;
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
    complete(cmd, REGISTRY, ctx)
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
  }, [cmd, compose, helpMode, ctx]);

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
    const rows: Row[] = [];
    let i = 0;
    const argLabel = (c: CommandSpec) =>
      cmdArgsLabel(c) ? `${cmdPath(c)} ${cmdArgsLabel(c)}` : cmdPath(c);
    const specRow = (c: CommandSpec): Row => ({
      idx: i++,
      group: c.group,
      pin: cmdPath(c),
      label: c.summary,
      pathHint: argLabel(c),
      iconGroup: c.group,
      needsArgs: hasRequiredArgs(c),
      mono: false,
    });
    const pinRow = (pin: string): Row => {
      const p = parse(pin, REGISTRY);
      const spec = p && !("error" in p) ? p.spec : null;
      const bare = spec ? cmdPath(spec) : "";
      const isBare = !!spec && pin.trim().toLowerCase() === bare.toLowerCase();
      return {
        idx: i++,
        group: "Pinned",
        pin,
        label: isBare && spec ? spec.summary : pin.replace(/^\//, ""),
        pathHint: isBare && spec ? argLabel(spec) : "",
        iconGroup: spec ? spec.group : "Help",
        needsArgs: !(p && !("error" in p) && !missingArgs(p)),
        mono: !isBare,
      };
    };
    const showPinned = !q && pins.length > 0;
    if (showPinned) {
      for (const pin of pins) rows.push(pinRow(pin));
      for (const c of list)
        if (!pins.includes(cmdPath(c))) rows.push(specRow(c));
    } else {
      for (const c of list) rows.push(specRow(c));
    }
    return rows;
  }, [browseFilter, pins]);

  const runnable = compose && !helpMode && isRunnable(cmd);
  const rowCount = browseMode ? browseRows.length : sugg.length;

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const togglePin = (pin: string) => {
    setPins((p) => {
      const next = p.includes(pin) ? p.filter((x) => x !== pin) : [...p, pin];
      savePins(next);
      return next;
    });
  };

  const runRow = (row?: Row) => {
    if (!row) return;
    if (row.needsArgs) {
      setQuery(row.pin.endsWith(" ") ? row.pin : `${row.pin} `);
      inputRef.current?.focus();
      return;
    }
    close();
    setTimeout(() => void runScript(row.pin, REGISTRY, ctx), 0);
  };

  // The command currently being composed, normalised for pinning.
  const composeCmd = `/${body.trim()}`;
  const composeParsed =
    compose && !helpMode && body.trim() ? parse(composeCmd, REGISTRY) : null;
  const canPin = !!composeParsed && !("error" in composeParsed);
  const composePinned = pins.includes(composeCmd);

  const exec = () => {
    const q = cmd;
    close();
    setTimeout(() => void runScript(q, REGISTRY, ctx), 0);
  };

  const accept = (s?: Suggestion) => {
    const pick = s ?? sugg[sel];
    if (!pick) return;
    setQuery(`/${applySuggestion(body, pick.value)}`);
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "/" && !compose) {
      e.preventDefault();
      setQuery("/");
      return;
    }
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
        runRow(browseRows[sel]);
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
          {compose && canPin && (
            <button
              onClick={() => togglePin(composeCmd)}
              title={composePinned ? "Unpin this command" : "Pin this command"}
              className="shrink-0 rounded p-1 transition hover:bg-brass-500/10"
            >
              <Star
                size={14}
                className={
                  composePinned
                    ? "fill-current text-brass-300"
                    : "text-ink-600 hover:text-brass-300"
                }
              />
            </button>
          )}
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
                {g.items.map((row) => {
                  const active = row.idx === sel;
                  const pinned = pins.includes(row.pin);
                  return (
                    <div
                      key={row.idx}
                      data-idx={row.idx}
                      onMouseMove={() => setSel(row.idx)}
                      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-brass-500/15 text-brass-200"
                          : "text-gray-200 hover:bg-ink-800/60"
                      }`}
                    >
                      <button
                        onClick={() => runRow(row)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                            active ? "text-brass-300" : "text-ink-600"
                          }`}
                        >
                          {groupIcon(row.iconGroup)}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate ${row.mono ? "font-mono" : ""}`}
                        >
                          {row.label}
                        </span>
                        {row.pathHint && (
                          <span className="shrink-0 truncate font-mono text-[11px] text-ink-600">
                            {row.pathHint}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePin(row.pin);
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
