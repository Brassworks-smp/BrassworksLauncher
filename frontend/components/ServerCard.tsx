import { useState } from "react";
import { Users, Signal, ListOrdered, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { PlayerCount } from "@/lib/types";

export function ServerCard({
  address,
  data,
  error,
  onRefresh,
}: {
  address: string;
  data: PlayerCount | null;
  error?: boolean;
  onRefresh?: () => Promise<void> | void;
}) {
  const t = useT();
  const online = data?.main.online ?? false;
  const hasQueue = !!data?.queue.online && (data?.queue.players_online ?? 0) > 0;

  return (
    <div className="group relative rounded-xl border border-edge bg-ink-900/50 p-4 transition-colors hover:border-brass-600/40">
      <CardRefresh onRefresh={onRefresh} />
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-mc text-xs tracking-wide text-brass-300">
          {t("serverCard.title")}
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${
            online
              ? "bg-patina-500/15 text-patina-400"
              : "bg-ink-800 text-ink-600"
          }`}
        >
          <Signal size={11} />
          {data ? (online ? t("servers.online") : t("servers.statusOffline")) : error ? t("serverCard.unavailable") : "…"}
        </span>
      </div>
      <div className="font-mono text-xs text-ink-600">{address}</div>
      <div className="mt-3 flex items-center gap-2 text-sm text-ink-600">
        <Users size={14} className="text-brass-400" />
        {online && data ? (
          <span className="tabular-nums text-gray-200">
            {data.main.players_online}
            <span className="text-ink-600">{t("serverCard.slashOnline", { max: data.main.players_max })}</span>
          </span>
        ) : (
          <span>
            {data
              ? t("serverCard.serverOffline")
              : error
                ? t("serverCard.statusUnavailable")
                : t("serverCard.checkingStatus")}
          </span>
        )}
      </div>
      {hasQueue && data && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
          <ListOrdered size={13} />
          <span className="tabular-nums">
            {t("serverCard.inQueue", { count: data.queue.players_online })}
          </span>
        </div>
      )}
    </div>
  );
}

export function CardRefresh({
  onRefresh,
}: {
  onRefresh?: () => Promise<void> | void;
}) {
  const t = useT();
  const [spinning, setSpinning] = useState(false);
  if (!onRefresh) return null;
  return (
    <button
      title={t("common.refresh")}
      onClick={async () => {
        if (spinning) return;
        setSpinning(true);
        try {
          await onRefresh();
        } finally {
          setTimeout(() => setSpinning(false), 400);
        }
      }}
      className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border border-edge bg-ink-900/80 text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 ${
        spinning ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
    >
      <RefreshCw size={13} className={spinning ? "animate-spin" : ""} />
    </button>
  );
}
