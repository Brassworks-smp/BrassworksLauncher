import { useEffect, useRef, useState, useCallback } from "react";
import {
  Loader2,
  Trash2,
  Check,
  Shirt,
  ChevronDown,
  Plus,
  Pencil,
  Move,
  X,
  Save,
  Download,
  Upload as UploadIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useClosable } from "@/components/ui";
import type { SkinProfile, SkinCape, SavedSkin } from "@/lib/types";

const TEX = (h: string) => `https://textures.minecraft.net/texture/${h}`;
type DefaultSkin = { name: string; preview: string; url: string; model: string };
const DEFAULT_SKINS: DefaultSkin[] = [
  { name: "Steve", preview: "/skins/steve.png", url: TEX("1abc803022d8300ab7578b189294cce39622d9a404cdc00d3feacfdf45be6981"), model: "classic" },
  { name: "Alex", preview: "/skins/alex.png", url: TEX("46acd06e8483b176e8ea39fc12fe105eb3a2a4970f5100057e9d84d4b60bdfa7"), model: "slim" },
  { name: "Ari", preview: "/skins/ari.png", url: TEX("4c05ab9e07b3505dc3ec11370c3bdce5570ad2fb2b562e9b9dd9cf271f81aa44"), model: "classic" },
  { name: "Kai", preview: "/skins/kai.png", url: TEX("6ac6ca262d67bcfb3dbc924ba8215a18195497c780058a5749de674217721892"), model: "slim" },
  { name: "Efe", preview: "/skins/efe.png", url: TEX("daf3d88ccb38f11f74814e92053d92f7728ddb1a7955652a60e30cb27ae6659f"), model: "classic" },
  { name: "Makena", preview: "/skins/makena.png", url: TEX("fece7017b1bb13926d1158864b283b8b930271f80a90482f174cca6a17e88236"), model: "slim" },
  { name: "Noor", preview: "/skins/noor.png", url: TEX("e5cdc3243b2153ab28a159861be643a4fc1e3c17d291cdd3e57a7f370ad676f3"), model: "classic" },
  { name: "Sunny", preview: "/skins/sunny.png", url: TEX("226c617fde5b1ba569aa08bd2cb6fd84c93337532a872b3eb7bf66bdd5b395f8"), model: "slim" },
  { name: "Zuri", preview: "/skins/zuri.png", url: TEX("7cb3ba52ddd5cc82c0b050c3f920f87da36add80165846f479079663805433db"), model: "slim" },
];

const BASE_YAW = 0.5;

const bust = (u: string) => `${u}${u.includes("?") ? "&" : "?"}v=${Date.now()}`;

const BTN =
  "flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50";

