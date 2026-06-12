import { Megaphone, WifiOff } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { CardRefresh } from "./ServerCard";
import { useT } from "@/lib/i18n";

export function NewsCard({
  news,
  error,
  onRefresh,
}: {
  news: NewsItem | null;
  error?: boolean;
  onRefresh?: () => Promise<void> | void;
}) {
  const t = useT();
  const empty = !news || (!news.title && !news.body);

  if (empty) {
    return (
      <div className="group relative rounded-xl border border-edge bg-ink-900/50 p-4 transition-colors hover:border-brass-600/40">
        <CardRefresh onRefresh={onRefresh} />
        <h3 className="mb-2.5 flex items-center gap-1.5 font-mc text-xs tracking-wide text-brass-300">
          <Megaphone size={12} /> {t("newsCard.title")}
        </h3>
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <WifiOff size={13} />
          {error ? t("newsCard.unavailable") : t("newsCard.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="rise group relative rounded-xl border border-edge bg-ink-900/50 p-4 transition-colors hover:border-brass-600/40">
      <CardRefresh onRefresh={onRefresh} />
      <h3 className="mb-2.5 flex items-center gap-1.5 font-mc text-xs tracking-wide text-brass-300">
        <Megaphone size={12} /> {t("newsCard.title")}
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
