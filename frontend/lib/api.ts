import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type {
  Account,
  AccountStatus,
  AccountStore,
  AuthEvent,
  ContentVersion,
  FlavorGroup,
  ManualMod,
  OptionalComponent,
  Preflight,
  PreflightProgress,
  QuickPlay,
  ExitInfo,
  InstallResult,
  InstalledMod,
  Instance,
  JavaInstall,
  FeaturedPack,
  PackwizShare,
  JavaReport,
  LaunchProgress,
  LauncherSettings,
  LogUpload,
  LogTail,
  ModInfo,
  ModpackDone,
  ModpackStatus,
  ExportTree,
  ExportSelection,
  ExportMeta,
  ExportConfig,
  ExportFormat,
  GitProvider,
  PublishResult,
  PackShare,
  PushProgress,
  SharePackParams,
  ShareRepoInfo,
  ShareDiffEntry,
  NewsItem,
  PlayerCount,
  ProjectDetail,
  Screenshot,
  SearchHit,
  UpdateInfo,
  UpdateProgress,
  McVersion,
  LoaderVersionInfo,
  PackDone,
  SkinProfile,
  SavedSkin,
  SkinLibraryView,
  WorldInfo,
  WorldBackup,
  DatapackInfo,
  ServerEntry,
  ServerStatus,
  StarKind,
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
export const defaultSettings = (): Promise<LauncherSettings> =>
  invoke("default_settings");
export const featuredPacks = (): Promise<FeaturedPack[]> =>
  invoke("featured_packs");


export const getAccounts = (): Promise<AccountStore> => invoke("get_accounts");
export const selectAccount = (id: string): Promise<AccountStore> =>
  invoke("select_account", { id });
export const removeAccount = (id: string): Promise<AccountStore> =>
  invoke("remove_account", { id });
export const accountStatus = (id: string): Promise<AccountStatus> =>
  invoke("account_status", { id });
export const addOfflineAccount = (username: string): Promise<AccountStore> =>
  invoke("add_offline_account", { username });
export const clearMsLoginCookies = (): Promise<void> =>
  invoke("clear_ms_login_cookies");
export const startMicrosoftLogin = (): Promise<void> =>
  invoke("start_microsoft_login");

export const onMicrosoftAuth = (
  cb: (e: AuthEvent) => void,
): Promise<UnlistenFn> => listen<AuthEvent>("auth://microsoft", (e) => cb(e.payload));

export const avatarUrl = (uuid: string, size = 64): string =>
  `https://mc-heads.net/avatar/${uuid.replace(/-/g, "")}/${size}`;

const faceTextures: Record<string, string> = {};
const faceSubs = new Set<() => void>();

export const setFaceTexture = (accountId: string, url: string | null): void => {
  if (url) {
    if (faceTextures[accountId] === url) return;
    faceTextures[accountId] = url;
  } else {
    if (!(accountId in faceTextures)) return;
    delete faceTextures[accountId];
  }
  faceSubs.forEach((f) => f());
};

export const getFaceTexture = (accountId: string): string | undefined =>
  faceTextures[accountId];

export const subscribeFaceTextures = (cb: () => void): (() => void) => {
  faceSubs.add(cb);
  return () => {
    faceSubs.delete(cb);
  };
};


export type { QuickPlay };
export const launch = (
  instanceId: string,
  quickPlay?: QuickPlay,
): Promise<void> => invoke("launch", { instanceId, quickPlay: quickPlay ?? null });
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
  source: string,
  projectId: string,
  versionId: string | null,
): Promise<ModInfo> =>
  invoke("mod_info", { instanceId, source, projectId, versionId });
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
  source: string,
  offset: number,
): Promise<SearchHit[]> =>
  invoke("search_content", { instanceId, query, projectType, source, offset });
export const installContent = (
  instanceId: string,
  projectId: string,
  projectType: string,
  source: string,
): Promise<InstallResult> =>
  invoke("install_content", { instanceId, projectId, projectType, source });
export const updateAllContent = (instanceId: string): Promise<string[]> =>
  invoke("update_all_content", { instanceId });
export const updateSelectedContent = (
  instanceId: string,
  keys: string[],
): Promise<string[]> =>
  invoke("update_selected_content", { instanceId, keys });
