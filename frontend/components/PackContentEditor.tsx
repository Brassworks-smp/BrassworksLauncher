import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, KeyRound, Copy } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import * as api from "@/lib/api";
import { BrassSwitch } from "./ui";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { getCachedInfo, setCachedInfo } from "@/lib/modcache";
import {
  CollapsibleSection,
  SearchBox,
  SmallBtn,
  ModRow,
  TreeRow,
  FlavorGroupsEditor,
  leafPaths,
  defaultLeaves,
  allChoices,
  slugify,
  uniqueId,
} from "./ExportModal";
import type {
  ExportNode,
  ExportTree,
  FlavorChoiceSpec,
  FlavorGroupSpec,
} from "@/lib/types";

export interface PackContentValue {
  mods: string[];
  files: string[];
  known_mods: string[];
  optional: Record<string, { default: boolean; description: string }>;
  flavor_groups: FlavorGroupSpec[];
  flavor_assignments: Record<string, string[]>;
  unsup: boolean;
  sign: boolean;
  sign_format: string;
}

export function PackContentEditor({
  instanceId,
  initial,
  onChange,
}: {
  instanceId: string;
  initial?: PackContentValue | null;
  onChange: (v: PackContentValue) => void;
}) {
  const t = useT();
  const [tree, setTree] = useState<ExportTree | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [selectedMods, setSelectedMods] = useState<Set<string>>(
    new Set(initial?.mods ?? []),
  );
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    new Set(initial?.files ?? []),
  );
  const [knownMods, setKnownMods] = useState<Set<string>>(
    new Set(initial?.known_mods ?? []),
  );
  const [optional, setOptional] = useState<
    Record<string, { default: boolean; description: string }>
  >({ ...(initial?.optional ?? {}) });
  const [flavorGroups, setFlavorGroups] = useState<FlavorGroupSpec[]>(
    initial?.flavor_groups ?? [],
  );
  const [flavorAssign, setFlavorAssign] = useState<Record<string, string[]>>({
    ...(initial?.flavor_assignments ?? {}),
  });
  const [unsupEnabled, setUnsupEnabled] = useState(initial?.unsup ?? false);
  const [sign, setSign] = useState(initial?.sign ?? false);
  const [signFormat, setSignFormat] = useState(initial?.sign_format || "signify");

  const [modsOpen, setModsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [modQuery, setModQuery] = useState("");
  const [query, setQuery] = useState("");
  const [pubKey, setPubKey] = useState("");

  const seeded = useRef(false);
  const loadTree = useCallback(() => {
    setRefreshing(true);
    api
      .exportTree(instanceId)
      .then((tr) => {
        setTree(tr);
        const allPaths = tr.mods.map((m) => m.path);
        if (!seeded.current) {
          seeded.current = true;
          if (!initial) {
            setSelectedMods(
              new Set(tr.mods.filter((m) => m.enabled).map((m) => m.path)),
            );
            const leaves: string[] = [];
            defaultLeaves(tr.files, leaves);
            setSelectedFiles(new Set(leaves));
            setKnownMods(new Set(allPaths));
          } else {
            const baseline = new Set(
              initial.known_mods?.length ? initial.known_mods : allPaths,
            );
            const fresh = allPaths.filter((p) => !baseline.has(p));
            if (fresh.length)
              setSelectedMods((prev) => new Set([...prev, ...fresh]));
            setKnownMods(new Set(allPaths));
          }
        } else {
          setKnownMods((prevKnown) => {
            const fresh = allPaths.filter((p) => !prevKnown.has(p));
            if (fresh.length)
              setSelectedMods((prevSel) => new Set([...prevSel, ...fresh]));
            return new Set([...prevKnown, ...allPaths]);
          });
        }
      })
      .catch((e) => toast(String(e), "error"))
      .finally(() => setRefreshing(false));
  }, [instanceId, initial]);

  useEffect(() => loadTree(), [loadTree]);

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
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      alive = false;
    };
  }, [tree, instanceId]);

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

  const flavorChoiceRefs = useMemo(() => allChoices(flavorGroups), [flavorGroups]);

  const remappedFlavors = useCallback(() => {
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
      const mapped = ids.map((x) => idMap.get(x)).filter((x): x is string => !!x);
      if (mapped.length) assignments[path] = mapped;
    }
    return { groups, assignments };
  }, [flavorGroups, flavorAssign, selectedMods]);

  useEffect(() => {
    const optOut: Record<string, { default: boolean; description: string }> = {};
    const assigned = new Set(
      unsupEnabled
        ? Object.keys(flavorAssign).filter((p) => flavorAssign[p]?.length)
        : [],
    );
    for (const [path, spec] of Object.entries(optional)) {
      if (selectedMods.has(path) && !assigned.has(path)) optOut[path] = spec;
    }
    const flavor = unsupEnabled
      ? remappedFlavors()
      : { groups: [], assignments: {} };
    onChange({
      mods: [...selectedMods],
      files: [...selectedFiles],
      known_mods: [...knownMods],
      optional: optOut,
      flavor_groups: flavor.groups,
      flavor_assignments: flavor.assignments,
      unsup: unsupEnabled,
      sign: unsupEnabled && sign,
      sign_format: signFormat,
    });
  }, [
    selectedMods,
    selectedFiles,
    knownMods,
    optional,
    flavorGroups,
    flavorAssign,
    unsupEnabled,
    sign,
    signFormat,
    onChange,
    remappedFlavors,
  ]);

  const toggleMod = useCallback((path: string) => {
    setSelectedMods((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const toggleDir = useCallback((node: ExportNode) => {
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
  const toggleOptional = useCallback((path: string) => {
    setOptional((prev) => {
      const next = { ...prev };
      if (next[path]) delete next[path];
      else next[path] = { default: true, description: "" };
      return next;
    });
  }, []);
  const setOptionalDefault = useCallback((path: string, def: boolean) => {
    setOptional((prev) => ({
      ...prev,
      [path]: { description: prev[path]?.description ?? "", default: def },
    }));
  }, []);
  const setOptionalDesc = useCallback((path: string, description: string) => {
    setOptional((prev) => ({
      ...prev,
      [path]: { default: prev[path]?.default ?? true, description },
    }));
  }, []);
  const toggleAssign = useCallback((path: string, choiceId: string) => {
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

  const addGroup = () => {
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
  const updateGroup = (id: string, patch: Partial<FlavorGroupSpec>) =>
    setFlavorGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const removeGroup = (id: string) =>
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
  const addChoice = (groupId: string) =>
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
  const updateChoice = (
    groupId: string,
    choiceId: string,
    patch: Partial<FlavorChoiceSpec>,
  ) =>
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
  const setChoiceDefault = (groupId: string, choiceId: string) =>
    setFlavorGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              choices: g.choices.map((c) => ({ ...c, default: c.id === choiceId })),
            }
          : g,
      ),
    );
  const removeChoice = (groupId: string, choiceId: string) => {
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

  const loadPubKey = useCallback(() => {
    api
      .unsupPublicKey(instanceId, signFormat)
      .then(setPubKey)
      .catch(() => setPubKey(""));
  }, [instanceId, signFormat]);
  useEffect(() => {
    if (unsupEnabled && sign) loadPubKey();
    else setPubKey("");
  }, [unsupEnabled, sign, loadPubKey]);

  const cfSelected = useMemo(
    () =>
      (tree?.mods ?? []).some(
        (m) => m.source === "curseforge" && selectedMods.has(m.path),
      ),
    [tree, selectedMods],
  );

  if (!tree) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="animate-spin text-ink-600" size={20} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-edge bg-ink-950/30 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-200">
            {t("share.editorUnsupTitle")}
          </span>
          <span className="block text-[11px] leading-snug text-ink-600">
            {t("share.editorUnsupDesc")}
          </span>
        </span>
        <BrassSwitch checked={unsupEnabled} onChange={setUnsupEnabled} />
      </label>

      {unsupEnabled && (
        <div className="rounded-lg border border-edge bg-ink-950/30 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <ShieldCheck size={16} className="shrink-0 text-brass-400" />
            <span className="min-w-0 flex-1 text-sm font-medium text-gray-200">
              {t("instanceSettings.export.modal.signTitle")}
            </span>
            <BrassSwitch checked={sign} onChange={setSign} />
          </label>
          {sign && (
            <div className="mt-3 flex flex-col gap-2.5 border-t border-edge pt-3">
              <div className="flex items-center gap-1.5">
                {(["signify", "ed25519"] as const).map((sf) => (
                  <button
                    key={sf}
                    onClick={() => setSignFormat(sf)}
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
                <div className="mt-2">
                  <SmallBtn
                    onClick={() => {
                      void navigator.clipboard?.writeText(`public_key=${pubKey}`);
                      toast(t("instanceSettings.export.modal.keyCopied"), "success");
                    }}
                  >
                    <span className="flex items-center gap-1">
                      <Copy size={11} />
                      {t("instanceSettings.export.modal.copy")}
                    </span>
                  </SmallBtn>
                </div>
              </div>
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

      <div className="flex items-center justify-end">
        <button
          onClick={() => loadTree()}
          disabled={refreshing}
          className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          {t("instanceSettings.export.modal.refresh")}
        </button>
      </div>

      {unsupEnabled && (
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
            placeholder={t("instanceSettings.export.modal.searchMods")}
          />
          <SmallBtn onClick={() => setSelectedMods(new Set(tree.mods.map((m) => m.path)))}>
            {t("instanceSettings.export.modal.selectAll")}
          </SmallBtn>
          <SmallBtn onClick={() => setSelectedMods(new Set())}>
            {t("instanceSettings.export.modal.selectNone")}
          </SmallBtn>
        </div>
        <div className="flex flex-col gap-1">
          {filteredMods.map((m) => (
            <ModRow
              key={m.path}
              mod={m}
              icon={icons[m.path]}
              checked={selectedMods.has(m.path)}
              optional={optional[m.path]}
              supportsMeta
              unsup={unsupEnabled}
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
            placeholder={t("instanceSettings.export.modal.search")}
          />
          <SmallBtn onClick={() => setSelectedFiles(new Set(allFileLeaves))}>
            {t("instanceSettings.export.modal.selectAll")}
          </SmallBtn>
          <SmallBtn onClick={() => setSelectedFiles(new Set())}>
            {t("instanceSettings.export.modal.selectNone")}
          </SmallBtn>
        </div>
        <div>
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
    </div>
  );
}
