import { useState, type FC } from "react";
import {
  X,
  Pin,
  Loader2,
  GitBranch,
  SlidersHorizontal,
  RefreshCw,
  Hammer,
  Download,
  Lock,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { FlavorPicker } from "@/components/FlavorPicker";
import type {
  Instance,
  LauncherSettings,
  FlavorGroup,
} from "@/lib/types";
import {
  MemorySettings,
  Select,
  Toggle,
  NumberField,
  Dropdown,
  inputCls,
} from "@/components/ui";


export interface ControlProps {
  instance: Instance;
  patch: (p: Partial<Instance>) => void;
  settings: LauncherSettings;
  onSaveInstance: (i: Instance) => void;
}

export interface PinnableSetting {
  id: string;
  
  tkey: string;
  
  selfLabeled?: boolean;
  applies: (instance: Instance) => boolean;
  Control: FC<ControlProps>;
}

const MemoryControl: FC<ControlProps> = ({ instance, patch, settings }) => (
  <MemorySettings
    max={instance.max_memory_mb ?? settings.default_max_memory_mb}
    min={instance.min_memory_mb ?? settings.default_min_memory_mb}
    onChange={(mx, mn) => patch({ max_memory_mb: mx, min_memory_mb: mn })}
  />
);

const JavaControl: FC<ControlProps> = ({ instance, patch }) => {
  const t = useT();
  const choice = instance.java_policy
    ? instance.java_path
      ? "custom"
      : instance.java_policy
    : "default";
  return (
    <Select
      value={choice}
      onChange={(v) => {
        if (v === "default") patch({ java_policy: null, java_path: null });
        else if (v === "custom") patch({ java_policy: "custom" });
        else patch({ java_policy: v, java_path: null });
      }}
      options={[
        { value: "default", label: t("instanceSettings.java.default") },
        { value: "auto", label: t("instanceSettings.java.auto") },
        { value: "system", label: t("instanceSettings.java.system") },
        { value: "custom", label: t("instanceSettings.java.custom") },
      ]}
    />
  );
};

const ResolutionControl: FC<ControlProps> = ({ instance, patch }) => (
  <div className="flex items-center gap-2">
    <NumberField
      min={640}
      value={instance.resolution?.[0] ?? null}
      onChange={(w) => {
        const h = instance.resolution?.[1] ?? 0;
        patch({ resolution: w && h ? [w, h] : w ? [w, 720] : null });
      }}
      placeholder="1280"
      className="w-20"
    />
    <span className="text-ink-600">×</span>
    <NumberField
      min={480}
      value={instance.resolution?.[1] ?? null}
      onChange={(h) => {
        const w = instance.resolution?.[0] ?? 0;
        patch({ resolution: w && h ? [w, h] : h ? [1280, h] : null });
      }}
      placeholder="720"
      className="w-20"
    />
  </div>
);

const ModpackActionsControl: FC<ControlProps> = ({ instance }) => {
  const t = useT();
  const [confirmReinstall, setConfirmReinstall] = useState(false);
  const act = (fn: () => Promise<void>, msg: string) =>
    fn()
      .then(() => toast(msg, "info"))
      .catch((e) => toast(String(e), "error"));
  const btn =
    "flex items-center justify-center gap-1.5 rounded-md border border-edge/60 px-2 py-1.5 text-[11px] text-ink-500 transition hover:border-brass-600/40 hover:text-brass-300";
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <button
        className={btn}
        onClick={() => act(() => api.syncModpack(instance.id), t("quickSettings.checkingUpdates"))}
      >
        <RefreshCw size={12} /> {t("quickSettings.update")}
      </button>
      <button
        className={btn}
        onClick={() => act(() => api.repairModpack(instance.id), t("quickSettings.verifying"))}
      >
        <Hammer size={12} /> {t("quickSettings.verify")}
      </button>
      {confirmReinstall ? (
        <button
          className={`${btn} border-red-500/40 text-red-300`}
          onClick={() => {
            act(() => api.reinstallModpack(instance.id), t("quickSettings.reinstalling"));
            setConfirmReinstall(false);
          }}
        >
          {t("quickSettings.sure")}
        </button>
      ) : (
        <button className={btn} onClick={() => setConfirmReinstall(true)}>
          <Download size={12} /> {t("quickSettings.reinstall")}
        </button>
      )}
    </div>
  );
};

