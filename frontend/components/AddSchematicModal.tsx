import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Box,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  Eye,
  History,
  Image as ImageIcon,
  Maximize2,
  Package,
  Loader2,
  Ruler,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type {
  FilterOptions,
  InstalledSchematic,
  SchematicCard,
  SchematicDetail,
  SchematicHome,
  SchematicRequiredMod,
  SearchFilters,
  SearchHit,
} from "@/lib/types";
import { EMPTY_FILTERS } from "@/lib/types";
import { BrowseResults, DetailShell, ResultRow } from "./Browse";
import { countActiveFilters, useFilters } from "./FilterSidebar";
import { Markdown } from "./Markdown";
import { Dropdown, SegmentedTabs, useClosable } from "./ui";
import { CachedImage } from "./CachedImage";

const CREATE_MOD_ACCENT_DARK: CSSProperties = {
  ["--color-brass-300" as string]: "#93c5fd",
  ["--color-brass-400" as string]: "#60a5fa",
  ["--color-brass-500" as string]: "#3b82f6",
  ["--color-brass-600" as string]: "#2563eb",
  ["--color-brass-700" as string]: "#1d4ed8",
};

const CREATE_MOD_ACCENT_LIGHT: CSSProperties = {
  ["--color-brass-300" as string]: "#1d4ed8",
  ["--color-brass-400" as string]: "#2563eb",
  ["--color-brass-500" as string]: "#3b82f6",
  ["--color-brass-600" as string]: "#2563eb",
  ["--color-brass-700" as string]: "#1e40af",
};

const SORTS = [
  "best_match",
  "trending",
  "newest",
  "oldest",
  "highest_rated",
  "lowest_rated",
  "most_viewed",
  "least_viewed",
];

const cardToHit = (card: SchematicCard): SearchHit => ({
  project_id: card.name,
  slug: card.name,
  title: card.title || card.name,
  description: card.categories.slice(0, 3).join(" · "),
  icon_url: card.featured_image,
  downloads: card.downloads,
  author: card.author ?? "",
  project_type: "schematic",
  versions: [],
  source: "modrinth",
  categories: card.categories,
});

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

function ProviderBadge() {
  return (
    <span className="shrink-0 rounded bg-brass-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brass-300">
      CreateMod.com
    </span>
  );
}

function HomeSection({
  title,
  cards,
  installed,
  onOpen,
  onInstall,
}: {
  title: string;
  cards: SchematicCard[];
  installed: Set<string>;
  onOpen: (hit: SearchHit) => void;
  onInstall: (name: string) => Promise<void>;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <span className="h-3.5 w-1 rounded-full bg-brass-500" />
        <h3 className="font-mc text-[13px] tracking-wide text-gray-100">{title}</h3>
      </div>
      <div className="flex flex-col gap-2">
        {cards.map((card) => {
          const hit = cardToHit(card);
          return (
            <ResultRow
              key={`${title}:${card.name}`}
              hit={hit}
              installed={installed.has(card.name)}
              onOpen={() => onOpen(hit)}
              onQuickInstall={() => onInstall(card.name)}
            />
          );
        })}
      </div>
    </section>
  );
}

