import {
  X,
  LayoutGrid,
  Play,
  Package,
  Globe2,
  Server,
  Image as ImageIcon,
  Box,
  FolderOpen,
  Plus,
  SlidersHorizontal,
  Lock,
  Shirt,
  CopyPlus,
  Pencil,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import type { View } from "@/components/Sidebar";

export const TAB_INTRO_PREFIX = "bw-tab-intro-";

type IntroStep = { icon: React.ReactNode; titleKey: string; bodyKey: string };
type IntroDef = { icon: React.ReactNode; headingKey: string; steps: IntroStep[] };


const INTROS: Partial<Record<View, IntroDef>> = {
  instances: {
    icon: <LayoutGrid size={18} />,
    headingKey: "tabIntro.instancesHeading",
    steps: [
      { icon: <Box size={18} />, titleKey: "tabIntro.instances1Title", bodyKey: "tabIntro.instances1Body" },
      { icon: <FolderOpen size={18} />, titleKey: "tabIntro.instances2Title", bodyKey: "tabIntro.instances2Body" },
      { icon: <Plus size={18} />, titleKey: "tabIntro.instances3Title", bodyKey: "tabIntro.instances3Body" },
    ],
  },
  play: {
    icon: <Play size={18} />,
    headingKey: "tabIntro.playHeading",
    steps: [
      { icon: <Play size={18} />, titleKey: "tabIntro.play1Title", bodyKey: "tabIntro.play1Body" },
      { icon: <SlidersHorizontal size={18} />, titleKey: "tabIntro.play2Title", bodyKey: "tabIntro.play2Body" },
    ],
  },
  mods: {
    icon: <Package size={18} />,
    headingKey: "tabIntro.contentHeading",
    steps: [
      { icon: <Package size={18} />, titleKey: "tabIntro.content1Title", bodyKey: "tabIntro.content1Body" },
      { icon: <Lock size={18} />, titleKey: "tabIntro.content2Title", bodyKey: "tabIntro.content2Body" },
    ],
  },
  worlds: {
    icon: <Globe2 size={18} />,
    headingKey: "tabIntro.worldsHeading",
    steps: [
      { icon: <Globe2 size={18} />, titleKey: "tabIntro.worlds1Title", bodyKey: "tabIntro.worlds1Body" },
      { icon: <Play size={18} />, titleKey: "tabIntro.worlds2Title", bodyKey: "tabIntro.worlds2Body" },
    ],
  },
  servers: {
    icon: <Server size={18} />,
    headingKey: "tabIntro.serversHeading",
    steps: [
      { icon: <Server size={18} />, titleKey: "tabIntro.servers1Title", bodyKey: "tabIntro.servers1Body" },
    ],
  },
  screenshots: {
    icon: <ImageIcon size={18} />,
    headingKey: "tabIntro.screenshotsHeading",
    steps: [
      { icon: <ImageIcon size={18} />, titleKey: "tabIntro.screenshots1Title", bodyKey: "tabIntro.screenshots1Body" },
    ],
  },
  skin: {
    icon: <Shirt size={18} />,
    headingKey: "tabIntro.skinHeading",
    steps: [
      { icon: <Shirt size={18} />, titleKey: "tabIntro.skin1Title", bodyKey: "tabIntro.skin1Body" },
      { icon: <CopyPlus size={18} />, titleKey: "tabIntro.skin2Title", bodyKey: "tabIntro.skin2Body" },
      { icon: <Pencil size={18} />, titleKey: "tabIntro.skin3Title", bodyKey: "tabIntro.skin3Body" },
    ],
  },
};


export const TAB_INTRO_VIEWS = Object.keys(INTROS) as View[];

export function hasTabIntro(view: View): boolean {
  return view in INTROS;
}

export function tabIntroSeen(view: View): boolean {
  try {
    return !!localStorage.getItem(TAB_INTRO_PREFIX + view);
  } catch {
    return true;
  }
}

export function markTabIntroSeen(view: View) {
  try {
    localStorage.setItem(TAB_INTRO_PREFIX + view, "1");
  } catch {}
}


export function resetTabIntros() {
  try {
    for (const v of TAB_INTRO_VIEWS) localStorage.removeItem(TAB_INTRO_PREFIX + v);
  } catch {}
}


export function markAllTabIntrosSeen() {
  for (const v of TAB_INTRO_VIEWS) markTabIntroSeen(v);
}


export function TabIntro({
  view,
  onClose,
  onSkipAll,
}: {
  view: View;
  onClose: () => void;
  onSkipAll: () => void;
}) {
  const def = INTROS[view];
  const t = useT();
  if (!def) return null;

  return (
    <div className="reveal-down mb-4 flex shrink-0 items-start gap-3 rounded-xl border border-brass-700/30 bg-ink-900/60 p-4">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge bg-ink-950/50 text-brass-300">
        {def.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-mc text-sm tracking-wide text-gray-100">
            {t(def.headingKey)}
          </h3>
          <span className="rounded-full bg-brass-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-brass-400/80">
            {t("tabIntro.tip")}
          </span>
        </div>
        <div className="mt-1.5 flex flex-col gap-1">
          {def.steps.map((s) => (
            <div key={s.titleKey} className="text-xs leading-relaxed text-ink-600">
              <span className="text-gray-200">{t(s.titleKey)}.</span> {t(s.bodyKey)}
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <button
          onClick={onClose}
          title={t("tabIntro.dismiss")}
          aria-label={t("tabIntro.dismiss")}
          className="grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
        >
          <X size={15} />
        </button>
        <button
          onClick={onSkipAll}
          className="whitespace-nowrap text-[11px] text-ink-600 transition hover:text-brass-300"
        >
          {t("tabIntro.skipTips")}
        </button>
      </div>
    </div>
  );
}
