"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { Sidebar, type View } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { AccountMenu } from "@/components/AccountMenu";
import { PlayView } from "@/components/PlayView";
import { ModsView } from "@/components/ModsView";
import { ScreenshotsView } from "@/components/ScreenshotsView";
import { SkinView } from "@/components/SkinView";
import { SettingsView } from "@/components/SettingsView";
import { InstancesView } from "@/components/InstancesView";
import { InstanceSettingsView } from "@/components/InstanceSettingsView";
import { AddInstanceModal } from "@/components/AddInstanceModal";
import { MicrosoftModal, type MsAuthState } from "@/components/MicrosoftModal";
import { LogUploadModal } from "@/components/LogUploadModal";
import { LogViewer } from "@/components/LogViewer";
import { ChangelogModal } from "@/components/ChangelogModal";
import { RestartPrompt } from "@/components/RestartPrompt";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as api from "@/lib/api";
import { ToastHost, toast, toastProgress, dismissToast } from "@/lib/toast";
import type {
  AccountStore,
  Instance,
  LaunchProgress,
  LauncherSettings,
  LogUpload,
  ModpackStatus,
  NewsItem,
  PlayerCount,
} from "@/lib/types";

const PLAYERCOUNT_INTERVAL = 30_000;
const NEWS_INTERVAL = 300_000;

type Phase = "idle" | "working" | "running" | "updating";