function SchematicFilters({
  open,
  options,
  loading,
  filters,
  onChange,
  accent,
}: {
  open: boolean;
  options: FilterOptions | null;
  loading: boolean;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  accent: CSSProperties;
}) {
  const t = useT();
  const patch = (next: Partial<SearchFilters>) => onChange({ ...filters, ...next });
  const active = countActiveFilters(filters);
  return (
    <aside
      aria-hidden={!open}
      style={accent}
      className={`shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? "w-64 opacity-100" : "w-0 opacity-0"
      }`}
    >
      <div className="flex h-full w-64 flex-col border-r border-edge">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-600">
            <SlidersHorizontal size={13} /> {t("mods.filter.tabFilters")}
          </span>
          {active > 0 && (
            <button
              onClick={() => onChange({ ...EMPTY_FILTERS })}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-600 transition-colors hover:text-brass-300 active:scale-[.97]"
            >
              <X size={13} /> {t("mods.filter.clear")}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {loading && !options ? (
            <p className="py-4 text-xs text-ink-600">{t("mods.filter.loading")}</p>
          ) : (
            <>
              <FilterSection title={t("mods.filter.sort")}>
                <Dropdown
                  value={filters.sort ?? "best_match"}
                  onChange={(sort) => patch({ sort: sort === "best_match" ? null : sort })}
                  options={SORTS.map((sort) => ({
                    value: sort,
                    label: t(`schematics.sort.${sort}`),
                  }))}
                  accentStyle={accent}
                />
              </FilterSection>
              <FilterSection title={t("schematics.allCategories")}>
                <div className="flex flex-wrap gap-1.5">
                  {(options?.categories ?? []).map((category) => {
                    const selected = filters.categories[0] === category.id;
                    return (
                      <button
                        key={category.id}
                        onClick={() => patch({ categories: selected ? [] : [category.id] })}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors active:scale-[.97] ${
                          selected
                            ? "border-brass-500/60 bg-brass-500/15 text-brass-200"
                            : "border-edge text-ink-600 hover:border-brass-500/40 hover:text-brass-300"
                        }`}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              </FilterSection>
              <FilterSection title={t("schematics.allMcVersions")}>
                <Dropdown
                  value={filters.gameVersions[0] ?? ""}
                  onChange={(value) => patch({ gameVersions: value ? [value] : [] })}
                  options={[
                    { value: "", label: t("schematics.anyVersion") },
                    ...(options?.gameVersions ?? []).map((value) => ({ value, label: value })),
                  ]}
                  accentStyle={accent}
                />
              </FilterSection>
              <FilterSection title={t("schematics.allCreateVersions")}>
                <Dropdown
                  value={filters.loaders[0] ?? ""}
                  onChange={(value) => patch({ loaders: value ? [value] : [] })}
                  options={[
                    { value: "", label: t("schematics.anyVersion") },
                    ...(options?.loaders ?? []).map((value) => ({ value, label: value })),
                  ]}
                  accentStyle={accent}
                />
              </FilterSection>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-600">
        {title}
      </h4>
      {children}
    </div>
  );
}

const formatUploaded = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
};

function GalleryLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const move = useCallback(
    (amount: number) => {
      setLoaded(false);
      setFailed(false);
      onIndex((index + amount + images.length) % images.length);
    },
    [images.length, index, onIndex],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close, move]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex flex-col bg-black/85 p-6 backdrop-blur-sm ${
        closing ? "fade-out" : "fade-in"
      }`}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div className="flex items-center justify-between pb-3 text-gray-200">
        <div className="min-w-0">
          <div className="truncate font-mc text-sm tracking-wide">{t("schematics.gallery")}</div>
          <div className="text-[11px] text-ink-600">{index + 1}/{images.length}</div>
        </div>
        <button
          onClick={close}
          className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          aria-label={t("schematics.closeImage")}
        >
          <X size={17} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {images.length > 1 && (
          <button
            onClick={() => move(-1)}
            className="absolute left-0 grid h-11 w-11 place-items-center rounded-full bg-ink-900/70 text-gray-300 transition hover:bg-ink-800"
            aria-label={t("schematics.previousImage")}
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {!loaded && !failed && (
          <Loader2 size={26} className="absolute animate-spin text-ink-600" />
        )}
        {failed && (
          <div className="flex flex-col items-center gap-2 text-ink-600">
            <ImageIcon size={30} className="opacity-40" />
            <span className="text-xs">{t("screenshots.loadFailed")}</span>
          </div>
        )}
        <CachedImage
          key={images[index]}
          src={images[index]}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`max-h-full max-w-full rounded-lg object-contain transition-opacity ${
            loaded && !failed ? "opacity-100" : "opacity-0"
          }`}
        />
        {images.length > 1 && (
          <button
            onClick={() => move(1)}
            className="absolute right-0 grid h-11 w-11 place-items-center rounded-full bg-ink-900/70 text-gray-300 transition hover:bg-ink-800"
            aria-label={t("schematics.nextImage")}
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SchematicGallery({ images }: { images: string[] }) {
  const t = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("schematics.gallery")}</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.slice(0, 9).map((image, index) => (
            <button
              key={image}
              onClick={() => setOpenIndex(index)}
              className="group/image relative overflow-hidden rounded-lg border border-edge bg-ink-900 text-left transition hover:border-brass-500/50"
            >
              <CachedImage src={image} alt="" loading="lazy" decoding="async" className="aspect-video w-full object-cover transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/image:scale-[1.025]" />
              <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover/image:opacity-100">
                <Maximize2 size={13} />
              </span>
            </button>
          ))}
        </div>
      </section>
      {openIndex != null && (
        <GalleryLightbox images={images} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}

function MaterialIcon({ blockId, name }: { blockId: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!blockId || failed) return <Box size={16} className="text-ink-600" />;
  const src = `https://blocksitems.com/api/v1/blocks/${encodeURIComponent(blockId)}/icon?size=64`;
  return <CachedImage src={src} alt={name} loading="lazy" className="h-8 w-8 object-contain" onError={() => setFailed(true)} />;
}

function RequiredModCard({
  mod,
  onOpen,
}: {
  mod: SchematicDetail["required_mod_details"][number];
  onOpen: (mod: SchematicRequiredMod) => Promise<void>;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onOpen(mod);
    } catch (reason) {
      toast(t("schematics.modOpenFailed", { name: mod.name, error: String(reason) }), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={open}
      className="group/mod flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-ink-900/40 py-2 pl-2 pr-2.5 text-left transition hover:border-brass-500/45 hover:bg-brass-500/[0.04]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-900 text-ink-600">
        {mod.image_url && !failed ? (
          <CachedImage src={mod.image_url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <Package size={16} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-gray-200">{mod.name}</span>
        <span className="block truncate text-[10px] text-ink-600">{mod.id}</span>
      </span>
      <span className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-600 transition group-hover/mod:bg-brass-500/12 group-hover/mod:text-brass-300">
        {busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Download size={13} />
        )}
      </span>
    </button>
  );
}

function SchematicDetailView({
  instanceId,
  hit,
  installed,
  onInstalled,
  onOpenRequiredMod,
}: {
  instanceId: string;
  hit: SearchHit;
  installed: InstalledSchematic | null;
  onInstalled: () => void;
  onOpenRequiredMod: (mod: SchematicRequiredMod) => Promise<void>;
}) {
  const t = useT();
  const [detail, setDetail] = useState<SchematicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedMaterials, setCopiedMaterials] = useState(false);
  const [removed, setRemoved] = useState(false);
  const effectiveInstalled = removed ? null : installed;

  useEffect(() => {
    let alive = true;
    setRemoved(false);
    setDetail(null);
    setError(null);
    api
      .schematicDetail(hit.project_id)
      .then((item) => alive && setDetail(item))
      .catch((reason) => alive && setError(String(reason)));
    return () => {
      alive = false;
    };
  }, [hit.project_id]);

  const install = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.downloadSchematic(instanceId, hit.project_id);
      toast(t("schematics.imported"), "success");
      setRemoved(false);
      onInstalled();
    } catch (reason) {
      setError(String(reason));
      toast(t("schematics.downloadFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async () => {
    if (busy || !effectiveInstalled) return;
    setBusy(true);
    try {
      await api.removeSchematic(instanceId, effectiveInstalled.filename);
      setRemoved(true);
      toast(t("schematics.removed", { name: effectiveInstalled.title }), "success");
      onInstalled();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyMaterials = async () => {
    if (!detail?.materials.length) return;
    const text = detail.materials
      .map((material) => `- ${material.count > 0 ? `${material.count}× ` : ""}${material.name}${material.block_id ? ` (${material.block_id})` : ""}`)
      .join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopiedMaterials(true);
      toast(t("schematics.materialsCopied"), "success");
      window.setTimeout(() => setCopiedMaterials(false), 1800);
    } catch (reason) {
      toast(String(reason), "error");
    }
  };

  const resolvedHit = detail
    ? { ...hit, title: detail.title || hit.title, icon_url: detail.featured_image }
    : hit;
  const subtitle = (
    <>
      <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">
        {detail?.excerpt || hit.description}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-600">
        {detail?.author && <span>{t("schematics.by")} {detail.author}</span>}
        {detail?.uploaded_at && (
          <span className="flex items-center gap-1"><CalendarDays size={11} /> {formatUploaded(detail.uploaded_at)}</span>
        )}
        <span className="flex items-center gap-1"><Eye size={11} /> {fmt(detail?.views ?? 0)}</span>
        <span className="flex items-center gap-1"><Download size={11} /> {fmt(detail?.downloads ?? hit.downloads)}</span>
        {detail?.rating != null && (
          <span className="flex items-center gap-1"><Star size={11} className="fill-brass-400 text-brass-400" /> {detail.rating.toFixed(1)}</span>
        )}
      </div>
    </>
  );

  return (
    <DetailShell
      hit={resolvedHit}
      badge={<ProviderBadge />}
      subtitle={subtitle}
      onExternal={() => {
        const url = detail?.web_url ?? hit.slug;
        if (url) void api.openExternal(url.startsWith("http") ? url : `https://createmod.com/schematics/${url}`);
      }}
      externalTitle={t("schematics.viewOnSite")}
      actions={
        <button
          disabled={busy}
          onClick={effectiveInstalled ? uninstall : install}
          className={`flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold transition-[color,background-color,transform,opacity] duration-150 active:scale-[.97] disabled:opacity-60 ${
            effectiveInstalled
              ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
              : "bg-brass-500 text-ink-950 hover:bg-brass-400"
          }`}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : effectiveInstalled ? <Trash2 size={15} /> : <Download size={15} />}
          {effectiveInstalled ? t("schematics.uninstall") : t("common.add")}
        </button>
      }
      error={error}
      showVersions={false}
      bodyNode={
        detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-[11px] text-ink-600">
              {(detail.dimensions.x > 0 || detail.dimensions.y > 0) && (
                <span className="flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1">
                  <Ruler size={12} /> {detail.dimensions.x}×{detail.dimensions.y}×{detail.dimensions.z}
                </span>
              )}
              {detail.block_count > 0 && (
                <span className="flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1">
                  <Box size={12} /> {fmt(detail.block_count)} {t("schematics.blocks")}
                </span>
              )}
              {detail.minecraft_version && <span className="rounded-full border border-edge px-2.5 py-1">MC {detail.minecraft_version}</span>}
              {detail.createmod_version && <span className="rounded-full border border-edge px-2.5 py-1">Create {detail.createmod_version}</span>}
            </div>

            {(detail.categories.length > 0 || detail.tags.length > 0) && (
              <section className="rounded-xl border border-edge bg-ink-900/30 p-3">
                {detail.categories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-ink-600">{t("schematics.categories")}</span>
                    {detail.categories.map((category) => (
                      <span key={category} className="rounded-full bg-brass-500/15 px-2 py-1 text-[11px] text-brass-300">{category}</span>
                    ))}
                  </div>
                )}
                {detail.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 first:mt-0">
                    <Tag size={12} className="mr-1 text-ink-600" />
                    {detail.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-edge px-2 py-1 text-[11px] text-ink-500">{tag}</span>
                    ))}
                  </div>
                )}
              </section>
            )}

            <SchematicGallery images={detail.gallery} />

            {detail.description_html ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("schematics.description")}</h4>
                <Markdown>{detail.description_html}</Markdown>
              </section>
            ) : null}

            {detail.required_mod_details.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("schematics.requiredMods")}</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.required_mod_details.map((mod) => (
                    <RequiredModCard key={mod.id} mod={mod} onOpen={onOpenRequiredMod} />
                  ))}
                </div>
                {detail.dependencies_html && <Markdown className="mt-3 text-xs">{detail.dependencies_html.trim()}</Markdown>}
              </section>
            )}

            {detail.materials.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-edge bg-ink-900/30">
                <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-600">{t("schematics.materials")}</h4>
                    <p className="mt-0.5 text-[10px] text-ink-700">{t("schematics.materialCount", { count: detail.materials.length })}</p>
                  </div>
                  <button
                    onClick={copyMaterials}
                    className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-brass-500/45 hover:text-brass-300"
                  >
                    {copiedMaterials ? <Check size={13} /> : <Clipboard size={13} />}
                    {copiedMaterials ? t("schematics.copied") : t("schematics.copyMaterials")}
                  </button>
                </div>
                <div className="grid max-h-80 grid-cols-1 overflow-y-auto sm:grid-cols-2">
                  {detail.materials.map((material, index) => (
                    <div key={`${material.block_id ?? material.name}:${index}`} className="flex items-center gap-2.5 border-b border-edge/60 px-3 py-2 last:border-b-0 sm:odd:border-r">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink-900">
                        <MaterialIcon blockId={material.block_id} name={material.name} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-gray-200">{material.name}</span>
                        {material.block_id && <span className="block truncate font-mono text-[9px] text-ink-700">{material.block_id}</span>}
                      </span>
                      {material.count > 0 && <span className="shrink-0 font-mono text-xs tabular-nums text-brass-300">×{material.count}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {detail.version_history.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-edge bg-ink-900/30">
                <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
                  <History size={14} className="text-brass-300" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-600">{t("schematics.versionHistory")}</h4>
                </div>
                <div>
                  {detail.version_history.map((version) => (
                    <div key={`${version.version}:${version.date}`} className="grid grid-cols-[48px_150px_1fr] gap-3 border-b border-edge/60 px-3 py-2.5 text-xs last:border-0">
                      <span className="font-mono font-semibold text-brass-300">{version.version}</span>
                      <span className="text-ink-600">{version.date}</span>
                      <span className="text-gray-300">{version.changes}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="grid place-items-center py-10 text-ink-600"><Loader2 className="animate-spin" /></div>
        )
      }
      versionsNode={null}
    />
  );
}

export function AddSchematicModal({
  instanceId,
  installed,
  initialProject,
  onClose,
  onInstalled,
  onOpenRequiredMod,
  suspended = false,
}: {
  instanceId: string;
  installed: InstalledSchematic[];
  initialProject?: InstalledSchematic | null;
  onClose: () => void;
  onInstalled: () => void;
  onOpenRequiredMod: (mod: SchematicRequiredMod) => Promise<void>;
  suspended?: boolean;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchHit | null>(
    initialProject?.project_id
      ? {
          project_id: initialProject.project_id,
          slug: initialProject.web_url ?? initialProject.project_id,
          title: initialProject.title,
          description: initialProject.description ?? "",
          icon_url: initialProject.image_url,
          downloads: 0,
          author: initialProject.author ?? "",
          project_type: "schematic",
          versions: [],
          source: "modrinth",
          categories: [],
        }
      : null,
  );
  const [home, setHome] = useState<SchematicHome | null>(null);
  const pageCursor = useRef({ key: "", next: 1 });
  const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("theme-light");
  const accent = isLight ? CREATE_MOD_ACCENT_LIGHT : CREATE_MOD_ACCENT_DARK;
  const installedIds = useMemo(
    () => new Set(installed.flatMap((item) => (item.project_id ? [item.project_id] : []))),
    [installed],
  );
  const installedById = useMemo(
    () =>
      new Map(
        installed.flatMap((item) =>
          item.project_id ? [[item.project_id, item] as const] : [],
        ),
      ),
    [installed],
  );
  const filtering = useFilters(
    async () => {
      const options = await api.schematicsFilters();
      return {
        categories: options.categories.map((item) => ({ id: item.value, name: item.label || item.value, icon: null })),
        gameVersions: options.mc_versions.map((item) => item.value),
        loaders: options.create_versions.map((item) => item.value),
        licenses: [],
        sorts: SORTS,
        supportsEnvironment: false,
        supportsAdvancedFacets: false,
      };
    },
    "schematics:createmod",
  );
  const homeMode = !query.trim() && countActiveFilters(filtering.filters) === 0;

  useEffect(() => {
    if (!homeMode || home) return;
    void api.schematicsHome().then(setHome).catch(() => {});
  }, [homeMode, home]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (suspended || event.defaultPrevented || event.key !== "Escape") return;
      if (selected && !initialProject) setSelected(null);
      else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, initialProject, selected, suspended]);

  const fetchPage = useCallback(
    async (search: string, offset: number) => {
      const firstPage = homeMode ? 2 : 1;
      const cursorKey = `${homeMode}:${search.trim()}:${filtering.key}`;
      const page =
        offset === 0 || pageCursor.current.key !== cursorKey
          ? firstPage
          : pageCursor.current.next;
      const result = await api.schematicsSearch({
        query: search.trim(),
        sort: homeMode ? "trending" : filtering.filters.sort ?? "best_match",
        category: filtering.filters.categories[0] ?? "all",
        mc_version: filtering.filters.gameVersions[0] ?? "all",
        create_version: filtering.filters.loaders[0] ?? "all",
        page,
      });
      pageCursor.current = { key: cursorKey, next: page + 1 };
      return { hits: result.items.map(cardToHit), hasMore: result.has_next };
    },
    [filtering.filters, filtering.key, homeMode],
  );

  const install = useCallback(
    async (name: string) => {
      try {
        await api.downloadSchematic(instanceId, name);
        toast(t("schematics.imported"), "success");
        onInstalled();
      } catch (reason) {
        toast(t("schematics.downloadFailed"), "error");
        throw reason;
      }
    },
    [instanceId, onInstalled, t],
  );

  const homeContent = homeMode ? (
    home ? (
      <div className="reveal-down pb-3">
        <HomeSection title={t("schematics.trending")} cards={home.trending} installed={installedIds} onOpen={setSelected} onInstall={install} />
        <HomeSection title={t("schematics.latest")} cards={home.latest} installed={installedIds} onOpen={setSelected} onInstall={install} />
        <HomeSection title={t("schematics.highest")} cards={home.highest} installed={installedIds} onOpen={setSelected} onInstall={install} />
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <span className="h-3.5 w-1 rounded-full bg-brass-500" />
          <h3 className="font-mc text-[13px] tracking-wide text-gray-100">{t("schematics.more")}</h3>
        </div>
      </div>
    ) : (
      <div className="grid h-full place-items-center text-ink-600"><Loader2 className="animate-spin" /></div>
    )
  ) : undefined;

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${closing ? "modal-overlay-out" : ""}`}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        style={{
          width: !initialProject && filtering.open ? "min(1080px, 96vw)" : "820px",
          maxWidth: "96vw",
          ...accent,
        }}
        className="rise flex h-[80vh] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl transition-[width,color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        aria-label={t("schematics.addSchematics")}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            {selected && (
              <button
                onClick={() => (initialProject ? close() : setSelected(null))}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:-translate-x-0.5 hover:text-gray-200"
              >
                <ChevronLeft size={17} />
              </button>
            )}
            <h2 className="font-mc text-lg tracking-wide text-gray-100">
              {selected ? selected.title : t("schematics.addSchematics")}
            </h2>
            {selected ? (
              <ProviderBadge />
            ) : (
              <SegmentedTabs value="createmod" onChange={() => {}} size="sm" options={[{ id: "createmod", label: "CreateMod.com" }]} />
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
          {!initialProject && (
            <BrowseResults
              hidden={!!selected}
              source="modrinth"
              query={query}
              onQueryChange={setQuery}
              autoFocusSearch
              placeholder={t("schematics.searchPlaceholder")}
              filtering={filtering}
              fetchPage={fetchPage}
              resetKey="createmod"
              enabled
              accent={accent}
              onOpen={setSelected}
              emptyText={t("schematics.noResults")}
              startTypingText={t("schematics.empty")}
              scrollKeyBase="schematics:createmod"
              contentBefore={homeContent}
              filterSidebar={
                <SchematicFilters
                  open={filtering.open}
                  options={filtering.options}
                  loading={filtering.loadingOptions}
                  filters={filtering.filters}
                  onChange={filtering.setFilters}
                  accent={accent}
                />
              }
              renderRow={(hit, open) => (
                <ResultRow
                  key={hit.project_id}
                  hit={hit}
                  installed={installedIds.has(hit.project_id)}
                  onOpen={open}
                  onQuickInstall={() => install(hit.project_id)}
                />
              )}
              footer={t("schematics.providerFooter")}
            />
          )}
          {selected && (
            <div className="flex min-h-0 flex-1 flex-col swap-in">
              <SchematicDetailView
                instanceId={instanceId}
                hit={selected}
                installed={installedById.get(selected.project_id) ?? null}
                onInstalled={onInstalled}
                onOpenRequiredMod={onOpenRequiredMod}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
