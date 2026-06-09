import { useEffect, useState } from "react";
import { Loader2, PartyPopper, ScrollText, X } from "lucide-react";
import * as api from "@/lib/api";
import { Markdown } from "@/components/Markdown";

export function ChangelogModal({
  version,
  updated,
  onClose,
}: {
  version: string | null;
  updated: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(false);
    api
      .releaseChangelog(version)
      .then((t) => alive && setText(t))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <div
      className="fixed inset-0 z-[55] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise flex max-h-[80vh] w-[620px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            {updated ? (
              <PartyPopper size={17} className="text-brass-400" />
            ) : (
              <ScrollText size={17} className="text-brass-400" />
            )}
            {updated ? "Launcher updated" : "What's new"}
            {version && (
              <span className="rounded-md bg-brass-500/10 px-2 py-0.5 text-xs text-brass-300">
                v{version}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        {updated && (
          <div className="border-b border-edge bg-brass-500/10 px-5 py-3 text-sm text-brass-200">
            Updated successfully to v{version}. Here&apos;s what changed:
          </div>
        )}

        <div className="selectable flex-1 overflow-y-auto px-5 py-4">
          {text === null && !error ? (
            <div className="flex items-center gap-2 py-6 text-sm text-ink-600">
              <Loader2 size={15} className="animate-spin" /> Loading changelog…
            </div>
          ) : error ? (
            <div className="py-6 text-sm text-ink-600">
              Couldn&apos;t load the changelog right now. You can read it on{" "}
              <button
                onClick={() =>
                  api
                    .openExternal(
                      `${api.BRASSWORKS_GITHUB}/BrassworksLauncher/releases`,
                    )
                    .catch(() => {})
                }
                className="text-brass-300 hover:text-brass-400"
              >
                GitHub
              </button>
              .
            </div>
          ) : (
            <Markdown className="text-sm">{text ?? ""}</Markdown>
          )}
        </div>

        <div className="flex justify-end border-t border-edge px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            {updated ? "Let's go" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
