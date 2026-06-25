import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Package,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  FolderOpen,
  Folder,
  FileText,
  Box as BoxIcon,
  Image as ImageIcon,
  Sparkles,
  Check,
  Minus,
  AlertTriangle,
  Search,
  RefreshCw,
  Trash2,
  Plus,
  Pencil,
  Save,
  Layers,
  ShieldCheck,
  KeyRound,
  Copy,
  Eye,
  Maximize2,
} from "lucide-react";
import * as api from "@/lib/api";
import { useClosable, Collapse, BrassSwitch } from "./ui";
import { useT } from "@/lib/i18n";
import { toast, toastProgress, dismissToast } from "@/lib/toast";
import { getCachedInfo, setCachedInfo } from "@/lib/modcache";
import type {
  ExportConfig,
  ExportFormat,
  ExportNode,
  ExportTree,
  ExportTreeMod,
  FlavorChoiceSpec,
  FlavorGroupSpec,
} from "@/lib/types";

const FORMATS: ExportFormat[] = ["packwiz", "modrinth", "curseforge"];

const ACCENTS: Record<ExportFormat, React.CSSProperties> = {
  packwiz: {
    "--color-brass-300": "#f9a8d4",
    "--color-brass-400": "#f472b6",
    "--color-brass-500": "#ec4899",
    "--color-brass-600": "#db2777",
    "--color-brass-700": "#be185d",
  } as React.CSSProperties,
  modrinth: {
    "--color-brass-300": "#86efac",
    "--color-brass-400": "#4ade80",
    "--color-brass-500": "#22c55e",
    "--color-brass-600": "#16a34a",
    "--color-brass-700": "#15803d",
  } as React.CSSProperties,
  curseforge: {
    "--color-brass-300": "#fdba74",
    "--color-brass-400": "#fb923c",
    "--color-brass-500": "#f97316",
    "--color-brass-600": "#ea580c",
    "--color-brass-700": "#c2410c",
  } as React.CSSProperties,
};

const FORMAT_SUPPORTS_AUTHOR: Record<ExportFormat, boolean> = {
  packwiz: true,
  modrinth: false,
  curseforge: true,
};

export const FORMAT_COLOR: Record<ExportFormat, string> = {
  packwiz: "#ec4899",
  modrinth: "#22c55e",
  curseforge: "#f97316",
};

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  packwiz: "packwiz",
  modrinth: "Modrinth",
  curseforge: "CurseForge",
};

const inputCls =
  "w-full rounded-md bg-ink-950/70 px-3 py-2 text-sm outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

function categoryIcon(category: string) {
  if (category === "resourcepacks") return <ImageIcon size={16} />;
  if (category === "shaderpacks") return <Sparkles size={16} />;
  return <BoxIcon size={16} />;
}

function leafPaths(node: ExportNode, out: string[]) {
  if (node.is_dir) {
    for (const c of node.children) leafPaths(c, out);
  } else {
    out.push(node.rel_path);
  }
}

function defaultLeaves(nodes: ExportNode[], out: string[]) {
  for (const n of nodes) {
    if (n.is_dir) defaultLeaves(n.children, out);
    else if (n.default_selected) out.push(n.rel_path);
  }
}