export const contentChangelog = (
  instanceId: string,
  projectId: string,
  versionId: string,
  source: string,
): Promise<string> =>
  invoke("content_changelog", { instanceId, projectId, versionId, source });
export const uninstallGame = (instanceId: string): Promise<void> =>
  invoke("uninstall_game", { instanceId });
export const exportModpack = (
  instanceId: string,
  format: ExportFormat,
): Promise<string> => invoke("export_modpack", { instanceId, format });
export const exportTree = (instanceId: string): Promise<ExportTree> =>
  invoke("export_tree", { instanceId });
export const exportModpackSelected = (
  instanceId: string,
  format: ExportFormat,
  selection: ExportSelection,
  meta: ExportMeta | null,
  unsup = false,
  sign = false,
  signFormat = "signify",
): Promise<string> =>
  invoke("export_modpack_selected", {
    instanceId,
    format,
    selection,
    meta,
    unsup,
    sign,
    signFormat,
  });
export const unsupPublicKey = (
  instanceId: string,
  format: string,
): Promise<string> => invoke("unsup_public_key", { instanceId, format });
export const regenerateUnsupKey = (
  instanceId: string,
  format: string,
): Promise<string> => invoke("regenerate_unsup_key", { instanceId, format });
export const listExportConfigs = (
  instanceId: string,
): Promise<ExportConfig[]> => invoke("list_export_configs", { instanceId });
export const saveExportConfig = (
  instanceId: string,
  config: ExportConfig,
): Promise<ExportConfig> =>
  invoke("save_export_config", { instanceId, config });
export const deleteExportConfig = (
  instanceId: string,
  configId: string,
): Promise<void> => invoke("delete_export_config", { instanceId, configId });
export const runExportConfig = (
  instanceId: string,
  configId: string,
): Promise<string> => invoke("run_export_config", { instanceId, configId });
export const forgeConnect = (
  provider: GitProvider,
  token: string,
  remember = true,
): Promise<string> => invoke("forge_connect", { provider, token, remember });
export const forgeTokenPresent = (provider: GitProvider): Promise<boolean> =>
  invoke("forge_token_present", { provider });
export const forgeRemembered = (provider: GitProvider): Promise<boolean> =>
  invoke("forge_remembered", { provider });
export const forgeDisconnect = (provider: GitProvider): Promise<void> =>
  invoke("forge_disconnect", { provider });
export const publishPack = (
  instanceId: string,
  configId: string,
  confirmEmbedded = false,
  provider: GitProvider = "github",
): Promise<PublishResult> =>
  invoke("publish_pack", { instanceId, configId, confirmEmbedded, provider });
export const sharePendingChanges = (instanceId: string): Promise<boolean> =>
  invoke("share_pending_changes", { instanceId });
export const shareLink = (instanceId: string): Promise<string> =>
  invoke("share_link", { instanceId });
export const writeShareFile = (instanceId: string): Promise<string> =>
  invoke("write_share_file", { instanceId });
export const disconnectShare = (instanceId: string): Promise<void> =>
  invoke("disconnect_share", { instanceId });
export const relinkShare = (
  instanceId: string,
  repoUrl: string,
): Promise<PackShare> => invoke("relink_share", { instanceId, repoUrl });
export const syncFromShared = (instanceId: string): Promise<void> =>
  invoke("sync_from_shared", { instanceId });
export const onPublishProgress = (
  cb: (p: PushProgress) => void,
): Promise<UnlistenFn> =>
  listen<PushProgress>("publish://progress", (e) => cb(e.payload));
export const shareParams = (instanceId: string): Promise<SharePackParams> =>
  invoke("share_params", { instanceId });
export const setShareParams = (
  instanceId: string,
  params: SharePackParams,
): Promise<void> => invoke("set_share_params", { instanceId, params });
export const shareRepoInfo = (instanceId: string): Promise<ShareRepoInfo> =>
  invoke("share_repo_info", { instanceId });
export const shareDiff = (instanceId: string): Promise<ShareDiffEntry[]> =>
  invoke("share_diff", { instanceId });
export const contentDetail = (
  instanceId: string,
  projectId: string,
  source: string,
): Promise<ProjectDetail> =>
  invoke("content_detail", { instanceId, projectId, source });
