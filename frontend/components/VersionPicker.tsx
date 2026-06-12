import { useEffect, useState } from "react";
import { Loader2, Check, Keyboard, List } from "lucide-react";
import * as api from "@/lib/api";
import type { McVersion, LoaderVersionInfo } from "@/lib/types";
import { Dropdown } from "@/components/ui";
import { useT } from "@/lib/i18n";

const baseInputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

export function VersionPicker({
  loader,
  mc,
  setMc,
  loaderVersion,
  setLoaderVersion,
}: {
  loader: string;
  mc: string;
  setMc: (v: string) => void;
  loaderVersion: string;
  setLoaderVersion: (v: string) => void;
}) {
  const t = useT();
  const [snapshots, setSnapshots] = useState(false);
  const [manual, setManual] = useState(false);
  const [mcVersions, setMcVersions] = useState<McVersion[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionInfo[]>([]);
  const [loadingMc, setLoadingMc] = useState(false);
  const [loadingLoader, setLoadingLoader] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingMc(true);
    api
      .minecraftVersions(snapshots)
      .then((v) => {
        if (!alive) return;
        setMcVersions(v);
        if (!mc && v.length) {
          const first = v.find((x) => x.kind === "release") ?? v[0];
          setMc(first.id);
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoadingMc(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots]);

  useEffect(() => {
    if (loader === "vanilla" || !mc) {
      setLoaderVersions([]);
      return;
    }
    let alive = true;
    setLoadingLoader(true);
    api
      .loaderVersions(loader, mc)
      .then((v) => alive && setLoaderVersions(v))
      .catch(() => alive && setLoaderVersions([]))
      .finally(() => alive && setLoadingLoader(false));
    return () => {
      alive = false;
    };
  }, [loader, mc]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-sm text-ink-600">
          <span>{t("versionPicker.mcVersion")}</span>
          <div className="flex items-center gap-1.5">
            {!manual && (
              <button
                type="button"
                onClick={() => setSnapshots((v) => !v)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition ${
                  snapshots
                    ? "border-brass-500/50 bg-brass-500/15 text-brass-300"
                    : "border-edge text-ink-600 hover:text-brass-300"
                }`}
              >
                <span
                  className={`grid h-3 w-3 place-items-center rounded-[3px] border ${
                    snapshots ? "border-brass-500 bg-brass-500" : "border-ink-600"
                  }`}
                >
                  {snapshots && <Check size={9} className="text-ink-950" />}
                </span>
                {t("versionPicker.snapshots")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setManual((v) => !v)}
              title={manual ? t("versionPicker.pickFromListTitle") : t("versionPicker.typeManuallyTitle")}
              className="flex items-center gap-1.5 rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink-600 transition hover:text-brass-300"
            >
              {manual ? <List size={11} /> : <Keyboard size={11} />}
              {manual ? t("versionPicker.pickFromList") : t("versionPicker.typeManually")}
            </button>
          </div>
        </div>
        {manual ? (
          <input
            value={mc}
            onChange={(e) => setMc(e.target.value.trim())}
            placeholder="e.g. 1.21.1"
            spellCheck={false}
            autoComplete="off"
            className={`${baseInputCls} font-mono`}
          />
        ) : (
          <div className="relative">
            <Dropdown
              value={mc}
              onChange={setMc}
              placeholder={loadingMc ? t("mods.loadingVersions") : t("versionPicker.selectVersion")}
              options={mcVersions.map((v) => ({
                value: v.id,
                label: `${v.id}${v.kind !== "release" ? ` (${v.kind})` : ""}`,
              }))}
            />
            {loadingMc && (
              <Loader2
                size={14}
                className="absolute right-9 top-2.5 animate-spin text-ink-600"
              />
            )}
          </div>
        )}
      </div>

      {loader !== "vanilla" && (
        <div>
          <div className="mb-1.5 text-sm text-ink-600">{t("instanceSettings.modpack.loaderVersion")}</div>
          <div className="relative">
            <Dropdown
              value={loaderVersion}
              onChange={setLoaderVersion}
              options={[
                { value: "stable", label: t("versionPicker.latestStable") },
                ...loaderVersions.map((v) => ({
                  value: v.version,
                  label: `${v.version}${!v.stable ? t("versionPicker.betaSuffix") : ""}`,
                })),
              ]}
            />
            {loadingLoader && (
              <Loader2
                size={14}
                className="absolute right-9 top-2.5 animate-spin text-ink-600"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
