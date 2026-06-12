import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Check } from "lucide-react";
import { Changelog } from "@/components/Markdown";
import { Collapse } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { ContentVersion } from "@/lib/types";

export function VersionList({
  instanceId,
  projectId,
  source,
  versions,
  actionLabel,
  busy,
  currentVersionId,
  onPick,
}: {
  instanceId: string;
  projectId: string;
  source: string;
  versions: ContentVersion[];
  actionLabel: string;
  busy?: boolean;
  currentVersionId?: string | null;
  onPick: (versionId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setPicked(null);
  }, [busy]);
  const anyBusy = busy || picked !== null;

  if (versions.length === 0) {
    return <div className="py-4 text-center text-xs text-ink-600">{t("versionList.noVersions")}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {versions.map((v) => {
        const expanded = open === v.version_id;
        const current = currentVersionId === v.version_id;
        return (
          <div
            key={v.version_id}
            className={`overflow-hidden rounded-lg border bg-ink-900/40 transition ${
              current ? "border-brass-500/50" : "border-edge"
            }`}
          >
            <div className="flex items-center gap-2 p-2.5">
              <button
                onClick={() => setOpen(expanded ? null : v.version_id)}
                className="grid h-6 w-6 place-items-center rounded text-ink-600 transition hover:text-brass-300"
                title={t("settings.updates.changelog")}
              >
                <ChevronRight
                  size={15}
                  className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-gray-100">
                  {v.version_number}
                </div>
                <div className="truncate text-[11px] text-ink-600">
                  {v.game_versions.join(", ")}
                  {v.loaders.length ? ` · ${v.loaders.join(", ")}` : ""}
                </div>
              </div>
              {current ? (
                <button
                  disabled
                  className="flex cursor-default items-center gap-1.5 rounded-md border border-patina-500/40 bg-patina-500/10 px-3 py-1.5 text-xs font-semibold text-patina-400"
                >
                  <Check size={12} /> {t("versionList.installed")}
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (anyBusy) return;
                    setPicked(v.version_id);
                    onPick(v.version_id);
                  }}
                  disabled={anyBusy}
                  className="brass-btn flex items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {(busy || picked === v.version_id) && (
                    <Loader2 size={12} className="animate-spin" />
                  )}
                  {picked === v.version_id ? t("versionList.installing") : actionLabel}
                </button>
              )}
            </div>
            <Collapse open={expanded}>
              <Changelog
                instanceId={instanceId}
                projectId={projectId}
                versionId={v.version_id}
                source={source}
                enabled={expanded}
              />
            </Collapse>
          </div>
        );
      })}
    </div>
  );
}
