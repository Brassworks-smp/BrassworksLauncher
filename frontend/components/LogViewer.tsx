"use client";

import { useEffect, useRef, useState } from "react";
import { X, Copy, Check, FileUp, Loader2, ScrollText } from "lucide-react";
import * as api from "@/lib/api";

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
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .readLog(instanceId)
        .then((t) => alive && setText(t))
        .catch(() => {});
    tick();
    const h = live ? setInterval(tick, 1500) : undefined;
    return () => {
      alive = false;
      if (h) clearInterval(h);
    };
  }, [instanceId, live]);

  useEffect(() => {
    if (follow && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, follow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = () => {
    if (text) api.copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise flex h-[82vh] w-[860px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            <ScrollText size={17} className="text-brass-400" />
            <h2 className="font-mc text-base tracking-wide text-gray-100">
              {live ? "Live logs" : "Last session log"}
            </h2>
            {live && (
              <span className="flex items-center gap-1.5 rounded-full bg-patina-500/15 px-2 py-0.5 text-[10px] text-patina-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-patina-400" />
                live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
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
              Upload to mclo.gs
            </button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <pre
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-ink-950/60 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-600"
        >
          {text === null
            ? "Loading…"
            : text.length === 0
              ? "No log found for this session yet."
              : text}
        </pre>
      </div>
    </div>
  );
}
