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
  ExternalLink,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useClosable, StarButton, useProgressive } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { Screenshot } from "@/lib/types";

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const thumbCache = new Map<string, string>();

const MAX_CONCURRENT_THUMBS = 2;
let activeThumbs = 0;
const thumbQueue: (() => void)[] = [];
function pumpThumbs() {
  while (activeThumbs < MAX_CONCURRENT_THUMBS && thumbQueue.length > 0) {
    const job = thumbQueue.shift()!;
    activeThumbs++;
    job();
  }
}
function queuedThumb(path: string, large: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const job = () => {
      api
        .screenshotThumb(path, large)
        .then(resolve, reject)
        .finally(() => {
          activeThumbs--;
          pumpThumbs();
        });
    };
    if (large) thumbQueue.unshift(job);
    else thumbQueue.push(job);
    pumpThumbs();
  });
}

type ThumbState =
  | { status: "loading"; src: null }
  | { status: "ready"; src: string }
  | { status: "error"; src: null };

function useThumb(path: string, large: boolean): ThumbState {
  const key = `${path}|${large ? "l" : "s"}`;
  const [state, setState] = useState<ThumbState>(() => {
    const c = thumbCache.get(key);
    return c ? { status: "ready", src: c } : { status: "loading", src: null };
  });
  useEffect(() => {
    const cached = thumbCache.get(key);
    if (cached) {
      setState({ status: "ready", src: cached });
      return;
    }
    if (!api.isTauri()) {
      setState({ status: "ready", src: api.fileSrc(path) });
      return;
    }
    let alive = true;
    setState({ status: "loading", src: null });
    queuedThumb(path, large)
      .then((p) => {
        const s = api.fileSrc(p);
        thumbCache.set(key, s);
        if (alive) setState({ status: "ready", src: s });
      })
      .catch(() => {
        if (alive) setState({ status: "error", src: null });
      });
    return () => {
      alive = false;
    };
  }, [key, path, large]);
  return state;
}


function GridThumb({ path, alt }: { path: string; alt: string }) {
  const thumb = useThumb(path, false);
  const [loaded, setLoaded] = useState(false);
  if (thumb.status === "error") {
    return (
      <div className="absolute inset-0 grid place-items-center text-ink-600">
        <ImageIcon size={22} className="opacity-40" />
      </div>
    );
  }
  return (
    <>
      {(thumb.status !== "ready" || !loaded) && (
        <div className="skeleton absolute inset-0" />
      )}
      {thumb.status === "ready" && (
        <img
          src={thumb.src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </>
  );
}

export function ScreenshotsView({ instanceId }: { instanceId: string }) {
  const t = useT();
  const [shots, setShots] = useState<Screenshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
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
    setActivePath(null);
    api
      .deleteScreenshot(s.instance, s.name)
      .then(() => toast(t("screenshots.deleted", { name: s.name }), "info"))
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
      toast(t("screenshots.copiedToast"), "success");
    } catch {
      toast(t("screenshots.copyFailed"), "error");
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
    .filter((s) => !starredOnly || s.starred)
    .sort(
      (a, b) =>
        Number(b.starred) - Number(a.starred) || b.modified - a.modified,
    );
  const { shown } = useProgressive(list, 48, `${scope}:${starredOnly}`);
  const active =
    activePath !== null ? list.findIndex((s) => s.path === activePath) : -1;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">
            {t("screenshots.title")}
          </h1>
          <p className="text-sm text-ink-600">
            {shots ? t("screenshots.captured", { count: list.length }) : t("common.loading")}
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
              {t("screenshots.thisInstance")}
            </button>
            <button
              onClick={() => setScope("all")}
              className={`rounded-md px-2.5 py-1 transition ${
                scope === "all"
                  ? "bg-brass-500/15 text-brass-300"
                  : "text-ink-600 hover:text-brass-300/80"
              }`}
            >
              {t("screenshots.all")}
            </button>
          </div>
          <button
            onClick={() => setStarredOnly((v) => !v)}
            title={t("screenshots.showStarred")}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition ${
              starredOnly
                ? "border-brass-500/50 bg-brass-500/10 text-brass-300"
                : "border-edge text-ink-600 hover:text-brass-300"
            }`}
          >
            <StarButton starred={starredOnly} onClick={() => setStarredOnly((v) => !v)} size={13} />
            {t("screenshots.starred")}
          </button>
          <button
            onClick={() =>
              api.openDir(instanceId, "screenshots").catch(() => {})
            }
            title={t("screenshots.openFolder")}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={15} /> {t("mods.folder")}
          </button>
          <button
            onClick={load}
            title={t("common.refresh")}
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
            {t("screenshots.empty")}
          </div>
        </div>
      ) : (
        <div className="stagger grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((s) => (
            <button
              key={s.path}
              onClick={() => setActivePath(s.path)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-edge bg-ink-950 transition hover:border-brass-600/50"
            >
              <GridThumb path={s.path} alt={s.name} />
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
                title={t("common.delete")}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md bg-ink-950/80 text-ink-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
        </div>
      )}

      {active >= 0 && list[active] && (
        <Lightbox
          shots={list}
          index={active}
          onIndex={(i) => setActivePath(list[i]?.path ?? null)}
          onClose={() => setActivePath(null)}
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
  const t = useT();
  const s = shots[index];
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const large = useThumb(s.path, true);
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
            {s.starred ? t("screenshots.starred") : t("ui.star")}
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
            {copied ? t("screenshots.copiedLabel") : t("screenshots.copy")}
          </button>
          <button
            onClick={() => api.openFile(s.path).catch(() => toast(t("screenshots.openFailed"), "error"))}
            title={t("screenshots.openTitle")}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <ExternalLink size={13} /> {t("screenshots.open")}
          </button>
          <button
            onClick={() => onDelete(s)}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10"
          >
            <Trash2 size={13} /> {t("common.delete")}
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
        {large.status === "loading" && (
          <Loader2 size={26} className="absolute animate-spin text-ink-600" />
        )}
        {large.status === "error" && (
          <div className="flex flex-col items-center gap-2 text-ink-600">
            <ImageIcon size={30} className="opacity-40" />
            <span className="text-xs">{t("screenshots.loadFailed")}</span>
          </div>
        )}
        {large.status === "ready" && (
          <img
            src={large.src}
            alt={s.name}
            onLoad={() => setLoaded(true)}
            className={`max-h-full max-w-full rounded-lg object-contain transition-opacity ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
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
