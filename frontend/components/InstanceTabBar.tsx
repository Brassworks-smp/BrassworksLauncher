import {
  Play,
  Package,
  Globe2,
  Server,
  Blocks,
  Image as ImageIcon,
  Settings,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import type { View } from "./Sidebar";

const TABS: { id: View; tkey: string; icon: typeof Play }[] = [
  { id: "play", tkey: "sidebar.overview", icon: Play },
  { id: "mods", tkey: "sidebar.content", icon: Package },
  { id: "worlds", tkey: "sidebar.worlds", icon: Globe2 },
  { id: "servers", tkey: "sidebar.servers", icon: Server },
  { id: "schematics", tkey: "sidebar.schematics", icon: Blocks },
  { id: "screenshots", tkey: "sidebar.screenshots", icon: ImageIcon },
];

const EDIT: { id: View; tkey: string; icon: typeof Settings } = {
  id: "instance-settings",
  tkey: "instanceSettings.title",
  icon: Settings,
};

export function InstanceTabBar({
  view,
  onChange,
  schematicsAvailable,
}: {
  view: View;
  onChange: (v: View) => void;
  schematicsAvailable: boolean;
}) {
  const t = useT();
  const tabs = schematicsAvailable
    ? TABS
    : TABS.filter((x) => x.id !== "schematics");

  const tab = (id: View, tkey: string, Icon: typeof Play) => {
    const active = view === id;
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          active
            ? "bg-brass-500/15 text-brass-300"
            : "text-ink-600 hover:bg-ink-800/60 hover:text-brass-300/80"
        }`}
      >
        <Icon size={15} className={active ? "text-brass-400" : "opacity-80"} />
        <span className="font-mc text-[13px] tracking-wide">{t(tkey)}</span>
      </button>
    );
  };

  return (
    <div className="no-scrollbar flex min-h-0 shrink-0 items-center gap-1 overflow-x-auto rounded-lg border border-edge bg-ink-900/50 p-1">
      {tabs.map(({ id, tkey, icon }) => tab(id, tkey, icon))}
      <div className="mx-1 h-5 w-px shrink-0 bg-edge" />
      {tab(EDIT.id, EDIT.tkey, EDIT.icon)}
    </div>
  );
}
