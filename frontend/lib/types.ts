
export type LoaderKind = "vanilla" | "neo_forge" | "forge" | "fabric";

export type LoaderVersion =
  | { channel: "stable" }
  | { channel: "unstable" }
  | { channel: "exact"; value: string };

export interface Instance {
  id: string;
  name: string;
  minecraft_version: string;
  loader: LoaderKind;
  loader_version: LoaderVersion;
  max_memory_mb: number | null;
  min_memory_mb: number | null;
  java_path: string | null;
  extra_jvm_args: string[];
  resolution: [number, number] | null;
  created_at: string;
  last_played: string | null;
  playtime_seconds: number;
}

export interface LauncherSettings {
  default_max_memory_mb: number;
  default_min_memory_mb: number;
  java_path: string | null;
  java_policy: string;
  keep_open: boolean;
  theme: string;
  pack_url: string | null;
  dev_mode: boolean;
  modpack_locked: boolean;
  curseforge_api_key: string | null;

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
  neoforge_version: string | null;
  minecraft_version: string | null;
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

export interface Screenshot {
  name: string;
  path: string;
  modified: number;
  size: number;
  instance: string;
}

export interface LogUpload {
  id: string;
  url: string;
  raw: string;
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
