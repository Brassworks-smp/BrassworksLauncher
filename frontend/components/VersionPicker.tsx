"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import * as api from "@/lib/api";
import type { McVersion, LoaderVersionInfo } from "@/lib/types";

const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60 cursor-pointer appearance-none";

/**
 * Minecraft + loader version dropdowns backed by the live version browsers.
 * `loaderVersion` is either "stable" or an exact loader version string.
 */
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
  const [snapshots, setSnapshots] = useState(false);
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
          <span>Minecraft version</span>
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
            Snapshots
          </button>
        </div>
        <div className="relative">
          <select
            value={mc}
            onChange={(e) => setMc(e.target.value)}
            className={inputCls}
          >
            {mcVersions.map((v) => (
              <option key={v.id} value={v.id} className="bg-ink-900">
                {v.id}
                {v.kind !== "release" ? ` (${v.kind})` : ""}
              </option>
            ))}
          </select>
          {loadingMc && (
            <Loader2
              size={14}
              className="absolute right-8 top-2.5 animate-spin text-ink-600"
            />
          )}
        </div>
      </div>

      {loader !== "vanilla" && (
        <div>
          <div className="mb-1.5 text-sm text-ink-600">Loader version</div>
          <div className="relative">
            <select
              value={loaderVersion}
              onChange={(e) => setLoaderVersion(e.target.value)}
              className={inputCls}
            >
              <option value="stable" className="bg-ink-900">
                Latest stable (recommended)
              </option>
              {loaderVersions.map((v) => (
                <option key={v.version} value={v.version} className="bg-ink-900">
                  {v.version}
                  {!v.stable ? " (beta)" : ""}
                </option>
              ))}
            </select>
            {loadingLoader && (
              <Loader2
                size={14}
                className="absolute right-8 top-2.5 animate-spin text-ink-600"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
