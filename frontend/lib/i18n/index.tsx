"use client";
import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";

import en from "./locales/en.json";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  af: "Afrikaans",
  ar: "العربية",
  bg: "Български",
  ca: "Català",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  es: "Español",
  et: "Eesti",
  fa: "فارسی",
  fi: "Suomi",
  fil: "Filipino",
  fr: "Français",
  he: "עברית",
  hi: "हिन्दी",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  lt: "Lietuvių",
  lv: "Latviešu",
  nb: "Norsk bokmål",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Português",
  "pt-BR": "Português (Brasil)",
  ro: "Română",
  ru: "Русский",
  sk: "Slovenčina",
  sr: "Српски",
  sv: "Svenska",
  th: "ไทย",
  tr: "Türkçe",
  uk: "Українська",
  vi: "Tiếng Việt",
  zh: "中文",
  "zh-CN": "中文（简体）",
  "zh-TW": "中文（繁體）",
};

function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

const CATALOGS: Record<string, Record<string, string>> = {
  en: flatten(en as Record<string, unknown>),
};
const EN = CATALOGS.en;

const localeModules = import.meta.glob<Record<string, unknown>>(
  "./locales/*.json",
  { eager: true, import: "default" },
);

for (const [path, mod] of Object.entries(localeModules)) {
  const code = path.slice(path.lastIndexOf("/") + 1, -".json".length);
  if (code === "en") continue;
  const cat = flatten(mod);
  for (const k of Object.keys(cat)) if (cat[k].trim() === "") delete cat[k];
  CATALOGS[code] = cat;
}

export const LOCALES: { id: string; label: string }[] = Object.keys(CATALOGS)
  .sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)))
  .map((id) => ({ id, label: LOCALE_LABELS[id] ?? id }));

function pseudoize(s: string): string {
  let out = "";
  let inVar = false;
  for (const ch of s) {
    if (ch === "{") inVar = true;
    if (inVar) {
      out += ch;
      if (ch === "}") inVar = false;
      continue;
    }
    if (ch >= "A" && ch <= "Z") out += "X";
    else if (ch >= "a" && ch <= "z") out += "x";
    else if (ch >= "0" && ch <= "9") out += "x";
    else out += ch;
  }
  return out;
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export interface TranslateOpts {
  locale?: string;
  pseudo?: boolean;
  vars?: Record<string, string | number>;
}


export function translate(key: string, opts?: TranslateOpts): string {
  const cat = (opts?.locale && CATALOGS[opts.locale]) || EN;
  let tmpl = cat[key] ?? EN[key] ?? key;
  if (opts?.pseudo) tmpl = pseudoize(tmpl);
  return interpolate(tmpl, opts?.vars);
}

type Ctx = { locale: string; pseudo: boolean };
const I18nCtx = createContext<Ctx>({ locale: "en", pseudo: false });

export function I18nProvider({
  locale,
  pseudo,
  children,
}: {
  locale: string;
  pseudo: boolean;
  children: ReactNode;
}) {
  return (
    <I18nCtx.Provider value={{ locale, pseudo }}>{children}</I18nCtx.Provider>
  );
}

export type TFunc = (
  key: string,
  vars?: Record<string, string | number>,
) => string;


export function useT(): TFunc {
  const { locale, pseudo } = useContext(I18nCtx);
  return useCallback(
    (key, vars) => translate(key, { locale, pseudo, vars }),
    [locale, pseudo],
  );
}
