import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Copy,
  Check,
  FileUp,
  Loader2,
  ScrollText,
  Search,
  FolderOpen,
} from "lucide-react";
import * as api from "@/lib/api";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";

type Level = "error" | "warn" | "info" | "debug" | "default";

const LEVEL_CLASS: Record<Level, string> = {
  error: "log-error",
  warn: "log-warn",
  info: "log-info",
  debug: "log-debug",
  default: "log-default",
};

function lineLevel(line: string): Level {
  const m = line.match(/\/(FATAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\]/i);
  const lvl = m?.[1]?.toUpperCase();
  if (lvl === "FATAL" || lvl === "ERROR") return "error";
  if (lvl === "WARN" || lvl === "WARNING") return "warn";
  if (lvl === "INFO") return "info";
  if (lvl === "DEBUG" || lvl === "TRACE") return "debug";
  if (/^\s+at\s|^Caused by:|^\s*\.\.\.\s\d|Exception(?::|\s)/.test(line))
    return "error";
  return "default";
}

export function LogViewer({
  instanceId,
  live,
  uploading,
  onUpload,
  onClose,
}: {
  instanceId: string;
  live: boolean;
  uploading: boolean;
  onUpload: () => void;
  onClose: () => void;
}) {
  const t = useT();
  
  
  const MAX_LINES = 5000;
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  
  const [tail, setTail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const idRef = useRef(0);
  const carryRef = useRef("");
  const { closing, close } = useClosable(onClose);

  
  
  
  useEffect(() => {
    let alive = true;
    offsetRef.current = 0;
    idRef.current = 0;
    carryRef.current = "";
    setLines([]);
    setTail("");
    setLoaded(false);

    const tick = async () => {
      try {
        const res = await api.tailLog(instanceId, offsetRef.current);
        if (!alive) return;
        offsetRef.current = res.offset;
        const combined = (res.reset ? "" : carryRef.current) + res.content;
        const parts = combined.split("\n");
        carryRef.current = parts.pop() ?? "";
        if (res.reset) idRef.current = 0;
        if (res.reset || parts.length) {
          const completed = parts.map((t) => ({ id: idRef.current++, text: t }));
          setLines((prev) => {
            const start = res.reset ? [] : prev;
            const next = completed.length ? start.concat(completed) : start;
            return next.length > MAX_LINES
              ? next.slice(next.length - MAX_LINES)
              : next;
          });
        }
        setTail(carryRef.current);
        setLoaded(true);
      } catch {
        if (alive) setLoaded(true);
      }
    };

    tick();
    const h = live ? setInterval(tick, 250) : undefined;
    return () => {
      alive = false;
      if (h) clearInterval(h);
    };
  }, [instanceId, live]);

  const q = query.trim().toLowerCase();
  const all = useMemo(
    () => (tail ? [...lines, { id: -1, text: tail }] : lines),
    [lines, tail],
  );
  const shown = useMemo(
    () => (q ? all.filter((l) => l.text.toLowerCase().includes(q)) : all),
    [all, q],
  );

  useEffect(() => {
    if (follow && !q && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [shown, follow, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const copy = async () => {
    
    try {
      const full = await api.readLog(instanceId);
      api.copyText(full);
    } catch {
      api.copyText(shown.map((l) => l.text).join("\n"));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="rise flex h-[82vh] w-[860px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3">
          <div className="flex shrink-0 items-center gap-2">
            <ScrollText size={17} className="text-brass-400" />
            <h2 className="font-mc text-base tracking-wide text-gray-100">
              {live ? t("logViewer.liveLogs") : t("logViewer.lastSessionLog")}
            </h2>
            {live && (
              <span className="flex items-center gap-1.5 rounded-full bg-patina-500/15 px-2 py-0.5 text-[10px] text-patina-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-patina-400" />
                {t("logViewer.liveBadge")}
              </span>
            )}
          </div>

          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("logViewer.searchPlaceholder")}
              className="w-full rounded-md bg-ink-950/60 py-1.5 pl-8 pr-3 text-xs outline-none ring-1 ring-edge focus:ring-brass-500/60"
              spellCheck={false}
            />
            {q && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-ink-600">
                {t("logViewer.matches", { count: shown.length })}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => api.openDir(instanceId, "logs").catch(() => {})}
              title={t("logViewer.openFolder")}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <FolderOpen size={13} /> {t("mods.folder")}
            </button>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t("screenshots.copiedLabel") : t("screenshots.copy")}
            </button>
            <button
              onClick={onUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FileUp size={13} />
              )}
              {t("logViewer.uploadMclogs")}
            </button>
            <button
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="selectable flex-1 overflow-auto bg-ink-950/60 px-4 py-3 font-mono text-[12px] leading-relaxed"
        >
          {!loaded ? (
            <span className="text-ink-600">{t("common.loading")}</span>
          ) : all.length === 0 ? (
            <span className="text-ink-600">
              {t("logViewer.noLog")}
            </span>
          ) : shown.length === 0 ? (
            <span className="text-ink-600">{t("logViewer.noMatch", { query })}</span>
          ) : (
            shown.map((line) => (
              <div
                key={line.id}
                className={`whitespace-pre-wrap break-words ${
                  LEVEL_CLASS[lineLevel(line.text)]
                }`}
              >
                {line.text || " "}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
