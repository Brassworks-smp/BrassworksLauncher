import { useEffect, useState } from "react";
import { X, Server, Loader2, Wifi, WifiOff, Check } from "lucide-react";
import * as api from "@/lib/api";
import { useClosable } from "./ui";
import type { ServerEntry, ServerStatus } from "@/lib/types";

/**
 * Add or edit a server entry (name + address) with a live "test connection"
 * preview that pings the address and shows the MOTD before saving.
 */
export function AddServerModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: ServerEntry | null;
  onClose: () => void;
  onSave: (entry: ServerEntry) => void;
}) {
  const { closing, close } = useClosable(onClose);
  const [name, setName] = useState(initial?.name ?? "");
  const [ip, setIp] = useState(initial?.ip ?? "");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const test = () => {
    if (!ip.trim()) return;
    setTesting(true);
    setStatus(null);
    api
      .pingServer(ip.trim())
      .then(setStatus)
      .catch(() => setStatus({
        online: false, motd: "", version: null, players_online: 0,
        players_max: 0, favicon: null, ping_ms: 0, error: "Unreachable",
      }))
      .finally(() => setTesting(false));
  };

  const save = () => {
    const trimmed = name.trim() || ip.trim();
    if (!ip.trim()) return;
    onSave({
      name: trimmed,
      ip: ip.trim(),
      icon: initial?.icon ?? null,
      accept_textures: initial?.accept_textures ?? null,
      starred: initial?.starred ?? false,
    });
    close();
  };

  const inputCls =
    "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[55] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="w-[460px] max-w-full overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Server size={17} className="text-brass-400" />
            {initial ? "Edit server" : "Add server"}
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div>
            <div className="mb-1.5 text-sm text-ink-600">Server name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              className={inputCls}
            />
          </div>
          <div>
            <div className="mb-1.5 text-sm text-ink-600">Address</div>
            <div className="flex gap-2">
              <input
                value={ip}
                onChange={(e) => {
                  setIp(e.target.value);
                  setStatus(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && test()}
                placeholder="play.example.com"
                spellCheck={false}
                autoComplete="off"
                className={`${inputCls} font-mono`}
              />
              <button
                onClick={test}
                disabled={!ip.trim() || testing}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge px-3 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
              >
                {testing ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
                Test
              </button>
            </div>
          </div>

          {status && (
            <div
              className={`rise rounded-lg border p-3 text-sm ${
                status.online
                  ? "border-patina-500/30 bg-patina-500/5"
                  : "border-red-500/30 bg-red-500/5"
              }`}
            >
              {status.online ? (
                <div className="flex items-start gap-3">
                  {status.favicon && (
                    <img
                      src={status.favicon}
                      alt=""
                      className="pixelated h-10 w-10 shrink-0 rounded"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-patina-300">
                      <Wifi size={13} /> Online · {status.players_online}/
                      {status.players_max} · {status.ping_ms}ms
                    </div>
                    <div className="mt-1 whitespace-pre-line break-words text-[12px] text-ink-600">
                      {status.motd || "(no MOTD)"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-300">
                  <WifiOff size={13} /> Couldn&apos;t reach this server.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-5 py-3">
          <button
            onClick={close}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-600 transition hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!ip.trim()}
            className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-40"
          >
            <Check size={15} /> {initial ? "Save" : "Add server"}
          </button>
        </div>
      </div>
    </div>
  );
}
