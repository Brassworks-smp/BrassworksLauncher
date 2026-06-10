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
} from "lucide-react";
import { Logo } from "./Logo";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

export type View =
  | "instances"
  | "play"
  | "mods"
  | "worlds"
  | "servers"
  | "screenshots"
  | "skin"
  | "settings"
  | "instance-settings";

const NAV: { id: View; label: string; icon: typeof Play }[] = [
  { id: "instances", label: "Instances", icon: LayoutGrid },
  { id: "play", label: "Play", icon: Play },
  { id: "mods", label: "Content", icon: Package },
  { id: "worlds", label: "Worlds", icon: Globe2 },
  { id: "servers", label: "Servers", icon: Server },
  { id: "skin", label: "Skins", icon: Shirt },
  { id: "screenshots", label: "Screenshots", icon: ImageIcon },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  view,
  onChange,
  running,
  onStop,
  onViewLogs,
  activeName,
  onActiveClick,
  onOpenPalette,
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
  footer?: React.ReactNode;
}) {
  return (
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-edge bg-ink-900/60 px-3 pb-3">
      <div className="no-drag flex items-center gap-2.5 px-2 py-3">
        <Logo size={30} />
        <div className="leading-tight">
          <div className="font-mc text-[15px] tracking-widest text-gray-200">
            BRASSWORKS
          </div>
          <div className="text-[10px] uppercase tracking-widest text-ink-600">
            Launcher
          </div>
        </div>
      </div>

      {activeName && (
        <button
          onClick={onActiveClick}
          title="Open instance settings"
          className="no-drag mx-1 mb-1 block w-[calc(100%-0.5rem)] truncate rounded-md border border-edge bg-ink-950/40 px-2.5 py-1.5 text-left transition hover:border-brass-600/40"
        >
          <div className="text-[9px] uppercase tracking-widest text-ink-600">
            Instance
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

      <nav className="no-drag mt-2 flex flex-col gap-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active =
            view === id || (id === "instances" && view === "instance-settings");
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                active
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
              <span className="font-mc text-[13px] tracking-wide">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto no-drag flex flex-col gap-2">
        {running && (
          <div className="rise rounded-lg border border-patina-500/30 bg-patina-500/10 p-2.5">
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-patina-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-patina-400" />
              </span>
              <span className="font-mc text-[11px] tracking-wide text-patina-300">
                Game running
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => onViewLogs(true)}
                title="View live game logs"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge bg-ink-900/50 px-2 py-1.5 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
              >
                <ScrollText size={12} /> Logs
              </button>
              <button
                onClick={onStop}
                title="Stop the game"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 transition hover:bg-red-500/20"
              >
                <Square size={11} className="fill-current" /> Stop
              </button>
            </div>
          </div>
        )}
        {!running && (
          <button
            onClick={() => onViewLogs(false)}
            title="View the previous session's log"
            className="flex items-center justify-center gap-2 rounded-lg border border-edge px-2 py-1.5 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <ScrollText size={12} /> View last log
          </button>
        )}
        {onOpenPalette && (
          <button
            onClick={onOpenPalette}
            title="Open the command palette"
            className="group/k flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-[12px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Search size={14} />
            <span className="flex-1 text-left">Search…</span>
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