export default function Home() {
  const [view, setView] = useState<View>("play");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gearId, setGearId] = useState<string | null>(null);
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [accounts, setAccounts] = useState<AccountStore>({
    accounts: [],
    selected: null,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msAuth, setMsAuth] = useState<MsAuthState | null>(null);

  const [maintaining, setMaintaining] = useState(false);
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

  const [addOpen, setAddOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installingInstanceId, setInstallingInstanceId] = useState<string | null>(
    null,
  );
  const [avatarVersion, setAvatarVersion] = useState(0);

  const instance = instances.find((i) => i.id === selectedId) ?? null;
  const gearInstance = instances.find((i) => i.id === gearId) ?? null;

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view === "play") setView("instances");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const theme = settings?.theme ?? "system";
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("reduce-motion", !!settings?.reduce_motion);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const light = theme === "brass-light" || (theme === "system" && mq.matches);
      root.classList.toggle("theme-light", light);
    };
    apply();
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, settings?.reduce_motion]);

  const refreshInstances = useCallback(async (): Promise<Instance[]> => {
    const list = await api.getInstances();
    setInstances(list);
    return list;
  }, []);

  const selectInstance = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setModStatus(null);
      setProgress(null);
      setPhase((prev) => (prev === "running" ? prev : "idle"));
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
        const [list, s, acc, running, ver] = await Promise.all([
          api.getInstances(),
          api.getSettings(),
          api.getAccounts(),
          api.getRunning(),
          api.appVersion().catch(() => null),
        ]);
        setInstances(list);
        setAccounts(acc);
        setAppVer(ver);

        const sel =
          (s.selected_instance &&
            list.find((i) => i.id === s.selected_instance)?.id) ||
          list.find((i) => i.featured)?.id ||
          list[0]?.id ||
          null;
        setSelectedId(sel);
        if (running.length) setRunningId(running[0]);
        if (sel && running.includes(sel)) setPhase("running");

        let next = s;
        if (ver && s.last_version !== ver) {
          if (s.last_version) setChangelog({ version: ver, updated: true });
          next = { ...s, last_version: ver };
          api.saveSettings(next).catch(() => {});
        }
        setSettings(next);

        if (next.auto_update) {
          try {
            const info = await api.checkForUpdate();
            if (info.available) {
              toast(`Update v${info.version} found — downloading…`, "info");
              await api.installUpdate();
              toast(`Update v${info.version} installed`, "success");
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

  const showNews = !!(
    instance?.featured &&
    instance.show_news &&
    instance.news_url
  );
  const showPlayers = !!(
    instance?.featured &&
    instance.show_playercount &&
    instance.playercount_url
  );

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
        if (p.instance_id === selectedRef.current) setProgress(p);
      }),
      api.onLaunchStarted((id) => {
        setRunningId(id);
        if (id === selectedRef.current) setPhase("running");
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
        setRunningId((cur) => (cur === info.instance_id ? null : cur));
        if (info.instance_id === selectedRef.current) {
          setPhase("idle");
          setProgress(null);
          if (info.error) setError(info.error);
          api.modpackStatus(info.instance_id).then(setModStatus).catch(() => {});
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
        if (p.instance_id !== selectedRef.current) return;
        setMaintaining(true);
        setProgress(p);
      }),
      api.onModpackDone((d) => {
        if (d.instance_id !== selectedRef.current) return;
        setMaintaining(false);
        setProgress(null);
        if (d.error) {
          setError(d.error);
          toast("Modpack update failed", "error");
        } else if (!d.cancelled) {
          toast("Modpack is up to date", "success");
        }
        refreshModStatus();
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
        setInstallingInstanceId(created.id);
        setAddOpen(false);
        setView("instances");
        refreshInstances().catch(() => {});
      }),
      api.onPackProgress((p) => {
        const pct =
          p.total > 0 ? Math.min(100, Math.round((p.current / p.total) * 100)) : null;
        toastProgress("install", p.message || "Installing modpack…", pct);
      }),
      api.onPackDone((d) => {
        setInstalling(false);
        setInstallingInstanceId(null);
        dismissToast("install");
        if (d.error) {
          setError(d.error);
          toast("Modpack install failed", "error");
          refreshInstances().catch(() => {});
        } else if (d.cancelled) {
          toast("Install cancelled", "info");
          refreshInstances().catch(() => {});
        } else if (d.instance) {
          const created = d.instance;
          toast(`Installed ${created.name}`, "success");
          setAddOpen(false);
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
      } else {
        setMsAuth({ status: "error", message: e.message });
      }
    });
    return () => {
      un.then((u) => u()).catch(() => {});
    };
  }, []);

  const onPlay = useCallback(
    async (id?: string) => {
      const target = id ?? selectedId;
      if (!target) return;
      if (target !== selectedId) await selectInstance(target);
      setError(null);
      setProgress(null);
      setPhase("working");
      setView("play");
      try {
        await api.launch(target);
      } catch (e) {
        setError(String(e));
        setPhase("idle");
      }
    },
    [selectedId, selectInstance],
  );

  const onStop = useCallback(async () => {
    const target = runningId ?? selectedId;
    if (!target) return;
    try {
      await api.stop(target);
    } catch (e) {
      setError(String(e));
    }
  }, [runningId, selectedId]);

  const onCancel = useCallback(async () => {
    if (!selectedId) return;
    try {
      await api.cancelOp(selectedId);
    } catch (e) {
      setError(String(e));
    }
  }, [selectedId]);

  const onMicrosoftLogin = useCallback(() => {
    setMsAuth({ status: "starting" });
    api.startMicrosoftLogin().catch((e) => {
      setMsAuth({ status: "error", message: String(e) });
    });
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
    ) => {
      setInstalling(true);
      toastProgress("install", "Starting install…", null);
      api.installModpack(source, projectId, versionId, name).catch((e) => {
        setInstalling(false);
        dismissToast("install");
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
  const canPlay = accounts.accounts.length > 0;
  const running = runningId !== null && runningId === selectedId;
  const locked = instance?.modpack_locked ?? true;
  const managed = instance ? instance.pack.kind !== "none" : false;

  return (
    <div className="flex h-screen w-screen flex-col bg-ink-950">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onChange={setView}
          running={runningId !== null}
          onStop={onStop}
          onViewLogs={setLogView}
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
              onSelect={(id) => api.selectAccount(id).then(refreshAccounts)}
              onRemove={(id) => api.removeAccount(id).then(refreshAccounts)}
              onMicrosoftLogin={onMicrosoftLogin}
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

          {view === "instances" && (
            <InstancesView
              instances={instances}
              selectedId={selectedId}
              runningId={runningId}
              installingId={installingInstanceId}
              onCancelInstall={() => api.cancelInstall().catch(() => {})}
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
            />
          )}

          {view === "play" && (
            <PlayView
              instance={instance}
              busy={phase === "working" || maintaining}
              running={running}
              progress={progress}
              canPlay={canPlay}
              modStatus={modStatus}
              locked={locked}
              notInstalled={managed && !!modStatus && !modStatus.installed_version}
              showPlaytime={settings?.show_playtime ?? true}
              playtimeHours={settings?.playtime_in_hours ?? false}
              players={players}
              playersError={playersError}
              news={news}
              newsError={newsError}
              onRefreshPlayers={refreshPlayers}
              onRefreshNews={refreshNews}
              onPlay={() => onPlay()}
              onUpdate={() => onPlay()}
              onStop={onStop}
              onCancel={onCancel}
            />
          )}

          {view === "mods" && selectedId && (
            <ModsView
              instanceId={selectedId}
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
              modStatus={gearId === selectedId ? modStatus : null}
              maintaining={maintaining && gearId === selectedId}
              progress={gearId === selectedId ? progress : null}
              onBack={() => setView("instances")}
              onSaveInstance={onSaveInstance}
              onDeleted={(id) => {
                refreshInstances().then((list) => {
                  if (selectedId === id) {
                    const next =
                      list.find((i) => i.featured)?.id ?? list[0]?.id ?? null;
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
              onError={(e) => setError(e)}
            />
          )}
        </main>
      </div>

      {addOpen && (
        <AddInstanceModal
          installing={installing}
          detailInstanceId={selectedId}
          onClose={() => setAddOpen(false)}
          onCreated={(inst) => {
            setAddOpen(false);
            refreshInstances().then(() => {
              void selectInstance(inst.id);
              setView("play");
            });
          }}
          onInstallModpack={onInstallModpack}
          onUploadModpack={(source, data, name) => {
            setInstalling(true);
            toastProgress("install", "Reading file…", null);
            api.installModpackBytes(data, source, name).catch((e) => {
              setInstalling(false);
              dismissToast("install");
              setError(String(e));
            });
          }}
          onError={setError}
        />
      )}

      <MicrosoftModal state={msAuth} onClose={() => setMsAuth(null)} />
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
      {restartVersion && (
        <RestartPrompt
          version={restartVersion}
          onDismiss={() => setRestartVersion(null)}
        />
      )}
      <ToastHost />
    </div>
  );
}
