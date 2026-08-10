import {
  Play,
  Settings,
  Package,
  Square,
  ScrollText,
  Image as ImageIcon,
  LayoutGrid,
  Shirt,
  Globe2,
  Server,
  Search,
  Blocks,
  Link2,
  Plus,
} from "lucide-react";
import { Logo } from "./Logo";
import { InstanceRail } from "./InstanceRail";
import { useT } from "@/lib/i18n";
import type { Instance, InstanceFolder } from "@/lib/types";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

export type View =
  | "instances"
  | "play"
  | "mods"
  | "worlds"
  | "servers"
  | "schematics"
  | "screenshots"
  | "skin"
  | "global-files"
  | "settings"
  | "instance-settings";

const NAV: { id: View; tkey: string; icon: typeof Play }[] = [
  { id: "instances", tkey: "sidebar.instances", icon: LayoutGrid },
  { id: "play", tkey: "sidebar.play", icon: Play },
  { id: "mods", tkey: "sidebar.content", icon: Package },
  { id: "worlds", tkey: "sidebar.worlds", icon: Globe2 },
  { id: "servers", tkey: "sidebar.servers", icon: Server },
  { id: "schematics", tkey: "sidebar.schematics", icon: Blocks },
  { id: "skin", tkey: "sidebar.skins", icon: Shirt },
  { id: "screenshots", tkey: "sidebar.screenshots", icon: ImageIcon },
  { id: "global-files", tkey: "sidebar.globalFiles", icon: Link2 },
  { id: "settings", tkey: "sidebar.settings", icon: Settings },
];

export const INSTANCE_VIEWS: View[] = [
  "play",
  "mods",
  "worlds",
  "servers",
  "schematics",
  "screenshots",
  "instance-settings",
];

const INSTANCE_NAV = new Set<View>([
  "play",
  "mods",
  "worlds",
  "servers",
  "schematics",
  "screenshots",
]);