export const contentVersions = (
  instanceId: string,
  projectId: string,
  projectType: string,
  source: string,
): Promise<ContentVersion[]> =>
  invoke("content_versions", { instanceId, projectId, projectType, source });
export const installContentVersion = (
  instanceId: string,
  projectId: string,
  versionId: string,
  projectType: string,
  source: string,
): Promise<InstallResult> =>
  invoke("install_content_version", {
    instanceId,
    projectId,
    versionId,
    projectType,
    source,
  });
export const setModpackLocked = (
  instanceId: string,
  locked: boolean,
): Promise<void> => invoke("set_modpack_locked", { instanceId, locked });
export const readLog = (instanceId: string): Promise<string> =>
  invoke("read_log", { instanceId });
export const tailLog = (
  instanceId: string,
  offset: number,
): Promise<LogTail> => invoke("tail_log", { instanceId, offset });
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

export const cacheSize = (): Promise<number> => invoke("cache_size");
export const clearCache = (): Promise<number> => invoke("clear_cache");
export const cacheImages = (values: string[]): Promise<void> =>
  invoke("cache_images", { values });
export const cachedImage = (value: string): Promise<string | null> =>
  invoke("cached_image", { value });

export const listScreenshots = (): Promise<Screenshot[]> =>
  invoke("list_screenshots");
export const deleteScreenshot = (
  instanceId: string,
  name: string,
): Promise<void> => invoke("delete_screenshot", { instanceId, name });
export const screenshotThumb = (
  path: string,
  large: boolean,
): Promise<string> => invoke("screenshot_thumb", { path, large });

export const openFile = (path: string): Promise<void> =>
  invoke("open_file", { path });
export const fileSrc = (path: string): string => convertFileSrc(path);


export const listWorlds = (instanceId: string): Promise<WorldInfo[]> =>
  invoke("list_worlds", { instanceId });
export const worldIcon = (
  instanceId: string,
  folder: string,
): Promise<string | null> => invoke("world_icon", { instanceId, folder });
export const deleteWorld = (
  instanceId: string,
  folder: string,
): Promise<void> => invoke("delete_world", { instanceId, folder });
export const backupWorld = (
  instanceId: string,
  world: string,
): Promise<string> => invoke("backup_world", { instanceId, world });
export const listWorldBackups = (
  instanceId: string,
): Promise<WorldBackup[]> => invoke("list_world_backups", { instanceId });
export const exportWorld = (
  instanceId: string,
  world: string,
): Promise<string> => invoke("export_world", { instanceId, world });

export const listDatapacks = (
  instanceId: string,
  world: string,
): Promise<DatapackInfo[]> => invoke("list_datapacks", { instanceId, world });
export const setDatapackEnabled = (
  instanceId: string,
  world: string,
  filename: string,
  enabled: boolean,
): Promise<void> =>
  invoke("set_datapack_enabled", { instanceId, world, filename, enabled });
export const removeDatapack = (
  instanceId: string,
  world: string,
  filename: string,
): Promise<void> => invoke("remove_datapack", { instanceId, world, filename });
export const installDatapack = (
  instanceId: string,
  world: string,
  source: string,
  projectId: string,
  versionId: string | null,
): Promise<string> =>
  invoke("install_datapack", { instanceId, world, source, projectId, versionId });

export const listServers = (instanceId: string): Promise<ServerEntry[]> =>
  invoke("list_servers", { instanceId });
export const saveServers = (
  instanceId: string,
  servers: ServerEntry[],
): Promise<void> => invoke("save_servers", { instanceId, servers });
export const pingServer = (address: string): Promise<ServerStatus> =>
  invoke("ping_server", { address });

export const toggleStar = (
  instanceId: string,
  kind: StarKind,
  key: string,
): Promise<boolean> => invoke("toggle_star", { instanceId, kind, key });

export const javaInfo = (instanceId: string): Promise<JavaReport> =>
  invoke("java_info", { instanceId });

export const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const onModpackProgress = (
  cb: (p: LaunchProgress) => void,
): Promise<UnlistenFn> =>
  listen<LaunchProgress>("modpack://progress", (e) => cb(e.payload));