const BranchControl: FC<ControlProps> = ({ instance, onSaveInstance }) => {
  const t = useT();
  const pack = instance.pack;
  const [branches, setBranches] = useState<api.PackwizBranch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  if (pack.kind !== "packwiz") return null;
  const editable = !instance.featured && !instance.modpack_locked;
  if (!editable) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-600">
        <Lock size={11} />
        {instance.featured
          ? t("quickSettings.fixedFeatured")
          : t("instanceSettings.modpack.unlockToSwitch")}
      </p>
    );
  }
  if (busy) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-brass-300">
        <Loader2 size={12} className="animate-spin" /> {t("quickSettings.switching")}
      </p>
    );
  }
  const open = branches !== null && branches.length > 0;
  return (
    <div className="flex flex-col gap-2">
      <button
        disabled={loading}
        onClick={() => {
          if (branches !== null) {
            
            setBranches(null);
            return;
          }
          setLoading(true);
          api
            .listPackwizBranches(pack.url)
            .then((list) => {
              setBranches(list);
              if (list.length === 0) toast(t("quickSettings.noOtherBranches"), "info");
            })
            .catch((e) => toast(String(e), "error"))
            .finally(() => setLoading(false));
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-edge/60 px-2.5 py-1.5 text-[11px] text-ink-500 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <GitBranch size={12} />
        )}
        {open ? t("quickSettings.hideBranches") : t("instanceSettings.modpack.switchBranch")}
      </button>
      {open && (
        <Dropdown
          value={pack.url}
          onChange={(v) => {
            if (v === pack.url) return;
            setBusy(true);
            (async () => {
              try {
                await api.switchPackwizBranch(instance.id, v);
                await api.syncModpack(instance.id);
                onSaveInstance(await api.getInstance(instance.id));
                toast(t("quickSettings.branchSwitched"), "success");
              } catch (e) {
                toast(String(e), "error");
              } finally {
                setBusy(false);
              }
            })();
          }}
          options={branches!.map((b) => ({ value: b.pack_url, label: b.name }))}
        />
      )}
    </div>
  );
};