export function Sidebar({
  view,
  onChange,
  running,
  onStop,
  onViewLogs,
  activeName,
  onActiveClick,
  onOpenPalette,
  onShowAbout,
  hasInstance = true,
  skinsAvailable = true,
  schematicsAvailable = true,
  globalFilesAvailable = true,
  advancedMode = false,
  instances,
  folders,
  settingsAccent,
  featuredEnabled = true,
  recencyVersion = 0,
  allInstancesOpen = false,
  onAllInstancesOpenChange,
  selectedId,
  runningIds,
  maintainingIds,
  workingIds,
  installingId,
  onSelectInstance,
  onOpenInstanceSettings,
  onStarInstance,
  onAddInstance,
  onSaveFolders,
  onSaveInstance,
  onPlayInstance,
  onDeleteInstance,
  canPlay = true,
  footer,
}: {
  view: View;
  onChange: (v: View) => void;
  running: boolean;
  onStop: () => void;
  onViewLogs: (live: boolean) => void;
  activeName?: string;
  onActiveClick?: () => void;
  onOpenPalette?: () => void;
  onShowAbout?: () => void;
  hasInstance?: boolean;

  skinsAvailable?: boolean;
  schematicsAvailable?: boolean;
  globalFilesAvailable?: boolean;
  advancedMode?: boolean;
  instances?: Instance[];
  folders?: InstanceFolder[];
  settingsAccent?: string | null;
  featuredEnabled?: boolean;
  recencyVersion?: number;
  allInstancesOpen?: boolean;
  onAllInstancesOpenChange?: (open: boolean) => void;
  selectedId?: string | null;
  runningIds?: Set<string>;
  maintainingIds?: Set<string>;
  workingIds?: Set<string>;
  installingId?: string | null;
  onSelectInstance?: (id: string) => void;
  onOpenInstanceSettings?: (id: string) => void;
  onStarInstance?: (instance: Instance) => void;
  onAddInstance?: () => void;
  onSaveFolders?: (folders: InstanceFolder[]) => void;
  onSaveInstance?: (instance: Instance) => void;
  onPlayInstance?: (id: string) => void;
  onDeleteInstance?: (id: string) => void;
  canPlay?: boolean;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const visibleNav = advancedMode
    ? NAV.filter(({ id }) => id !== "instances" && !INSTANCE_NAV.has(id))
    : NAV;

  const renderNavItems = () =>
    visibleNav.map(({ id, tkey, icon: Icon }) => {
      const visible =
        (id !== "schematics" || schematicsAvailable) &&
        (id !== "global-files" || globalFilesAvailable);
      const active =
        view === id || (id === "instances" && view === "instance-settings");
      const noInstance = !hasInstance && INSTANCE_VIEWS.includes(id);
      const noSkins = id === "skin" && !skinsAvailable;
      const disabled = !visible || noInstance || noSkins;
      return (
        <div
          key={id}
          aria-hidden={!visible}
          className={`grid transition-[grid-template-rows,opacity,transform] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            visible
              ? "grid-rows-[1fr] opacity-100 translate-x-0"
              : "pointer-events-none grid-rows-[0fr] -translate-x-1 opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <button
              disabled={disabled}
              tabIndex={visible ? undefined : -1}
              onClick={() => !disabled && onChange(id)}
              title={
                noSkins
                  ? t("sidebar.skinsNeedAccount")
                  : noInstance
                    ? t("sidebar.selectInstanceFirst")
                    : undefined
              }
              className={`group relative my-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                disabled
                  ? "cursor-not-allowed text-ink-800 opacity-40"
                  : active
                    ? "bg-brass-500/15 text-brass-300 glow"
                    : "text-ink-600 hover:translate-x-0.5 hover:bg-ink-800/60 hover:text-brass-300/80"
              }`}
            >
              <span
                className={`pointer-events-none absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brass-400 transition-all duration-200 ${
                  active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"
                }`}
              />
              <Icon
                size={17}
                className={`transition-transform duration-200 group-hover:scale-110 group-active:scale-95 ${
                  active ? "text-brass-400" : "opacity-80"
                }`}
              />
              <span className="font-mc text-[13px] tracking-wide">{t(tkey)}</span>
            </button>
          </div>
        </div>
      );
    });

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-edge bg-ink-900/60 px-3 pb-3 ${
        advancedMode ? "w-[232px]" : "w-[208px]"
      }`}
    >
      <button
        onClick={advancedMode ? () => onChange("instances") : onShowAbout}
        title={
          advancedMode
            ? t("sidebar.instances")
            : t("sidebar.about")
        }
        className="no-drag group mt-3 mb-1 flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition hover:bg-ink-800/50"
      >
        <Logo
          size={30}
          className="origin-center transition-transform duration-300 ease-out group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none"
        />
        <div className="leading-tight">
          <div className="font-mc text-[15px] tracking-widest text-gray-200 transition group-hover:text-brass-300">
            BRASSWORKS
          </div>
          <div className="text-[10px] uppercase tracking-widest text-ink-600">
            {t("sidebar.brandSub")}
          </div>
        </div>
      </button>

      {advancedMode ? (
        <>
          <div className="mb-1 mt-1 flex items-center justify-between px-1">
            <button
              onClick={() => onChange("instances")}
              title={t("sidebar.instances")}
              className="font-mc text-[10px] uppercase tracking-widest text-brass-400/80 transition hover:text-brass-300"
            >
              {t("sidebar.instances")}
            </button>
            <button
              onClick={onAddInstance}
              title={t("instances.newInstance")}
              className="grid h-6 w-6 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800/60 hover:text-brass-300"
            >
              <Plus size={14} />
            </button>
          </div>

          <InstanceRail
            bare
            instances={instances ?? []}
            showFeatured={featuredEnabled}
            folders={folders ?? []}
            settingsAccent={settingsAccent}
            recencyVersion={recencyVersion}
            selectedId={selectedId ?? null}
            runningIds={runningIds ?? new Set()}
            maintainingIds={maintainingIds ?? new Set()}
            workingIds={workingIds ?? new Set()}
            installingId={installingId}
            onSelect={(id) => onSelectInstance?.(id)}
            onOpenSettings={(id) => onOpenInstanceSettings?.(id)}
            onStar={(i) => onStarInstance?.(i)}
            onAdd={() => onAddInstance?.()}
            onSaveFolders={(f) => onSaveFolders?.(f)}
            onSaveInstance={(i) => onSaveInstance?.(i)}
            onPlay={onPlayInstance}
            onDelete={onDeleteInstance}
            onStop={onStop}
            canPlay={canPlay}
            allOpen={allInstancesOpen}
            onAllOpenChange={onAllInstancesOpenChange}
          />

          <nav className="no-drag mt-1 flex flex-col border-t border-edge/60 pt-1.5">
            {renderNavItems()}
          </nav>
        </>
      ) : (
        <>
          {activeName && (
            <button
              onClick={onActiveClick}
              title={t("sidebar.openInstanceSettings")}
              className="no-drag mx-1 mb-1 block w-[calc(100%-0.5rem)] truncate rounded-md border border-edge bg-ink-950/40 px-2.5 py-1.5 text-left transition hover:border-brass-600/40"
            >
              <div className="text-[9px] uppercase tracking-widest text-ink-600">
                {t("sidebar.instanceLabel")}
              </div>
              <div
                className={`truncate font-mc text-[12px] ${
                  running ? "text-patina-300" : "text-gray-100"
                }`}
              >
                {activeName}
              </div>
            </button>
          )}

          <nav className="no-drag mt-2 flex flex-col">
            {renderNavItems()}
          </nav>
        </>
      )}

      <div className="mt-auto no-drag flex flex-col gap-2 border-t border-edge/60 pt-3">
        {running && (
          <div className="rise rounded-lg border border-patina-500/30 bg-patina-500/10 p-2.5">
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-patina-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-patina-400" />
              </span>
              <span className="font-mc text-[11px] tracking-wide text-patina-300">
                {t("sidebar.gameRunning")}
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => onViewLogs(true)}
                title={t("sidebar.viewLiveLogs")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge bg-ink-900/50 px-2 py-1.5 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
              >
                <ScrollText size={12} /> {t("sidebar.logs")}
              </button>
              {!advancedMode && (
                <button
                  onClick={onStop}
                  title={t("sidebar.stopGame")}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 transition hover:bg-red-500/20"
                >
                  <Square size={11} className="fill-current" /> {t("sidebar.stop")}
                </button>
              )}
            </div>
          </div>
        )}
        {!running && (
          <button
            onClick={() => onViewLogs(false)}
            title={t("sidebar.viewPrevLog")}
            className="flex items-center justify-center gap-2 rounded-lg border border-edge px-2 py-1.5 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <ScrollText size={12} /> {t("sidebar.viewLastLog")}
          </button>
        )}
        {onOpenPalette && (
          <button
            onClick={onOpenPalette}
            title={t("sidebar.openPalette")}
            className="group/k flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Search size={14} />
            <span className="flex-1 text-left">{t("sidebar.searchPlaceholder")}</span>
            <kbd className="rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] text-ink-600 transition group-hover/k:border-brass-600/40">
              {IS_MAC ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
        )}
        {footer}
      </div>
    </aside>
  );
}
