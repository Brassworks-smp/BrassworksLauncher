
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Account,
  AccountStore,
  AuthEvent,
  ContentVersion,
  ExitInfo,
  InstalledMod,
  Instance,
  LaunchProgress,
  LauncherSettings,
  LogUpload,
  ModInfo,
  ModpackDone,
  ModpackStatus,
  NewsItem,
  PlayerCount,
  ProjectDetail,
  SearchHit,
} from "./types";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;


export const getInstances = (): Promise<Instance[]> => invoke("get_instances");
export const getInstance = (id: string): Promise<Instance> =>
  invoke("get_instance", { id });
export const updateInstance = (instance: Instance): Promise<void> =>
  invoke("update_instance", { instance });


export const getSettings = (): Promise<LauncherSettings> =>
  invoke("get_settings");
export const saveSettings = (settings: LauncherSettings): Promise<void> =>
  invoke("save_settings", { settings });


export const getAccounts = (): Promise<AccountStore> => invoke("get_accounts");
export const selectAccount = (id: string): Promise<AccountStore> =>
  invoke("select_account", { id });
export const removeAccount = (id: string): Promise<AccountStore> =>
  invoke("remove_account", { id });
export const startMicrosoftLogin = (): Promise<void> =>
  invoke("start_microsoft_login");

export const onMicrosoftAuth = (
  cb: (e: AuthEvent) => void,
): Promise<UnlistenFn> => listen<AuthEvent>("auth://microsoft", (e) => cb(e.payload));

export const avatarUrl = (uuid: string, size = 64): string =>
  `https://mc-heads.net/avatar/${uuid.replace(/-/g, "")}/${size}`;


export const launch = (instanceId: string): Promise<void> =>
  invoke("launch", { instanceId });
export const stop = (instanceId: string): Promise<void> =>
  invoke("stop", { instanceId });
export const cancelOp = (instanceId: string): Promise<void> =>
  invoke("cancel_op", { instanceId });
export const getRunning = (): Promise<string[]> => invoke("get_running");

export const onLaunchProgress = (
  cb: (p: LaunchProgress) => void,
): Promise<UnlistenFn> => listen<LaunchProgress>("launch://progress", (e) => cb(e.payload));

export const onLaunchStarted = (
  cb: (instanceId: string) => void,
): Promise<UnlistenFn> => listen<string>("launch://started", (e) => cb(e.payload));

export const onLaunchExited = (
  cb: (info: ExitInfo) => void,
): Promise<UnlistenFn> => listen<ExitInfo>("launch://exited", (e) => cb(e.payload));


export const modpackStatus = (instanceId: string): Promise<ModpackStatus> =>
  invoke("modpack_status", { instanceId });
export const syncModpack = (instanceId: string): Promise<void> =>
  invoke("sync_modpack", { instanceId });
export const repairModpack = (instanceId: string): Promise<void> =>
  invoke("repair_modpack", { instanceId });
export const reinstallModpack = (instanceId: string): Promise<void> =>
  invoke("reinstall_modpack", { instanceId });
export const reinstallLoader = (instanceId: string): Promise<void> =>
  invoke("reinstall_loader", { instanceId });
export const listMods = (instanceId: string): Promise<InstalledMod[]> =>
  invoke("list_mods", { instanceId });
export const modInfo = (
  instanceId: string,
  modrinthId: string,
  versionId: string | null,
): Promise<ModInfo> =>
  invoke("mod_info", { instanceId, modrinthId, versionId });
export const setContentEnabled = (
  instanceId: string,
  path: string,
  enabled: boolean,
): Promise<void> =>
  invoke("set_content_enabled", { instanceId, path, enabled });
export const removeContent = (instanceId: string, path: string): Promise<void> =>
  invoke("remove_content", { instanceId, path });
export const searchContent = (
  instanceId: string,
  query: string,
  projectType: string,
  offset: number,
): Promise<SearchHit[]> =>
  invoke("search_content", { instanceId, query, projectType, offset });
export const installContent = (
  instanceId: string,
  projectId: string,
  projectType: string,
): Promise<InstalledMod> =>
  invoke("install_content", { instanceId, projectId, projectType });
export const contentDetail = (
  instanceId: string,
  projectId: string,
): Promise<ProjectDetail> =>
  invoke("content_detail", { instanceId, projectId });
export const contentVersions = (
  instanceId: string,
  projectId: string,
  projectType: string,
): Promise<ContentVersion[]> =>
  invoke("content_versions", { instanceId, projectId, projectType });
export const installContentVersion = (
  instanceId: string,
  projectId: string,
  versionId: string,
  projectType: string,
): Promise<InstalledMod> =>
  invoke("install_content_version", {
    instanceId,
    projectId,
    versionId,
    projectType,
  });
export const setModpackLocked = (
  instanceId: string,
  locked: boolean,
): Promise<void> => invoke("set_modpack_locked", { instanceId, locked });
export const readLog = (instanceId: string): Promise<string> =>
  invoke("read_log", { instanceId });
export const uploadLog = (instanceId: string): Promise<LogUpload> =>
  invoke("upload_log", { instanceId });

export const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
  }
};
export const openDir = (instanceId: string, sub?: string): Promise<void> =>
  invoke("open_dir", { instanceId, sub: sub ?? null });

export const onModpackProgress = (
  cb: (p: LaunchProgress) => void,
): Promise<UnlistenFn> =>
  listen<LaunchProgress>("modpack://progress", (e) => cb(e.payload));

export const onModpackDone = (
  cb: (d: ModpackDone) => void,
): Promise<UnlistenFn> =>
  listen<ModpackDone>("modpack://done", (e) => cb(e.payload));


export const getNews = (): Promise<NewsItem> => invoke("get_news");
export const getPlayercount = (): Promise<PlayerCount> =>
  invoke("get_playercount");


export const BRASSWORKS_WEBSITE = "https://brassworks.opnsoc.org";
export const BRASSWORKS_GITHUB = "https://github.com/Brassworks-smp";

export const openExternal = (url: string): Promise<void> => openUrl(url);

export const modrinthUrl = (slugOrId: string): string =>
  `https://modrinth.com/project/${slugOrId}`;

export type { Account };
