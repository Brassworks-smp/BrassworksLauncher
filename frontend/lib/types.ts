export type LoaderKind = "vanilla" | "neo_forge" | "forge" | "fabric" | "quilt";

export type LoaderVersion =
  | { channel: "stable" }
  | { channel: "unstable" }
  | { channel: "exact"; value: string };

export type PackSource =
  | { kind: "none" }
  | { kind: "packwiz"; url: string; unsup: boolean }
  | { kind: "modrinth"; project_id: string | null; version_id: string }
  | { kind: "curseforge"; project_id: string; file_id: string };

export interface Instance {
  id: string;
  name: string;
  minecraft_version: string;
  loader: LoaderKind;
  loader_version: LoaderVersion;
  max_memory_mb: number | null;
  min_memory_mb: number | null;
  java_path: string | null;
  java_policy: string | null;
  extra_jvm_args: string[];
  resolution: [number, number] | null;
  pre_launch_command: string | null;
  post_exit_command: string | null;
  pack: PackSource;
  featured: boolean;
  pinned: boolean;
  icon: string | null;
  banner: string | null;
  logo: string | null;
  modpack_locked: boolean;
  news_url: string | null;
  playercount_url: string | null;
  show_news: boolean;
  show_playercount: boolean;
  created_at: string;
  last_played: string | null;
  playtime_seconds: number;
  notes: string | null;
  tags: string[];
  folder_id: string | null;
  optional_mods: string[] | null;
  unsup_flavors: string[] | null;
  unsup_public_key: string | null;
  pinned_settings: string[];
  account_override: string | null;
  auto_join: QuickPlay | null;
}

export type QuickPlay =
  | { kind: "server"; ip: string }
  | { kind: "world"; folder: string };

export interface InstanceFolder {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
}

export interface McVersion {
  id: string;
  kind: string;
}

export interface LoaderVersionInfo {
  version: string;
  stable: boolean;
}

export interface PackDone {
  instance: Instance | null;
  error: string | null;
  cancelled: boolean;
}

export interface SkinCape {
  id: string;
  name: string;
  url: string;
  active: boolean;
}

export interface SkinProfile {
  id: string;
  name: string;
  skin_url: string | null;
  model: string;
  capes: SkinCape[];
}


export interface SavedSkin {
  id: string;
  name: string;
  file: string;
  model: string;
  cape_id: string | null;
}

export interface SkinLibraryView {
  skins: SavedSkin[];
  
  selected: string | null;
}

export interface LauncherSettings {
  default_max_memory_mb: number;
  default_min_memory_mb: number;
  java_path: string | null;
  java_policy: string;
  keep_open: boolean;
  theme: string;
  accent_color: string | null;
  pack_url: string | null;
  dev_mode: boolean;
  curseforge_api_key: string | null;
  selected_instance: string | null;

  pre_launch_command: string | null;
  post_exit_command: string | null;
  launch_behavior: string;
  default_resolution: [number, number] | null;
  start_minimized: boolean;

  console_on_launch: boolean;
  console_on_crash: boolean;
  console_on_quit: boolean;

  record_playtime: boolean;
  show_playtime: boolean;
  playtime_in_hours: boolean;

  discord_rpc: boolean;
  reduce_motion: boolean;
  locale: string;
  pseudo_localize: boolean;
  high_contrast: boolean;
  close_to_tray: boolean;
  show_featured: boolean;
  instance_folders: InstanceFolder[];

  auto_update: boolean;
  last_version: string | null;
  download_concurrency: number;
  manual_download_folders: string[];
}

export interface BlockedMod {
  id: string;
  project_id: string;
  file_id: string;
  filename: string;
  name: string;
  url: string;
  required: boolean;
  sha1: string | null;
}

export interface Preflight {
  optional: OptionalComponent[];
  blocked: BlockedMod[];
}

export interface PreflightProgress {
  stage: string;
  current: number;
  total: number;
}

export type ManualMod = [string, string];

export interface UpdateInfo {
  available: boolean;
  version: string;
  current_version: string;
  notes: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  done: boolean;
}

export interface JavaInstall {
  path: string;
  major: number | null;
  version: string | null;
  kind: "system" | "bundled" | "custom";
  label: string;
}

export interface JavaReport {
  system: JavaInstall | null;
  runtimes: JavaInstall[];
  required_major: number;
  policy: string;
  custom_path: string | null;
}

export type ContentSource = "modrinth" | "curseforge" | "local";

export type AccountKind = "offline" | "microsoft";

export interface Account {
  id: string;
  username: string;
  uuid: string;
  kind: AccountKind;
}

export interface MicrosoftCode {
  user_code: string;
  verification_uri: string;
  message: string;
}

export type AuthEvent =
  | { phase: "code"; user_code: string; verification_uri: string; message: string }
  | { phase: "done"; store: AccountStore }
  | { phase: "error"; message: string };

export interface AccountStore {
  accounts: Account[];
  selected: string | null;
}

export type AccountStatus = "ok" | "needs_relogin" | "offline";

export type LaunchStage =
  | "resolving"
  | "checking_updates"
  | "syncing_modpack"
  | "loading_version"
  | "downloading"
  | "preparing_jvm"
  | "installing_loader"
  | "launching"
  | "running";

export interface LaunchProgress {
  instance_id: string;
  stage: LaunchStage;
  message: string;
  current: number;
  total: number;
}

