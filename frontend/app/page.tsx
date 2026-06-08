"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { Sidebar, type View } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { AccountMenu } from "@/components/AccountMenu";
import { PlayView } from "@/components/PlayView";
import { ModsView } from "@/components/ModsView";
import { SettingsView } from "@/components/SettingsView";
import { MicrosoftModal, type MsAuthState } from "@/components/MicrosoftModal";
import { LogUploadModal } from "@/components/LogUploadModal";
import { LogViewer } from "@/components/LogViewer";
import * as api from "@/lib/api";
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

const PRIMARY_ID = "brassworks";
const PLAYERCOUNT_INTERVAL = 30_000;
const NEWS_INTERVAL = 300_000;

type Phase = "idle" | "working" | "running" | "updating";

export default function Home() {
  const [view, setView] = useState<View>("play");
  const [instance, setInstance] = useState<Instance | null>(null);
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [accounts, setAccounts] = useState<AccountStore>({
    accounts: [],
    selected: null,
  });

  const [phase, setPhase] = useState<Phase>("idle");
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

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!api.isTauri()) return;
    (async () => {
      try {
        const [list, s, acc, running] = await Promise.all([
          api.getInstances(),
          api.getSettings(),
          api.getAccounts(),
          api.getRunning(),
        ]);
        setInstance(list.find((i) => i.id === PRIMARY_ID) ?? list[0] ?? null);
        setSettings(s);
        setAccounts(acc);
        if (running.includes(PRIMARY_ID)) setPhase("running");
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const refreshModStatus = useCallback(() => {
    if (!api.isTauri()) return;
    api
      .modpackStatus(PRIMARY_ID)
      .then(setModStatus)
      .catch(() => {});
  }, []);
  useEffect(refreshModStatus, [refreshModStatus]);

  useEffect(() => {
    if (!api.isTauri()) return;
    let alive = true;
    const tick = () =>
      api
        .getPlayercount()
        .then((p) => {
          if (alive) {
            setPlayers(p);
            setPlayersError(false);
          }
        })
        .catch(() => alive && setPlayersError(true));
    tick();
    const h = setInterval(tick, PLAYERCOUNT_INTERVAL);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    let alive = true;
    const tick = () =>
      api
        .getNews()
        .then((n) => {
          if (alive) {
            setNews(n);
            setNewsError(false);
          }
        })
        .catch(() => alive && setNewsError(true));
    tick();
    const h = setInterval(tick, NEWS_INTERVAL);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    const unlisteners = [
      api.onLaunchProgress((p) => {
        if (p.instance_id === PRIMARY_ID) setProgress(p);
      }),
      api.onLaunchStarted((id) => {
        if (id === PRIMARY_ID) setPhase("running");
      }),
      api.onLaunchExited((info) => {
        if (info.instance_id !== PRIMARY_ID) return;
        setPhase("idle");
        setProgress(null);
        if (info.error) setError(info.error);
        api.getInstance(PRIMARY_ID).then(setInstance).catch(() => {});
        api.modpackStatus(PRIMARY_ID).then(setModStatus).catch(() => {});
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
        if (p.instance_id !== PRIMARY_ID) return;
        setMaintaining(true);
        setProgress(p);
      }),
      api.onModpackDone((d) => {
        if (d.instance_id !== PRIMARY_ID) return;
        setMaintaining(false);
        setProgress(null);
        if (d.error) setError(d.error);
        refreshModStatus();
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, [refreshModStatus]);

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

  const onPlay = useCallback(async () => {
    setError(null);
    setProgress(null);
    setPhase("working");
    try {
      await api.launch(PRIMARY_ID);
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }, []);

  const onUpdate = onPlay;

  const onStop = useCallback(async () => {
    try {
      await api.stop(PRIMARY_ID);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onCancel = useCallback(async () => {
    try {
      await api.cancelOp(PRIMARY_ID);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onMicrosoftLogin = useCallback(() => {
    setMsAuth({ status: "starting" });
    api.startMicrosoftLogin().catch((e) => {
      setMsAuth({ status: "error", message: String(e) });
    });
  }, []);

  const onToggleLock = useCallback(() => {
    const next = !(settings?.modpack_locked ?? true);
    api
      .setModpackLocked(PRIMARY_ID, next)
      .then(() => api.getSettings())
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, [settings]);

  const onUploadLog = useCallback(() => {
    setUploadingLog(true);
    setError(null);
    api
      .uploadLog(PRIMARY_ID)
      .then(setLogUpload)
      .catch((e) => setError(String(e)))
      .finally(() => setUploadingLog(false));
  }, []);

  const refreshAccounts = (s: AccountStore) => setAccounts(s);
  const canPlay = accounts.accounts.length > 0;
  const running = phase === "running";
  const locked = settings?.modpack_locked ?? true;

  return (
    <div className="flex h-screen w-screen flex-col bg-ink-950">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onChange={setView}
          running={running}
          onStop={onStop}
          onViewLogs={setLogView}
          footer={
            <AccountMenu
              store={accounts}
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

          {view === "play" && (
            <PlayView
              instance={instance}
              busy={phase === "working" || maintaining}
              running={phase === "running"}
              progress={progress}
              canPlay={canPlay}
              modStatus={modStatus}
              locked={locked}
              players={players}
              playersError={playersError}
              news={news}
              newsError={newsError}
              onPlay={onPlay}
              onUpdate={onUpdate}
              onStop={onStop}
              onCancel={onCancel}
            />
          )}

          {view === "mods" && (
            <ModsView
              instanceId={PRIMARY_ID}
              locked={locked}
              onToggleLock={onToggleLock}
            />
          )}

          {view === "settings" && (
            <SettingsView
              settings={settings}
              instance={instance}
              modStatus={modStatus}
              maintaining={maintaining}
              progress={progress}
              onSaveSettings={(s) => {
                setSettings(s);
                api.saveSettings(s).catch((e) => setError(String(e)));
              }}
              onSaveInstance={(i) => {
                setInstance(i);
                api.updateInstance(i).catch((e) => setError(String(e)));
              }}
              onError={(e) => setError(e)}
            />
          )}
        </main>
      </div>

      <MicrosoftModal state={msAuth} onClose={() => setMsAuth(null)} />
      {logView !== null && (
        <LogViewer
          instanceId={PRIMARY_ID}
          live={logView}
          uploading={uploadingLog}
          onUpload={onUploadLog}
          onClose={() => setLogView(null)}
        />
      )}
      {logUpload && (
        <LogUploadModal upload={logUpload} onClose={() => setLogUpload(null)} />
      )}
    </div>
  );
}
