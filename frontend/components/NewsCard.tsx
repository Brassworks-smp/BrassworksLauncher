"use client";

import { Megaphone, WifiOff } from "lucide-react";
import type { NewsItem } from "@/lib/types";

export function NewsCard({
  news,
  error,
}: {
  news: NewsItem | null;
  error?: boolean;
}) {
  if ((!news || (!news.title && !news.body)) && error) {
    return (
      <div className="rounded-xl panel p-4">
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-ink-600">
          <Megaphone size={13} /> Latest news
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <WifiOff size={13} /> News unavailable right now.
        </div>
      </div>
    );
  }

  if (!news || (!news.title && !news.body)) return null;

  return (
    <div className="rise rounded-xl panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brass-500/15 text-brass-400">
          <Megaphone size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-ink-600">
            Latest news
          </div>
          <div className="truncate font-mc text-sm tracking-wide text-gray-100">
            {news.title}
          </div>
        </div>
      </div>
      <p className="max-h-56 min-h-[7rem] overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-ink-600">
        {news.body}
      </p>
    </div>
  );
}
