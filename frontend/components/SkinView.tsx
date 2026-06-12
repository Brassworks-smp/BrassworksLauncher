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
  CopyPlus,
  Upload as UploadIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { SkinProfile, SkinCape, SavedSkin } from "@/lib/types";


type Blueprint = { name: string; texture: string; model?: string };
type BlueprintSection = { header: string; skins: Blueprint[] };
type BlueprintConfig = { sections: BlueprintSection[] };

const isUrlTexture = (t: string) => /^https?:\/\//i.test(t);

const bpModel = (m?: string) => (m === "slim" ? "slim" : "classic");

const BASE_YAW = 0.5;

const bust = (u: string) => `${u}${u.includes("?") ? "&" : "?"}v=${Date.now()}`;

const BTN =
  "flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50";

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
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);

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
      if (alive) setReady(true);
      const sk = skinRef.current;
      if (sk)
        viewer
          .loadSkin(sk, { model: modelRef.current === "slim" ? "slim" : "default" })
          .then(() => alive && setLoaded(true))
          .catch(() => alive && setLoaded(true));
      else setLoaded(true);
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
    if (!v) return;
    if (skin)
      v.loadSkin(skin, { model: model === "slim" ? "slim" : "default" })
        .then(() => setLoaded(true))
        .catch(() => {});
  }, [skin, model, ready]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    if (cape) {
      v.loadCape(cape).catch(() => {});
    } else {
      try {
        if (typeof v.resetCape === "function") v.resetCape();
        else v.loadCape(null);
      } catch {
      }
    }
  }, [cape, ready, loaded]);

  useEffect(() => {
    targetRef.current = flipped ? BASE_YAW + Math.PI : BASE_YAW;
  }, [flipped]);

  return (
    <canvas
      ref={ref}
      className={`[filter:drop-shadow(0_8px_8px_rgba(0,0,0,0.4))] transition-opacity duration-500 ${
        rotate ? "cursor-grab active:cursor-grabbing" : ""
      } ${loaded ? "opacity-100" : "opacity-0"}`}
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
  const t = useT();
  return (
    <>
      <span className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow-lg ring-2 ring-ink-950/40">
        <Check size={16} strokeWidth={3.5} />
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-brass-600/90 to-transparent pb-1.5 pt-6 text-center font-mc text-[11px] tracking-wider text-ink-950">
        {t("instances.selected")}
      </span>
    </>
  );
}


function CapeSelectedMark() {
  return (
    <>
      <span className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow-lg ring-2 ring-ink-950/40">
        <Check size={11} strokeWidth={3.5} />
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-1/3 bg-gradient-to-t from-brass-600/85 to-transparent" />
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
        <div className="grid grid-cols-[repeat(auto-fill,162px)] justify-start gap-3">
          {children}
        </div>
      )}
    </section>
  );
}

const cachedLibraries: Record<string, SavedSkin[]> = {};
const cachedSelected: Record<string, string | null> = {};
const cachedProfiles: Record<string, SkinProfile> = {};

type TextureSource = { data: number[] } | { url: string };

type NewSeed = {
  name: string;
  model: string;
  capeId: string | null;
  previewUrl: string;
  texture: TextureSource;
};

type EditorState =
  | { mode: "new"; seed: NewSeed }
  | { mode: "edit"; preset: SavedSkin };

