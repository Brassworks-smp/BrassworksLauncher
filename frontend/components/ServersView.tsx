import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Server,
  Plus,
  RefreshCw,
  Search,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  WifiOff,
  Users,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { SegmentedTabs, StarButton } from "./ui";
import { AddServerModal } from "./AddServerModal";
import type { ServerEntry, ServerStatus } from "@/lib/types";

const serversCache = new Map<string, ServerEntry[]>();
const statusCache = new Map<string, ServerStatus>();

const keyOf = (s: ServerEntry) => `${s.name}${s.ip}`;

function dataIcon(b64: string | null | undefined): string | null {
  if (!b64) return null;
  return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
}

function PingBars({ status }: { status?: ServerStatus | "loading" }) {
  if (status === "loading")
    return <Loader2 size={13} className="animate-spin text-ink-600" />;
  if (!status || !status.online)
    return <WifiOff size={13} className="text-red-400/70" />;
  const ms = status.ping_ms;
  const bars = ms < 80 ? 4 : ms < 200 ? 3 : ms < 500 ? 2 : 1;
  const color =
    bars >= 3 ? "bg-patina-400" : bars === 2 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-end gap-0.5" title={`${ms}ms`}>
      {[3, 6, 9, 12].map((h, i) => (
        <span
          key={h}
          style={{ height: h }}
          className={`w-1 rounded-sm ${i < bars ? color : "bg-ink-700"}`}
        />
      ))}
    </div>
  );
}