function dirState(
  node: ExportNode,
  selected: Set<string>,
): "all" | "some" | "none" {
  const leaves: string[] = [];
  leafPaths(node, leaves);
  if (leaves.length === 0) return "none";
  const picked = leaves.filter((p) => selected.has(p)).length;
  if (picked === 0) return "none";
  if (picked === leaves.length) return "all";
  return "some";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function slugify(name: string, fallback: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

type ChoiceRef = { groupId: string; groupName: string; choice: FlavorChoiceSpec };

function allChoices(groups: FlavorGroupSpec[]): ChoiceRef[] {
  const out: ChoiceRef[] = [];
  for (const g of groups)
    for (const c of g.choices)
      out.push({ groupId: g.id, groupName: g.name || g.id, choice: c });
  return out;
}

export function ExportModal({
  instanceId,
  mcVersion,
  loader,
  defaultName,
  initialConfigId,
  onClose,
}: {
  instanceId: string;
  mcVersion: string;
  loader: string;
  defaultName: string;
  initialConfigId?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [format, setFormat] = useState<ExportFormat>("packwiz");
  const [packName, setPackName] = useState(defaultName);
  const [author, setAuthor] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [tree, setTree] = useState<ExportTree | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [optional, setOptional] = useState<
    Record<string, { default: boolean; description: string }>
  >({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [modsOpen, setModsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [modQuery, setModQuery] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [unsupEnabled, setUnsupEnabled] = useState(false);
  const [flavorGroups, setFlavorGroups] = useState<FlavorGroupSpec[]>([]);
  const [flavorAssign, setFlavorAssign] = useState<Record<string, string[]>>({});
  const [sign, setSign] = useState(false);
  const [signFormat, setSignFormat] = useState("signify");
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [switchWarn, setSwitchWarn] = useState<{
    lost: string[];
    apply: () => void;
  } | null>(null);

  const [configs, setConfigs] = useState<ExportConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [configName, setConfigName] = useState("");
  const [nameOverlay, setNameOverlay] = useState<null | "create" | "rename">(
    null,
  );
  const [nameDraft, setNameDraft] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<ExportConfig | null>(null);

  const goStep = (next: number) => {
    setDir(next > step ? "fwd" : "back");
    setStep(next);
  };

  const attemptClose = () => {
    if (busy) return;
    if (!dirty) {
      close();
      return;
    }
    setCancelConfirm(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cancelConfirm) setCancelConfirm(false);
      else if (deleteConfirm) setDeleteConfirm(null);
      else if (nameOverlay) setNameOverlay(null);
      else attemptClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const reloadConfigs = useCallback(() => {
    api
      .listExportConfigs(instanceId)
      .then(setConfigs)
      .catch(() => setConfigs([]));
  }, [instanceId]);

  useEffect(() => reloadConfigs(), [reloadConfigs]);

  const loadTree = useCallback(
    (initial: boolean) => {
      setRefreshing(true);
      api
        .exportTree(instanceId)
        .then((tr) => {
          setTree(tr);
          if (initial) {
            setSelectedMods(
              new Set(tr.mods.filter((m) => m.enabled).map((m) => m.path)),
            );
            const leaves: string[] = [];
            defaultLeaves(tr.files, leaves);
            setSelectedFiles(new Set(leaves));
          }
        })
        .catch((e) => toast(String(e), "error"))
        .finally(() => setRefreshing(false));
    },
    [instanceId],
  );

  useEffect(() => loadTree(!initialConfigId), [loadTree, initialConfigId]);

  useEffect(() => {
    if (!tree) return;
    let alive = true;
    const queue = tree.mods.filter((m) => m.project_id && m.source !== "local");
    const seed: Record<string, string> = {};
    for (const m of queue) {
      const c = getCachedInfo(m.source, m.project_id!, m.version_id);
      if (c?.icon_url) seed[m.path] = c.icon_url;
    }
    if (Object.keys(seed).length) setIcons((prev) => ({ ...prev, ...seed }));
    let i = 0;
    const worker = async () => {
      while (i < queue.length && alive) {
        const m = queue[i++];
        if (seed[m.path]) continue;
        try {
          const info = await api.modInfo(
            instanceId,
            m.source,
            m.project_id!,
            m.version_id,
          );
          setCachedInfo(m.source, m.project_id!, m.version_id, info);
          if (info.icon_url && alive)
            setIcons((prev) => ({ ...prev, [m.path]: info.icon_url! }));
        } catch {
          /* ignore */
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      alive = false;
    };
  }, [tree, instanceId]);

  const toggleMod = useCallback((path: string) => {
    setDirty(true);
    setSelectedMods((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleOptional = useCallback((path: string) => {
    setDirty(true);
    setOptional((prev) => {
      const next = { ...prev };
      if (next[path]) delete next[path];
      else next[path] = { default: true, description: "" };
      return next;
    });
  }, []);

  const setOptionalDefault = useCallback((path: string, def: boolean) => {
    setDirty(true);
    setOptional((prev) => ({
      ...prev,
      [path]: { description: prev[path]?.description ?? "", default: def },
    }));
  }, []);

  const setOptionalDesc = useCallback((path: string, description: string) => {
    setDirty(true);
    setOptional((prev) => ({
      ...prev,
      [path]: { default: prev[path]?.default ?? true, description },
    }));
  }, []);

  const toggleFile = useCallback((path: string) => {
    setDirty(true);
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleDir = useCallback((node: ExportNode) => {
    setDirty(true);
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      const leaves: string[] = [];
      leafPaths(node, leaves);
      const allOn = leaves.every((p) => next.has(p));
      for (const p of leaves) {
        if (allOn) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  }, []);

  const allFileLeaves = useMemo(() => {
    const out: string[] = [];
    if (tree) for (const n of tree.files) leafPaths(n, out);
    return out;
  }, [tree]);

  const filteredMods = useMemo(() => {
    const q = modQuery.trim().toLowerCase();
    const all = tree?.mods ?? [];
    return q ? all.filter((m) => m.name.toLowerCase().includes(q)) : all;
  }, [tree, modQuery]);

  const selectAllMods = () => {
    setDirty(true);
    setSelectedMods(new Set((tree?.mods ?? []).map((m) => m.path)));
  };
  const selectNoMods = () => {
    setDirty(true);
    setSelectedMods(new Set());
  };
  const selectAllFiles = () => {
    setDirty(true);
    setSelectedFiles(new Set(allFileLeaves));
  };
  const selectNoFiles = () => {
    setDirty(true);
    setSelectedFiles(new Set());
  };

  const supportsAuthor = FORMAT_SUPPORTS_AUTHOR[format];
  const supportsOptionalMeta = format === "packwiz";
  const effectiveUnsup = unsupEnabled && format === "packwiz";
  const effectiveSign = effectiveUnsup && sign;

  const isFlavorAssigned = (path: string) =>
    effectiveUnsup && (flavorAssign[path]?.length ?? 0) > 0;

  const optionalForSelected = () => {
    const out: Record<string, { default: boolean; description: string }> = {};
    for (const [path, spec] of Object.entries(optional)) {
      if (selectedMods.has(path) && !isFlavorAssigned(path)) out[path] = spec;
    }
    return out;
  };

  const remappedFlavors = () => {
    const takenGroup = new Set<string>();
    const takenChoice = new Set<string>();
    const idMap = new Map<string, string>();
    const groups: FlavorGroupSpec[] = flavorGroups.map((g, gi) => {
      const gid = uniqueId(slugify(g.name, `group_${gi + 1}`), takenGroup);
      takenGroup.add(gid);
      const choices = g.choices.map((c, ci) => {
        const eid = uniqueId(slugify(c.name, `${gid}_${ci + 1}`), takenChoice);
        takenChoice.add(eid);
        idMap.set(c.id, eid);
        return { ...c, id: eid };
      });
      return { ...g, id: gid, choices };
    });
    const assignments: Record<string, string[]> = {};
    for (const [path, ids] of Object.entries(flavorAssign)) {
      if (!selectedMods.has(path)) continue;
      const mapped = ids
        .map((x) => idMap.get(x))
        .filter((x): x is string => !!x);
      if (mapped.length) assignments[path] = mapped;
    }
    return { groups, assignments };
  };

  const buildSelection = () => {
    const flavor = effectiveUnsup
      ? remappedFlavors()
      : { groups: [], assignments: {} };
    return {
      mods: [...selectedMods],
      files: [...selectedFiles],
      optional: optionalForSelected(),
      flavor_groups: flavor.groups,
      flavor_assignments: flavor.assignments,
    };
  };

  const doExport = async () => {
    if (!packName.trim()) {
      toast(t("instanceSettings.export.modal.nameRequired"), "error");
      goStep(1);
      return;
    }
    setBusy(true);
    const key = `export:${instanceId}:${format}`;
    toastProgress(key, t("instanceSettings.export.exportingToast"), null);
    try {
      const path = await api.exportModpackSelected(
        instanceId,
        format,
        buildSelection(),
        {
          name: packName.trim(),
          author: supportsAuthor ? author.trim() : "",
          version: version.trim() || "1.0.0",
          mc_version: mcVersion,
          loader,
          loader_version: null,
        },
        effectiveUnsup,
        effectiveSign,
        signFormat,
      );
      dismissToast(key);
      toast(t("instanceSettings.export.exportedToast", { path }), "success");
    } catch (e) {
      dismissToast(key);
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const persistConfig = async (name: string) => {
    const isUpdate = editingId !== null;
    try {
      const saved = await api.saveExportConfig(instanceId, {
        id: editingId ?? "",
        name: name.trim() || packName.trim() || "Export",
        format,
        pack_name: packName.trim(),
        author: supportsAuthor ? author.trim() : "",
        version: version.trim() || "1.0.0",
        selection: buildSelection(),
        created_at: 0,
        unsup: effectiveUnsup,
        sign: effectiveSign,
        sign_format: signFormat,
      });
      setEditingId(saved.id);
      setConfigName(saved.name);
      setDirty(false);
      reloadConfigs();
      toast(
        isUpdate
          ? t("instanceSettings.export.modal.updatedToast")
          : t("instanceSettings.export.modal.savedToast"),
        "success",
      );
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const onSaveClick = () => {
    if (editingId) {
      void persistConfig(configName);
      return;
    }
    setNameDraft(packName.trim());
    setNameOverlay("create");
  };

  const confirmName = () => {
    const overlay = nameOverlay;
    setNameOverlay(null);
    if (overlay) void persistConfig(nameDraft);
  };

  const loadConfig = useCallback((c: ExportConfig) => {
    setEditingId(c.id);
    setConfigName(c.name);
    setFormat(c.format);
    setPackName(c.pack_name);
    setAuthor(c.author);
    setVersion(c.version || "1.0.0");
    setSelectedMods(new Set(c.selection.mods));
    setSelectedFiles(new Set(c.selection.files));
    setOptional({ ...c.selection.optional });
    setUnsupEnabled(c.unsup ?? false);
    setSign(c.sign ?? false);
    setSignFormat(c.sign_format || "signify");
    setFlavorGroups(c.selection.flavor_groups ?? []);
    setFlavorAssign({ ...(c.selection.flavor_assignments ?? {}) });
    setGroupsOpen(true);
    setModsOpen(
      c.selection.mods.length > 0 || Object.keys(c.selection.optional).length > 0,
    );
    setFilesOpen(true);
    setDirty(false);
    setDir("fwd");
    setStep(1);
  }, []);

  const appliedInitial = useRef(false);
  useEffect(() => {
    if (appliedInitial.current) return;
    if (!initialConfigId) {
      appliedInitial.current = true;
      return;
    }
    const c = configs.find((x) => x.id === initialConfigId);
    if (c) {
      appliedInitial.current = true;
      loadConfig(c);
    }
  }, [configs, initialConfigId, loadConfig]);

  const newExport = () => {
    setEditingId(null);
    setConfigName("");
    setFormat("packwiz");
    setPackName(defaultName);
    setAuthor("");
    setVersion("1.0.0");
    if (tree) {
      setSelectedMods(new Set(tree.mods.filter((m) => m.enabled).map((m) => m.path)));
      const leaves: string[] = [];
      defaultLeaves(tree.files, leaves);
      setSelectedFiles(new Set(leaves));
    } else {
      setSelectedMods(new Set());
      setSelectedFiles(new Set());
    }
    setOptional({});
    setUnsupEnabled(false);
    setSign(false);
    setSignFormat("signify");
    setFlavorGroups([]);
    setFlavorAssign({});
    setDirty(false);
    goStep(0);
  };

  const removeConfig = async (c: ExportConfig) => {
    setDeleteConfirm(null);
    try {
      await api.deleteExportConfig(instanceId, c.id);
      if (editingId === c.id) {
        setEditingId(null);
        setConfigName("");
      }
      reloadConfigs();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const clearUnsupData = () => {
    setUnsupEnabled(false);
    setSign(false);
    setFlavorGroups([]);
    setFlavorAssign({});
  };

  const lostLeavingUnsup = (): string[] => {
    const lost: string[] = [];
    if (flavorGroups.length)
      lost.push(
        t("instanceSettings.export.modal.lostFlavors", {
          count: flavorGroups.length,
        }),
      );
    if (sign) lost.push(t("instanceSettings.export.modal.lostSigning"));
    return lost;
  };

  const changeFormat = (next: ExportFormat) => {
    if (next === format) return;
    const lost: string[] = [];
    if (next !== "packwiz") lost.push(...lostLeavingUnsup());
    if (next === "modrinth" && author.trim())
      lost.push(t("instanceSettings.export.modal.lostAuthor"));
    const apply = () => {
      setDirty(true);
      setFormat(next);
      if (next !== "packwiz") clearUnsupData();
    };
    if (lost.length) setSwitchWarn({ lost, apply });
    else apply();
  };

  const toggleUnsup = (next: boolean) => {
    if (next) {
      setDirty(true);
      setUnsupEnabled(true);
      return;
    }
    const lost = lostLeavingUnsup();
    const apply = () => {
      setDirty(true);
      clearUnsupData();
    };
    if (lost.length) setSwitchWarn({ lost, apply });
    else apply();
  };

  const allChoiceIdSet = () =>
    new Set(allChoices(flavorGroups).map((c) => c.choice.id));

  const addGroup = () => {
    setDirty(true);
    setFlavorGroups((prev) => {
      const taken = new Set(prev.map((g) => g.id));
      const gid = uniqueId(`group_${prev.length + 1}`, taken);
      const cTaken = new Set(allChoices(prev).map((c) => c.choice.id));
      const c1 = uniqueId("choice", cTaken);
      cTaken.add(c1);
      const c2 = uniqueId("choice", cTaken);
      return [
        ...prev,
        {
          id: gid,
          name: "",
          description: "",
          side: "both",
          choices: [
            { id: c1, name: "", description: "", default: true },
            { id: c2, name: "", description: "", default: false },
          ],
        },
      ];
    });
    setGroupsOpen(true);
  };

  const updateGroup = (id: string, patch: Partial<FlavorGroupSpec>) => {
    setDirty(true);
    setFlavorGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
  };

  const removeGroup = (id: string) => {
    setDirty(true);
    setFlavorGroups((prev) => {
      const grp = prev.find((g) => g.id === id);
      if (grp) {
        const ids = new Set(grp.choices.map((c) => c.id));
        setFlavorAssign((a) => {
          const out: Record<string, string[]> = {};
          for (const [p, list] of Object.entries(a)) {
            const kept = list.filter((x) => !ids.has(x));
            if (kept.length) out[p] = kept;
          }
          return out;
        });
      }
      return prev.filter((g) => g.id !== id);
    });
  };

  const addChoice = (groupId: string) => {
    setDirty(true);
    setFlavorGroups((prev) => {
      const taken = new Set(allChoices(prev).map((c) => c.choice.id));
      const cid = uniqueId("choice", taken);
      return prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              choices: [
                ...g.choices,
                { id: cid, name: "", description: "", default: false },
              ],
            }
          : g,
      );
    });
  };

  const updateChoice = (
    groupId: string,
    choiceId: string,
    patch: Partial<FlavorChoiceSpec>,
  ) => {
    setDirty(true);
    setFlavorGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              choices: g.choices.map((c) =>
                c.id === choiceId ? { ...c, ...patch } : c,
              ),
            }
          : g,
      ),
    );
  };

  const setChoiceDefault = (groupId: string, choiceId: string) => {
    setDirty(true);
    setFlavorGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              choices: g.choices.map((c) => ({
                ...c,
                default: c.id === choiceId,
              })),
            }
          : g,
      ),
    );
  };

  const removeChoice = (groupId: string, choiceId: string) => {
    setDirty(true);
    setFlavorGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, choices: g.choices.filter((c) => c.id !== choiceId) }
          : g,
      ),
    );
    setFlavorAssign((a) => {
      const out: Record<string, string[]> = {};
      for (const [p, list] of Object.entries(a)) {
        const kept = list.filter((x) => x !== choiceId);
        if (kept.length) out[p] = kept;
      }
      return out;
    });
  };

  const toggleAssign = useCallback((path: string, choiceId: string) => {
    setDirty(true);
    setOptional((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setFlavorAssign((prev) => {
      const cur = new Set(prev[path] ?? []);
      if (cur.has(choiceId)) cur.delete(choiceId);
      else cur.add(choiceId);
      const next = { ...prev };
      if (cur.size) next[path] = [...cur];
      else delete next[path];
      return next;
    });
  }, []);

  const setModMode = useCallback(
    (path: string, mode: "always" | "optional" | "flavor") => {
      setDirty(true);
      setOptional((prev) => {
        const next = { ...prev };
        if (mode === "optional") {
          if (!next[path]) next[path] = { default: true, description: "" };
        } else {
          delete next[path];
        }
        return next;
      });
      if (mode !== "flavor") {
        setFlavorAssign((prev) => {
          if (!prev[path]) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        });
      }
    },
    [],
  );

  const [pubKey, setPubKey] = useState("");
  const loadPubKey = useCallback(() => {
    api
      .unsupPublicKey(instanceId, signFormat)
      .then(setPubKey)
      .catch(() => setPubKey(""));
  }, [instanceId, signFormat]);

  useEffect(() => {
    if (effectiveSign) loadPubKey();
    else setPubKey("");
  }, [effectiveSign, loadPubKey]);

  const regenKey = () => {
    api
      .regenerateUnsupKey(instanceId, signFormat)
      .then((k) => {
        setPubKey(k);
        toast(t("instanceSettings.export.modal.keyRegenerated"), "success");
      })
      .catch((e) => toast(String(e), "error"));
  };

  const copyPubKey = () => {
    void navigator.clipboard?.writeText(`public_key=${pubKey}`);
    toast(t("instanceSettings.export.modal.keyCopied"), "success");
  };

  const cfSelected = useMemo(
    () =>
      (tree?.mods ?? []).some(
        (m) => m.source === "curseforge" && selectedMods.has(m.path),
      ),
    [tree, selectedMods],
  );

  const flavorChoiceRefs = useMemo(
    () => allChoices(flavorGroups),
    [flavorGroups],
  );

  const primaryBtn =
    "brass-btn flex items-center justify-center gap-2 rounded-lg bg-brass-500 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50";
  const ghostBtn =
    "flex items-center gap-1 rounded-lg border border-edge px-4 py-2.5 text-sm text-gray-200 transition hover:border-brass-600/40 hover:text-brass-300";

  const stepDots = (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((s) => (
        <button
          key={s}
          onClick={() => goStep(s)}
          aria-label={`Step ${s + 1}`}
          className={`h-1.5 rounded-full transition-all ${
            s === step
              ? "w-5 bg-brass-400"
              : "w-1.5 bg-ink-700 hover:bg-ink-600"
          }`}
        />
      ))}
    </div>
  );

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[55] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && attemptClose()}
    >
      <div
        className="relative flex h-[86vh] max-h-[760px] w-[960px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/40 bg-ink-900 shadow-2xl"
        style={ACCENTS[format]}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <Package size={17} className="text-brass-400" />
            {t("instanceSettings.export.modal.title")}
          </h2>
          <button
            onClick={attemptClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-60 shrink-0 flex-col border-r border-edge bg-ink-950/40">
            <div className="border-b border-edge px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-ink-600">
              {t("instanceSettings.export.savedConfigs")}
            </div>
            <div className="menu-scroll min-h-0 flex-1 overflow-y-auto p-2.5">
              <button
                onClick={newExport}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] font-medium transition ${
                  editingId === null
                    ? "border-brass-500/60 bg-brass-500/10 text-brass-200"
                    : "border-edge text-gray-200 hover:border-brass-600/40 hover:text-brass-300"
                }`}
              >
                <Plus size={15} />
                {t("instanceSettings.export.newExport")}
              </button>

              <div className="mt-2 flex flex-col gap-1">
                {configs.length === 0 ? (
                  <p className="px-1.5 py-2 text-[11px] leading-snug text-ink-600">
                    {t("instanceSettings.export.noSavedConfigs")}
                  </p>
                ) : (
                  configs.map((c) => {
                    const active = editingId === c.id;
                    return (
                      <div
                        key={c.id}
                        onClick={() => loadConfig(c)}
                        className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition ${
                          active
                            ? "border-brass-500/60 bg-brass-500/10"
                            : "border-transparent hover:border-edge hover:bg-ink-800/40"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: FORMAT_COLOR[c.format] }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-gray-200">
                            {c.name}
                          </span>
                          <span className="block truncate text-[10px] text-ink-600">
                            {FORMAT_LABEL[c.format]} ·{" "}
                            {t("instanceSettings.export.fileCount", {
                              count:
                                c.selection.mods.length + c.selection.files.length,
                            })}
                          </span>
                        </span>
                        {active && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNameDraft(configName);
                              setNameOverlay("rename");
                            }}
                            title={t("instanceSettings.export.modal.rename")}
                            className="shrink-0 text-ink-600 transition hover:text-brass-300"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(c);
                          }}
                          title={t("instanceSettings.export.deleteConfig")}
                          className={`shrink-0 text-ink-600 transition hover:text-red-300 ${
                            active ? "" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-5 pt-3.5">
              {stepDots}
              <span className="truncate pl-3 text-[11px] text-ink-600">
                {editingId
                  ? t("instanceSettings.export.modal.editing", {
                      name: configName,
                    })
                  : t("instanceSettings.export.modal.draft")}
              </span>
            </div>

            <div
              className={`menu-scroll min-h-0 flex-1 overflow-y-auto p-5 ${
                busy ? "pointer-events-none select-none opacity-60" : ""
              }`}
              aria-disabled={busy}
            >
              <div
                key={step}
                className={dir === "back" ? "swap-in-back" : "swap-in"}
              >
                {step === 0 && (
                  <div className="flex flex-col gap-2.5">
                    <div className="mb-1 text-sm text-ink-600">
                      {t("instanceSettings.export.modal.stepFormat")}
                    </div>
                    {FORMATS.map((f) => {
                      const selected = f === format;
                      const label =
                        f === "packwiz"
                          ? "packwiz"
                          : f === "modrinth"
                            ? t("instanceSettings.export.mrpack")
                            : t("instanceSettings.export.cfzip");
                      const desc = t(
                        `instanceSettings.export.modal.format${
                          f[0].toUpperCase() + f.slice(1)
                        }Desc`,
                      );
                      return (
                        <button
                          key={f}
                          onClick={() => changeFormat(f)}
                          style={ACCENTS[f]}
                          className={`group flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition ${
                            selected
                              ? "border-brass-500 bg-brass-500/15"
                              : "border-edge hover:border-brass-600/50 hover:bg-brass-500/5"
                          }`}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brass-500/20 text-brass-400 transition group-hover:bg-brass-500/30">
                            <Package size={17} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-gray-100">
                              {label}
                            </span>
                            <span className="block text-xs text-ink-600">
                              {desc}
                            </span>
                          </span>
                          {selected && (
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brass-300 to-brass-600 text-ink-950 shadow ring-1 ring-ink-950/30">
                              <Check size={11} strokeWidth={3.5} />
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {format === "packwiz" && (
                      <div className="mt-1 rounded-lg border border-edge bg-ink-950/30">
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                          <Layers size={17} className="shrink-0 text-brass-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-gray-100">
                              {t("instanceSettings.export.modal.unsupTitle")}
                            </span>
                            <span className="block text-xs leading-snug text-ink-600">
                              {t("instanceSettings.export.modal.unsupDesc")}
                            </span>
                          </span>
                          <BrassSwitch checked={unsupEnabled} onChange={toggleUnsup} />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {step === 1 && (
                  <div className="flex flex-col gap-4">
                    <div className="mb-1 text-sm text-ink-600">
                      {t("instanceSettings.export.modal.stepDetails")}
                    </div>
                    <Labeled label={t("instanceSettings.export.modal.packName")}>
                      <input
                        value={packName}
                        onChange={(e) => {
                          setPackName(e.target.value);
                          setDirty(true);
                        }}
                        className={inputCls}
                      />
                    </Labeled>
                    <Labeled
                      label={t("instanceSettings.export.modal.author")}
                      hint={
                        supportsAuthor
                          ? undefined
                          : t("instanceSettings.export.modal.authorUnsupported")
                      }
                    >
                      <input
                        value={supportsAuthor ? author : ""}
                        disabled={!supportsAuthor}
                        onChange={(e) => {
                          setAuthor(e.target.value);
                          setDirty(true);
                        }}
                        className={`${inputCls} disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}
                      />
                    </Labeled>
                    <Labeled label={t("instanceSettings.export.modal.version")}>
                      <input
                        value={version}
                        onChange={(e) => {
                          setVersion(e.target.value);
                          setDirty(true);
                        }}
                        className={inputCls}
                      />
                    </Labeled>
                    <div className="flex gap-2 text-xs text-ink-600">
                      <span className="rounded-md bg-ink-800 px-2 py-1">
                        {mcVersion}
                      </span>
                      <span className="rounded-md bg-ink-800 px-2 py-1">
                        {loader}
                      </span>
                    </div>

                    {effectiveUnsup && (
                      <div className="rounded-lg border border-edge bg-ink-950/30 p-3.5">
                        <label className="flex cursor-pointer items-center gap-2.5">
                          <ShieldCheck size={16} className="shrink-0 text-brass-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-gray-200">
                              {t("instanceSettings.export.modal.signTitle")}
                            </span>
                            <span className="block text-[11px] leading-snug text-ink-600">
                              {t("instanceSettings.export.modal.signDesc")}
                            </span>
                          </span>
                          <BrassSwitch
                            checked={sign}
                            onChange={(v) => {
                              setSign(v);
                              setDirty(true);
                            }}
                          />
                        </label>

                        {sign && (
                          <div className="mt-3 flex flex-col gap-2.5 border-t border-edge pt-3">
                            <div className="flex items-center gap-1.5">
                              {(["signify", "ed25519"] as const).map((sf) => (
                                <button
                                  key={sf}
                                  onClick={() => {
                                    setSignFormat(sf);
                                    setDirty(true);
                                  }}
                                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
                                    signFormat === sf
                                      ? "border-brass-500 bg-brass-500/15 text-brass-200"
                                      : "border-edge text-ink-600 hover:border-brass-600/40"
                                  }`}
                                >
                                  {sf}
                                </button>
                              ))}
                            </div>

                            <div className="rounded-md bg-ink-950/70 p-2.5 ring-1 ring-edge">
                              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-600">
                                <KeyRound size={11} />
                                {t("instanceSettings.export.modal.publicKey")}
                              </div>
                              <code className="block break-all font-mono text-[10px] leading-relaxed text-gray-300">
                                {pubKey
                                  ? `public_key=${pubKey}`
                                  : t("instanceSettings.export.modal.keyLoading")}
                              </code>
                              <div className="mt-2 flex gap-1.5">
                                <SmallBtn onClick={copyPubKey}>
                                  <span className="flex items-center gap-1">
                                    <Copy size={11} />
                                    {t("instanceSettings.export.modal.copy")}
                                  </span>
                                </SmallBtn>
                                <SmallBtn onClick={regenKey}>
                                  {t("instanceSettings.export.modal.regenerate")}
                                </SmallBtn>
                              </div>
                            </div>

                            <p className="text-[10px] leading-snug text-ink-600">
                              {t("instanceSettings.export.modal.signHint")}
                            </p>
                            {cfSelected && (
                              <p className="flex items-start gap-1.5 text-[10px] leading-snug text-amber-400/90">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                {t("instanceSettings.export.modal.signInsecureHash")}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-ink-600">
                        {t("instanceSettings.export.modal.stepFiles")}
                      </div>
                      <button
                        onClick={() => loadTree(false)}
                        disabled={refreshing}
                        title={t("instanceSettings.export.modal.refresh")}
                        className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
                      >
                        <RefreshCw
                          size={12}
                          className={refreshing ? "animate-spin" : ""}
                        />
                        {t("instanceSettings.export.modal.refresh")}
                      </button>
                    </div>

                    {!tree ? (
                      <div className="grid place-items-center py-8">
                        <Loader2
                          className="animate-spin text-ink-600"
                          size={20}
                        />
                      </div>
                    ) : (
                      <>
                        {effectiveUnsup && (
                          <CollapsibleSection
                            open={groupsOpen}
                            onToggle={() => setGroupsOpen((o) => !o)}
                            title={t("instanceSettings.export.modal.flavorGroups")}
                            meta={`${flavorGroups.length}`}
                            hint={t("instanceSettings.export.modal.expandHint")}
                          >
                            <FlavorGroupsEditor
                              groups={flavorGroups}
                              onAddGroup={addGroup}
                              onUpdateGroup={updateGroup}
                              onRemoveGroup={removeGroup}
                              onAddChoice={addChoice}
                              onUpdateChoice={updateChoice}
                              onSetDefault={setChoiceDefault}
                              onRemoveChoice={removeChoice}
                            />
                          </CollapsibleSection>
                        )}

                        <CollapsibleSection
                          open={modsOpen}
                          onToggle={() => setModsOpen((o) => !o)}
                          title={t("instanceSettings.export.modal.mods")}
                          meta={t("instanceSettings.export.modal.modsCount", {
                            selected: selectedMods.size,
                            total: tree.mods.length,
                          })}
                          hint={t("instanceSettings.export.modal.expandHint")}
                        >
                          <div className="mb-2 flex items-center gap-1.5">
                            <SearchBox
                              value={modQuery}
                              onChange={setModQuery}
                              placeholder={t(
                                "instanceSettings.export.modal.searchMods",
                              )}
                            />
                            <SmallBtn onClick={selectAllMods}>
                              {t("instanceSettings.export.modal.selectAll")}
                            </SmallBtn>
                            <SmallBtn onClick={selectNoMods}>
                              {t("instanceSettings.export.modal.selectNone")}
                            </SmallBtn>
                          </div>
                          {tree.mods.length > 0 && (
                            <p className="mb-2 text-[11px] leading-snug text-ink-600">
                              {effectiveUnsup
                                ? t("instanceSettings.export.modal.flavorAssignHint")
                                : t("instanceSettings.export.modal.optionalHint")}
                              {!supportsOptionalMeta &&
                                ` ${t("instanceSettings.export.modal.optionalUnsupported")}`}
                            </p>
                          )}
                          <div className="stagger flex flex-col gap-1">
                            {filteredMods.map((m) => (
                              <ModRow
                                key={m.path}
                                mod={m}
                                icon={icons[m.path]}
                                checked={selectedMods.has(m.path)}
                                optional={optional[m.path]}
                                supportsMeta={supportsOptionalMeta}
                                unsup={effectiveUnsup}
                                choices={flavorChoiceRefs}
                                assigned={flavorAssign[m.path]}
                                onToggleAssign={toggleAssign}
                                onSetMode={setModMode}
                                onToggle={toggleMod}
                                onToggleOptional={toggleOptional}
                                onSetDefault={setOptionalDefault}
                                onSetDesc={setOptionalDesc}
                              />
                            ))}
                          </div>
                        </CollapsibleSection>

                        <CollapsibleSection
                          open={filesOpen}
                          onToggle={() => setFilesOpen((o) => !o)}
                          title={t("instanceSettings.export.modal.configs")}
                          meta={`${selectedFiles.size}`}
                          hint={t("instanceSettings.export.modal.expandHint")}
                        >
                          <div className="mb-2 flex items-center gap-1.5">
                            <SearchBox
                              value={query}
                              onChange={setQuery}
                              placeholder={t(
                                "instanceSettings.export.modal.search",
                              )}
                            />
                            <SmallBtn onClick={selectAllFiles}>
                              {t("instanceSettings.export.modal.selectAll")}
                            </SmallBtn>
                            <SmallBtn onClick={selectNoFiles}>
                              {t("instanceSettings.export.modal.selectNone")}
                            </SmallBtn>
                          </div>
                          <div className="stagger">
                            {tree.files.map((node) => (
                              <TreeRow
                                key={node.rel_path}
                                node={node}
                                depth={0}
                                query={query.toLowerCase()}
                                selected={selectedFiles}
                                onToggleFile={toggleFile}
                                onToggleDir={toggleDir}
                              />
                            ))}
                          </div>
                        </CollapsibleSection>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-edge px-5 py-3">
              <button
                onClick={() => (step === 0 ? attemptClose() : goStep(step - 1))}
                disabled={busy}
                className={`${ghostBtn} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {step === 0 ? (
                  t("instanceSettings.export.modal.cancel")
                ) : (
                  <>
                    <ChevronLeft size={15} />
                    {t("instanceSettings.export.modal.back")}
                  </>
                )}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSaveClick}
                  disabled={busy || !packName.trim()}
                  className={`${ghostBtn} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Save size={14} />
                  {editingId
                    ? t("instanceSettings.export.modal.update")
                    : t("instanceSettings.export.modal.saveAs")}
                </button>
                {step < 2 ? (
                  <button
                    onClick={() => goStep(step + 1)}
                    disabled={step === 1 && !packName.trim()}
                    className={primaryBtn}
                  >
                    {t("instanceSettings.export.modal.next")}
                    <ChevronRight size={15} />
                  </button>
                ) : (
                  <button onClick={doExport} disabled={busy} className={primaryBtn}>
                    {busy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Download size={15} />
                    )}
                    {busy
                      ? t("instanceSettings.export.modal.exporting")
                      : t("instanceSettings.export.modal.export")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {nameOverlay && (
          <div
            className="modal-overlay absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-sm"
            onMouseDown={(e) =>
              e.target === e.currentTarget && setNameOverlay(null)
            }
          >
            <div className="w-[360px] max-w-[90%] rounded-xl border border-brass-700/40 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-3 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
                <Save size={15} className="text-brass-400" />
                {nameOverlay === "rename"
                  ? t("instanceSettings.export.modal.renameTitle")
                  : t("instanceSettings.export.modal.saveConfigTitle")}
              </div>
              <div className="mb-1.5 text-sm text-ink-600">
                {t("instanceSettings.export.modal.saveConfigName")}
              </div>
              <input
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmName()}
                className={inputCls}
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setNameOverlay(null)}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                >
                  {t("instanceSettings.export.modal.cancel")}
                </button>
                <button
                  onClick={confirmName}
                  disabled={!nameDraft.trim() && !packName.trim()}
                  className="rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-50"
                >
                  {t("instanceSettings.export.modal.saveConfig")}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirm && (
          <div className="modal-overlay absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
            <div className="w-[360px] max-w-[90%] rounded-xl border border-red-600/30 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
                <Trash2 size={15} className="text-red-400" />
                {t("instanceSettings.export.modal.deleteConfigTitle")}
              </div>
              <p className="mb-4 text-xs leading-relaxed text-ink-500">
                {t("instanceSettings.export.modal.deleteConfigBody", {
                  name: deleteConfirm.name,
                })}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                >
                  {t("instanceSettings.export.modal.cancelKeep")}
                </button>
                <button
                  onClick={() => removeConfig(deleteConfirm)}
                  className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-red-400"
                >
                  {t("instanceSettings.export.deleteConfig")}
                </button>
              </div>
            </div>
          </div>
        )}

        {cancelConfirm && (
          <div className="modal-overlay absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
            <div className="w-[340px] max-w-[90%] rounded-xl border border-amber-600/30 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
                <AlertTriangle size={16} className="text-amber-400" />
                {t("instanceSettings.export.modal.cancelTitle")}
              </div>
              <p className="mb-4 text-xs leading-relaxed text-ink-500">
                {t("instanceSettings.export.modal.cancelBody")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCancelConfirm(false)}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                >
                  {t("instanceSettings.export.modal.cancelKeep")}
                </button>
                <button
                  onClick={close}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-amber-400"
                >
                  {t("instanceSettings.export.modal.cancelDiscard")}
                </button>
              </div>
            </div>
          </div>
        )}

        {switchWarn && (
          <div className="modal-overlay absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
            <div className="w-[380px] max-w-[90%] rounded-xl border border-amber-600/30 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 font-mc text-sm tracking-wide text-gray-100">
                <AlertTriangle size={16} className="text-amber-400" />
                {t("instanceSettings.export.modal.switchTitle")}
              </div>
              <p className="mb-2 text-xs leading-relaxed text-ink-500">
                {t("instanceSettings.export.modal.switchBody")}
              </p>
              <ul className="mb-4 flex flex-col gap-1">
                {switchWarn.lost.map((l, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 text-xs text-amber-300/90"
                  >
                    <Trash2 size={11} className="shrink-0" />
                    {l}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSwitchWarn(null)}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:text-gray-200"
                >
                  {t("instanceSettings.export.modal.cancelKeep")}
                </button>
                <button
                  onClick={() => {
                    switchWarn.apply();
                    setSwitchWarn(null);
                  }}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-amber-400"
                >
                  {t("instanceSettings.export.modal.switchConfirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm text-ink-600">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-amber-400/80">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1">
      <Search
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md bg-ink-950/70 py-1.5 pl-7 pr-2 text-xs outline-none ring-1 ring-edge transition focus:ring-brass-500/60"
      />
    </div>
  );
}

function SmallBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
    >
      {children}
    </button>
  );
}

function CollapsibleSection({
  open,
  onToggle,
  title,
  meta,
  hint,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  meta: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-edge bg-ink-950/30">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-brass-500/[0.04]"
      >
        <ChevronRight
          size={15}
          className={`shrink-0 text-brass-400 transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-sm font-medium text-gray-200">{title}</span>
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-600">
          {meta}
        </span>
        <span className="ml-auto text-[11px] text-ink-600">
          {open ? "" : hint}
        </span>
      </button>
      <Collapse open={open}>
        <div className="border-t border-edge p-2.5">{children}</div>
      </Collapse>
    </div>
  );
}

function CheckBox({ state }: { state: "all" | "some" | "none" }) {
  const on = state !== "none";
  return (
    <span
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition ${
        on ? "border-brass-500 bg-brass-500" : "border-ink-600"
      }`}
    >
      {state === "all" && (
        <Check size={11} strokeWidth={3} className="text-ink-950" />
      )}
      {state === "some" && (
        <Minus size={11} strokeWidth={3} className="text-ink-950" />
      )}
    </span>
  );
}

const ModRow = memo(function ModRow({
  mod,
  icon,
  checked,
  optional,
  supportsMeta,
  unsup,
  choices,
  assigned,
  onToggleAssign,
  onSetMode,
  onToggle,
  onToggleOptional,
  onSetDefault,
  onSetDesc,
}: {
  mod: ExportTreeMod;
  icon?: string;
  checked: boolean;
  optional?: { default: boolean; description: string };
  supportsMeta: boolean;
  unsup: boolean;
  choices: ChoiceRef[];
  assigned?: string[];
  onToggleAssign: (path: string, choiceId: string) => void;
  onSetMode: (path: string, mode: "always" | "optional" | "flavor") => void;
  onToggle: (path: string) => void;
  onToggleOptional: (path: string) => void;
  onSetDefault: (path: string, def: boolean) => void;
  onSetDesc: (path: string, desc: string) => void;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [flavOpen, setFlavOpen] = useState(false);
  const isOptional = !!optional;
  const assignedSet = useMemo(() => new Set(assigned ?? []), [assigned]);
  const isAssigned = assignedSet.size > 0;
  const activeMode: "always" | "optional" | "flavor" = isAssigned
    ? "flavor"
    : isOptional
      ? "optional"
      : flavOpen
        ? "flavor"
        : "always";
  const grouped = useMemo(() => {
    const map = new Map<string, ChoiceRef[]>();
    for (const c of choices) {
      const arr = map.get(c.groupName) ?? [];
      arr.push(c);
      map.set(c.groupName, arr);
    }
    return [...map.entries()];
  }, [choices]);
  const badge =
    mod.source === "modrinth"
      ? "Modrinth"
      : mod.source === "curseforge"
        ? "CurseForge"
        : t("instanceSettings.export.modal.sourceLocal");
  const highlighted = checked && (isOptional || isAssigned);
  return (
    <div
      className={`rounded-md border transition ${
        highlighted
          ? "border-brass-500/50 bg-brass-500/[0.06]"
          : "border-edge bg-ink-950/30"
      }`}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm">
        <button
          onClick={() => onToggle(mod.path)}
          className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <CheckBox state={checked ? "all" : "none"} />
          <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded bg-ink-900 text-ink-600">
            {icon && !failed ? (
              <img
                src={icon}
                alt=""
                loading="eager"
                decoding="async"
                className="h-full w-full object-cover"
                onError={() => setFailed(true)}
              />
            ) : (
              categoryIcon(mod.category)
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-gray-200" title={mod.name}>
            {mod.name}
          </span>
        </button>
        {checked && unsup ? (
          <div className="flex shrink-0 items-center rounded-md border border-edge p-0.5">
            {(["always", "optional", "flavor"] as const).map((mode) => {
              const active = activeMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => {
                    if (mode === "flavor") {
                      onSetMode(mod.path, "flavor");
                      setFlavOpen(true);
                    } else {
                      onSetMode(mod.path, mode);
                      setFlavOpen(false);
                    }
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                    active
                      ? "bg-brass-500/25 text-brass-100"
                      : "text-ink-600 hover:text-brass-300"
                  }`}
                >
                  {t(`instanceSettings.export.modal.mode_${mode}`)}
                  {mode === "flavor" && isAssigned ? ` · ${assignedSet.size}` : ""}
                </button>
              );
            })}
          </div>
        ) : checked ? (
          <button
            onClick={() => onToggleOptional(mod.path)}
            title={t("instanceSettings.export.modal.optionalOn")}
            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
              isOptional
                ? "border-brass-500 bg-brass-500/20 text-brass-200"
                : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
            }`}
          >
            {t("instanceSettings.export.modal.makeOptional")}
          </button>
        ) : null}
        <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-600">
          {badge}
        </span>
      </div>

      <Collapse open={checked && unsup && activeMode === "flavor"}>
        <div className="flex flex-col gap-2 border-t border-brass-600/20 px-2.5 py-2">
          {grouped.length === 0 ? (
            <p className="text-[11px] leading-snug text-ink-600">
              {t("instanceSettings.export.modal.noFlavorGroups")}
            </p>
          ) : (
            grouped.map(([groupName, list]) => (
              <div key={groupName}>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-600">
                  {groupName}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((c) => {
                    const on = assignedSet.has(c.choice.id);
                    return (
                      <button
                        key={c.choice.id}
                        onClick={() => onToggleAssign(mod.path, c.choice.id)}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
                          on
                            ? "border-brass-500 bg-brass-500/20 text-brass-100"
                            : "border-edge text-ink-600 hover:border-brass-600/40 hover:text-brass-300"
                        }`}
                      >
                        {on && <Check size={9} strokeWidth={3.5} />}
                        {c.choice.name ||
                          t("instanceSettings.export.modal.unnamedChoice")}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </Collapse>

      <Collapse open={checked && activeMode === "optional"}>
        <div className="flex flex-col gap-2 border-t border-brass-600/20 px-2.5 py-2">
          {supportsMeta ? (
            <>
              <label className="flex items-center justify-between gap-3 text-xs text-gray-200">
                <span>{t("instanceSettings.export.modal.optionalDefaultOn")}</span>
                <BrassSwitch
                  checked={optional?.default ?? true}
                  onChange={(v) => onSetDefault(mod.path, v)}
                />
              </label>
              <div>
                <div className="mb-1 text-[11px] text-ink-600">
                  {t("instanceSettings.export.modal.optionalDescLabel")}
                </div>
                <ExpandableDescription
                  value={optional?.description ?? ""}
                  onChange={(v) => onSetDesc(mod.path, v)}
                  placeholder={t(
                    "instanceSettings.export.modal.optionalDescPlaceholder",
                  )}
                  rich={unsup}
                />
              </div>
            </>
          ) : (
            <p className="text-[11px] leading-snug text-ink-600">
              {t("instanceSettings.export.modal.optionalUnsupported")}
            </p>
          )}
        </div>
      </Collapse>
    </div>
  );
});

type TreeRowProps = {
  node: ExportNode;
  depth: number;
  query: string;
  selected: Set<string>;
  onToggleFile: (p: string) => void;
  onToggleDir: (n: ExportNode) => void;
};

const TreeRow = memo(
  function TreeRow({
    node,
    depth,
    query,
    selected,
    onToggleFile,
    onToggleDir,
  }: TreeRowProps) {
    const [open, setOpen] = useState(false);
    const matches = query ? node.rel_path.toLowerCase().includes(query) : true;
    const childMatches =
      node.is_dir &&
      (matches || node.children.some((c) => deepMatch(c, query)));
    if (node.is_dir && !childMatches) return null;
    if (!node.is_dir && !matches) return null;
    const isOpen = open || query.length > 0;
    const indent = depth * 14;

    if (node.is_dir) {
      return (
        <div>
          <div
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition hover:bg-ink-800/40"
            style={{ marginLeft: indent }}
          >
            <button onClick={() => onToggleDir(node)}>
              <CheckBox state={dirState(node, selected)} />
            </button>
            <button
              onClick={() => setOpen(!open)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <ChevronRight
                size={13}
                className={`shrink-0 text-ink-600 transition-transform duration-200 ${
                  isOpen ? "rotate-90" : ""
                }`}
              />
              {isOpen ? (
                <FolderOpen size={14} className="shrink-0 text-brass-400" />
              ) : (
                <Folder size={14} className="shrink-0 text-brass-400" />
              )}
              <span className="truncate text-gray-200">{node.name}</span>
              <span className="text-[10px] text-ink-600">
                {formatBytes(node.size)}
              </span>
            </button>
          </div>
          {isOpen && (
            <div className="fade-in">
              {node.children.map((c) => (
                <TreeRow
                  key={c.rel_path}
                  node={c}
                  depth={depth + 1}
                  query={query}
                  selected={selected}
                  onToggleFile={onToggleFile}
                  onToggleDir={onToggleDir}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={() => onToggleFile(node.rel_path)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition hover:bg-ink-800/40"
        style={{ marginLeft: indent, width: `calc(100% - ${indent}px)` }}
      >
        <CheckBox state={selected.has(node.rel_path) ? "all" : "none"} />
        <FileText size={13} className="shrink-0 text-ink-600" />
        <span className="min-w-0 flex-1 truncate text-gray-300">{node.name}</span>
        <span className="text-[10px] text-ink-600">{formatBytes(node.size)}</span>
      </button>
    );
  },
  (a, b) => {
    if (
      a.node !== b.node ||
      a.depth !== b.depth ||
      a.query !== b.query ||
      a.onToggleFile !== b.onToggleFile ||
      a.onToggleDir !== b.onToggleDir
    )
      return false;
    if (a.node.is_dir) {
      return dirState(a.node, a.selected) === dirState(b.node, b.selected);
    }
    return a.selected.has(a.node.rel_path) === b.selected.has(b.node.rel_path);
  },
);

function deepMatch(node: ExportNode, query: string): boolean {
  if (!query) return true;
  if (node.rel_path.toLowerCase().includes(query)) return true;
  return node.is_dir && node.children.some((c) => deepMatch(c, query));
}

const ALLOWED_TAGS = ["h1", "h2", "h3", "b", "strong", "i", "em", "ul", "li", "br"];

function toPreviewHtml(text: string): string {
  let esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  for (const tag of ALLOWED_TAGS) {
    esc = esc
      .replace(new RegExp(`&lt;${tag}&gt;`, "gi"), `<${tag}>`)
      .replace(new RegExp(`&lt;/${tag}&gt;`, "gi"), `</${tag}>`)
      .replace(new RegExp(`&lt;${tag}\\s*/?&gt;`, "gi"), `<${tag}>`);
  }
  return esc.replace(/\n/g, "<br>");
}

const PREVIEW_CLS =
  "px-2.5 py-1.5 text-xs leading-snug text-gray-300 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:font-medium [&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic [&_em]:italic [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4";

function RichDescription({
  value,
  onChange,
  placeholder,
  rich,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rich: boolean;
  rows?: number;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);

  const surround = (open: string, close: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const sel = value.slice(s, e);
    onChange(value.slice(0, s) + open + sel + close + value.slice(e));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const p = s + open.length;
      el.setSelectionRange(p, p + sel.length);
    });
  };

  const insert = (snippet: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    onChange(value.slice(0, s) + snippet + value.slice(s));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const p = s + snippet.length;
      el.setSelectionRange(p, p);
    });
  };

  const tools: { key: string; label: string; cls?: string; on: () => void }[] = [
    { key: "b", label: "B", cls: "font-bold", on: () => surround("<b>", "</b>") },
    { key: "i", label: "I", cls: "italic", on: () => surround("<i>", "</i>") },
    { key: "h1", label: "H1", on: () => surround("<h1>", "</h1>") },
    { key: "h2", label: "H2", on: () => surround("<h2>", "</h2>") },
    { key: "h3", label: "H3", on: () => surround("<h3>", "</h3>") },
    { key: "ul", label: "•", on: () => insert("<ul>\n  <li></li>\n</ul>\n") },
    { key: "br", label: "↵", on: () => insert("<br>\n") },
  ];

  return (
    <div className="overflow-hidden rounded-md bg-ink-950/70 ring-1 ring-edge transition focus-within:ring-brass-500/60">
      {rich && (
        <div className="flex items-center gap-0.5 border-b border-edge px-1 py-0.5">
          {tools.map((tool) => (
            <button
              key={tool.key}
              type="button"
              onClick={tool.on}
              title={t(`instanceSettings.export.modal.fmt_${tool.key}`)}
              className={`grid h-5 min-w-5 place-items-center rounded px-1 text-[11px] text-ink-600 transition hover:bg-ink-800 hover:text-brass-300 ${tool.cls ?? ""}`}
            >
              {tool.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            title={t("instanceSettings.export.modal.fmt_preview")}
            className={`ml-auto flex h-5 items-center gap-1 rounded px-1.5 text-[10px] transition hover:bg-ink-800 ${
              preview ? "text-brass-300" : "text-ink-600 hover:text-brass-300"
            }`}
          >
            {preview ? <Pencil size={10} /> : <Eye size={10} />}
            {preview
              ? t("instanceSettings.export.modal.fmt_edit")
              : t("instanceSettings.export.modal.fmt_preview")}
          </button>
        </div>
      )}
      {rich && preview ? (
        value.trim() ? (
          <div
            className={PREVIEW_CLS}
            dangerouslySetInnerHTML={{ __html: toPreviewHtml(value) }}
          />
        ) : (
          <div className="px-2.5 py-1.5 text-xs text-ink-600">
            {t("instanceSettings.export.modal.fmt_emptyPreview")}
          </div>
        )
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="block w-full resize-y bg-transparent px-2.5 py-1.5 text-xs text-gray-200 outline-none"
        />
      )}
    </div>
  );
}

function ExpandableDescription({
  value,
  onChange,
  placeholder,
  rich,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rich: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const fieldCls =
    "min-w-0 rounded-md bg-ink-950/70 px-2 py-1 text-xs text-gray-200 outline-none ring-1 ring-edge transition focus:ring-brass-500/60";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${fieldCls} flex-1`}
      />
      {rich && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t("instanceSettings.export.modal.fmt_expand")}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
        >
          <Maximize2 size={11} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            className="modal-overlay fixed inset-0 z-[70] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div className="flex max-h-[80vh] w-[520px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/40 bg-ink-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
                <h3 className="flex items-center gap-2 text-sm tracking-wide text-gray-100">
                  <Pencil size={13} className="text-brass-400" />
                  {t("instanceSettings.export.modal.descEditorTitle")}
                </h3>
                <button
                  onClick={() => setOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <RichDescription
                  value={value}
                  onChange={onChange}
                  placeholder={placeholder}
                  rich
                  rows={9}
                />
                <p className="mt-2 text-[10px] leading-snug text-ink-600">
                  {t("instanceSettings.export.modal.allowedTagsHint")}
                </p>
              </div>
              <div className="flex justify-end border-t border-edge px-4 py-2.5">
                <button
                  onClick={() => setOpen(false)}
                  className="brass-btn rounded-lg bg-brass-500 px-4 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400"
                >
                  {t("instanceSettings.export.modal.done")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function FlavorGroupsEditor({
  groups,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  onAddChoice,
  onUpdateChoice,
  onSetDefault,
  onRemoveChoice,
}: {
  groups: FlavorGroupSpec[];
  onAddGroup: () => void;
  onUpdateGroup: (id: string, patch: Partial<FlavorGroupSpec>) => void;
  onRemoveGroup: (id: string) => void;
  onAddChoice: (groupId: string) => void;
  onUpdateChoice: (
    groupId: string,
    choiceId: string,
    patch: Partial<FlavorChoiceSpec>,
  ) => void;
  onSetDefault: (groupId: string, choiceId: string) => void;
  onRemoveChoice: (groupId: string, choiceId: string) => void;
}) {
  const t = useT();
  const smallInput =
    "min-w-0 rounded-md bg-ink-950/70 px-2 py-1 text-xs outline-none ring-1 ring-edge transition focus:ring-brass-500/60";
  return (
    <div className="flex flex-col gap-2.5">
      {groups.length === 0 && (
        <p className="text-[11px] leading-snug text-ink-600">
          {t("instanceSettings.export.modal.flavorGroupsEmpty")}
        </p>
      )}
      {groups.map((g) => (
        <div
          key={g.id}
          className="rounded-lg border border-edge bg-ink-950/40 p-2.5"
        >
          <div className="flex items-center gap-1.5">
            <input
              value={g.name}
              onChange={(e) => onUpdateGroup(g.id, { name: e.target.value })}
              placeholder={t("instanceSettings.export.modal.groupNamePlaceholder")}
              className={`${smallInput} flex-1 font-medium`}
            />
            <div className="flex items-center gap-1">
              {(["both", "client"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onUpdateGroup(g.id, { side: s })}
                  className={`rounded-md border px-1.5 py-1 text-[10px] transition ${
                    g.side === s
                      ? "border-brass-500 bg-brass-500/15 text-brass-200"
                      : "border-edge text-ink-600 hover:border-brass-600/40"
                  }`}
                >
                  {t(`instanceSettings.export.modal.side_${s}`)}
                </button>
              ))}
            </div>
            <button
              onClick={() => onRemoveGroup(g.id)}
              title={t("instanceSettings.export.modal.removeGroup")}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-600 transition hover:text-red-300"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="mt-1.5">
            <ExpandableDescription
              value={g.description}
              onChange={(v) => onUpdateGroup(g.id, { description: v })}
              placeholder={t("instanceSettings.export.modal.groupDescPlaceholder")}
              rich
            />
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            {g.choices.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5">
                <button
                  onClick={() => onSetDefault(g.id, c.id)}
                  title={t("instanceSettings.export.modal.defaultChoice")}
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition ${
                    c.default
                      ? "border-brass-500 bg-brass-500"
                      : "border-ink-600 hover:border-brass-500"
                  }`}
                >
                  {c.default && (
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-950" />
                  )}
                </button>
                <input
                  value={c.name}
                  onChange={(e) =>
                    onUpdateChoice(g.id, c.id, { name: e.target.value })
                  }
                  placeholder={t(
                    "instanceSettings.export.modal.choiceNamePlaceholder",
                  )}
                  className={`${smallInput} w-28 shrink-0`}
                />
                <div className="min-w-0 flex-1">
                  <ExpandableDescription
                    value={c.description}
                    onChange={(v) =>
                      onUpdateChoice(g.id, c.id, { description: v })
                    }
                    placeholder={t(
                      "instanceSettings.export.modal.choiceDescPlaceholder",
                    )}
                    rich
                  />
                </div>
                <button
                  onClick={() => onRemoveChoice(g.id, c.id)}
                  disabled={g.choices.length <= 2}
                  title={t("instanceSettings.export.modal.removeChoice")}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-600 transition hover:text-red-300 disabled:opacity-30"
                >
                  <Minus size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => onAddChoice(g.id)}
            className="mt-2 flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Plus size={11} />
            {t("instanceSettings.export.modal.addChoice")}
          </button>
        </div>
      ))}
      <button
        onClick={onAddGroup}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-gray-300 transition hover:border-brass-600/40 hover:text-brass-300"
      >
        <Plus size={13} />
        {t("instanceSettings.export.modal.addGroup")}
      </button>
    </div>
  );
}
