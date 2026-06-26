import { Github, Gitlab, type LucideIcon } from "lucide-react";
import type { GitProvider } from "./types";

export interface ProviderInfo {
  id: GitProvider;
  label: string;
  icon: LucideIcon;
  tokenUrl: string;
  tokenPlaceholder: string;
  scopeHintKey: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "github",
    label: "GitHub",
    icon: Github,
    tokenUrl:
      "https://github.com/settings/tokens/new?scopes=repo&description=Brassworks%20Launcher",
    tokenPlaceholder: "ghp_…",
    scopeHintKey: "github",
  },
  {
    id: "gitlab",
    label: "GitLab",
    icon: Gitlab,
    tokenUrl:
      "https://gitlab.com/-/user_settings/personal_access_tokens?name=Brassworks%20Launcher&scopes=api,write_repository",
    tokenPlaceholder: "glpat-…",
    scopeHintKey: "gitlab",
  },
];

export function providerInfo(id: GitProvider): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
