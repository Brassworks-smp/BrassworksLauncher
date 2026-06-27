import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import {
  X,
  Download,
  Check,
  Loader2,
  Box,
  Image as ImageIcon,
  Sparkles,
  ChevronLeft,
  ListChecks,
  Unlock,
  Users,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { ResultRow, BrowseResults, DetailShell } from "./Browse";
import { useFilters } from "./FilterSidebar";
import { VersionList } from "./VersionList";
import { Markdown } from "./Markdown";
import { SegmentedTabs, useClosable } from "./ui";
import { useT } from "@/lib/i18n";
import type {
  ContentVersion,
  InstalledMod,
  LoaderKind,
  ProjectDetail,
  SearchHit,
} from "@/lib/types";

export type ProjectType = "mod" | "resourcepack" | "shader";
export type Source = "modrinth" | "curseforge";


const LOADER_TKEY: Record<LoaderKind, string> = {
  vanilla: "instanceSettings.loader.vanilla",
  neo_forge: "instanceSettings.loader.neoforge",
  forge: "instanceSettings.loader.forge",
  fabric: "instanceSettings.loader.fabric",
  quilt: "instanceSettings.loader.quilt",
};

const SOURCES: { id: Source; tkey: string; color: string }[] = [
  { id: "modrinth", tkey: "mods.modrinth", color: "#54e596" },
  { id: "curseforge", tkey: "mods.curseforge", color: "#f58c6b" },
];

const keyOf = (h: { source: string; project_id: string }) =>
  `${h.source}:${h.project_id}`;

const CURSEFORGE_ACCENT_DARK: CSSProperties = {
  ["--color-brass-300" as string]: "#ffb591",
  ["--color-brass-400" as string]: "#f58c6b",
  ["--color-brass-500" as string]: "#f16436",
  ["--color-brass-600" as string]: "#d8521f",
  ["--color-brass-700" as string]: "#a83f17",
};
const CURSEFORGE_ACCENT_LIGHT: CSSProperties = {
  ["--color-brass-300" as string]: "#c2410c",
  ["--color-brass-400" as string]: "#c2410c",
  ["--color-brass-500" as string]: "#ea580c",
  ["--color-brass-600" as string]: "#c2410c",
  ["--color-brass-700" as string]: "#9a3412",
};
const MODRINTH_ACCENT_DARK: CSSProperties = {
  ["--color-brass-300" as string]: "#5fe393",
  ["--color-brass-400" as string]: "#34d27a",
  ["--color-brass-500" as string]: "#1fbf63",
  ["--color-brass-600" as string]: "#18a153",
  ["--color-brass-700" as string]: "#14803f",
};
const MODRINTH_ACCENT_LIGHT: CSSProperties = {
  ["--color-brass-300" as string]: "#15803d",
  ["--color-brass-400" as string]: "#15803d",
  ["--color-brass-500" as string]: "#1bbf5f",
  ["--color-brass-600" as string]: "#15a34a",
  ["--color-brass-700" as string]: "#0e7a37",
};

const TABS: { id: ProjectType; tkey: string; icon: typeof Box }[] = [
  { id: "mod", tkey: "mods.catMods", icon: Box },
  { id: "resourcepack", tkey: "mods.catResourcePacks", icon: ImageIcon },
  { id: "shader", tkey: "mods.catShaders", icon: Sparkles },
];

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function AddContentModal({
  instanceId,
  mc,
  loader,
  installed,
  lockedIds,
  initial,
  initialType,
  initialSource,
  onClose,
  onInstalled,
  onUnlock,
}: {
  instanceId: string;

  mc: string;
  loader: LoaderKind;
  installed: Record<string, string | null>;
  lockedIds?: string[];
  initial?: SearchHit | null;
  initialType?: ProjectType;
  initialSource?: Source;
  onClose: () => void;
  onInstalled: (mod: InstalledMod) => void;

  onUnlock?: () => void;
}) {
  const t = useT();
  const [type, setType] = useState<ProjectType>(
    (initial?.project_type as ProjectType) || initialType || "mod",
  );
  const [source, setSource] = useState<Source>(
    (initial?.source as Source) === "curseforge"
      ? "curseforge"
      : initial
        ? "modrinth"
        : initialSource ?? "modrinth",
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchHit | null>(initial ?? null);
  const { closing, close } = useClosable(onClose);
  const openDetail = (hit: SearchHit) => setSelected(hit);
  const goBack = () => setSelected(null);
  const lockedSet = new Set(lockedIds ?? []);
  const detailOnly = !!initial;
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-light");
  const accent =
    source === "curseforge"
      ? isLight
        ? CURSEFORGE_ACCENT_LIGHT
        : CURSEFORGE_ACCENT_DARK
      : isLight
        ? MODRINTH_ACCENT_LIGHT
        : MODRINTH_ACCENT_DARK;

  const filtering = useFilters(
    () => api.contentFilterOptions(instanceId, type, source),
    `${instanceId}:${type}:${source}`,
  );
  const filtersOpen = filtering.open;

  const fetchPage = useCallback(
    (q: string, offset: number) =>
      api.searchContent(instanceId, q, type, source, offset, filtering.filters),
    [instanceId, type, source, filtering.filters],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" &&
      (selected && !detailOnly ? goBack() : close());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, selected, detailOnly]);

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="rise flex h-[80vh] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl transition-[width,color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          width: !detailOnly && filtersOpen ? "min(1080px, 96vw)" : "820px",
          ...accent,
        }}
      >
        {}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            {selected && (
              <button
                onClick={() => (detailOnly ? close() : goBack())}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:-translate-x-0.5 hover:text-gray-200"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="font-mc text-lg tracking-wide text-gray-100">
              {selected ? selected.title : t("mods.addContent")}
            </h2>
            {selected ? (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  selected.source === "curseforge"
                    ? "badge-curseforge"
                    : "badge-modrinth"
                }`}
              >
                {api.sourceLabel(selected.source)}
              </span>
            ) : (
              <SegmentedTabs
                size="sm"
                value={source}
                onChange={(v) => setSource(v as Source)}
                options={SOURCES.map((s) => ({ id: s.id, label: t(s.tkey) }))}
              />
            )}
          </div>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!detailOnly && (
            <BrowseResults
              hidden={!!selected}
              source={source}
              query={query}
              onQueryChange={setQuery}
              autoFocusSearch
              placeholder={t("addContent.searchPlaceholder", {
                source: api.sourceLabel(source),
                type: t(
                  TABS.find((tb) => tb.id === type)?.tkey ?? "mods.title",
                ).toLowerCase(),
              })}
              headerLeft={
                <SegmentedTabs
                  value={type}
                  onChange={(v) => setType(v as ProjectType)}
                  options={TABS.map(({ id, tkey, icon: Icon }) => ({
                    id,
                    label: t(tkey),
                    icon: <Icon size={14} />,
                  }))}
                />
              }
              filtering={filtering}
              fetchPage={fetchPage}
              resetKey={`${type}:${source}`}
              scrollKeyBase={`${type}:${source}`}
              accent={accent}
              onOpen={openDetail}
              emptyText={t("addContent.noResults")}
              startTypingText={t("addContent.startTyping", {
                source: api.sourceLabel(source),
              })}
              renderRow={(hit, open) => (
                <ResultRow
                  key={`${hit.source}:${hit.project_id}`}
                  hit={hit}
                  installed={keyOf(hit) in installed}
                  onOpen={open}
                  onQuickInstall={async () => {
                    try {
                      const res = await api.installContent(
                        instanceId,
                        hit.project_id,
                        type,
                        hit.source,
                      );
                      const n = res.dependencies.length;
                      toast(
                        n
                          ? t("addContent.installedDeps", { name: res.item.name, n })
                          : t("addContent.installedToast", { name: res.item.name }),
                        "success",
                      );
                      onInstalled(res.item);
                    } catch (e) {
                      toast(String(e), "error");
                      throw e;
                    }
                  }}
                />
              )}
              footer={t("addContent.compatNote", {
                mc,
                loader:
                  type === "mod" && loader !== "vanilla"
                    ? ` · ${t(LOADER_TKEY[loader])}`
                    : "",
              })}
            />
          )}
          {selected && (
            <div className="flex min-h-0 flex-1 flex-col swap-in">
              <DetailView
                instanceId={instanceId}
                hit={selected}
                type={type}
                installedVersion={installed[keyOf(selected)]}
                isInstalled={keyOf(selected) in installed}
                locked={lockedSet.has(keyOf(selected))}
                onInstalled={onInstalled}
                onUnlock={onUnlock}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailView({
  instanceId,
  hit,
  type,
  installedVersion,
  isInstalled,
  locked,
  onInstalled,
  onUnlock,
}: {
  instanceId: string;
  hit: SearchHit;
  type: ProjectType;
  installedVersion: string | null | undefined;
  isInstalled: boolean;
  locked: boolean;
  onInstalled: (mod: InstalledMod) => void;
  onUnlock?: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .contentDetail(instanceId, hit.project_id, hit.source)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e)));
    api
      .contentVersions(instanceId, hit.project_id, type, hit.source)
      .then((v) => alive && setVersions(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [instanceId, hit.project_id, hit.source, type]);

  const latest = versions?.[0];
  const updateAvailable =
    isInstalled && latest && installedVersion !== latest.version_id;

  const install = (versionId?: string) => {
    setBusy(versionId ?? "latest");
    setError(null);
    const p = versionId
      ? api.installContentVersion(
          instanceId,
          hit.project_id,
          versionId,
          type,
          hit.source,
        )
      : api.installContent(instanceId, hit.project_id, type, hit.source);
    p.then((res) => {
      const n = res.dependencies.length;
      toast(
        n
          ? t("addContent.installedDeps", { name: res.item.name, n })
          : t("addContent.installedToast", { name: res.item.name }),
        "success",
      );
      onInstalled(res.item);
    })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(null));
  };

  const subtitle = (
    <>
      <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">
        {detail?.description ?? hit.description}
      </p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-600">
        <Users size={11} />{" "}
        {t("addContent.downloads", {
          count: fmtDownloads(hit.downloads || detail?.downloads || 0),
        })}
        {latest && (
          <span className="ml-2 font-mono">
            {t("addContent.latestVersion", { version: latest.version_number })}
          </span>
        )}
      </div>
    </>
  );

  const actions = (
    <>
      {locked ? (
        onUnlock ? (
          <button
            onClick={onUnlock}
            title={t("addContent.unlockTitle")}
            className="flex w-32 flex-col items-center gap-1 rounded-md border border-edge bg-ink-850/60 px-3 py-2 text-center text-[11px] leading-snug text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Unlock size={14} />
            {t("addContent.managedUnlock")}
          </button>
        ) : (
          <div className="w-32 rounded-md border border-edge bg-ink-850/60 px-3 py-2 text-center text-[11px] leading-snug text-ink-600">
            {t("addContent.managedLocked")}
          </div>
        )
      ) : (
        <button
          disabled={!!busy}
          onClick={() => install()}
          className="flex items-center justify-center gap-1.5 rounded-md bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-60"
        >
          {busy === "latest" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : updateAvailable ? (
            <>
              <Download size={15} /> {t("addContent.update")}
            </>
          ) : isInstalled ? (
            <>
              <Check size={15} /> {t("addContent.reinstall")}
            </>
          ) : (
            <>
              <Download size={15} /> {t("common.add")}
            </>
          )}
        </button>
      )}
      <button
        onClick={() => setShowVersions((v) => !v)}
        aria-pressed={showVersions}
        title={showVersions ? t("addContent.backToDescription") : t("addContent.showAllVersions")}
        className={`flex items-center justify-center gap-1.5 rounded-md border px-4 py-2 text-xs transition ${
          showVersions
            ? "border-brass-500/50 bg-brass-500/15 text-brass-200"
            : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
        }`}
      >
        {showVersions ? <ChevronLeft size={14} /> : <ListChecks size={14} />}
        {showVersions ? t("addContent.description") : t("addContent.versions")}
      </button>
    </>
  );

  return (
    <DetailShell
      hit={hit}
      onExternal={() =>
        api
          .openExternal(
            detail?.url ?? api.sourceUrl(hit.source, hit.slug || hit.project_id),
          )
          .catch(() => {})
      }
      externalTitle={t("mods.viewOn", { source: api.sourceLabel(hit.source) })}
      subtitle={subtitle}
      actions={actions}
      error={error}
      showVersions={showVersions}
      bodyNode={
        detail ? (
          <Markdown>{detail.body || detail.description}</Markdown>
        ) : (
          <div className="grid place-items-center py-10 text-ink-600">
            <Loader2 className="animate-spin" />
          </div>
        )
      }
      versionsNode={
        <VersionList
          instanceId={instanceId}
          projectId={hit.project_id}
          source={hit.source}
          versions={versions}
          installedVersion={installedVersion}
          busy={busy}
          locked={locked}
          showLatestBadge
          onPick={(v) => install(v)}
        />
      }
    />
  );
}
