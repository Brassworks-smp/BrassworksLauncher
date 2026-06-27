import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  X,
  Play,
  Package,
  Globe2,
  Server,
  Shirt,
  Image as ImageIcon,
  LayoutGrid,
  Settings as SettingsIcon,
  Plus,
  ScrollText,
  FolderOpen,
  SunMoon,
  Loader2,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import type { CommandContext, CmdState } from "@/lib/cmd/types";
import { runScript } from "@/lib/cmd/parser";
import { REGISTRY } from "@/lib/cmd/registry";
import { pinnedMenuItems, onPinsChanged } from "@/lib/cmd/pins";

import { Sidebar, INSTANCE_VIEWS, type View } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { AccountMenu } from "@/components/AccountMenu";
import { PlayView } from "@/components/PlayView";
import { ModsView } from "@/components/ModsView";
import { WorldsView } from "@/components/WorldsView";
import { ServersView } from "@/components/ServersView";
import { ScreenshotsView } from "@/components/ScreenshotsView";
import { SkinView } from "@/components/SkinView";
import { TooltipLayer } from "@/components/Tooltip";
import { SettingsView } from "@/components/SettingsView";
import { InstancesView } from "@/components/InstancesView";
import { InstanceSettingsView } from "@/components/InstanceSettingsView";
import { AddInstanceModal } from "@/components/AddInstanceModal";
import { MicrosoftModal, type MsAuthState } from "@/components/MicrosoftModal";
import { LogUploadModal } from "@/components/LogUploadModal";
import { LogViewer } from "@/components/LogViewer";
import { ChangelogModal } from "@/components/ChangelogModal";
import { AboutModal } from "@/components/AboutModal";
import { OnboardingWizard, ONBOARDED_KEY } from "@/components/OnboardingWizard";
import {
  TabIntro,
  hasTabIntro,
  tabIntroSeen,
  markTabIntroSeen,
  resetTabIntros,
} from "@/components/TabIntro";
import { RestartPrompt } from "@/components/RestartPrompt";
import { AccountOverrideWarning } from "@/components/AccountOverrideWarning";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as api from "@/lib/api";
import { I18nProvider, translate } from "@/lib/i18n";
import { applyAccent } from "@/lib/colors";
import { isCacheableBranding } from "@/lib/instanceIcons";
import { ToastHost, toast, toastProgress, dismissToast } from "@/lib/toast";
import type {
  AccountStore,
  FeaturedPack,
  FlavorGroup,
  Instance,
  LaunchProgress,
  LauncherSettings,
  LogUpload,
  ManualMod,
  ModpackStatus,
  NewsItem,
  PackwizShare,
  PlayerCount,
} from "@/lib/types";
import { FlavorPicker } from "@/components/FlavorPicker";

const PLAYERCOUNT_INTERVAL = 30_000;
const NEWS_INTERVAL = 300_000;

const withId = (set: Set<string>, id: string) => {
  const next = new Set(set);
  next.add(id);
  return next;
};
const withoutId = (set: Set<string>, id: string) => {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
};


const defaultInstanceId = (
  list: Instance[],
  showFeatured: boolean,
): string | null => {
  const pool = showFeatured ? list : list.filter((i) => !i.featured);
  return pool.find((i) => i.featured)?.id ?? pool[0]?.id ?? null;
};

const isNavDisabled = (
  v: View,
  hasSelected: boolean,
  skinsAvailable: boolean,
): boolean =>
  (INSTANCE_VIEWS.includes(v) && !hasSelected) ||
  (v === "skin" && !skinsAvailable);

