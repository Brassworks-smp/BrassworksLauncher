import { Megaphone, WifiOff } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { CardRefresh } from "./ServerCard";

export function NewsCard({
  news,
  error,
  onRefresh,
}: {
  news: NewsItem | null;
  error?: boolean;
  onRefresh?: () => Promise<void> | void;
}) {
  const empty = !news || (!news.title && !news.body);

  if (empty) {
    return (
      <div className="group relative rounded-lg border border-edge bg-ink-900/40 p-4 transition-colors hover:border-brass-600/40">
        <CardRefresh onRefresh={onRefresh} />
        <h3 className="mb-3 flex items-center gap-2 font-mc text-sm tracking-wide text-brass-300">
          <Megaphone size={14} /> Latest news
        </h3>
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <WifiOff size={13} />
          {error ? "News unavailable right now." : "Loading news…"}
        </div>
      </div>
    );
  }

  return (
    <div className="rise group relative rounded-lg border border-edge bg-ink-900/40 p-4 transition-colors hover:border-brass-600/40">
      <CardRefresh onRefresh={onRefresh} />
      <h3 className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-brass-300">
        <Megaphone size={14} /> Latest news
      </h3>
      <div className="mb-2 truncate font-mc text-[13px] tracking-wide text-gray-100">
        {news!.title}
      </div>
      <p className="max-h-56 min-h-[6rem] overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-ink-600">
        {news!.body}
      </p>
    </div>
  );
}
