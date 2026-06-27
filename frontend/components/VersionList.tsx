import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Check } from "lucide-react";
import { Changelog } from "@/components/Markdown";
import { Collapse } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { ContentVersion } from "@/lib/types";

export function VersionList({
  instanceId,
  projectId,
  source,
  versions,
  busy,
  onPick,
  actionLabel,
  installedVersion,
  locked,
  showLatestBadge,
}: {
  instanceId: string;
  projectId: string;
  source: string;
  versions: ContentVersion[] | null;
  busy?: string | null;
  onPick: (versionId: string) => void;
  actionLabel?: string;
  installedVersion?: string | null;
  locked?: boolean;
  showLatestBadge?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setPicked(null);
  }, [busy]);
  const anyBusy = !!busy || picked !== null;

  if (versions === null)
    return (
      <div className="grid place-items-center py-10 text-ink-600">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (versions.length === 0)
    return (
      <div className="py-10 text-center text-sm text-ink-600">
        {t("versionList.noVersions")}
      </div>
    );

  const label = actionLabel ?? t("mods.install");
  return (
    <div className="flex flex-col gap-1.5">
      {versions.map((v, i) => {
        const expanded = open === v.version_id;
        const installed = installedVersion === v.version_id;
        const installingThis = busy === v.version_id || picked === v.version_id;
        return (
          <div
            key={v.version_id}
            className={`overflow-hidden rounded-md border bg-ink-850/40 transition ${
              installed ? "border-brass-500/40" : "border-edge"
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => setOpen(expanded ? null : v.version_id)}
                title={t("settings.updates.changelog")}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded transition ${
                  expanded
                    ? "bg-brass-500/15 text-brass-300"
                    : "text-ink-600 hover:text-brass-300"
                }`}
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              <button
                onClick={() => setOpen(expanded ? null : v.version_id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[13px] text-gray-100">
                    {v.version_number}
                  </span>
                  {showLatestBadge && i === 0 && (
                    <span className="rounded bg-brass-500/15 px-1.5 text-[9px] text-brass-300">
                      {t("addContent.latest")}
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-ink-600">
                  {v.game_versions.join(", ")}
                  {v.loaders.length ? ` · ${v.loaders.join(", ")}` : ""}
                </div>
              </button>
              {installed ? (
                <span className="flex shrink-0 items-center gap-1 rounded-md border border-patina-500/40 bg-patina-500/10 px-3 py-1.5 text-xs font-medium text-patina-400">
                  <Check size={12} /> {t("versionList.installed")}
                </span>
              ) : (
                <button
                  disabled={anyBusy || locked}
                  onClick={() => {
                    if (anyBusy || locked) return;
                    setPicked(v.version_id);
                    onPick(v.version_id);
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-brass-500/15 px-3 py-1.5 text-xs font-medium text-brass-300 transition hover:bg-brass-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {installingThis ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      {t("versionList.installing")}
                    </>
                  ) : (
                    label
                  )}
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