export interface ExitInfo {
  instance_id: string;
  code: number | null;
  error: string | null;
  cancelled: boolean;
}


export interface ModpackStatus {
  installed_version: string | null;
  latest_version: string;
  name: string;
  update_available: boolean;
  complete: boolean;
  failed: string[];
  failures: FileFailure[];
  neoforge_version: string | null;
  minecraft_version: string | null;
}

export interface FileFailure {
  path: string;
  reason: string;
}

export interface InstalledMod {
  name: string;
  filename: string;
  path: string;
  side: string;
  category: string;
  enabled: boolean;
  managed: boolean;
  source: ContentSource;
  project_id: string | null;
  version_id: string | null;
  version: string | null;
  title: string | null;
  description: string | null;
  icon_url: string | null;
}

export type ExportFormat = "packwiz" | "modrinth" | "curseforge";

export interface ExportTreeMod {
  path: string;
  name: string;
  filename: string;
  category: string;
  side: string;
  source: ContentSource;
  project_id: string | null;
  version_id: string | null;
  enabled: boolean;
}

export interface ExportNode {
  rel_path: string;
  name: string;
  is_dir: boolean;
  size: number;
  default_selected: boolean;
  children: ExportNode[];
}

export interface ExportTree {
  mods: ExportTreeMod[];
  files: ExportNode[];
}

export interface ExportOptional {
  default: boolean;
  description: string;
}

export interface ExportSelection {
  mods: string[];
  files: string[];
  optional: Record<string, ExportOptional>;
}

export interface ExportMeta {
  name: string;
  author: string;
  version: string;
  mc_version: string;
  loader: string;
  loader_version: string | null;
}

export interface ExportConfig {
  id: string;
  name: string;
  format: ExportFormat;
  pack_name: string;
  author: string;
  version: string;
  selection: ExportSelection;
  created_at: number;
}

export interface ModInfo {
  title: string | null;
  description: string | null;
  icon_url: string | null;
  version: string | null;
}

export interface SearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  author: string;
  project_type: string;
  versions: string[];
  source: ContentSource;
}

export interface ProjectDetail {
  id: string;
  title: string;
  description: string;
  body: string;
  icon_url: string | null;
  url: string | null;
  downloads: number;
}

export interface ContentVersion {
  version_id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
}

export interface InstallResult {
  item: InstalledMod;
  dependencies: string[];
}


export interface FlavorGroup {
  id: string;
  name: string;
  description: string | null;
  side: string;
  choices: FlavorChoice[];
}

export interface FlavorChoice {
  id: string;
  name: string;
  description: string | null;
  default: boolean;
}


export function isBooleanFlavor(g: FlavorGroup): boolean {
  if (g.choices.length !== 2) return false;
  const ids = g.choices.map((c) => c.id);
  return (
    ids.includes(`${g.id}_on`) && ids.includes(`${g.id}_off`)
  );
}


export interface OptionalComponent {
  
  id: string;
  name: string;
  description: string | null;
  
  default: boolean;
  side: string;
  category: string;
}

export interface Screenshot {
  name: string;
  path: string;
  modified: number;
  size: number;
  instance: string;
  starred: boolean;
}

export interface WorldInfo {
  folder: string;
  name: string;
  icon: boolean;
  
  last_played: number;
  
  game_mode: number;
  hardcore: boolean;
  
  difficulty: number;
  version_name: string | null;
  size_bytes: number;
  datapack_count: number;
  seed: number | null;
  starred: boolean;
}

export interface WorldBackup {
  filename: string;
  size_bytes: number;
  modified: number;
}

export interface DatapackInfo {
  filename: string;
  name: string;
  enabled: boolean;
  is_dir: boolean;
  size_bytes: number;
  
  source: string | null;
  project_id: string | null;
  version_id: string | null;
  title: string | null;
  description: string | null;
  icon_url: string | null;
}

export interface FeaturedPack {

  id: string;
  name: string;
  icon: string | null;
  modrinth_ids: string[];
  curseforge_ids: string[];
}

export interface PackwizShare {
  pack_url: string;
  name: string | null;
  description: string | null;
  unsup: boolean;
  icon: string | null;
  banner: string | null;
  signing_key: string | null;
  news_url: string | null;
  playercount_url: string | null;
  min_memory_mb: number | null;
  max_memory_mb: number | null;
  jvm_args: string[] | null;
}

export interface ServerEntry {
  name: string;
  ip: string;
  
  icon: string | null;
  accept_textures: number | null;
  
  featured: boolean;
  starred: boolean;
}

export interface ServerStatus {
  online: boolean;
  motd: string;
  version: string | null;
  players_online: number;
  players_max: number;
  
  favicon: string | null;
  ping_ms: number;
  error: string | null;
}

export type StarKind = "worlds" | "servers" | "screenshots";

export interface LogUpload {
  id: string;
  url: string;
  raw: string;
}

export interface LogTail {
  content: string;
  offset: number;
  reset: boolean;
}

export interface ModpackDone {
  instance_id: string;
  error: string | null;
  cancelled: boolean;
}


export interface NewsItem {
  title: string;
  body: string;
}

export interface PlayerGroup {
  online: boolean;
  players_online: number;
  players_max: number;
}

export interface PlayerCount {
  main: PlayerGroup;
  queue: PlayerGroup;
  timestamp: string | null;
}