export default function Home() {
  const [view, setView] = useState<View>("play");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gearId, setGearId] = useState<string | null>(null);
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [featuredPacks, setFeaturedPacks] = useState<FeaturedPack[]>([]);
  const [accounts, setAccounts] = useState<AccountStore>({
    accounts: [],
    selected: null,
  });

  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [maintainingIds, setMaintainingIds] = useState<Set<string>>(new Set());
  const [progressById, setProgressById] = useState<
    Record<string, LaunchProgress>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [msAuth, setMsAuth] = useState<MsAuthState | null>(null);
  const [accountsRecheck, setAccountsRecheck] = useState(0);

  const [logUpload, setLogUpload] = useState<LogUpload | null>(null);
  const [uploadingLog, setUploadingLog] = useState(false);
  const [logView, setLogView] = useState<boolean | null>(null);
  const [news, setNews] = useState<NewsItem | null>(null);
  const [newsError, setNewsError] = useState(false);
  const [players, setPlayers] = useState<PlayerCount | null>(null);
  const [playersError, setPlayersError] = useState(false);
  const [modStatus, setModStatus] = useState<ModpackStatus | null>(null);

  const [appVer, setAppVer] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<{
    version: string | null;
    updated: boolean;
  } | null>(null);
  const [restartVersion, setRestartVersion] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  
  const [importFromOnboarding, setImportFromOnboarding] = useState(false);
  const [tabIntro, setTabIntro] = useState<View | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [pendingPackwizShare, setPendingPackwizShare] =
    useState<PackwizShare | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installingInstanceId, setInstallingInstanceId] = useState<string | null>(
    null,
  );
  
  const [flavorPrompt, setFlavorPrompt] = useState<{
    instanceId: string;
    quickPlay?: api.QuickPlay;
    groups: FlavorGroup[] | "loading";
  } | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);

  const instance = instances.find((i) => i.id === selectedId) ?? null;
  const gearInstance = instances.find((i) => i.id === gearId) ?? null;

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const skinsAvailableRef = useRef(false);
  const installingIdRef = useRef<string | null>(null);
  const deleteInstallOnCancelRef = useRef(false);

  
  
  
  const tr = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(key, {
        locale: settingsRef.current?.locale ?? "en",
        pseudo: !!settingsRef.current?.pseudo_localize,
        vars,
      }),
    [],
  );

  const [paletteOpen, setPaletteOpen] = useState(false);

  
  
  const anyOverlayOpen =
    addOpen ||
    !!flavorPrompt ||
    !!msAuth ||
    logView !== null ||
    !!logUpload ||
    !!changelog ||
    !!restartVersion ||
    aboutOpen ||
    onboardingOpen ||
    paletteOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && view === "play" && !anyOverlayOpen)
        setView("instances");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, anyOverlayOpen]);

  const theme = settings?.theme ?? "system";
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("reduce-motion", !!settings?.reduce_motion);
    root.classList.toggle("theme-contrast", !!settings?.high_contrast);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    
    const THEME_CLASS: Record<string, string> = {
      "brass-light": "theme-light",
      "brass-grey": "theme-grey",
      "brass-ocean": "theme-ocean",
      "brass-mocha": "theme-mocha",
      "brass-nord": "theme-nord",
      "brass-rose": "theme-rose",
      "brass-amethyst": "theme-amethyst",
      "brass-crimson": "theme-crimson",
      "brass-forest": "theme-forest",
    };
    const allClasses = Object.values(THEME_CLASS);
    const apply = () => {
      const resolved =
        theme === "system" ? (mq.matches ? "brass-light" : "brass-dark") : theme;
      root.classList.remove(...allClasses);
      const cls = THEME_CLASS[resolved];
      if (cls) root.classList.add(cls);
    };
    apply();
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, settings?.reduce_motion, settings?.high_contrast]);

  useEffect(() => {
    applyAccent(settings?.accent_color ?? null);
  }, [settings?.accent_color]);

  const refreshInstances = useCallback(async (): Promise<Instance[]> => {
    const list = await api.getInstances();
    setInstances(list);
    return list;
  }, []);

  const selectInstance = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setModStatus(null);
      api.setActiveInstance(id).catch(() => {});
      api.modpackStatus(id).then(setModStatus).catch(() => {});
      setSettings((s) => (s ? { ...s, selected_instance: id } : s));
    },
    [],
  );

  useEffect(() => {
    if (!api.isTauri()) return;
    (async () => {
      try {
        const [list, s, acc, running, ver, feat] = await Promise.all([
          api.getInstances(),
          api.getSettings(),
          api.getAccounts(),
          api.getRunning(),
          api.appVersion().catch(() => null),
          api.featuredPacks().catch(() => []),
        ]);
        setInstances(list);
        setAccounts(acc);
        setAppVer(ver);
        setFeaturedPacks(feat);

        const pool = s.show_featured ? list : list.filter((i) => !i.featured);
        const sel =
          (s.selected_instance &&
            pool.find((i) => i.id === s.selected_instance)?.id) ||
          defaultInstanceId(list, s.show_featured);
        setSelectedId(sel);
        if (running.length) setRunningIds(new Set(running));

        let next = s;
        if (ver && s.last_version !== ver) {
          if (s.last_version) setChangelog({ version: ver, updated: true });
          next = { ...s, last_version: ver };
          api.saveSettings(next).catch(() => {});
        }
        setSettings(next);

        
        
        try {
          if (!localStorage.getItem(ONBOARDED_KEY) && acc.accounts.length === 0)
            setOnboardingOpen(true);
        } catch {}

        if (next.auto_update) {
          try {
            const info = await api.checkForUpdate();
            if (info.available) {
              toast(tr("page.updateFound", { version: info.version }), "info");
              await api.installUpdate();
              toast(tr("settings.updates.installedToast", { version: info.version }), "success");
              setRestartVersion(info.version);
            }
          } catch {
          }
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const refreshModStatus = useCallback(() => {
    if (!api.isTauri() || !selectedId) return;
    api.modpackStatus(selectedId).then(setModStatus).catch(() => {});
  }, [selectedId]);
  useEffect(refreshModStatus, [refreshModStatus]);

  useEffect(() => {
    if (!api.isTauri() || instances.length === 0) return;
    const values = Array.from(
      new Set(
        instances
          .flatMap((i) => [i.icon, i.banner, i.logo])
          .filter((v): v is string => isCacheableBranding(v)),
      ),
    );
    if (values.length) api.cacheImages(values).catch(() => {});
  }, [instances]);

  useEffect(() => {
    const preload = () => void import("skinview3d").catch(() => {});
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (ric) {
      const id = ric(preload, { timeout: 4000 });
      return () => (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(preload, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    const acc =
      accounts.accounts.find((a) => a.id === accounts.selected) ??
      accounts.accounts[0];
    if (!acc || api.getFaceTexture(acc.id)) return;
    api
      .skinProfile(acc.id)
      .then((p) => {
        if (p.skin_url) api.setFaceTexture(acc.id, p.skin_url);
      })
      .catch(() => {});
  }, [accounts]);

  
  
  useEffect(() => {
    if (!api.isTauri()) return;
    let un: (() => void) | undefined;
    const NAV: Record<string, View> = {
      "nav-play": "play",
      "nav-instances": "instances",
      "nav-mods": "mods",
      "nav-worlds": "worlds",
      "nav-servers": "servers",
      "nav-skin": "skin",
      "nav-screenshots": "screenshots",
      "nav-settings": "settings",
    };
    api
      .onMenuAction((action) => {
        if (action === "about") setAboutOpen(true);
        else if (action === "palette") setPaletteOpen(true);
        else if (action === "add-instance") setAddOpen(true);
        else if (action === "view-log") setLogView(false);
        else if (NAV[action]) {
          const v = NAV[action];
          if (!isNavDisabled(v, !!selectedRef.current, skinsAvailableRef.current))
            setView(v);
        }
      })
      .then((u) => (un = u));
    return () => un?.();
  }, []);

  const featuredEnabled = settings?.show_featured ?? true;
  const feedsEnabled = !!instance && (!instance.featured || featuredEnabled);
  const showNews = !!(
    feedsEnabled &&
    instance?.show_news &&
    instance.news_url
  );
  const showPlayers = !!(
    feedsEnabled &&
    instance?.show_playercount &&
    instance.playercount_url
  );

  
  
  useEffect(() => {
    if (featuredEnabled || !instance?.featured) return;
    const next = instances.find((i) => !i.featured);
    if (next) void selectInstance(next.id);
    else setSelectedId(null);
  }, [featuredEnabled, instance?.featured, instances, selectInstance]);

  
  
  
  
  useEffect(() => {
    if (!settings) return;
    if (!selectedId && INSTANCE_VIEWS.includes(view)) setView("instances");
    
    const acc =
      accounts.accounts.find((a) => a.id === accounts.selected) ??
      accounts.accounts[0];
    if (view === "skin" && acc?.kind !== "microsoft")
      setView(selectedId ? "play" : "instances");
  }, [settings, selectedId, view, accounts]);

  
  
  useEffect(() => {
    if (!settings || onboardingOpen) return;
    if (!hasTabIntro(view) || tabIntroSeen(view)) return;
    if (INSTANCE_VIEWS.includes(view) && !selectedId) return;
    setTabIntro(view);
  }, [settings, onboardingOpen, view, selectedId]);

  const refreshPlayers = useCallback(async () => {
    if (!api.isTauri() || !selectedId || !showPlayers) return;
    try {
      setPlayers(await api.getPlayercount(selectedId));
      setPlayersError(false);
    } catch {
      setPlayersError(true);
    }
  }, [selectedId, showPlayers]);
  useEffect(() => {
    if (!showPlayers) {
      setPlayers(null);
      return;
    }
    void refreshPlayers();
    const h = setInterval(refreshPlayers, PLAYERCOUNT_INTERVAL);
    return () => clearInterval(h);
  }, [refreshPlayers, showPlayers]);

  const refreshNews = useCallback(async () => {
    if (!api.isTauri() || !selectedId || !showNews) return;
    try {
      setNews(await api.getNews(selectedId));
      setNewsError(false);
    } catch {
      setNewsError(true);
    }
  }, [selectedId, showNews]);
  useEffect(() => {
    if (!showNews) {
      setNews(null);
      return;
    }
    void refreshNews();
    const h = setInterval(refreshNews, NEWS_INTERVAL);
    return () => clearInterval(h);
  }, [refreshNews, showNews]);

  useEffect(() => {
    if (!api.isTauri()) return;
    const unlisteners = [
      api.onLaunchProgress((p) => {
        setProgressById((m) => ({ ...m, [p.instance_id]: p }));
      }),
      api.onLaunchStarted((id) => {
        setRunningIds((s) => withId(s, id));
        setWorkingIds((s) => withoutId(s, id));
        setProgressById((m) => {
          if (!(id in m)) return m;
          const next = { ...m };
          delete next[id];
          return next;
        });
        const s = settingsRef.current;
        if (s?.console_on_launch) setLogView(true);
        const behavior = s?.launch_behavior ?? "keep";
        if (api.isTauri()) {
          const win = getCurrentWindow();
          if (behavior === "hide") win.minimize().catch(() => {});
          else if (behavior === "quit") win.close().catch(() => {});
        }
      }),
      api.onLaunchExited((info) => {
        const id = info.instance_id;
        setRunningIds((s) => withoutId(s, id));
        setWorkingIds((s) => withoutId(s, id));
        setProgressById((m) => {
          if (!(id in m)) return m;
          const next = { ...m };
          delete next[id];
          return next;
        });
        if (id === selectedRef.current) {
          if (info.error) setError(info.error);
          api.modpackStatus(id).then(setModStatus).catch(() => {});
        }
        api.getInstances().then(setInstances).catch(() => {});

        const s = settingsRef.current;
        if (api.isTauri() && s?.launch_behavior === "hide") {
          const win = getCurrentWindow();
          win.unminimize().catch(() => {});
          win.setFocus().catch(() => {});
        }
        const crashed = !!info.error || (info.code !== null && info.code !== 0);
        if ((crashed && s?.console_on_crash) || (!crashed && s?.console_on_quit))
          setLogView(false);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    const unlisteners = [
      api.onModpackProgress((p) => {
        setMaintainingIds((s) => withId(s, p.instance_id));
        setProgressById((m) => ({ ...m, [p.instance_id]: p }));
      }),
      api.onModpackDone((d) => {
        const id = d.instance_id;
        dismissToast(`download:${id}`);
        setMaintainingIds((s) => withoutId(s, id));
        setProgressById((m) => {
          if (!(id in m)) return m;
          const next = { ...m };
          delete next[id];
          return next;
        });
        if (d.error) {
          if (id === selectedRef.current) setError(d.error);
          toast(tr("page.modpackUpdateFailed"), "error");
        } else if (!d.cancelled) {
          toast(tr("page.modpackUpToDate"), "success");
        }
        if (id === selectedRef.current) refreshModStatus();
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, [refreshModStatus]);

  useEffect(() => {
    if (!api.isTauri()) return;
    const unlisteners = [
      api.onPackStarted((created) => {
        installingIdRef.current = created.id;
        setInstallingInstanceId(created.id);
        setAddOpen(false);
        // Closing the modal here bypasses its onClose, so clear the one-shot
        // import inputs too — otherwise the next "Add Instance" re-runs the
        // dragged/opened pack install.
        setImportFile(null);
        setPendingPackwizShare(null);
        setImportFromOnboarding(false);
        setMaintainingIds((s) => withId(s, created.id));
        refreshInstances().then(() => {
          void selectInstance(created.id);
          setView("play");
        });
      }),
      api.onPackProgress((p) => {
        const id = installingIdRef.current;
        if (!id) return;
        setMaintainingIds((s) => withId(s, id));
        setProgressById((m) => ({ ...m, [id]: { ...p, instance_id: id } }));
      }),
      api.onPackDone((d) => {
        setInstalling(false);
        const id = installingIdRef.current;
        installingIdRef.current = null;
        const deleteOnCancel = deleteInstallOnCancelRef.current;
        deleteInstallOnCancelRef.current = false;
        setInstallingInstanceId(null);
        if (id) {
          dismissToast(`download:${id}`);
          setMaintainingIds((s) => withoutId(s, id));
          setProgressById((m) => {
            if (!(id in m)) return m;
            const next = { ...m };
            delete next[id];
            return next;
          });
        }
        if (d.error) {
          setError(d.error);
          toast(tr("page.modpackInstallFailed"), "error");
          refreshInstances().catch(() => {});
        } else if (d.cancelled) {
          toast(tr("page.installCancelled"), "info");
          if (id && deleteOnCancel) {
            api
              .deleteInstance(id)
              .catch(() => {})
              .finally(() => {
                refreshInstances()
                  .then((list) => {
                    if (selectedRef.current === id) {
                      const next = defaultInstanceId(
                        list,
                        settingsRef.current?.show_featured ?? true,
                      );
                      if (next) void selectInstance(next);
                      else setSelectedId(null);
                    }
                  })
                  .catch(() => {});
              });
          } else {
            refreshInstances().catch(() => {});
          }
        } else if (d.instance) {
          const created = d.instance;
          toast(tr("page.installedInstance", { name: created.name }), "success");
          refreshInstances().then(() => {
            void selectInstance(created.id);
            setView("play");
          });
        }
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, [refreshInstances, selectInstance]);

  useEffect(() => {
    if (!api.isTauri()) return;
    const un = api.onMicrosoftAuth((e) => {
      if (e.phase === "code") {
        setMsAuth({
          status: "code",
          user_code: e.user_code,
          verification_uri: e.verification_uri,
          message: e.message,
        });
      } else if (e.phase === "done") {
        setAccounts(e.store);
        setMsAuth(null);
        
        
        setAccountsRecheck((n) => n + 1);
      } else {
        setMsAuth({ status: "error", message: e.message });
      }
    });
    return () => {
      un.then((u) => u()).catch(() => {});
    };
  }, []);

  const launchNow = useCallback(
    async (target: string, quickPlay?: api.QuickPlay) => {
      if (target !== selectedId) await selectInstance(target);
      setError(null);
      setProgressById((m) => {
        if (!(target in m)) return m;
        const next = { ...m };
        delete next[target];
        return next;
      });
      setWorkingIds((s) => withId(s, target));
      setView("play");
      try {
        await api.launch(target, quickPlay);
      } catch (e) {
        setError(String(e));
        setWorkingIds((s) => withoutId(s, target));
      }
    },
    [selectedId, selectInstance],
  );

  const onPlay = useCallback(
    async (id?: string, quickPlay?: api.QuickPlay) => {
      const target = id ?? selectedId;
      if (!target) return;
      
      
      const inst = instances.find((i) => i.id === target);
      if (
        inst &&
        inst.pack.kind === "packwiz" &&
        inst.pack.unsup &&
        inst.unsup_flavors === null
      ) {
        if (target !== selectedId) await selectInstance(target);
        setView("play");
        setFlavorPrompt({ instanceId: target, quickPlay, groups: "loading" });
        try {
          const groups = await api.inspectPackwizFlavors(inst.pack.url);
          if (groups.length === 0) {
            
            setFlavorPrompt(null);
            const updated = await api.setPackwizFlavors(target, []);
            setInstances((list) =>
              list.map((x) => (x.id === updated.id ? updated : x)),
            );
            await launchNow(target, quickPlay);
          } else {
            setFlavorPrompt({ instanceId: target, quickPlay, groups });
          }
        } catch (e) {
          setFlavorPrompt(null);
          setError(String(e));
        }
        return;
      }
      await launchNow(target, quickPlay);
    },
    [selectedId, selectInstance, instances, launchNow],
  );

  const onStop = useCallback(async () => {
    const target =
      selectedId && runningIds.has(selectedId)
        ? selectedId
        : Array.from(runningIds)[0] ?? selectedId;
    if (!target) return;
    try {
      await api.stop(target);
    } catch (e) {
      setError(String(e));
    }
  }, [runningIds, selectedId]);

  const onCancel = useCallback(async () => {
    if (!selectedId) return;
    try {
      if (selectedId === installingIdRef.current) await api.cancelInstall();
      else await api.cancelOp(selectedId);
    } catch (e) {
      setError(String(e));
    }
  }, [selectedId]);

  const cancelDownload = useCallback((id: string) => {
    if (id === installingIdRef.current) {
      deleteInstallOnCancelRef.current = true;
      api.cancelInstall().catch(() => {});
    } else {
      api.cancelOp(id).catch(() => {});
    }
  }, []);

  useEffect(() => {
    maintainingIds.forEach((id) => {
      if (view === "play" && selectedId === id) {
        dismissToast(`download:${id}`);
        return;
      }
      const p = progressById[id];
      const pct =
        p && p.total > 0
          ? Math.min(100, Math.round((p.current / p.total) * 100))
          : null;
      const name = instances.find((i) => i.id === id)?.name;
      toastProgress(
        `download:${id}`,
        name ?? p?.message ?? tr("page.installingModpack"),
        pct,
        () => cancelDownload(id),
      );
    });
  }, [maintainingIds, progressById, view, selectedId, instances, cancelDownload, tr]);

  const onMicrosoftLogin = useCallback(() => {
    setMsAuth({ status: "starting" });
    api.startMicrosoftLogin().catch((e) => {
      setMsAuth({ status: "error", message: String(e) });
    });
  }, []);

  const openPackwizShare = useCallback(async (input: string) => {
    try {
      const share = await api.resolvePackwizShare(input);
      getCurrentWindow().setFocus().catch(() => {});
      setPendingPackwizShare(share);
      setAddOpen(true);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onUploadLog = useCallback(() => {
    if (!selectedId) return;
    setUploadingLog(true);
    setError(null);
    api
      .uploadLog(selectedId)
      .then(setLogUpload)
      .catch((e) => setError(String(e)))
      .finally(() => setUploadingLog(false));
  }, [selectedId]);

  const onInstallModpack = useCallback(
    (
      source: "modrinth" | "curseforge",
      projectId: string,
      versionId: string,
      name: string,
      optional: string[],
      manualMods: ManualMod[] = [],
    ) => {
      setInstalling(true);
      api
        .installModpack(source, projectId, versionId, name, optional, manualMods)
        .catch((e) => {
          setInstalling(false);
          setError(String(e));
        });
    },
    [],
  );

  const onInstallModpackFile = useCallback(
    (
      source: "modrinth" | "curseforge",
      path: string,
      name: string,
      optional: string[],
      manualMods: ManualMod[] = [],
    ) => {
      setInstalling(true);
      api.installModpackFile(path, source, name, optional, manualMods).catch((e) => {
        setInstalling(false);
        setError(String(e));
      });
    },
    [],
  );

  const onSaveInstance = useCallback((i: Instance) => {
    setInstances((list) => list.map((x) => (x.id === i.id ? i : x)));
    api.updateInstance(i).catch((e) => setError(String(e)));
  }, []);

  const refreshAccounts = (s: AccountStore) => setAccounts(s);

  const [acctWarn, setAcctWarn] = useState<{
    instance: Instance;
    accountId: string;
  } | null>(null);

  const handleSelectAccount = (id: string) => {
    const inst = instancesRef.current.find((i) => i.id === selectedRef.current);
    if (inst?.account_override && inst.account_override !== id) {
      setAcctWarn({ instance: inst, accountId: id });
      return;
    }
    api.selectAccount(id).then(refreshAccounts).catch(() => {});
  };

  const confirmAccountChange = () => {
    if (!acctWarn) return;
    onSaveInstance({ ...acctWarn.instance, account_override: null });
    api.selectAccount(acctWarn.accountId).then(refreshAccounts).catch(() => {});
    setAcctWarn(null);
  };

  const clearAutoJoinIfRemoved = (kind: "world" | "server", id: string) => {
    const inst = instancesRef.current.find((i) => i.id === selectedRef.current);
    const aj = inst?.auto_join;
    if (!inst || !aj || aj.kind !== kind) return;
    const matches = aj.kind === "world" ? aj.folder === id : aj.ip === id;
    if (matches) onSaveInstance({ ...inst, auto_join: null });
  };
  const activeAccount =
    accounts.accounts.find((a) => a.id === accounts.selected) ??
    accounts.accounts[0];

  const overrideAccountId =
    instance?.account_override &&
    accounts.accounts.some((a) => a.id === instance.account_override)
      ? instance.account_override
      : null;

  const skinsAvailable = activeAccount?.kind === "microsoft";
  skinsAvailableRef.current = skinsAvailable;
  const canPlay = accounts.accounts.length > 0;
  const running = !!selectedId && runningIds.has(selectedId);
  const working = !!selectedId && workingIds.has(selectedId);
  const maintaining = !!selectedId && maintainingIds.has(selectedId);
  const progress = selectedId ? progressById[selectedId] ?? null : null;
  const gearMaintaining = !!gearId && maintainingIds.has(gearId);
  const gearProgress = gearId ? progressById[gearId] ?? null : null;
  const locked = instance?.modpack_locked ?? true;
  const managed = instance ? instance.pack.kind !== "none" : false;

  const cmdEnvRef = useRef({
    instances,
    selectedId,
    instance,
    settings,
    accounts,
    runningIds,
    skinsAvailable,
    featuredEnabled,
    onPlay,
    onStop,
    selectInstance,
    onSaveInstance,
    refreshInstances,
    onMicrosoftLogin,
  });
  cmdEnvRef.current = {
    instances,
    selectedId,
    instance,
    settings,
    accounts,
    runningIds,
    skinsAvailable,
    featuredEnabled,
    onPlay,
    onStop,
    selectInstance,
    onSaveInstance,
    refreshInstances,
    onMicrosoftLogin,
  };

  const cmdCtx = useMemo<CommandContext>(() => {
    const env = () => cmdEnvRef.current;
    return {
      api,
      toast,
      state: (): CmdState => {
        const e = env();
        return {
          instances: e.instances,
          selectedId: e.selectedId,
          instance: e.instance,
          settings: e.settings,
          accounts: e.accounts,
          runningIds: e.runningIds,
          skinsAvailable: e.skinsAvailable,
          featuredEnabled: e.featuredEnabled,
        };
      },
      nav: (v) => setView(v),
      selectInstance: (id) => env().selectInstance(id),
      play: (id, qp) => env().onPlay(id, qp),
      stop: () => void env().onStop(),
      applySettings: (patch) => {
        const s = settingsRef.current;
        if (!s) return;
        const next = { ...s, ...patch } as LauncherSettings;
        setSettings(next);
        api.saveSettings(next).catch(() => {});
      },
      saveInstance: (i) => env().onSaveInstance(i),
      refreshInstances: () => env().refreshInstances(),
      openModal: (m) => {
        if (m === "add-instance") setAddOpen(true);
        else if (m === "about") setAboutOpen(true);
        else if (m === "log") setLogView(false);
        else if (m === "ms-login") env().onMicrosoftLogin();
      },
      startMsLogin: () => env().onMicrosoftLogin(),
    };
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    const unsubs: Array<() => void> = [];
    Promise.all([
      api
        .onCliCommand((cmd) => {
          getCurrentWindow().setFocus().catch(() => {});
          void runScript(cmd, REGISTRY, cmdCtx);
        })
        .then((u) => unsubs.push(u)),
      api
        .onPackwizOpen((path) => void openPackwizShare(path))
        .then((u) => unsubs.push(u)),
    ]).then(() => {
      api
        .cliReady()
        .then((pending) => {
          if (pending.open) void openPackwizShare(pending.open);
          if (pending.command) {
            getCurrentWindow().setFocus().catch(() => {});
            void runScript(pending.command, REGISTRY, cmdCtx);
          }
        })
        .catch(() => {});
    });
    api
      .onMenuAction((action) => {
        if (!action.startsWith("cmd:")) return;
        const command = action.slice(4);
        const win = getCurrentWindow();
        win.show().catch(() => {});
        win.setFocus().catch(() => {});
        setTimeout(() => void runScript(command, REGISTRY, cmdCtx), 60);
      })
      .then((u) => unsubs.push(u));
    const syncMenu = () =>
      api.setMenuCommands(pinnedMenuItems()).catch(() => {});
    syncMenu();
    const offPins = onPinsChanged(syncMenu);
    return () => {
      unsubs.forEach((u) => u());
      offPins();
    };
  }, [cmdCtx, openPackwizShare]);

  return (
    <I18nProvider
      locale={settings?.locale ?? "en"}
      pseudo={!!settings?.pseudo_localize}
    >
    <div className="flex h-screen w-screen flex-col bg-ink-950">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onChange={setView}
          running={runningIds.size > 0}
          onStop={onStop}
          onViewLogs={setLogView}
          onOpenPalette={() => setPaletteOpen(true)}
          onShowAbout={() => setAboutOpen(true)}
          hasInstance={!!selectedId}
          skinsAvailable={skinsAvailable}
          activeName={instance?.name}
          onActiveClick={() => {
            if (selectedId) {
              setGearId(selectedId);
              setView("instance-settings");
            }
          }}
          footer={
            <AccountMenu
              store={accounts}
              avatarVersion={avatarVersion}
              activeId={overrideAccountId}
              overridden={!!overrideAccountId}
              onSelect={handleSelectAccount}
              onRemove={(id) => api.removeAccount(id).then(refreshAccounts)}
              onMicrosoftLogin={onMicrosoftLogin}
              recheckSignal={accountsRecheck}
              onAddOffline={(username) =>
                api
                  .addOfflineAccount(username)
                  .then(refreshAccounts)
                  .catch((e) => setError(String(e)))
              }
            />
          }
        />

        <main className="flex min-w-0 flex-1 flex-col p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 rise">
              <AlertTriangle size={16} />
              <span className="flex-1 truncate">{error}</span>
              <button onClick={() => setError(null)}>
                <X size={15} />
              </button>
            </div>
          )}

          <div
            key={view}
            className="view-anim flex min-h-0 flex-1 flex-col"
          >
          {tabIntro === view && (
            <TabIntro
              view={tabIntro}
              onClose={() => {
                markTabIntroSeen(tabIntro);
                setTabIntro(null);
              }}
            />
          )}
          {view === "instances" && (
            <InstancesView
              instances={instances}
              showFeatured={featuredEnabled}
              folders={settings?.instance_folders ?? []}
              settingsAccent={settings?.accent_color ?? null}
              onSaveFolders={(f) => {
                setSettings((s) => {
                  if (!s) return s;
                  const next = { ...s, instance_folders: f };
                  api.saveSettings(next).catch((e) => setError(String(e)));
                  return next;
                });
              }}
              onSaveInstance={onSaveInstance}
              selectedId={selectedId}
              runningIds={runningIds}
              maintainingIds={maintainingIds}
              workingIds={workingIds}
              installingId={installingInstanceId}
              onSelect={(id) => {
                void selectInstance(id);
                setView("play");
              }}
              onOpenSettings={(id) => {
                setGearId(id);
                setView("instance-settings");
              }}
              onStar={(i) => onSaveInstance({ ...i, pinned: !i.pinned })}
              onAdd={() => setAddOpen(true)}
              onImportFile={(file) => {
                setImportFile(file);
                setAddOpen(true);
              }}
              onPlay={(id) => void launchNow(id)}
              onDelete={(id) => {
                api
                  .deleteInstance(id)
                  .then(() =>
                    refreshInstances().then((list) => {
                      if (selectedRef.current === id) {
                        const next = defaultInstanceId(
                          list,
                          settingsRef.current?.show_featured ?? true,
                        );
                        if (next) void selectInstance(next);
                        else setSelectedId(null);
                      }
                    }),
                  )
                  .catch((e) => setError(String(e)));
              }}
            />
          )}

          {view === "play" && (
            <PlayView
              instance={instance}
              busy={working || maintaining}
              running={running}
              progress={progress}
              canPlay={canPlay}
              modStatus={modStatus}
              locked={locked}
              notInstalled={managed && !!modStatus && !modStatus.installed_version}
              showPlaytime={settings?.show_playtime ?? true}
              playtimeHours={settings?.playtime_in_hours ?? false}
              featuredEnabled={featuredEnabled}
              players={players}
              playersError={playersError}
              news={news}
              newsError={newsError}
              onRefreshPlayers={refreshPlayers}
              onRefreshNews={refreshNews}
              onPlay={(qp) => onPlay(undefined, qp)}
              onUpdate={() => onPlay()}
              onStop={onStop}
              onCancel={onCancel}
              onSaveInstance={onSaveInstance}
              onShareChanged={() => void refreshInstances()}
              onOpenSettings={() => {
                if (selectedId) {
                  setGearId(selectedId);
                  setView("instance-settings");
                }
              }}
              launcherSettings={settings}
              overrideAccount={
                instance?.account_override
                  ? accounts.accounts.find((a) => a.id === instance.account_override)
                      ?.username ?? null
                  : null
              }
            />
          )}

          {view === "mods" && selectedId && (
            <ModsView
              instanceId={selectedId}
              mc={instance?.minecraft_version ?? ""}
              loader={instance?.loader ?? "vanilla"}
              locked={locked}
              onToggleLock={() => {
                if (!instance) return;
                api
                  .setModpackLocked(instance.id, !instance.modpack_locked)
                  .then(() => api.getInstance(instance.id).then(onSaveInstance))
                  .catch((e) => setError(String(e)));
              }}
            />
          )}

          {view === "worlds" && selectedId && (
            <WorldsView
              instanceId={selectedId}
              canPlay={canPlay && !running}
              onQuickPlay={(qp) => onPlay(selectedId, qp)}
              onRemoved={(folder) => clearAutoJoinIfRemoved("world", folder)}
            />
          )}

          {view === "servers" && selectedId && (
            <ServersView
              instanceId={selectedId}
              canPlay={canPlay && !running}
              onQuickPlay={(qp) => onPlay(selectedId, qp)}
              onRemoved={(ip) => clearAutoJoinIfRemoved("server", ip)}
            />
          )}

          {view === "screenshots" && selectedId && (
            <ScreenshotsView instanceId={selectedId} />
          )}

          {view === "skin" &&
            (() => {
              const acc =
                accounts.accounts.find((a) => a.id === accounts.selected) ??
                accounts.accounts[0] ??
                null;
              return (
                <SkinView
                  key={acc?.id ?? "none"}
                  accountId={acc?.id ?? null}
                  username={acc?.username}
                  onSkinApplied={() => setAvatarVersion((v) => v + 1)}
                />
              );
            })()}

          {view === "instance-settings" && gearInstance && settings && (
            <InstanceSettingsView
              instance={gearInstance}
              settings={settings}
              accounts={accounts}
              modStatus={gearId === selectedId ? modStatus : null}
              maintaining={gearMaintaining}
              progress={gearProgress}
              onBack={() => setView("instances")}
              onSaveInstance={onSaveInstance}
              onRefresh={() => void refreshInstances()}
              onDeleted={(id) => {
                refreshInstances().then((list) => {
                  if (selectedId === id) {
                    const next = defaultInstanceId(list, featuredEnabled);
                    if (next) void selectInstance(next);
                    else setSelectedId(null);
                  }
                });
                setView("instances");
              }}
              onError={setError}
              onCheckUpdates={() => {
                if (!gearId) return;
                api
                  .modpackStatus(gearId)
                  .then((st) => {
                    if (gearId === selectedRef.current) setModStatus(st);
                  })
                  .catch(() => {});
                api.syncModpack(gearId).catch((e) => setError(String(e)));
              }}
            />
          )}

          {view === "settings" && (
            <SettingsView
              settings={settings}
              javaInstanceId={selectedId}
              appVersion={appVer}
              onShowChangelog={() =>
                setChangelog({ version: appVer, updated: false })
              }
              onUpdateInstalled={(v) => setRestartVersion(v)}
              onSaveSettings={(s) => {
                setSettings(s);
                api.saveSettings(s).catch((e) => setError(String(e)));
              }}
              onReplayOnboarding={() => {
                try {
                  localStorage.removeItem(ONBOARDED_KEY);
                } catch {}
                resetTabIntros();
                setTabIntro(null);
                setView("play");
                setOnboardingOpen(true);
              }}
              onError={(e) => setError(e)}
            />
          )}
          </div>
        </main>
      </div>

      {addOpen && (
        <AddInstanceModal
          installing={installing}
          detailInstanceId={selectedId}
          importOnly={importFromOnboarding}
          initialPackwiz={pendingPackwizShare}
          initialImportFile={importFile}
          onClose={() => {
            setAddOpen(false);
            setImportFromOnboarding(false);
            setPendingPackwizShare(null);
            setImportFile(null);
          }}
          onCreated={(inst) => {
            setAddOpen(false);
            setImportFromOnboarding(false);
            setPendingPackwizShare(null);
            setImportFile(null);
            api.getSettings().then(setSettings).catch(() => {});
            refreshInstances().then(() => {
              void selectInstance(inst.id);
              setView("play");
            });
          }}
          onInstallModpack={onInstallModpack}
          onInstallModpackFile={onInstallModpackFile}
          onError={setError}
          featured={featuredPacks}
          featuredEnabled={featuredEnabled}
          onEnableFeatured={() => {
            setSettings((s) => {
              if (!s || s.show_featured) return s;
              const next = { ...s, show_featured: true };
              api.saveSettings(next).catch((e) => setError(String(e)));
              return next;
            });
          }}
          onOpenFeatured={(id) => {
            setAddOpen(false);
            void selectInstance(id);
            setView("play");
          }}
        />
      )}

      {flavorPrompt && (
        <div
          className="modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setFlavorPrompt(null)
          }
        >
          <div className="rise flex h-[70vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 p-5 shadow-2xl">
            {flavorPrompt.groups === "loading" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-600">
                <Loader2 size={22} className="animate-spin text-brass-400" />
                <span className="text-sm">{tr("addInstance.checkingOptional")}</span>
              </div>
            ) : (
              <FlavorPicker
                title={
                  instances.find((i) => i.id === flavorPrompt.instanceId)?.name ??
                  tr("addInstance.modpackFallback")
                }
                groups={flavorPrompt.groups}
                busy={false}
                confirmLabel={tr("page.installAndPlay")}
                onBack={() => setFlavorPrompt(null)}
                onConfirm={(ids) => {
                  const p = flavorPrompt;
                  setFlavorPrompt(null);
                  api
                    .setPackwizFlavors(p.instanceId, ids)
                    .then((updated) => {
                      setInstances((list) =>
                        list.map((x) => (x.id === updated.id ? updated : x)),
                      );
                      return launchNow(p.instanceId, p.quickPlay);
                    })
                    .catch((e) => setError(String(e)));
                }}
              />
            )}
          </div>
        </div>
      )}

      {msAuth && (
        <MicrosoftModal state={msAuth} onClose={() => setMsAuth(null)} />
      )}
      {logView !== null && selectedId && (
        <LogViewer
          instanceId={selectedId}
          live={logView}
          uploading={uploadingLog}
          onUpload={onUploadLog}
          onClose={() => setLogView(null)}
        />
      )}
      {logUpload && (
        <LogUploadModal upload={logUpload} onClose={() => setLogUpload(null)} />
      )}
      {changelog && (
        <ChangelogModal
          version={changelog.version}
          updated={changelog.updated}
          onClose={() => setChangelog(null)}
        />
      )}
      {acctWarn && (
        <AccountOverrideWarning
          instanceName={acctWarn.instance.name}
          accountName={
            accounts.accounts.find((a) => a.id === acctWarn.accountId)?.username ??
            acctWarn.accountId
          }
          onConfirm={confirmAccountChange}
          onCancel={() => setAcctWarn(null)}
        />
      )}
      {restartVersion && (
        <RestartPrompt
          version={restartVersion}
          onDismiss={() => setRestartVersion(null)}
        />
      )}
      {aboutOpen && (
        <AboutModal
          appVersion={appVer}
          onShowChangelog={() => setChangelog({ version: appVer, updated: false })}
          onUpdateInstalled={(v) => setRestartVersion(v)}
          onError={setError}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {onboardingOpen && settings && (
        <OnboardingWizard
          settings={settings}
          onPatch={(p) => {
            setSettings((s) => {
              if (!s) return s;
              const next = { ...s, ...p };
              api.saveSettings(next).catch((e) => setError(String(e)));
              return next;
            });
          }}
          accounts={accounts}
          onMicrosoftLogin={onMicrosoftLogin}
          onAddOffline={(username) =>
            api
              .addOfflineAccount(username)
              .then(refreshAccounts)
              .catch((e) => setError(String(e)))
          }
          onOpenImport={() => {
            setImportFromOnboarding(true);
            setAddOpen(true);
          }}
          onFinish={() => setOnboardingOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette ctx={cmdCtx} onClose={() => setPaletteOpen(false)} />
      )}
      <ToastHost />
      <TooltipLayer />
    </div>
    </I18nProvider>
  );
}
