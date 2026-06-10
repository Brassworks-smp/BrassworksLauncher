import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  FolderOpen,
  Trash2,
  X,
  Image as ImageIcon,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useClosable, StarButton } from "@/components/ui";
import type { Screenshot } from "@/lib/types";

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ScreenshotsView({ instanceId }: { instanceId: string }) {
  const [shots, setShots] = useState<Screenshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [scope, setScope] = useState<"this" | "all">("this");
  const [starredOnly, setStarredOnly] = useState(false);

  const load = useCallback(() => {
    if (!api.isTauri()) {
      setShots([]);
      return;
    }
    setLoading(true);
    api
      .listScreenshots()
      .then(setShots)
      .catch(() => setShots([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = (s: Screenshot) => {
    setShots((prev) => (prev ? prev.filter((x) => x.path !== s.path) : prev));
    setActive(null);
    api
      .deleteScreenshot(s.instance, s.name)
      .then(() => toast(`Deleted ${s.name}`, "info"))
      .catch((e) => {
        toast(String(e), "error");
        load();
      });
  };

  const copy = async (s: Screenshot) => {
    try {
      const blob = await (await fetch(api.fileSrc(s.path))).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || "image/png"]: blob }),
      ]);
      toast("Screenshot copied to clipboard", "success");
    } catch {
      toast("Couldn't copy this image", "error");
    }
  };

  const toggleStar = (s: Screenshot) => {
    setShots((prev) =>
      prev
        ? prev.map((x) =>
            x.path === s.path ? { ...x, starred: !x.starred } : x,
          )
        : prev,
    );
    api.toggleStar(s.instance, "screenshots", s.name).catch(() => load());
  };

  const list = (shots ?? [])
    .filter((s) => scope === "all" || s.instance === instanceId)
    .filter((s) => !starredOnly || s.starred);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">
            Screenshots
          </h1>
          <p className="text-sm text-ink-600">
            {shots ? `${list.length} captured` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-edge bg-ink-900/50 p-0.5 text-xs">
            <button
              onClick={() => setScope("this")}
              className={`rounded-md px-2.5 py-1 transition ${
                scope === "this"
                  ? "bg-brass-500/15 text-brass-300"
                  : "text-ink-600 hover:text-brass-300/80"
              }`}
            >
              This instance
            </button>
            <button
              onClick={() => setScope("all")}
              className={`rounded-md px-2.5 py-1 transition ${
                scope === "all"
                  ? "bg-brass-500/15 text-brass-300"
                  : "text-ink-600 hover:text-brass-300/80"
              }`}
            >
              All
            </button>
          </div>
          <button
            onClick={() => setStarredOnly((v) => !v)}
            title="Show starred only"
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition ${
              starredOnly
                ? "border-brass-500/50 bg-brass-500/10 text-brass-300"
                : "border-edge text-ink-600 hover:text-brass-300"
            }`}
          >
            <StarButton starred={starredOnly} onClick={() => setStarredOnly((v) => !v)} size={13} />
            Starred
          </button>
          <button
            onClick={() =>
              api.openDir(instanceId, "screenshots").catch(() => {})
            }
            title="Open screenshots folder"
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={15} /> Folder
          </button>
          <button
            onClick={load}
            title="Refresh"
            className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {shots && list.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-ink-600">
          <div>
            <ImageIcon size={28} className="mx-auto mb-2 opacity-50" />
            No screenshots yet — press F2 in‑game to take one.
          </div>
        </div>
      ) : (
        <div className="stagger grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((s, i) => (
            <button
              key={s.path}
              onClick={() => setActive(i)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-edge bg-ink-950 transition hover:border-brass-600/50"
            >
              <img
                src={api.fileSrc(s.path)}
                alt={s.name}
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-[1.03]"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-left text-[10px] text-gray-300 opacity-0 transition group-hover:opacity-100">
                {fmtDate(s.modified)}
              </div>
              <StarButton
                starred={s.starred}
                onClick={() => toggleStar(s)}
                size={14}
                className={`absolute left-1.5 top-1.5 h-7 w-7 bg-ink-950/70 backdrop-blur-sm transition ${
                  s.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              />
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(s);
                }}
                title="Delete"
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md bg-ink-950/80 text-ink-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
        </div>
      )}

      {active !== null && list[active] && (
        <Lightbox
          shots={list}
          index={active}
          onIndex={setActive}
          onClose={() => setActive(null)}
          onDelete={remove}
          onCopy={copy}
          onStar={toggleStar}
        />
      )}
    </div>
  );
}

function Lightbox({
  shots,
  index,
  onIndex,
  onClose,
  onDelete,
  onCopy,
  onStar,
}: {
  shots: Screenshot[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (s: Screenshot) => void;
  onCopy: (s: Screenshot) => void | Promise<void>;
  onStar: (s: Screenshot) => void;
}) {
  const s = shots[index];
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { closing, close } = useClosable(onClose);

  const go = useCallback(
    (dir: number) => {
      const next = (index + dir + shots.length) % shots.length;
      setLoaded(false);
      onIndex(next);
    },
    [index, shots.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, close]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-black/85 p-6 backdrop-blur-sm ${
        closing ? "fade-out" : "fade-in"
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex items-center justify-between pb-3 text-gray-200">
        <div className="min-w-0">
          <div className="truncate font-mc text-sm tracking-wide">{s.name}</div>
          <div className="text-[11px] text-ink-600">
            {fmtDate(s.modified)} · {api.formatBytes(s.size)} · {index + 1}/
            {shots.length}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStar(s)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition ${
              s.starred
                ? "border-brass-500/50 bg-brass-500/10 text-brass-300"
                : "border-edge text-ink-600 hover:border-brass-500/40 hover:text-brass-300"
            }`}
          >
            <StarButton starred={s.starred} onClick={() => onStar(s)} size={13} />
            {s.starred ? "Starred" : "Star"}
          </button>
          <button
            onClick={async () => {
              await onCopy(s);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => onDelete(s)}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10"
          >
            <Trash2 size={13} /> Delete
          </button>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {shots.length > 1 && (
          <button
            onClick={() => go(-1)}
            className="absolute left-0 grid h-11 w-11 place-items-center rounded-full bg-ink-900/70 text-gray-300 transition hover:bg-ink-800"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {!loaded && (
          <Loader2 size={26} className="absolute animate-spin text-ink-600" />
        )}
        <img
          src={api.fileSrc(s.path)}
          alt={s.name}
          onLoad={() => setLoaded(true)}
          className={`max-h-full max-w-full rounded-lg object-contain transition-opacity ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
        {shots.length > 1 && (
          <button
            onClick={() => go(1)}
            className="absolute right-0 grid h-11 w-11 place-items-center rounded-full bg-ink-900/70 text-gray-300 transition hover:bg-ink-800"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </div>
  );
}