export const onModpackDone = (
  cb: (d: ModpackDone) => void,
): Promise<UnlistenFn> =>
  listen<ModpackDone>("modpack://done", (e) => cb(e.payload));


export const getNews = (instanceId: string): Promise<NewsItem> =>
  invoke("get_news", { instanceId });
export const getPlayercount = (instanceId: string): Promise<PlayerCount> =>
  invoke("get_playercount", { instanceId });


export const deleteInstance = (instanceId: string): Promise<void> =>
  invoke("delete_instance", { instanceId });
export const setActiveInstance = (instanceId: string): Promise<void> =>
  invoke("set_active_instance", { instanceId });
export const createCustomInstance = (
  name: string,
  minecraftVersion: string,
  loader: string,
  loaderVersion: string,
): Promise<Instance> =>
  invoke("create_custom_instance", {
    name,
    minecraftVersion,
    loader,
    loaderVersion,
  });
export const createPackwizInstance = (
  name: string,
  url: string,
  optional: string[] = [],
  unsup = false,
  flavors: string[] = [],
  publicKey: string | null = null,
  meta: {
    icon?: string | null;
    banner?: string | null;
    description?: string | null;
    newsUrl?: string | null;
    playercountUrl?: string | null;
    minMemoryMb?: number | null;
    maxMemoryMb?: number | null;
    jvmArgs?: string[] | null;
    sharedBy?: string | null;
  } = {},
): Promise<Instance> =>
  invoke("create_packwiz_instance", {
    name,
    url,
    optional,
    unsup,
    flavors,
    publicKey,
    meta: {
      icon: meta.icon ?? null,
      banner: meta.banner ?? null,
      description: meta.description ?? null,
      newsUrl: meta.newsUrl ?? null,
      playercountUrl: meta.playercountUrl ?? null,
      minMemoryMb: meta.minMemoryMb ?? null,
      maxMemoryMb: meta.maxMemoryMb ?? null,
      jvmArgs: meta.jvmArgs ?? null,
      sharedBy: meta.sharedBy ?? null,
    },
  });

export const extractPackwizPack = (path: string): Promise<string> =>
  invoke("extract_packwiz_pack", { path });

export const resolvePackwizShare = (input: string): Promise<PackwizShare> =>
  invoke("resolve_packwiz_share", { input });


export const inspectPackwizFlavors = (
  url: string,
): Promise<FlavorGroup[]> => invoke("inspect_packwiz_flavors", { url });


export const setPackwizFlavors = (
  id: string,
  flavors: string[],
): Promise<Instance> => invoke("set_packwiz_flavors", { id, flavors });

export interface ImportCandidate {
  source: "prism" | "modrinth";
  key: string;
  name: string;
  minecraft: string;
  loader: string;
  loader_version: string | null;
  group: string | null;
  icon: string | null;
  path: string;
  notes: string | null;
  pack_provider: string | null;
  pack_id: string | null;
  pack_version: string | null;
}
export const scanImportable = (): Promise<ImportCandidate[]> =>
  invoke("scan_importable");
export const importExternal = (keys: string[]): Promise<Instance[]> =>
  invoke("import_external", { keys });

export interface PackwizBranch {
  name: string;
  pack_url: string;
}
export const listPackwizBranches = (repo: string): Promise<PackwizBranch[]> =>
  invoke("list_packwiz_branches", { repo });
export const switchPackwizBranch = (
  id: string,
  url: string,
): Promise<Instance> => invoke("switch_packwiz_branch", { id, url });

export const minecraftVersions = (
  includeSnapshots: boolean,
): Promise<McVersion[]> =>
  invoke("minecraft_versions", { includeSnapshots });
export const loaderVersions = (
  loader: string,
  minecraftVersion: string,
): Promise<LoaderVersionInfo[]> =>
  invoke("loader_versions", { loader, minecraftVersion });

export const supportedLoaders = (
  minecraftVersion: string,
): Promise<string[]> =>
  invoke("supported_loaders", { minecraftVersion });

export const searchModpacks = (
  source: string,
  query: string,
  offset: number,
): Promise<SearchHit[]> =>
  invoke("search_modpacks", { source, query, offset });