const FlavorsControl: FC<ControlProps> = ({ instance, onSaveInstance }) => {
  const t = useT();
  const pack = instance.pack;
  const [groups, setGroups] = useState<FlavorGroup[] | "loading" | null>(null);
  const [busy, setBusy] = useState(false);
  if (pack.kind !== "packwiz" || !pack.unsup) return null;
  return (
    <>
      <button
        disabled={groups === "loading" || busy}
        onClick={() => {
          setGroups("loading");
          api
            .inspectPackwizFlavors(pack.url)
            .then((g) => {
              if (g.length === 0) {
                setGroups(null);
                toast(t("quickSettings.noFlavorGroups"), "info");
              } else setGroups(g);
            })
            .catch((e) => {
              setGroups(null);
              toast(String(e), "error");
            });
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-edge/60 px-2.5 py-1.5 text-[11px] text-ink-500 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
      >
        {groups === "loading" ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <SlidersHorizontal size={12} />
        )}
        {t("instanceSettings.modpack.changeFlavors")}
      </button>
      {groups && groups !== "loading" && (
        <div
          className="modal-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setGroups(null)}
        >
          <div className="rise flex h-[70vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 p-5 shadow-2xl">
            <FlavorPicker
              title={instance.name}
              groups={groups}
              preset={instance.unsup_flavors ?? undefined}
              busy={busy}
              confirmLabel={t("instanceSettings.modpack.applyFlavors")}
              onBack={() => setGroups(null)}
              onConfirm={(ids) => {
                setGroups(null);
                setBusy(true);
                (async () => {
                  try {
                    await api.setPackwizFlavors(instance.id, ids);
                    onSaveInstance(await api.getInstance(instance.id));
                    await api.syncModpack(instance.id);
                    toast(t("quickSettings.flavorsUpdated"), "success");
                  } catch (e) {
                    toast(String(e), "error");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

const JvmControl: FC<ControlProps> = ({ instance, patch }) => (
  <textarea
    rows={2}
    defaultValue={instance.extra_jvm_args.join(" ")}
    onBlur={(e) =>
      patch({
        extra_jvm_args: e.target.value.split(/\s+/).filter((x) => x.length > 0),
      })
    }
    placeholder="-XX:+UseG1GC"
    className={`${inputCls} font-mono text-xs`}
    spellCheck={false}
  />
);

const PreCmdControl: FC<ControlProps> = ({ instance, patch }) => (
  <input
    defaultValue={instance.pre_launch_command ?? ""}
    onBlur={(e) => patch({ pre_launch_command: e.target.value.trim() || null })}
    placeholder="e.g. mangohud"
    className={`${inputCls} font-mono text-xs`}
    spellCheck={false}
  />
);

const PostCmdControl: FC<ControlProps> = ({ instance, patch }) => (
  <input
    defaultValue={instance.post_exit_command ?? ""}
    onBlur={(e) => patch({ post_exit_command: e.target.value.trim() || null })}
    placeholder="e.g. notify-send Closed"
    className={`${inputCls} font-mono text-xs`}
    spellCheck={false}
  />
);

const NotesControl: FC<ControlProps> = ({ instance, patch }) => {
  const t = useT();
  return (
    <textarea
      rows={3}
      defaultValue={instance.notes ?? ""}
      onBlur={(e) => patch({ notes: e.target.value.trim() || null })}
      placeholder={t("quickSettings.notesPlaceholder")}
      className={`${inputCls} resize-none text-xs leading-relaxed`}
      spellCheck={false}
    />
  );
};

const TagsControl: FC<ControlProps> = ({ instance, patch }) => {
  const t = useT();
  return (
    <input
      defaultValue={(instance.tags ?? []).join(", ")}
      onBlur={(e) =>
        patch({
          tags: e.target.value
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x.length > 0),
        })
      }
      placeholder={t("quickSettings.tagsPlaceholder")}
      className={`${inputCls} text-xs`}
      spellCheck={false}
    />
  );
};

const NewsToggle: FC<ControlProps> = ({ instance, patch }) => {
  const t = useT();
  return (
    <Toggle
      label={t("instanceSettings.feeds.showNews")}
      checked={instance.show_news}
      onChange={(v) => patch({ show_news: v })}
    />
  );
};

const PlayerToggle: FC<ControlProps> = ({ instance, patch }) => {
  const t = useT();
  return (
    <Toggle
      label={t("instanceSettings.feeds.showPlayers")}
      checked={instance.show_playercount}
      onChange={(v) => patch({ show_playercount: v })}
    />
  );
};

const managed = (i: Instance) => i.pack.kind !== "none";
const isPackwiz = (i: Instance) => i.pack.kind === "packwiz";


export const PINNABLE_SETTINGS: PinnableSetting[] = [
  { id: "max_memory", tkey: "instanceSettings.memory.title", applies: () => true, Control: MemoryControl },
  { id: "java", tkey: "instanceSettings.java.title", applies: () => true, Control: JavaControl },
  { id: "resolution", tkey: "settings.window.size", applies: () => true, Control: ResolutionControl },
  { id: "modpack_actions", tkey: "instanceSettings.modpack.title", applies: managed, Control: ModpackActionsControl },
  { id: "branch", tkey: "addInstance.branch", applies: isPackwiz, Control: BranchControl },
  {
    id: "flavors",
    tkey: "quickSettings.flavors",
    applies: (i) => i.pack.kind === "packwiz" && i.pack.unsup,
    Control: FlavorsControl,
  },
  { id: "show_news", tkey: "instanceSettings.feeds.showNews", selfLabeled: true, applies: (i) => i.featured, Control: NewsToggle },
  {
    id: "show_playercount",
    tkey: "instanceSettings.feeds.showPlayers",
    selfLabeled: true,
    applies: (i) => i.featured,
    Control: PlayerToggle,
  },
  { id: "jvm_args", tkey: "instanceSettings.jvm.title", applies: () => true, Control: JvmControl },
  { id: "pre_launch_command", tkey: "instanceSettings.commands.pre", applies: () => true, Control: PreCmdControl },
  { id: "post_exit_command", tkey: "instanceSettings.commands.post", applies: () => true, Control: PostCmdControl },
  { id: "notes", tkey: "instanceSettings.details.notes", applies: () => true, Control: NotesControl },
  { id: "tags", tkey: "instanceSettings.details.tags", applies: () => true, Control: TagsControl },
];

export function appliedPins(instance: Instance): PinnableSetting[] {
  return (instance.pinned_settings ?? [])
    .map((id) => PINNABLE_SETTINGS.find((s) => s.id === id))
    .filter((s): s is PinnableSetting => !!s && s.applies(instance));
}


export function QuickSettingsPicker({
  instance,
  onSaveInstance,
  onClose,
}: {
  instance: Instance;
  onSaveInstance: (i: Instance) => void;
  onClose: () => void;
}) {
  const t = useT();
  const options = PINNABLE_SETTINGS.filter((s) => s.applies(instance));
  const toggle = (id: string) => {
    const cur = instance.pinned_settings ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onSaveInstance({ ...instance, pinned_settings: next });
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise flex max-h-[80vh] w-[420px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Pin size={16} className="text-brass-400" /> {t("quickSettings.title")}
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>
        <p className="px-5 pt-3 text-xs text-ink-600">
          {t("quickSettings.pickerDesc")}
        </p>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-5 pt-3">
          {options.map((s) => {
            const pinned = (instance.pinned_settings ?? []).includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  pinned
                    ? "border-brass-600/40 bg-brass-500/10 text-gray-100"
                    : "border-edge text-ink-500 hover:border-brass-600/40 hover:bg-ink-800/50"
                }`}
              >
                <span>{t(s.tkey)}</span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                    pinned
                      ? "border-brass-500 bg-brass-500 text-ink-950"
                      : "border-edge text-transparent"
                  }`}
                >
                  <Pin size={11} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