function SkinCanvas({
  skin,
  cape,
  model,
  flipped,
  rotate,
  width,
  height,
  animate = false,
}: {
  skin: string | null;
  cape: string | null;
  model: string;
  flipped: boolean;
  rotate: boolean;
  width: number;
  height: number;
  animate?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const targetRef = useRef(BASE_YAW);
  const skinRef = useRef(skin);
  const capeRef = useRef(cape);
  const modelRef = useRef(model);
  skinRef.current = skin;
  capeRef.current = cape;
  modelRef.current = model;

  useEffect(() => {
    let alive = true;
    let raf = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any;
    (async () => {
      const sv = await import("skinview3d");
      if (!alive || !ref.current) return;
      viewer = new sv.SkinViewer({ canvas: ref.current, width, height });
      viewer.fov = 40;
      viewer.zoom = 0.92;
      viewer.autoRotate = false;
      viewer.playerObject.rotation.y = BASE_YAW;

      if (viewer.controls) {
        viewer.controls.enableZoom = false;
        viewer.controls.enableRotate = rotate;
        viewer.controls.minPolarAngle = Math.PI / 2;
        viewer.controls.maxPolarAngle = Math.PI / 2;
      }
      if (animate) {
        try {
          viewer.animation = new sv.IdleAnimation();
        } catch {
        }
      }
      viewerRef.current = viewer;
      const sk = skinRef.current;
      if (sk)
        viewer
          .loadSkin(sk, { model: modelRef.current === "slim" ? "slim" : "default" })
          .catch(() => {});
      if (capeRef.current) viewer.loadCape(capeRef.current).catch(() => {});
      const tick = () => {
        if (!alive || !viewer) return;
        const cur = viewer.playerObject.rotation.y;
        viewer.playerObject.rotation.y = cur + (targetRef.current - cur) * 0.16;
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      try {
        viewer?.dispose();
      } catch {
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotate, width, height, animate]);

  useEffect(() => {
    const v = viewerRef.current;
    if (v && skin) v.loadSkin(skin, { model: model === "slim" ? "slim" : "default" }).catch(() => {});
  }, [skin, model]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (cape) v.loadCape(cape).catch(() => {});
    else
      try {
        v.loadCape(null);
      } catch {
      }
  }, [cape]);

  useEffect(() => {
    targetRef.current = flipped ? BASE_YAW + Math.PI : BASE_YAW;
  }, [flipped]);

  return (
    <canvas
      ref={ref}
      className="[filter:drop-shadow(0_8px_8px_rgba(0,0,0,0.4))]"
    />
  );
}


type Baked = { front: HTMLCanvasElement; back: HTMLCanvasElement };
const bakeCache = new Map<string, Baked>();
const bakeKey = (url: string, model: string, cape: string | null) => `${url}|${model}|${cape ?? ""}`;

let bakeChain: Promise<unknown> = Promise.resolve();


function snapshot(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  out.getContext("2d")?.drawImage(src, 0, 0);
  return out;
}

async function bakeOne(url: string, model: string, cape: string | null): Promise<Baked> {
  const sv = await import("skinview3d");
  const canvas = document.createElement("canvas");
  const viewer = new sv.SkinViewer({ canvas, width: 200, height: 250, renderPaused: true });
  try {
    viewer.fov = 20;
    viewer.zoom = 1.11;
    viewer.autoRotate = false;
    viewer.playerObject.position.y = -4;
    viewer.playerObject.position.x = -2.2;
    await viewer.loadSkin(url, { model: model === "slim" ? "slim" : "default" });
    if (cape) {
      try {
        await viewer.loadCape(cape);
      } catch {
      }
    }
    viewer.playerObject.rotation.y = BASE_YAW;
    viewer.render();
    const front = snapshot(canvas);
    viewer.playerObject.rotation.y = BASE_YAW + Math.PI;
    viewer.render();
    const back = snapshot(canvas);
    return { front, back };
  } finally {
    try {
      viewer.dispose();
    } catch {
    }
  }
}

function bakeSkin(url: string, model: string, cape: string | null): Promise<Baked> {
  const key = bakeKey(url, model, cape);
  const cached = bakeCache.get(key);
  if (cached) return Promise.resolve(cached);
  const run = bakeChain.then(async () => {
    const again = bakeCache.get(key);
    if (again) return again;
    const baked = await bakeOne(url, model, cape);
    bakeCache.set(key, baked);
    return baked;
  });
  bakeChain = run.catch(() => {});
  return run;
}

function Flip3DThumb({ url, model, cape }: { url: string; model: string; cape: string | null }) {
  const frontRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    bakeSkin(url, model, cape)
      .then((baked) => {
        if (!alive) return;
        ([[frontRef, baked.front], [backRef, baked.back]] as const).forEach(([ref, src]) => {
          const cv = ref.current;
          const ctx = cv?.getContext("2d");
          if (cv && ctx) {
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(src, 0, 0, cv.width, cv.height);
          }
        });
        setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, model, cape]);

  const face =
    "absolute inset-0 h-full w-full [backface-visibility:hidden] [filter:drop-shadow(0_8px_8px_rgba(0,0,0,0.4))]";
  return (
    <div className="relative grid h-full w-full place-items-center [perspective:820px]">
      <div
        className={`relative h-[250px] w-[200px] transition-transform duration-500 ease-out [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)] motion-reduce:transition-none ${
          ready ? "opacity-100" : "opacity-0"
        }`}
      >
        <canvas ref={frontRef} width={200} height={250} className={face} />
        <canvas
          ref={backRef}
          width={200}
          height={250}
          className={`${face} [transform:rotateY(180deg)]`}
        />
      </div>
      {!ready && <Loader2 size={20} className="absolute animate-spin text-ink-600" />}
    </div>
  );
}

/** Draws the front face of a cape texture (UV 1,1 → 10×16) into a tile. */
function CapeImage({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cv = ref.current;
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      const s = img.naturalWidth / 64;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, cv.width, cv.height);
    };
    img.src = url;
  }, [url]);
  return (
    <canvas
      ref={ref}
      width={50}
      height={80}
      className="h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

function SelectedMark() {
  return (
    <>
      <span className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow-lg ring-2 ring-ink-950/40">
        <Check size={16} strokeWidth={3.5} />
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-brass-600/90 to-transparent pb-1.5 pt-6 text-center font-mc text-[11px] tracking-wider text-ink-950">
        Selected
      </span>
    </>
  );
}

function Tile({
  selected,
  onClick,
  title,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`group relative grid h-[210px] place-items-center overflow-hidden rounded-xl border bg-ink-900/40 transition ${
        selected
          ? "border-brass-400 ring-2 ring-brass-400/50 glow"
          : "border-edge hover:border-brass-600/40 hover:bg-ink-900/70"
      }`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <button
        onClick={onToggle}
        className="mb-2 flex items-center gap-2 font-mc text-base text-gray-100"
      >
        <ChevronDown
          size={16}
          className={`text-ink-600 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {title}
      </button>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          {children}
        </div>
      )}
    </section>
  );
}

const cachedLibraries: Record<string, SavedSkin[]> = {};
const cachedSelected: Record<string, string | null> = {};
const cachedProfiles: Record<string, SkinProfile> = {};

type ApplyTarget =
  | { kind: "saved"; skin: SavedSkin }
  | { kind: "preset"; preset: DefaultSkin }
  | { kind: "cape" };

export function SkinView({
  accountId,
  username,
  onSkinApplied,
}: {
  accountId: string | null;
  username?: string;
  onSkinApplied?: () => void;
}) {
  const [profile, setProfile] = useState<SkinProfile | null>(
    accountId ? cachedProfiles[accountId] ?? null : null,
  );
  const [library, setLibrary] = useState<SavedSkin[]>(
    accountId ? cachedLibraries[accountId] ?? [] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selSaved, setSelSaved] = useState<string | null>(
    accountId ? cachedSelected[accountId] ?? null : null,
  );
  const [savedOpen, setSavedOpen] = useState(true);
  const [defaultOpen, setDefaultOpen] = useState(true);
  const [applyTarget, setApplyTarget] = useState<ApplyTarget | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const activeCape = profile?.capes.find((c) => c.active)?.url ?? null;
  const selectedSkin = library.find((s) => s.id === selSaved) ?? null;
  const displayName = profile?.name || username || "Player";

  const previewSkin = selectedSkin ? api.fileSrc(selectedSkin.file) : profile?.skin_url ?? null;
  const previewModel = selectedSkin?.model ?? profile?.model ?? "classic";

  useEffect(() => {
    if (accountId && profile?.skin_url && !api.getFaceTexture(accountId))
      api.setFaceTexture(accountId, profile.skin_url);
  }, [accountId, profile?.skin_url]);

  const refresh = useCallback(() => {
    if (!api.isTauri() || !accountId) return;
    api
      .listSkins(accountId)
      .then((view) => {
        cachedLibraries[accountId] = view.skins;
        cachedSelected[accountId] = view.selected;
        setLibrary(view.skins);
        setSelSaved(view.selected);
      })
      .catch(() => {});
    api
      .skinProfile(accountId)
      .then((p) => {
        cachedProfiles[accountId] = p;
        setProfile(p);
      })
      .catch(() => {});
  }, [accountId]);

  useEffect(refresh, [refresh]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !accountId) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const saved = await api.uploadSkin(
        accountId,
        file.name.replace(/\.[^.]+$/, ""),
        Array.from(new Uint8Array(buf)),
        "classic",
      );
      toast("Skin added & applied", "success");
      api.setFaceTexture(accountId, bust(api.fileSrc(saved.file)));
      setSelSaved(saved.id);
      onSkinApplied?.();
      refresh();
    } catch (e2) {
      setError(String(e2));
    } finally {
      setBusy(false);
    }
  };

  const saveToDisk = () => {
    const source = selectedSkin ? selectedSkin.file : profile?.skin_url ?? null;
    if (!source) return;
    api
      .exportSkin(source, selectedSkin?.name ?? `${displayName}-skin`)
      .then(() => toast("Skin saved to Downloads", "success"))
      .catch((e) => setError(String(e)));
  };

  if (!accountId) {
    return (
      <div className="grid flex-1 place-items-center text-center text-ink-600">
        <div>
          <Shirt size={28} className="mx-auto mb-2 opacity-50" />
          Sign in with a Microsoft account to manage skins &amp; capes.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <input ref={fileInput} type="file" accept=".png" onChange={onPickFile} className="hidden" />
      <h1 className="pb-4 font-mc text-2xl tracking-wide text-gray-100">Skin selector</h1>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="flex w-[230px] shrink-0 flex-col items-center">
          <div className="mb-3 mt-16 rounded-md bg-ink-800/70 px-4 py-1.5 font-mc text-sm tracking-widest text-gray-200">
            {displayName}
          </div>
          <div className="grid flex-1 place-items-center">
            <SkinCanvas
              skin={previewSkin}
              cape={activeCape}
              model={previewModel}
              flipped={false}
              rotate
              animate
              width={210}
              height={300}
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
            <Move size={13} /> Drag to rotate
          </div>
          <div className="mt-3 flex flex-col gap-2 self-stretch">
            <button
              onClick={() =>
                setApplyTarget(selectedSkin ? { kind: "saved", skin: selectedSkin } : { kind: "cape" })
              }
              className={`${BTN} justify-center`}
            >
              <Pencil size={15} /> {selectedSkin ? "Edit skin" : "Change cape"}
            </button>
            <button onClick={saveToDisk} className={`${BTN} justify-center`}>
              <Download size={15} /> Save skin
            </button>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          <Section title="Your skins" open={savedOpen} onToggle={() => setSavedOpen((v) => !v)}>
            <button
              onClick={() => fileInput.current?.click()}
              className="flex h-[210px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge text-ink-600 transition hover:border-brass-600/50 hover:text-brass-300"
            >
              {busy ? <Loader2 size={22} className="animate-spin" /> : <Plus size={22} />}
              <span className="text-sm font-medium">Add skin</span>
              <span className="text-[11px]">Drag and drop</span>
            </button>

            {library.map((s) => (
              <Tile
                key={s.id}
                selected={selSaved === s.id}
                onClick={() => setApplyTarget({ kind: "saved", skin: s })}
                title={s.name}
              >
                {selSaved === s.id && <SelectedMark />}
                <Flip3DThumb url={api.fileSrc(s.file)} model={s.model} cape={activeCape} />
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    api
                      .deleteSkin(accountId, s.id)
                      .then(() => {
                        if (selSaved === s.id) setSelSaved(null);
                        refresh();
                      })
                      .catch((er) => setError(String(er)));
                  }}
                  title="Delete"
                  className="absolute left-1.5 top-1.5 z-20 grid h-6 w-6 place-items-center rounded-md bg-ink-950/80 text-ink-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </span>
              </Tile>
            ))}
          </Section>

          <Section title="Default skins" open={defaultOpen} onToggle={() => setDefaultOpen((v) => !v)}>
            {DEFAULT_SKINS.map((d) => (
              <Tile
                key={d.url}
                title={d.name}
                onClick={() => setApplyTarget({ kind: "preset", preset: d })}
              >
                <Flip3DThumb url={d.preview} model={d.model} cape={null} />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent pb-2 pt-6 text-center font-mc text-[11px] tracking-wider text-gray-300">
                  {d.name}
                </span>
              </Tile>
            ))}
          </Section>
        </div>
      </div>

      {applyTarget && (
        <ApplySkinModal
          accountId={accountId}
          target={applyTarget}
          activeCape={activeCape}
          capes={profile?.capes ?? []}
          onClose={() => setApplyTarget(null)}
          onApplied={(selectedId) => {
            setApplyTarget(null);
            if (selectedId !== undefined) setSelSaved(selectedId);
            onSkinApplied?.();
            refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function ApplySkinModal({
  accountId,
  target,
  activeCape,
  capes,
  onClose,
  onApplied,
  onError,
}: {
  accountId: string;
  target: ApplyTarget;
  activeCape: string | null;
  capes: SkinCape[];
  onClose: () => void;
  onApplied: (selectedId?: string | null) => void;
  onError: (e: string) => void;
}) {
  const savedSkin = target.kind === "saved" ? target.skin : null;
  const preset = target.kind === "preset" ? target.preset : null;
  const capeOnly = target.kind === "cape";

  const [model, setModel] = useState(
    (savedSkin?.model ?? preset?.model ?? "classic") === "slim" ? "slim" : "classic",
  );
  const [capeId, setCapeId] = useState<string | null>(
    savedSkin?.cape_id ?? capes.find((c) => c.active)?.id ?? null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    savedSkin ? api.fileSrc(savedSkin.file) : preset ? preset.preview : null,
  );
  const [newBytes, setNewBytes] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { closing, close } = useClosable(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const capeUrl = capes.find((c) => c.id === capeId)?.url ?? null;

  const replace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const buf = await file.arrayBuffer();
    setNewBytes(Array.from(new Uint8Array(buf)));
    setPreviewUrl(URL.createObjectURL(file));
  };

  const apply = async () => {
    setSaving(true);
    try {
      if (savedSkin) {
        if (newBytes) await api.replaceSkinTexture(accountId, savedSkin.id, newBytes);
        await api.updateSkin(accountId, savedSkin.id, model, capeId);
        await api.applySavedSkin(accountId, savedSkin.id);
        api.setFaceTexture(accountId, bust(api.fileSrc(savedSkin.file)));
        toast(`Applied ${savedSkin.name}`, "success");
        onApplied(savedSkin.id);
      } else if (preset) {
        const saved = await api.applyPreset(accountId, preset.name, preset.url, model, capeId);
        api.setFaceTexture(accountId, bust(api.fileSrc(saved.file)));
        toast(`Applied ${preset.name}`, "success");
        onApplied(saved.id);
      } else {
        await api.setCape(accountId, capeId);
        toast("Cape updated", "success");
        onApplied(); 
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const title = capeOnly
    ? "Change cape"
    : preset
      ? `Apply ${preset.name}?`
      : `Apply ${savedSkin?.name ?? "skin"}?`;
  const applyLabel = capeOnly ? "Save cape" : "Apply";

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="rise flex max-h-[88vh] w-[760px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="font-mc text-base tracking-wide text-gray-100">{title}</h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-5 overflow-y-auto p-5">
          <div className="flex w-[230px] shrink-0 flex-col items-center">
            <div className="grid flex-1 place-items-center">
              <SkinCanvas
                skin={previewUrl}
                cape={capeUrl ?? (capeOnly ? activeCape : null)}
                model={model}
                flipped={false}
                rotate
                animate
                width={210}
                height={300}
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
              <Move size={13} /> Drag to rotate
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <input ref={fileInput} type="file" accept=".png" onChange={replace} className="hidden" />
            {savedSkin && (
              <div>
                <div className="mb-2 font-mc text-sm text-gray-100">Texture</div>
                <button onClick={() => fileInput.current?.click()} className={BTN}>
                  <UploadIcon size={15} /> Replace texture
                </button>
              </div>
            )}

            {!capeOnly && (
              <div>
                <div className="mb-2 font-mc text-sm text-gray-100">Arm style</div>
                <div className="flex gap-2">
                  {[
                    { id: "classic", label: "Wide" },
                    { id: "slim", label: "Slim" },
                  ].map((a) => {
                    const on = model === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setModel(a.id)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                          on
                            ? "border-brass-500/50 bg-brass-500/15 text-brass-300"
                            : "border-edge text-ink-600 hover:text-brass-300"
                        }`}
                      >
                        <span
                          className={`grid h-3 w-3 place-items-center rounded-[3px] border ${
                            on ? "border-brass-500 bg-brass-500" : "border-ink-600"
                          }`}
                        >
                          {on && <Check size={9} className="text-ink-950" />}
                        </span>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 font-mc text-sm text-gray-100">Cape</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-2">
                <button
                  onClick={() => setCapeId(null)}
                  className={`flex aspect-[10/16] flex-col items-center justify-center gap-1 rounded-lg border text-ink-600 transition ${
                    !capeId ? "border-patina-500/70" : "border-edge hover:border-brass-600/40"
                  }`}
                >
                  <X size={16} />
                  <span className="text-[11px]">None</span>
                </button>
                {capes.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCapeId(c.id)}
                    title={c.name}
                    className={`aspect-[10/16] overflow-hidden rounded-lg border bg-ink-950/60 transition ${
                      capeId === c.id ? "border-patina-500/70" : "border-edge hover:border-brass-600/40"
                    }`}
                  >
                    <CapeImage url={c.url} />
                  </button>
                ))}
              </div>
              {capes.length === 0 && (
                <p className="mt-1 text-xs text-ink-600">No capes on this account.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-5 py-3">
          <button onClick={close} className={BTN}>
            <X size={15} /> Cancel
          </button>
          <button onClick={apply} disabled={saving} className={BTN}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