export const modpackVersions = (
  source: string,
  projectId: string,
): Promise<ContentVersion[]> =>
  invoke("modpack_versions", { source, projectId });
export const installModpack = (
  source: string,
  projectId: string,
  versionId: string,
  name: string,
  optional: string[] = [],
  manualMods: ManualMod[] = [],
): Promise<void> =>
  invoke("install_modpack", { source, projectId, versionId, name, optional, manualMods });
export const updateModpack = (
  instanceId: string,
  versionId: string | null,
): Promise<void> => invoke("update_modpack", { instanceId, versionId });


export const installModpackFile = (
  filePath: string,
  source: string,
  name: string,
  optional: string[] = [],
  manualMods: ManualMod[] = [],
): Promise<void> =>
  invoke("install_modpack_file", { filePath, source, name, optional, manualMods });


export const preflightModpack = (
  source: string,
  projectId: string,
  versionId: string,
): Promise<Preflight> =>
  invoke("preflight_modpack", { source, projectId, versionId });

export const preflightModpackFile = (
  filePath: string,
  source: string,
): Promise<Preflight> => invoke("preflight_modpack_file", { filePath, source });

export const onPreflightProgress = (
  cb: (p: PreflightProgress) => void,
): Promise<UnlistenFn> =>
  listen<PreflightProgress>("pack://preflight", (e) => cb(e.payload));

export const scanManualMods = (
  folders: string[],
  wanted: { filename: string; sha1: string | null }[],
): Promise<ManualMod[]> => invoke("scan_manual_mods", { folders, wanted });

export const validateManualMod = (
  path: string,
  sha1: string | null,
): Promise<boolean> => invoke("validate_manual_mod", { path, sha1 });

export const defaultDownloadDir = (): Promise<string | null> =>
  invoke("default_download_dir");

export const inspectPackwiz = (url: string): Promise<OptionalComponent[]> =>
  invoke("inspect_packwiz", { url });


export const pickModpackFile = async (): Promise<{
  path: string;
  source: "modrinth" | "curseforge";
} | null> => {
  const picked = await openFileDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Modpack", extensions: ["mrpack", "zip"] }],
  });
  if (typeof picked !== "string") return null;
  const source = picked.toLowerCase().endsWith(".mrpack")
    ? "modrinth"
    : "curseforge";
  return { path: picked, source };
};

export const pickPackwizZip = async (): Promise<string | null> => {
  const picked = await openFileDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "packwiz pack", extensions: ["zip"] }],
  });
  return typeof picked === "string" ? picked : null;
};

export const pickBrandingImage = async (): Promise<string | null> => {
  const picked = await openFileDialog({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Image",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
      },
    ],
  });
  return typeof picked === "string" ? picked : null;
};

export const importInstanceBranding = (
  instanceId: string,
  kind: "icon" | "banner" | "logo",
  srcPath: string,
): Promise<string> =>
  invoke("import_instance_branding", { instanceId, kind, srcPath });

export const openInstanceDir = (instanceId: string): Promise<void> =>
  invoke("open_instance_dir", { instanceId });
export const revealPath = (path: string): Promise<void> =>
  invoke("reveal_path", { path });
export const deleteJavaRuntime = (path: string): Promise<void> =>
  invoke("delete_java_runtime", { path });
export const listJavaRuntimes = (): Promise<JavaInstall[]> =>
  invoke("list_java_runtimes");
export const downloadJava = (major: number): Promise<void> =>
  invoke("download_java", { major });

export const skinProfile = (accountId: string): Promise<SkinProfile> =>
  invoke("skin_profile", { accountId });
export const setCape = (
  accountId: string,
  capeId: string | null,
): Promise<void> => invoke("set_cape", { accountId, capeId });
export const listSkins = (accountId: string): Promise<SkinLibraryView> =>
  invoke("list_skins", { accountId });

export const seedCurrentSkin = (
  accountId: string,
): Promise<SkinLibraryView> => invoke("seed_current_skin", { accountId });
export const deleteSkin = (accountId: string, skinId: string): Promise<void> =>
  invoke("delete_skin", { accountId, skinId });

export const applySavedSkin = (
  accountId: string,
  skinId: string,
): Promise<void> => invoke("apply_saved_skin", { accountId, skinId });


