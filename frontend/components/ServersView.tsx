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
  Star,
  Play,
  X,
  Signal,
  Globe,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { parseMotd } from "@/lib/motd";
import { useT } from "@/lib/i18n";
import { SegmentedTabs, StarButton, useClosable } from "./ui";
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

export function ServersView({
  instanceId,
  canPlay,
  onQuickPlay,
  onRemoved,
}: {
  instanceId: string;
  canPlay: boolean;
  onQuickPlay: (qp: api.QuickPlay) => void;
  onRemoved?: (ip: string) => void;
}) {
  const t = useT();
  const [servers, setServers] = useState<ServerEntry[] | null>(
    () => serversCache.get(instanceId) ?? null,
  );
  const [statuses, setStatuses] = useState<Record<string, ServerStatus | "loading">>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<ServerEntry | null>(null);
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
    api
      .saveServers(instanceId, next.filter((s) => !s.featured))
      .catch((e) => toast(String(e), "error"));
  };

  const upsert = (entry: ServerEntry) => {
    const list = servers ?? [];
    const idx = editing ? list.findIndex((s) => keyOf(s) === keyOf(editing)) : -1;
    const next = idx >= 0 ? list.map((s, i) => (i === idx ? entry : s)) : [...list, entry];
    persist(next);
    pingAll(next);
  };

  const remove = (s: ServerEntry) => {
    persist((servers ?? []).filter((x) => keyOf(x) !== keyOf(s)));
    onRemoved?.(s.ip);
  };

  const moveWithin = (group: ServerEntry[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= group.length) return;
    if (group[i].featured || group[j].featured) return; 
    const list = [...(servers ?? [])];
    const ia = list.findIndex((x) => keyOf(x) === keyOf(group[i]));
    const ib = list.findIndex((x) => keyOf(x) === keyOf(group[j]));
    if (ia < 0 || ib < 0) return;
    [list[ia], list[ib]] = [list[ib], list[ia]];
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

  const starredList = useMemo(() => filtered.filter((s) => s.starred), [filtered]);
  const restList = useMemo(() => filtered.filter((s) => !s.starred), [filtered]);
  const canReorder = !query.trim() && filter !== "online";

  return (
    <div className="flex flex-1 flex-col overflow-hidden px-1 -mx-1">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">{t("servers.title")}</h1>
          <p className="text-sm text-ink-600">
            {servers
              ? t("servers.count", { count: servers.length })
              : t("common.loading")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            title={t("servers.refreshStatus")}
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
            <Plus size={16} /> {t("servers.addServer")}
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
            placeholder={t("servers.searchPlaceholder")}
            className="w-56 rounded-lg bg-ink-900/50 py-2 pl-8 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
        <SegmentedTabs
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: t("servers.all") },
            { id: "online", label: t("servers.online") },
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
            {t("servers.starred")}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {servers === null ? null : filtered.length === 0 ? (
          <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
            <div>
              <Server size={28} className="mx-auto mb-2 opacity-50" />
              {(servers?.length ?? 0) === 0
                ? t("servers.emptyNone")
                : t("servers.emptyFilter")}
            </div>
          </div>
        ) : (
          <div className="stagger flex flex-col gap-2">
            {starredList.length > 0 && (
              <>
                {restList.length > 0 && (
                  <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-brass-400/80">
                    <Star size={11} className="fill-current" /> {t("servers.starred")}
                  </div>
                )}
                {starredList.map((s, i) => (
                  <ServerRow
                    key={keyOf(s)}
                    server={s}
                    status={statuses[keyOf(s)]}
                    canPlay={canPlay}
                    onOpen={() => setDetail(s)}
                    canMoveUp={canReorder && i > 0 && !s.featured}
                    canMoveDown={canReorder && i < starredList.length - 1 && !s.featured}
                    onJoin={() => onQuickPlay({ kind: "server", ip: s.ip })}
                    onStar={() => toggleStar(s)}
                    onEdit={() => {
                      setEditing(s);
                      setAdding(true);
                    }}
                    onDelete={() => remove(s)}
                    onMoveUp={() => moveWithin(starredList, i, -1)}
                    onMoveDown={() => moveWithin(starredList, i, 1)}
                  />
                ))}
              </>
            )}

            {restList.length > 0 && (
              <>
                {starredList.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-edge px-1 pb-0.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-600">
                    {t("servers.allServers")}
                  </div>
                )}
                {restList.map((s, i) => (
                  <ServerRow
                    key={keyOf(s)}
                    server={s}
                    status={statuses[keyOf(s)]}
                    canPlay={canPlay}
                    onOpen={() => setDetail(s)}
                    canMoveUp={canReorder && i > 0 && !s.featured}
                    canMoveDown={canReorder && i < restList.length - 1 && !s.featured}
                    onJoin={() => onQuickPlay({ kind: "server", ip: s.ip })}
                    onStar={() => toggleStar(s)}
                    onEdit={() => {
                      setEditing(s);
                      setAdding(true);
                    }}
                    onDelete={() => remove(s)}
                    onMoveUp={() => moveWithin(restList, i, -1)}
                    onMoveDown={() => moveWithin(restList, i, 1)}
                  />
                ))}
              </>
            )}
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

      {detail && (
        <ServerDetailModal
          server={detail}
          status={statuses[keyOf(detail)]}
          canPlay={canPlay}
          onJoin={() => {
            onQuickPlay({ kind: "server", ip: detail.ip });
            setDetail(null);
          }}
          onEdit={() => {
            setEditing(detail);
            setAdding(true);
            setDetail(null);
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function ServerRow({
  server,
  status,
  canPlay,
  canMoveUp,
  canMoveDown,
  onJoin,
  onStar,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onOpen,
}: {
  server: ServerEntry;
  status?: ServerStatus | "loading";
  canPlay: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onJoin: () => void;
  onStar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const live = status && status !== "loading" ? status : null;
  const favicon = dataIcon(live?.favicon ?? server.icon);

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title={t("servers.viewServer", { name: server.name })}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-edge bg-ink-900/50 p-3 transition hover:border-brass-600/40"
    >
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

      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-100">
            {server.name}
          </span>
          {server.featured && (
            <span className="shrink-0 rounded bg-brass-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-brass-300">
              {t("servers.featured")}
            </span>
          )}
          <PingBars status={status} />
          {live?.online && (
            <span className="flex items-center gap-1 text-[11px] text-patina-400">
              <Users size={11} /> {live.players_online}/{live.players_max}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-ink-600">{server.ip}</div>
        <div className="truncate font-mc text-[12px] text-ink-600">
          {status === "loading"
            ? t("servers.pinging")
            : live?.online
              ? live.motd
                ? parseMotd(live.motd.split("\n")[0])
                : live.version || ""
              : t("servers.offline")}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {(canMoveUp || canMoveDown) && (
          <div className="mr-1 flex flex-col opacity-0 transition group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              disabled={!canMoveUp}
              className="text-ink-600 transition hover:text-brass-300 disabled:opacity-30"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              disabled={!canMoveDown}
              className="text-ink-600 transition hover:text-brass-300 disabled:opacity-30"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onJoin();
          }}
          disabled={!canPlay}
          title={t("servers.joinTitle")}
          className="brass-btn mr-0.5 flex items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={12} className="fill-current" /> {t("servers.join")}
        </button>
        {!server.featured && (
          <StarButton starred={server.starred} onClick={onStar} className="h-8 w-8" />
        )}
        {!server.featured && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title={t("common.edit")}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-700 hover:text-brass-300"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title={t("common.remove")}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ServerDetailModal({
  server,
  status,
  canPlay,
  onJoin,
  onEdit,
  onClose,
}: {
  server: ServerEntry;
  status?: ServerStatus | "loading";
  canPlay: boolean;
  onJoin: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const live = status && status !== "loading" ? status : null;
  const favicon = dataIcon(live?.favicon ?? server.icon);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [close]);

  const stats: { icon: typeof Globe; label: string; value: string }[] = [];
  if (live) {
    stats.push({
      icon: Signal,
      label: t("servers.statStatus"),
      value: live.online
        ? t("servers.onlinePing", { ms: live.ping_ms })
        : t("servers.statusOffline"),
    });
    if (live.online) {
      stats.push({
        icon: Users,
        label: t("servers.statPlayers"),
        value: `${live.players_online} / ${live.players_max}`,
      });
    }
    if (live.version)
      stats.push({ icon: Globe, label: t("servers.statVersion"), value: live.version });
  }

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex max-h-[80vh] w-[520px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="relative">
          <div className="flex items-center gap-4 border-b border-edge bg-gradient-to-b from-ink-850 to-ink-900 px-5 py-5">
            <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-950 text-ink-600">
              {favicon ? (
                <img src={favicon} alt="" className="pixelated h-full w-full object-cover" />
              ) : (
                <Server size={26} />
              )}
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-ink-900 ${
                  live?.online ? "bg-patina-400" : live ? "bg-red-500" : "bg-ink-600"
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-mc text-lg tracking-wide text-gray-100">
                  {server.name}
                </h2>
                {server.featured && (
                  <span className="shrink-0 rounded bg-brass-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-brass-300">
                    {t("servers.featured")}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-ink-600">
                {server.ip}
              </div>
            </div>
          </div>
          <button
            onClick={close}
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-lg border border-edge bg-ink-950/50 p-4">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
              {t("servers.motd")}
            </div>
            {status === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-ink-600">
                <Loader2 size={14} className="animate-spin" /> {t("servers.pinging")}
              </div>
            ) : live?.online ? (
              <div className="whitespace-pre-line break-words font-mc text-[13px] leading-relaxed text-gray-200">
                {live.motd ? parseMotd(live.motd) : "-"}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-red-300/80">
                <WifiOff size={14} /> {t("servers.offline")}
              </div>
            )}
          </div>

          {stats.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg border border-edge bg-ink-800/40 p-3"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                    <s.icon size={12} /> {s.label}
                  </div>
                  <div className="truncate text-sm text-gray-100">{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-edge px-5 py-3">
          {!server.featured ? (
            <button
              onClick={onEdit}
              className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Pencil size={13} /> {t("common.edit")}
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={onJoin}
            disabled={!canPlay}
            className="flex items-center gap-2 rounded-md bg-brass-500/90 px-4 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play size={14} /> {t("servers.joinServer")}
          </button>
        </div>
      </div>
    </div>
  );
}
