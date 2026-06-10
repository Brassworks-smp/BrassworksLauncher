import { useEffect, useRef, useState } from "react";
import { X, Loader2, Boxes, Hammer, Upload, BookOpen } from "lucide-react";
import * as api from "@/lib/api";
import type { Instance } from "@/lib/types";
import { VersionPicker } from "@/components/VersionPicker";
import { ModpackBrowser } from "@/components/ModpackBrowser";
import { SegmentedTabs, useClosable } from "@/components/ui";

type Tab = "custom" | "modrinth" | "curseforge" | "packwiz";

const TABS: { id: Tab; label: string }[] = [
  { id: "custom", label: "Custom" },
  { id: "modrinth", label: "Modrinth" },
  { id: "curseforge", label: "CurseForge" },
  { id: "packwiz", label: "packwiz URL" },
];

const LOADERS: { id: string; label: string }[] = [
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "forge", label: "Forge" },
  { id: "neoforge", label: "NeoForge" },
];

const ACCENTS: Record<Tab, Record<string, string> | undefined> = {
  custom: undefined,
  modrinth: {
    "--color-brass-300": "#86efac",
    "--color-brass-400": "#4ade80",
    "--color-brass-500": "#22c55e",
    "--color-brass-600": "#16a34a",
    "--color-brass-700": "#15803d",
  },
  curseforge: {
    "--color-brass-300": "#fdba74",
    "--color-brass-400": "#fb923c",
    "--color-brass-500": "#f97316",
    "--color-brass-600": "#ea580c",
    "--color-brass-700": "#c2410c",
  },
  packwiz: {
    "--color-brass-300": "#f9a8d4",
    "--color-brass-400": "#f472b6",
    "--color-brass-500": "#ec4899",
    "--color-brass-600": "#db2777",
    "--color-brass-700": "#be185d",
  },
};

/** Heuristic loader availability by Minecraft version (avoids a request storm). */
function loaderAllowed(loader: string, mc: string): boolean {
  if (loader === "vanilla") return true;
  const parts = mc.split(".");
  if (parts[0] !== "1") return true;
  const minor = Number(parts[1]);
  const patch = Number(parts[2] ?? "0");
  if (!Number.isFinite(minor)) return true; 
  if (loader === "neoforge") return minor > 20 || (minor === 20 && patch >= 1);
  if (loader === "fabric" || loader === "quilt") return minor >= 14;
  if (loader === "forge") return minor >= 1;
  return true;
}

const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

export function AddInstanceModal({
  installing,
  detailInstanceId,
  onClose,
  onCreated,
  onInstallModpack,
  onUploadModpack,
  onError,
}: {
  installing: boolean;
  detailInstanceId: string | null;
  onClose: () => void;
  onCreated: (instance: Instance) => void;
  onInstallModpack: (
    source: "modrinth" | "curseforge",
    projectId: string,
    versionId: string,
    name: string,
  ) => void;
  onUploadModpack: (
    source: "modrinth" | "curseforge",
    data: number[],
    name: string,
  ) => void;
  onError: (e: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("custom");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { closing, close } = useClosable(onClose);

  const [name, setName] = useState("");
  const [loader, setLoader] = useState("fabric");
  const [mc, setMc] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("stable");

  useEffect(() => {
    if (mc && !loaderAllowed(loader, mc)) {
      setLoader("vanilla");
      setLoaderVersion("stable");
    }
  }, [mc, loader]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const source: "modrinth" | "curseforge" = file.name.endsWith(".mrpack")
      ? "modrinth"
      : "curseforge";
    const buf = await file.arrayBuffer();
    onUploadModpack(source, Array.from(new Uint8Array(buf)), file.name.replace(/\.[^.]+$/, ""));
  };

  const [packName, setPackName] = useState("");
  const [packUrl, setPackUrl] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const createCustom = async () => {
    setBusy(true);
    try {
      const inst = await api.createCustomInstance(name, mc, loader, loaderVersion);
      onCreated(inst);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const createPackwiz = async () => {
    setBusy(true);
    try {
      const inst = await api.createPackwizInstance(packName, packUrl.trim());
      onCreated(inst);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={ACCENTS[tab] as React.CSSProperties | undefined}
        className="rise flex max-h-[86vh] w-[640px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl"
      >
        <input
          ref={fileInput}
          type="file"
          accept=".mrpack,.zip"
          onChange={onPickFile}
          className="hidden"
        />
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Boxes size={17} className="text-brass-400" />
            New instance
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-edge px-3 py-2">
          <SegmentedTabs
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            options={TABS.map((t) => ({ id: t.id, label: t.label }))}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "custom" && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 text-sm text-ink-600">Name</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My instance"
                  className={inputCls}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">Mod loader</div>
                <div className="flex flex-wrap gap-1.5">
                  {LOADERS.map((l) => {
                    const disabled = !!mc && !loaderAllowed(l.id, mc);
                    return (
                      <button
                        key={l.id}
                        disabled={disabled}
                        title={disabled ? `Not available for ${mc}` : undefined}
                        onClick={() => {
                          setLoader(l.id);
                          setLoaderVersion("stable");
                        }}
                        className={`rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          loader === l.id
                            ? "border-brass-500 bg-brass-500/15 text-brass-200"
                            : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
                        }`}
                      >
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <VersionPicker
                loader={loader}
                mc={mc}
                setMc={setMc}
                loaderVersion={loaderVersion}
                setLoaderVersion={setLoaderVersion}
              />
              <button
                disabled={busy || !mc}
                onClick={createCustom}
                className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Create instance
              </button>
            </div>
          )}

          {tab === "packwiz" && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-ink-600">
                Point at a <span className="text-brass-300">pack.toml</span> URL.
                The launcher fetches it, detects the loader + Minecraft version,
                and syncs on launch.
              </p>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">Name (optional)</div>
                <input
                  value={packName}
                  onChange={(e) => setPackName(e.target.value)}
                  placeholder="Leave blank to use the pack's name"
                  className={inputCls}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm text-ink-600">pack.toml URL</div>
                <input
                  value={packUrl}
                  onChange={(e) => setPackUrl(e.target.value)}
                  placeholder="https://example.com/pack.toml"
                  className={`${inputCls} font-mono text-xs`}
                  spellCheck={false}
                />
              </div>
              <button
                onClick={() =>
                  api.openExternal("https://packwiz.infra.link/").catch(() => {})
                }
                className="flex items-center gap-1.5 self-start text-xs text-brass-300 hover:text-brass-400"
              >
                <BookOpen size={13} /> What is packwiz? Read the wiki →
              </button>
              <button
                disabled={busy || !packUrl.trim()}
                onClick={createPackwiz}
                className="brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Hammer size={16} />
                )}
                Add packwiz instance
              </button>
            </div>
          )}

          {(tab === "modrinth" || tab === "curseforge") && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => fileInput.current?.click()}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
              >
                <Upload size={14} /> Upload a .mrpack / CurseForge .zip instead
              </button>
              <ModpackBrowser
                source={tab}
                detailInstanceId={detailInstanceId}
                installing={installing}
                onInstall={(projectId, versionId, packName2) =>
                  onInstallModpack(tab, projectId, versionId, packName2)
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