export const createPreset = (
  accountId: string,
  name: string,
  model: string,
  capeId: string | null,
  texture: { data: number[] } | { url: string },
): Promise<SavedSkin> =>
  invoke("create_preset", {
    accountId,
    name,
    model,
    capeId,
    data: "data" in texture ? texture.data : null,
    url: "url" in texture ? texture.url : null,
  });


export const duplicateSkin = (
  accountId: string,
  skinId: string,
  name: string,
): Promise<SavedSkin> =>
  invoke("duplicate_skin", { accountId, skinId, name });


export const updatePreset = (
  accountId: string,
  skinId: string,
  name: string,
  model: string,
  capeId: string | null,
  data: number[] | null,
): Promise<SavedSkin> =>
  invoke("update_preset", { accountId, skinId, name, model, capeId, data });

export const exportSkin = (source: string, name: string): Promise<string> =>
  invoke("export_skin", { source, name });

export const onPackProgress = (
  cb: (p: LaunchProgress) => void,
): Promise<UnlistenFn> =>
  listen<LaunchProgress>("pack://progress", (e) => cb(e.payload));
export const onPackStarted = (
  cb: (instance: Instance) => void,
): Promise<UnlistenFn> =>
  listen<Instance>("pack://started", (e) => cb(e.payload));
export const cancelInstall = (): Promise<void> => cancelOp("__install__");
export const cancelPreflight = (): Promise<void> => cancelOp("__preflight__");
export const onPackDone = (
  cb: (d: PackDone) => void,
): Promise<UnlistenFn> => listen<PackDone>("pack://done", (e) => cb(e.payload));


export const appVersion = (): Promise<string> => getVersion();
export const releaseChangelog = (version: string | null): Promise<string> =>
  invoke("release_changelog", { version });
export const checkForUpdate = (): Promise<UpdateInfo> =>
  invoke("check_for_update");
export const installUpdate = (): Promise<void> => invoke("install_update");
export const restartApp = (): Promise<void> => invoke("restart_app");

export const updateBlockReason = (): Promise<string | null> =>
  invoke("update_block_reason");

export const onUpdaterProgress = (
  cb: (p: UpdateProgress) => void,
): Promise<UnlistenFn> =>
  listen<UpdateProgress>("updater://progress", (e) => cb(e.payload));


export const onMenuAction = (
  cb: (action: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("menu://action", (e) => cb(e.payload));

export const onCliCommand = (
  cb: (command: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("cli://command", (e) => cb(e.payload));

export const onPackwizOpen = (
  cb: (path: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("packwiz://open", (e) => cb(e.payload));

export interface PendingStartup {
  open: string | null;
  command: string | null;
}
export const cliReady = (): Promise<PendingStartup> => invoke("cli_ready");

export const installCli = (): Promise<string> => invoke("install_cli");

export const uninstallCli = (): Promise<string> => invoke("uninstall_cli");

export interface CliStatus {
  installed: boolean;
  path: string | null;
}
export const cliStatus = (): Promise<CliStatus> => invoke("cli_status");

export const setMenuCommands = (
  items: { id: string; label: string }[],
): Promise<void> => invoke("set_menu_commands", { items });


export const BRASSWORKS_WEBSITE = "https://brassworks.opnsoc.org";
export const BRASSWORKS_GITHUB = "https://github.com/Brassworks-smp";
export const BRASSWORKS_KOFI = "https://ko-fi.com/brassworks";
export const BRASSWORKS_DISCORD = "https://brassworks.opnsoc.org/discord";
export const BRASSWORKS_MODRINTH = "https://modrinth.com/organization/brassworks";

export const openExternal = (url: string): Promise<void> => openUrl(url);

export const modrinthUrl = (slugOrId: string): string =>
  `https://modrinth.com/project/${slugOrId}`;

export const curseforgeUrl = (slugOrId: string): string =>
  `https://www.curseforge.com/minecraft/mc-mods/${slugOrId}`;

export const sourceUrl = (source: string, slugOrId: string): string =>
  source === "curseforge" ? curseforgeUrl(slugOrId) : modrinthUrl(slugOrId);

export const sourceLabel = (source: string): string =>
  source === "curseforge" ? "CurseForge" : "Modrinth";

export type { Account };