export function SkinView({
  accountId,
  username,
  onSkinApplied,
}: {
  accountId: string | null;
  username?: string;
  onSkinApplied?: () => void;
}) {
  const t = useT();
  const [profile, setProfile] = useState<SkinProfile | null>(
    accountId ? cachedProfiles[accountId] ?? null : null,
  );
  const [library, setLibrary] = useState<SavedSkin[]>(
    accountId ? cachedLibraries[accountId] ?? [] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(
    accountId ? cachedSelected[accountId] ?? null : null,
  );
  const [savedOpen, setSavedOpen] = useState(true);
  const [sections, setSections] = useState<BlueprintSection[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pending, setPending] = useState<NewSeed[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  
  const capeUrlFor = (capeId: string | null) =>
    profile?.capes.find((c) => c.id === capeId)?.url ?? null;

  const selectedSkin = library.find((s) => s.id === selected) ?? null;
  const displayName = profile?.name || username || "Player";

  const previewSkin = selectedSkin ? api.fileSrc(selectedSkin.file) : profile?.skin_url ?? null;
  const previewModel = selectedSkin?.model ?? profile?.model ?? "classic";
  const previewCape = selectedSkin
    ? capeUrlFor(selectedSkin.cape_id)
    : profile?.capes.find((c) => c.active)?.url ?? null;

  useEffect(() => {
    if (accountId && profile?.skin_url && !api.getFaceTexture(accountId))
      api.setFaceTexture(accountId, profile.skin_url);
  }, [accountId, profile?.skin_url]);

  const refresh = useCallback(() => {
    if (!api.isTauri() || !accountId) return;
    api
      .seedCurrentSkin(accountId)
      .then((view) => {
        cachedLibraries[accountId] = view.skins;
        cachedSelected[accountId] = view.selected;
        setLibrary(view.skins);
        setSelected(view.selected);
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

  useEffect(() => {
    let alive = true;
    fetch("/skins/blueprints.json")
      .then((r) => r.json())
      .then((cfg: BlueprintConfig) => {
        if (alive) setSections(cfg.sections ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const importFiles = async (files: File[]) => {
    if (!accountId) return;
    const imgs = files.filter(
      (f) => /\.png$/i.test(f.name) || f.type === "image/png",
    );
    if (imgs.length === 0) return;
    const seeds: NewSeed[] = [];
    for (const f of imgs) {
      const buf = await f.arrayBuffer();
      seeds.push({
        name: f.name.replace(/\.[^.]+$/, ""),
        model: "classic",
        capeId: null,
        previewUrl: URL.createObjectURL(f),
        texture: { data: Array.from(new Uint8Array(buf)) },
      });
    }
    setEditor({ mode: "new", seed: seeds[0] });
    setPending(seeds.slice(1));
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await importFiles(files);
  };

  
  const openBlueprint = async (d: Blueprint) => {
    setPending([]);
    try {
      const texture: TextureSource = isUrlTexture(d.texture)
        ? { url: d.texture }
        : { data: Array.from(new Uint8Array(await (await fetch(d.texture)).arrayBuffer())) };
      setEditor({
        mode: "new",
        seed: {
          name: d.name,
          model: bpModel(d.model),
          capeId: null,
          previewUrl: d.texture,
          texture,
        },
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const openEdit = (s: SavedSkin) => {
    setPending([]);
    setEditor({ mode: "edit", preset: s });
  };

  const advanceEditor = () => {
    if (pending.length) {
      setEditor({ mode: "new", seed: pending[0] });
      setPending((q) => q.slice(1));
    } else {
      setEditor(null);
    }
  };

  const quickApply = async (s: SavedSkin) => {
    if (!accountId) return;
    setBusy(true);
    try {
      await api.applySavedSkin(accountId, s.id);
      api.setFaceTexture(accountId, bust(api.fileSrc(s.file)));
      setSelected(s.id);
      toast(t("skin.appliedSkin"), "success");
      onSkinApplied?.();
      refresh();
    } catch (e2) {
      setError(String(e2));
    } finally {
      setBusy(false);
    }
  };

  const removePreset = (s: SavedSkin) => {
    if (!accountId) return;
    api
      .deleteSkin(accountId, s.id)
      .then(refresh)
      .catch((er) => setError(String(er)));
  };

  const duplicate = async (s: SavedSkin) => {
    if (!accountId) return;
    const base = s.name.replace(/\s*\(\d+\)\s*$/, "").trim() || s.name;
    const taken = new Set(library.map((p) => p.name.toLowerCase()));
    let n = 1;
    while (taken.has(`${base} (${n})`.toLowerCase())) n++;
    try {
      await api.duplicateSkin(accountId, s.id, `${base} (${n})`);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveToDisk = () => {
    const source = selectedSkin ? selectedSkin.file : profile?.skin_url ?? null;
    if (!source) return;
    api
      .exportSkin(source, selectedSkin?.name ?? `${displayName}-skin`)
      .then(() => toast(t("skin.savedToDownloads"), "success"))
      .catch((e) => setError(String(e)));
  };

  if (!accountId) {
    return (
      <div className="grid flex-1 place-items-center text-center text-ink-600">
        <div>
          <Shirt size={28} className="mx-auto mb-2 opacity-50" />
          {t("skin.signInPrompt")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <input
        ref={fileInput}
        type="file"
        accept=".png"
        multiple
        onChange={onPickFile}
        className="hidden"
      />
      <h1 className="pb-4 font-mc text-2xl tracking-wide text-gray-100">{t("skin.title")}</h1>

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
              cape={previewCape}
              model={previewModel}
              flipped={false}
              rotate
              animate
              width={210}
              height={300}
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
            <Move size={13} /> {t("skin.dragToRotate")}
          </div>
          {selectedSkin && (
            <div className="mt-2 max-w-full truncate font-mc text-[13px] text-brass-300">
              {selectedSkin.name}
            </div>
          )}
          <div className="mt-3 flex flex-col gap-2 self-stretch">
            <button onClick={saveToDisk} className={`${BTN} justify-center`}>
              <Download size={15} /> {t("skin.saveSkin")}
            </button>
          </div>
        </div>

        <div
          className={`min-w-0 flex-1 overflow-y-auto rounded-xl pr-1 transition ${
            dragOver ? "ring-2 ring-brass-500/50" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void importFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <Section title={t("skin.yourPresets")} open={savedOpen} onToggle={() => setSavedOpen((v) => !v)}>
            <button
              onClick={() => fileInput.current?.click()}
              className={`flex h-[210px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-ink-600 transition hover:border-brass-600/50 hover:text-brass-300 ${
                dragOver ? "border-brass-500/60 text-brass-300" : "border-edge"
              }`}
            >
              {busy ? <Loader2 size={22} className="animate-spin" /> : <Plus size={22} />}
              <span className="text-sm font-medium">{t("skin.addSkin")}</span>
              <span className="text-[11px]">{t("skin.dragDropHint")}</span>
            </button>

            {library.map((s) => {
              const isSel = selected === s.id;
              return (
                <Tile
                  key={s.id}
                  selected={isSel}
                  onClick={() => openEdit(s)}
                  title={s.name}
                >
                  {isSel && <SelectedMark />}
                  <Flip3DThumb
                    url={api.fileSrc(s.file)}
                    model={s.model}
                    cape={capeUrlFor(s.cape_id)}
                  />
                  <span className="absolute left-1.5 top-1.5 z-20 flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void duplicate(s);
                      }}
                      title={t("skin.duplicatePreset")}
                      aria-label={t("skin.duplicatePreset")}
                      className="grid h-8 w-8 place-items-center rounded-md bg-ink-950/80 text-ink-600 transition hover:text-brass-300"
                    >
                      <CopyPlus size={15} />
                    </span>
                    {}
                    {!isSel && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePreset(s);
                        }}
                        title={t("skin.deletePreset")}
                        aria-label={t("skin.deletePreset")}
                        className="grid h-8 w-8 place-items-center rounded-md bg-ink-950/80 text-ink-600 transition hover:text-red-300"
                      >
                        <Trash2 size={15} />
                      </span>
                    )}
                  </span>
                  <span className="absolute inset-x-0 bottom-0 z-20 flex justify-center gap-1.5 bg-gradient-to-t from-ink-950/95 to-transparent pb-2 pt-7 opacity-0 transition group-hover:opacity-100">
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(s);
                      }}
                      className="flex items-center gap-1 rounded-md border border-edge bg-ink-900/90 px-2 py-1 text-[11px] text-gray-200 transition hover:border-brass-600/50 hover:text-brass-300"
                    >
                      <Pencil size={11} /> {t("common.edit")}
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void quickApply(s);
                      }}
                      className="flex items-center gap-1 rounded-md bg-brass-500 px-2 py-1 text-[11px] font-semibold text-ink-950 transition hover:bg-brass-400"
                    >
                      <Check size={11} /> {isSel ? t("skin.reapply") : t("skin.apply")}
                    </span>
                  </span>
                </Tile>
              );
            })}
          </Section>

          {sections.map((sec) => (
            <Section
              key={sec.header}
              title={sec.header}
              open={!collapsed[sec.header]}
              onToggle={() =>
                setCollapsed((c) => ({ ...c, [sec.header]: !c[sec.header] }))
              }
            >
              {sec.skins.map((d) => (
                <Tile
                  key={d.name}
                  title={t("skin.newPresetFrom", { name: d.name })}
                  onClick={() => void openBlueprint(d)}
                >
                  <Flip3DThumb url={d.texture} model={bpModel(d.model)} cape={null} />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent pb-2 pt-6 text-center font-mc text-[11px] tracking-wider text-gray-300">
                    {d.name}
                  </span>
                </Tile>
              ))}
            </Section>
          ))}
        </div>
      </div>

      {editor && (
        <PresetEditor
          key={editor.mode === "edit" ? `edit:${editor.preset.id}` : `new:${editor.seed.previewUrl}`}
          accountId={accountId}
          state={editor}
          capes={profile?.capes ?? []}
          library={library}
          selectedId={selected}
          onClose={advanceEditor}
          onSaved={(applied) => {
            toast(applied ? t("skin.appliedSkinCape") : t("skin.savedPreset"), "success");
            if (applied) onSkinApplied?.();
            advanceEditor();
            refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function PresetEditor({
  accountId,
  state,
  capes,
  library,
  selectedId,
  onClose,
  onSaved,
  onError,
}: {
  accountId: string;
  state: EditorState;
  capes: SkinCape[];
  library: SavedSkin[];
  selectedId: string | null;
  onClose: () => void;
  onSaved: (applied: boolean) => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  const isEdit = state.mode === "edit";
  const preset = isEdit ? state.preset : null;
  const seed = isEdit ? null : state.seed;
  const isSelected = isEdit && preset!.id === selectedId;

  const [name, setName] = useState(preset?.name ?? seed!.name);
  const [model, setModel] = useState(
    (preset?.model ?? seed!.model) === "slim" ? "slim" : "classic",
  );
  const [capeId, setCapeId] = useState<string | null>(
    preset ? preset.cape_id : seed!.capeId,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    preset ? api.fileSrc(preset.file) : seed!.previewUrl,
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

  const trimmed = name.trim();
  const dupe = library.some(
    (s) => s.id !== preset?.id && s.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const nameError = trimmed === "" ? t("skin.enterName") : dupe ? t("skin.nameUsed") : null;
  const canSubmit = !nameError && !saving;

  const replace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const buf = await file.arrayBuffer();
    setNewBytes(Array.from(new Uint8Array(buf)));
    setPreviewUrl(URL.createObjectURL(file));
  };

  const persist = async (): Promise<SavedSkin> => {
    if (isEdit) {
      return api.updatePreset(accountId, preset!.id, trimmed, model, capeId, newBytes);
    }
    const texture: TextureSource = newBytes ? { data: newBytes } : seed!.texture;
    return api.createPreset(accountId, trimmed, model, capeId, texture);
  };

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const saved = await persist();
      if (isSelected) {
        await api.applySavedSkin(accountId, saved.id);
        api.setFaceTexture(accountId, bust(api.fileSrc(saved.file)));
      }
      onSaved(isSelected);
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? t("skin.editSkin") : t("skin.newSkin");

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
                key={`${previewUrl ?? ""}|${model}`}
                skin={previewUrl}
                cape={capeUrl}
                model={model}
                flipped={false}
                rotate
                animate
                width={210}
                height={300}
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
              <Move size={13} /> {t("skin.dragToRotate")}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <input ref={fileInput} type="file" accept=".png" onChange={replace} className="hidden" />
            <div>
              <div className="mb-2 font-mc text-sm text-gray-100">{t("instanceSettings.details.name")}</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("skin.namePlaceholder")}
                spellCheck={false}
                className={`w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm text-gray-100 outline-none ring-1 transition focus:ring-brass-500/60 ${
                  nameError && trimmed !== "" ? "ring-red-500/60" : "ring-edge"
                }`}
              />
              {nameError && trimmed !== "" && (
                <p className="mt-1 text-xs text-red-300">{nameError}</p>
              )}
            </div>
            <div>
              <div className="mb-2 font-mc text-sm text-gray-100">{t("skin.texture")}</div>
              <button onClick={() => fileInput.current?.click()} className={BTN}>
                <UploadIcon size={15} /> {t("skin.replaceTexture")}
              </button>
            </div>

            <div>
              <div className="mb-2 font-mc text-sm text-gray-100">{t("skin.armStyle")}</div>
              <div className="flex gap-2">
                {[
                  { id: "classic", label: t("skin.wide") },
                  { id: "slim", label: t("skin.slim") },
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

            <div>
              <div className="mb-2 font-mc text-sm text-gray-100">{t("skin.cape")}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-2">
                <button
                  onClick={() => setCapeId(null)}
                  className={`group relative flex aspect-[10/16] flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border transition-all duration-200 hover:-translate-y-0.5 ${
                    !capeId
                      ? "border-brass-400 text-brass-200 ring-2 ring-brass-400/50 glow"
                      : "border-edge text-ink-600 hover:border-brass-600/40"
                  }`}
                >
                  <X size={16} className="transition-transform duration-300 group-hover:scale-110" />
                  <span className="text-[11px]">{t("skin.none")}</span>
                  {!capeId && <CapeSelectedMark />}
                </button>
                {capes.map((c) => {
                  const on = capeId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCapeId(c.id)}
                      title={c.name}
                      className={`group relative aspect-[10/16] overflow-hidden rounded-lg border bg-ink-950/60 transition-all duration-200 hover:-translate-y-0.5 ${
                        on
                          ? "border-brass-400 ring-2 ring-brass-400/50 glow"
                          : "border-edge hover:border-brass-600/40"
                      }`}
                    >
                      <span className="block h-full w-full transition-transform duration-300 group-hover:scale-110">
                        <CapeImage url={c.url} />
                      </span>
                      {on && <CapeSelectedMark />}
                    </button>
                  );
                })}
              </div>
              {capes.length === 0 && (
                <p className="mt-1 text-xs text-ink-600">{t("skin.noCapes")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-edge px-5 py-3">
          <span className="mr-auto text-xs text-ink-600">
            {isSelected ? t("skin.selectedHint") : t("skin.presetHint")}
          </span>
          <button onClick={close} className={BTN}>
            <X size={15} /> {t("common.cancel")}
          </button>
          <button onClick={save} disabled={!canSubmit} className={BTN_PRIMARY}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isSelected ? t("skin.saveApply") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