export function ServersView({ instanceId }: { instanceId: string }) {
  const [servers, setServers] = useState<ServerEntry[] | null>(
    () => serversCache.get(instanceId) ?? null,
  );
  const [statuses, setStatuses] = useState<Record<string, ServerStatus | "loading">>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const reqRef = useRef(0);

  const pingAll = useCallback((list: ServerEntry[]) => {
    const req = ++reqRef.current;
    setStatuses((prev) => {
      const next: Record<string, ServerStatus | "loading"> = {};
      for (const s of list) {
        const k = keyOf(s);
        next[k] = statusCache.get(s.ip) ?? prev[k] ?? "loading";
      }
      return next;
    });
    for (const s of list) {
      api
        .pingServer(s.ip)
        .then((st) => {
          if (req !== reqRef.current) return;
          statusCache.set(s.ip, st);
          setStatuses((prev) => ({ ...prev, [keyOf(s)]: st }));
        })
        .catch(() => {});
    }
  }, []);

  const load = useCallback(() => {
    if (!api.isTauri()) {
      setServers([]);
      return;
    }
    api
      .listServers(instanceId)
      .then((list) => {
        serversCache.set(instanceId, list);
        setServers(list);
        pingAll(list);
      })
      .catch(() => setServers([]));
  }, [instanceId, pingAll]);
  useEffect(load, [load]);

  const persist = (next: ServerEntry[]) => {
    serversCache.set(instanceId, next);
    setServers(next);
    api.saveServers(instanceId, next).catch((e) => toast(String(e), "error"));
  };

  const upsert = (entry: ServerEntry) => {
    const list = servers ?? [];
    const idx = editing ? list.findIndex((s) => keyOf(s) === keyOf(editing)) : -1;
    const next = idx >= 0 ? list.map((s, i) => (i === idx ? entry : s)) : [...list, entry];
    persist(next);
    pingAll(next);
  };

  const remove = (s: ServerEntry) =>
    persist((servers ?? []).filter((x) => keyOf(x) !== keyOf(s)));

  const move = (i: number, dir: -1 | 1) => {
    const list = [...(servers ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    persist(list);
  };

  const toggleStar = (s: ServerEntry) => {
    if (!servers) return;
    const next = servers.map((x) =>
      keyOf(x) === keyOf(s) ? { ...x, starred: !x.starred } : x,
    );
    serversCache.set(instanceId, next);
    setServers(next);
    api.toggleStar(instanceId, "servers", keyOf(s)).catch(() => load());
  };

  const filtered = useMemo(() => {
    let list = servers ?? [];
    if (starredOnly) list = list.filter((s) => s.starred);
    if (filter === "online")
      list = list.filter((s) => {
        const st = statuses[keyOf(s)];
        return st && st !== "loading" && st.online;
      });
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.ip.toLowerCase().includes(q),
      );
    return list;
  }, [servers, statuses, query, filter, starredOnly]);

  const starredCount = (servers ?? []).filter((s) => s.starred).length;

  const ordered = useMemo(
    () =>
      [...filtered].sort((a, b) => Number(b.starred) - Number(a.starred)),
    [filtered],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">Servers</h1>
          <p className="text-sm text-ink-600">
            {servers
              ? `${servers.length} server${servers.length === 1 ? "" : "s"}`
              : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            title="Refresh status"
            className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
            className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            <Plus size={16} /> Add server
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers…"
            className="w-56 rounded-lg bg-ink-900/50 py-2 pl-8 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
        <SegmentedTabs
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "online", label: "Online" },
          ]}
        />
        {starredCount > 0 && (
          <button
            onClick={() => setStarredOnly((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition ${
              starredOnly
                ? "border-brass-500/50 bg-brass-500/10 text-brass-300"
                : "border-edge text-ink-600 hover:text-brass-300"
            }`}
          >
            <StarButton starred={starredOnly} onClick={() => setStarredOnly((v) => !v)} size={12} />
            Starred
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {servers === null ? null : ordered.length === 0 ? (
          <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
            <div>
              <Server size={28} className="mx-auto mb-2 opacity-50" />
              {(servers?.length ?? 0) === 0
                ? "No servers saved — add one to get started."
                : "No servers match your filters."}
            </div>
          </div>
        ) : (
          <div className="stagger flex flex-col gap-2">
            {ordered.map((s) => {
              const realIndex = (servers ?? []).findIndex(
                (x) => keyOf(x) === keyOf(s),
              );
              return (
                <ServerRow
                  key={keyOf(s)}
                  server={s}
                  status={statuses[keyOf(s)]}
                  canMoveUp={realIndex > 0 && filter === "all" && !query}
                  canMoveDown={
                    realIndex < (servers?.length ?? 0) - 1 &&
                    filter === "all" &&
                    !query
                  }
                  onStar={() => toggleStar(s)}
                  onEdit={() => {
                    setEditing(s);
                    setAdding(true);
                  }}
                  onDelete={() => remove(s)}
                  onMoveUp={() => move(realIndex, -1)}
                  onMoveDown={() => move(realIndex, 1)}
                />
              );
            })}
          </div>
        )}
      </div>

      {adding && (
        <AddServerModal
          initial={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={upsert}
        />
      )}
    </div>
  );
}

function ServerRow({
  server,
  status,
  canMoveUp,
  canMoveDown,
  onStar,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  server: ServerEntry;
  status?: ServerStatus | "loading";
  canMoveUp: boolean;
  canMoveDown: boolean;
  onStar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const live = status && status !== "loading" ? status : null;
  const favicon = dataIcon(live?.favicon ?? server.icon);

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-edge bg-ink-800/60 p-3 transition hover:border-brass-600/40">
      <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-ink-600">
        {favicon ? (
          <img src={favicon} alt="" className="pixelated h-full w-full object-cover" />
        ) : (
          <Server size={20} />
        )}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink-800 ${
            live?.online ? "bg-patina-400" : live ? "bg-red-500" : "bg-ink-600"
          }`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-100">
            {server.name}
          </span>
          <PingBars status={status} />
          {live?.online && (
            <span className="flex items-center gap-1 text-[11px] text-patina-400">
              <Users size={11} /> {live.players_online}/{live.players_max}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-ink-600">{server.ip}</div>
        <div className="truncate text-[12px] text-ink-600">
          {status === "loading"
            ? "Pinging…"
            : live?.online
              ? live.motd.split("\n")[0] || live.version || ""
              : "Offline or unreachable"}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {(canMoveUp || canMoveDown) && (
          <div className="mr-1 flex flex-col opacity-0 transition group-hover:opacity-100">
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="text-ink-600 transition hover:text-brass-300 disabled:opacity-30"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="text-ink-600 transition hover:text-brass-300 disabled:opacity-30"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
        <StarButton starred={server.starred} onClick={onStar} className="h-8 w-8" />
        <button
          onClick={onEdit}
          title="Edit"
          className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-700 hover:text-brass-300"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          title="Remove"
          className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
