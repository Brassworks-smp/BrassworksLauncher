import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { InstalledSchematic } from "@/lib/types";
import type {
  InstalledMod,
  Instance,
  SchematicRequiredMod,
  SearchHit,
} from "@/lib/types";
import { EMPTY_FILTERS } from "@/lib/types";
import { accentForProvider, AddSchematicModal } from "./AddSchematicModal";
import { AddContentModal } from "./AddContentModal";
import { CachedImage } from "./CachedImage";
import { SegmentedTabs, Skeleton } from "./ui";

const schematicsCache = new Map<string, InstalledSchematic[]>();

type RequiredContentTarget = {
  hit: SearchHit;
  instance: Instance;
  installed: Record<string, string | null>;
  installedPaths: Record<string, string>;
};

const normalizedModName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function SchematicSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-lg border border-edge bg-ink-900/50 p-2.5"
        >
          <Skeleton className="h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function SchematicRow({
  schematic,
  onOpen,
  onRemove,
}: {
  schematic: InstalledSchematic;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [imageFailed, setImageFailed] = useState(false);
  const hasMetadata = !!schematic.source && !!schematic.project_id;
  return (
    <div
      style={schematic.source ? accentForProvider(schematic.source) : undefined}
      role={hasMetadata ? "button" : undefined}
      tabIndex={hasMetadata ? 0 : undefined}
      onClick={() => hasMetadata && onOpen()}
      onKeyDown={(event) => {
        if (hasMetadata && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`group/row cv-auto rounded-lg border border-edge bg-ink-900/50 transition-colors ${
        hasMetadata
          ? "cursor-pointer hover:border-brass-500/45 hover:bg-brass-500/[0.04]"
          : ""
      }`}
    >
      <div className="flex items-center gap-3 p-2.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-ink-600">
          {schematic.image_url && !imageFailed ? (
            <CachedImage
              src={schematic.image_url}
              alt={schematic.title}
              className="h-full w-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Boxes size={17} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-sm font-medium text-gray-100 ${
                hasMetadata ? "group-hover/row:text-brass-300" : ""
              }`}
            >
              {schematic.title}
            </span>
            {hasMetadata && <ExternalLink size={10} className="shrink-0 text-ink-600" />}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-600">
            {hasMetadata && (
              <span className="shrink-0 rounded bg-brass-500/15 px-1.5 text-[9px] font-medium text-brass-300">
                {schematic.source === "createmod" ? "CreateMod.com" : schematic.source === "minecraft-schematics" ? "Minecraft Schematics" : schematic.source === "abfielder" ? "Abfielder" : schematic.source}
              </span>
            )}
            <span className="truncate">
              {schematic.description || schematic.filename}
            </span>
            {schematic.author && (
              <span className="shrink-0">· {t("schematics.by")} {schematic.author}</span>
            )}
          </div>
        </div>
        {!hasMetadata && (
          <span className="rounded-md border border-edge bg-ink-900/60 px-2 py-1 text-[10px] uppercase tracking-wide text-ink-600">
            {t("schematics.local")}
          </span>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title={t("common.remove")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-600 transition-[color,background-color,transform] duration-150 hover:bg-red-500/10 hover:text-red-300 active:scale-[.97]"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function SchematicsView({ instanceId }: { instanceId: string }) {
  const t = useT();
  const [schematics, setSchematics] = useState<InstalledSchematic[] | null>(
    () => schematicsCache.get(instanceId) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [detailProject, setDetailProject] = useState<InstalledSchematic | null>(null);
  const [requiredContent, setRequiredContent] = useState<RequiredContentTarget | null>(null);

  const load = useCallback(() => {
    if (!api.isTauri()) {
      setSchematics([]);
      return;
    }
    setLoading(true);
    api
      .listSchematics(instanceId)
      .then((items) => {
        schematicsCache.set(instanceId, items);
        setSchematics(items);
        setError(null);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
  }, [instanceId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const all = schematics?.length ?? 0;
    const bySource = new Map<string, number>();
    for (const item of schematics ?? []) bySource.set(item.source ?? "local", (bySource.get(item.source ?? "local") ?? 0) + 1);
    return { all, bySource };
  }, [schematics]);

  const filtered = useMemo(() => {
    let items = schematics ?? [];
    if (source !== "all") {
      items = items.filter((item) => (item.source ?? "local") === source);
    }
    const needle = query.trim().toLowerCase();
    if (needle) {
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(needle) ||
          item.filename.toLowerCase().includes(needle) ||
          item.author?.toLowerCase().includes(needle),
      );
    }
    return items;
  }, [query, schematics, source]);

  const remove = (schematic: InstalledSchematic) => {
    setSchematics((items) => items?.filter((item) => item.path !== schematic.path) ?? []);
    api.removeSchematic(instanceId, schematic.path).then(() => {
      toast(t("schematics.removed", { name: schematic.title }), "success");
      load();
    }).catch((reason) => {
      setError(String(reason));
      load();
    });
  };

  const openRequiredMod = async (mod: SchematicRequiredMod) => {
    const preferred: "modrinth" | "curseforge" | null = mod.image_url?.includes("cdn.modrinth.com")
      ? "modrinth"
      : mod.image_url?.includes("forgecdn.net")
        ? "curseforge"
        : null;
    const sources: Array<"modrinth" | "curseforge"> = preferred
      ? [preferred, preferred === "modrinth" ? "curseforge" : "modrinth"]
      : ["modrinth", "curseforge"];
    const wanted = normalizedModName(mod.name);
    let hit: SearchHit | null = null;

    for (const candidateSource of sources) {
      const results = await api
        .searchContent(
          instanceId,
          mod.name,
          "mod",
          candidateSource,
          0,
          EMPTY_FILTERS,
        )
        .catch(() => []);
      hit =
        results.find(
          (item) =>
            normalizedModName(item.title) === wanted ||
            normalizedModName(item.slug) === normalizedModName(mod.id),
        ) ?? results[0] ?? null;
      if (hit) break;
    }

    if (!hit) {
      toast(t("schematics.modProviderNotFound", { name: mod.name }), "error");
      return;
    }

    const [instance, mods] = await Promise.all([
      api.getInstance(instanceId),
      api.listMods(instanceId),
    ]);
    const installed = Object.fromEntries(
      mods.flatMap((item: InstalledMod) =>
        item.project_id
          ? [[`${item.source}:${item.project_id}`, item.version_id] as const]
          : [],
      ),
    );
    const installedPaths = Object.fromEntries(
      mods.flatMap((item: InstalledMod) =>
        item.project_id && !item.managed
          ? [[`${item.source}:${item.project_id}`, item.path] as const]
          : [],
      ),
    );
    setRequiredContent({ hit, instance, installed, installedPaths });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden px-1 -mx-1">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="font-mc text-2xl tracking-wide text-gray-100">
            {t("schematics.heroTitle")}
          </h1>
          <p className="text-sm text-ink-600">
            {schematics
              ? t("schematics.installed", { count: schematics.length })
              : t("common.loading")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAdding(true)}
            className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            <Plus size={16} /> {t("schematics.addSchematics")}
          </button>
          <button
            onClick={() => api.openSchematicFolder(instanceId).catch((reason) => setError(String(reason)))}
            className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <FolderOpen size={15} /> {t("schematics.folder")}
          </button>
          <button
            onClick={load}
            title={t("common.refresh")}
            className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <SegmentedTabs
          value={source}
          onChange={(value) => setSource(value as typeof source)}
          options={[
            { id: "all", label: <>{t("mods.all")} <span className="ml-1.5 tabular-nums text-ink-600">{counts.all}</span></> },
            ...Array.from(counts.bySource.entries()).map(([id, count]) => ({ id, label: <>{id === "createmod" ? "CreateMod.com" : id === "minecraft-schematics" ? "Minecraft Schematics" : id === "abfielder" ? "Abfielder" : t("schematics.local")} <span className="ml-1.5 tabular-nums text-ink-600">{count}</span></> })),
          ]}
        />
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("schematics.searchInstalled")}
            className="w-full rounded-lg bg-ink-900/50 py-2 pl-9 pr-3 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto pr-1">
        {schematics === null ? (
          <SchematicSkeleton />
        ) : (
          <div key={`${source}:${query}`} className="reveal-down flex flex-1 flex-col gap-2">
            {filtered.map((schematic) => (
              <SchematicRow
                key={schematic.path}
                schematic={schematic}
                onOpen={() => setDetailProject(schematic)}
                onRemove={() => remove(schematic)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="grid flex-1 place-items-center py-16 text-center text-ink-600">
                <div>
                  <Boxes size={28} className="mx-auto mb-2 opacity-50" />
                  {schematics.length === 0
                    ? t("schematics.emptyInstalled")
                    : t("schematics.noInstalledResults")}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {(adding || detailProject) && schematics && (
        <AddSchematicModal
          instanceId={instanceId}
          installed={schematics}
          initialProject={detailProject}
          onClose={() => {
            setAdding(false);
            setDetailProject(null);
          }}
          onInstalled={load}
          onOpenRequiredMod={openRequiredMod}
          suspended={!!requiredContent}
        />
      )}

      {requiredContent && (
        <AddContentModal
          instanceId={instanceId}
          mc={requiredContent.instance.minecraft_version}
          loader={requiredContent.instance.loader}
          installed={requiredContent.installed}
          installedPaths={requiredContent.installedPaths}
          initial={requiredContent.hit}
          initialType="mod"
          initialSource={requiredContent.hit.source === "curseforge" ? "curseforge" : "modrinth"}
          onClose={() => setRequiredContent(null)}
          onInstalled={(mod) => {
            setRequiredContent((current) =>
              current
                ? {
                    ...current,
                    installed: {
                      ...current.installed,
                      [`${mod.source}:${mod.project_id}`]: mod.version_id,
                    },
                    installedPaths: {
                      ...current.installedPaths,
                      [`${mod.source}:${mod.project_id}`]: mod.path,
                    },
                  }
                : null,
            );
          }}
          onUninstalled={(path) => {
            setRequiredContent((current) => {
              if (!current) return null;
              const key = Object.entries(current.installedPaths).find(
                ([, installedPath]) => installedPath === path,
              )?.[0];
              if (!key) return current;
              const installed = { ...current.installed };
              const installedPaths = { ...current.installedPaths };
              delete installed[key];
              delete installedPaths[key];
              return { ...current, installed, installedPaths };
            });
          }}
        />
      )}
    </div>
  );
}
