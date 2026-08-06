import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Layers3,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import type {
  ExportNode,
  GlobalFileProfile,
  GlobalFilesApplyReport,
  Instance,
} from "@/lib/types";
import { toast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { Dropdown } from "./ui";

const inputClass =
  "rounded-lg border border-edge bg-ink-950/60 px-3 py-2 text-sm text-gray-200 outline-none transition focus:border-brass-500/60";

function profileId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile"
  );
}

function reportToast(report: GlobalFilesApplyReport, t: ReturnType<typeof useT>) {
  if (report.backups.length > 0) {
    toast(
      t("globalFiles.savedWithBackups", {
        count: report.backups.length,
      }),
      "success",
    );
  } else {
    toast(t("globalFiles.saved"), "success");
  }
}

function covered(path: string, selected: Set<string>): boolean {
  if (selected.has(path)) return true;
  const parts = path.split("/");
  while (parts.length > 1) {
    parts.pop();
    if (selected.has(parts.join("/"))) return true;
  }
  return false;
}

function hasSelectedChild(path: string, selected: Set<string>): boolean {
  const prefix = `${path}/`;
  return [...selected].some((item) => item.startsWith(prefix));
}

export function GlobalFilesView({
  instances,
  selectedInstanceId,
  onInstancesChanged,
  ensureSymlinkSupport,
}: {
  instances: Instance[];
  selectedInstanceId: string | null;
  onInstancesChanged: () => Promise<unknown>;
  ensureSymlinkSupport: () => Promise<boolean>;
}) {
  const t = useT();
  const [profiles, setProfiles] = useState<GlobalFileProfile[]>([]);
  const [activeId, setActiveId] = useState("default");
  const [sourceId, setSourceId] = useState(selectedInstanceId ?? instances[0]?.id ?? "");
  const [tree, setTree] = useState<ExportNode[]>([]);
  const [name, setName] = useState("Default");
  const [paths, setPaths] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const loadConfig = useCallback(async () => {
    const config = await api.globalFilesConfig();
    setProfiles(config.profiles);
    setActiveId((current) =>
      config.profiles.some((profile) => profile.id === current) ? current : "default",
    );
  }, []);

  useEffect(() => {
    loadConfig()
      .catch((error) => toast(String(error), "error"))
      .finally(() => setLoading(false));
  }, [loadConfig]);

  useEffect(() => {
    if (!sourceId) {
      setTree([]);
      return;
    }
    api.globalFilesTree(sourceId).then(setTree).catch((error) => toast(String(error), "error"));
  }, [sourceId]);

  useEffect(() => {
    if (creating) return;
    const profile = profiles.find((item) => item.id === activeId);
    if (!profile) return;
    setName(profile.name);
    setPaths(new Set(profile.paths));
    setDeleteConfirm(false);
  }, [activeId, creating, profiles]);

  const selectProfile = (profile: GlobalFileProfile) => {
    setCreating(false);
    setActiveId(profile.id);
    setName(profile.name);
    setPaths(new Set(profile.paths));
  };

  const toggle = (node: ExportNode) => {
    setPaths((current) => {
      const next = new Set(current);
      if (covered(node.rel_path, current) && !current.has(node.rel_path)) return current;
      if (current.has(node.rel_path)) {
        next.delete(node.rel_path);
      } else {
        for (const value of next) {
          if (value.startsWith(`${node.rel_path}/`)) next.delete(value);
        }
        next.add(node.rel_path);
      }
      return next;
    });
  };

  const save = async () => {
    if (!sourceId || !name.trim()) return;
    if (!(await ensureSymlinkSupport())) return;
    setBusy(true);
    try {
      let id = creating ? profileId(name) : activeId;
      if (creating) {
        const base = id;
        let suffix = 2;
        while (profiles.some((profile) => profile.id === id)) {
          id = `${base}-${suffix++}`;
        }
      }
      const report = await api.saveGlobalFilesProfile(
        { id, name: name.trim(), paths: [...paths] },
        sourceId,
      );
      setCreating(false);
      setActiveId(id);
      await loadConfig();
      await onInstancesChanged();
      reportToast(report, t);
    } catch (error) {
      toast(String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const removeProfile = async () => {
    if (!(await ensureSymlinkSupport())) return;
    setBusy(true);
    try {
      const report = await api.deleteGlobalFilesProfile(activeId);
      setActiveId("default");
      setDeleteConfirm(false);
      await loadConfig();
      await onInstancesChanged();
      reportToast(report, t);
    } catch (error) {
      toast(String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="grid flex-1 place-items-center text-sm text-ink-600"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link2 size={22} className="text-brass-400" />
            <h1 className="font-mc text-2xl tracking-wide text-gray-100">
              {t("globalFiles.title")}
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-600">
            {t("globalFiles.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => api.revealGlobalFilesConfig().catch((error) => toast(String(error), "error"))} className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300">
            <FileCode2 size={15} /> {t("globalFiles.openConfig")}
          </button>
          <button onClick={() => api.openGlobalFilesFolder().catch((error) => toast(String(error), "error"))} className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300">
            <FolderOpen size={15} /> {t("globalFiles.openFolder")}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-[210px_minmax(0,1fr)] items-start gap-3">
        <section className="row-span-2 flex flex-col rounded-xl border border-edge bg-ink-900/45 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-ink-600">{t("globalFiles.profiles")}</span>
            <button
              onClick={() => {
                setCreating(true);
                setActiveId("");
                setName(t("globalFiles.newProfileName"));
                setPaths(new Set());
              }}
              title={t("globalFiles.newProfile")}
              className="grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => selectProfile(profile)}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  !creating && activeId === profile.id
                    ? "border-brass-500/40 bg-brass-500/10 text-brass-200"
                    : "border-transparent text-ink-600 hover:border-edge hover:bg-ink-800/50 hover:text-gray-200"
                }`}
              >
                <div className="truncate text-sm font-medium">{profile.name}</div>
                <div className="mt-0.5 text-[11px] opacity-70">
                  {t("globalFiles.pathCount", { count: profile.paths.length })}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col rounded-xl border border-edge bg-ink-900/45 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-600">
              {t("globalFiles.profileName")}
              <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-600">
              {t("globalFiles.sourceInstance")}
              <Dropdown
                value={sourceId}
                onChange={setSourceId}
                options={instances.map((instance) => ({
                  value: instance.id,
                  label: instance.name,
                }))}
                placeholder={t("globalFiles.noInstances")}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-600">{t("globalFiles.sourceHint")}</p>
          <div className="relative mt-3">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("globalFiles.search")} className={`${inputClass} w-full pl-8`} />
          </div>
          <div className="mt-2 rounded-lg border border-edge bg-ink-950/35 p-2">
            {tree.length === 0 ? (
              <div className="grid h-full min-h-32 place-items-center text-center text-xs text-ink-600">{t("globalFiles.emptyTree")}</div>
            ) : (
              tree.map((node) => (
                <GlobalTreeRow key={node.rel_path} node={node} depth={0} query={query.toLowerCase()} selected={paths} onToggle={toggle} />
              ))
            )}
          </div>
          {paths.size > 0 && (
            <div className="mt-2 flex max-h-16 flex-wrap gap-1 overflow-y-auto">
              {[...paths].sort().map((path) => (
                <button
                  key={path}
                  onClick={() => setPaths((current) => {
                    const next = new Set(current);
                    next.delete(path);
                    return next;
                  })}
                  title={t("globalFiles.removePath", { path })}
                  className="flex max-w-full items-center gap-1 rounded-md border border-brass-600/25 bg-brass-500/[0.06] px-1.5 py-0.5 text-[10px] text-brass-200 transition hover:border-red-500/35 hover:text-red-300"
                >
                  <span className="truncate">{path}</span><X size={9} className="shrink-0" />
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-600">{t("globalFiles.selectedCount", { count: paths.size })}</span>
            <div className="flex gap-2">
              {!creating && activeId !== "default" && (
                deleteConfirm ? (
                  <>
                    <button onClick={() => setDeleteConfirm(false)} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-600">{t("common.cancel")}</button>
                    <button disabled={busy} onClick={removeProfile} className="flex items-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-ink-950"><Trash2 size={13} /> {t("globalFiles.confirmDelete")}</button>
                  </>
                ) : (
                  <button onClick={() => setDeleteConfirm(true)} className="grid h-9 w-9 place-items-center rounded-lg border border-red-500/25 text-red-300 transition hover:bg-red-500/10"><Trash2 size={14} /></button>
                )
              )}
              <button disabled={busy || !sourceId || !name.trim()} onClick={save} className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {t("globalFiles.saveProfile")}
              </button>
            </div>
          </div>
        </section>

        <section className="flex flex-col rounded-xl border border-edge bg-ink-900/45 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Layers3 size={16} className="text-brass-400" /> {t("globalFiles.instances")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">{t("globalFiles.instancesHint")}</p>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2">
            {instances.map((instance) => (
              <InstanceProfileCard key={instance.id} instance={instance} profiles={profiles} onChanged={onInstancesChanged} ensureSymlinkSupport={ensureSymlinkSupport} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function GlobalTreeRow({
  node,
  depth,
  query,
  selected,
  onToggle,
}: {
  node: ExportNode;
  depth: number;
  query: string;
  selected: Set<string>;
  onToggle: (node: ExportNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const matches = !query || node.rel_path.toLowerCase().includes(query);
  const childMatches = node.children.some((child) => deepMatch(child, query));
  if (!matches && !childMatches) return null;
  const exact = selected.has(node.rel_path);
  const inherited = covered(node.rel_path, selected) && !exact;
  const partial = !exact && !inherited && hasSelectedChild(node.rel_path, selected);
  const isOpen = open || !!query;
  return (
    <div>
      <div className={`flex items-center gap-1.5 rounded-md py-1 pr-1.5 text-sm transition hover:bg-ink-800/40 ${inherited ? "opacity-55" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}>
        <button onClick={() => onToggle(node)} title={inherited ? "Controlled by a selected parent folder" : undefined} className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${exact || inherited || partial ? "border-brass-500 bg-brass-500" : "border-ink-600"}`}>
          {(exact || inherited) && <Check size={11} strokeWidth={3} className="text-ink-950" />}
          {partial && <span className="h-0.5 w-2 bg-ink-950" />}
        </button>
        {node.is_dir ? (
          <button onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <ChevronRight size={13} className={`text-ink-600 transition ${isOpen ? "rotate-90" : ""}`} />
            {isOpen ? <FolderOpen size={14} className="text-brass-400" /> : <Folder size={14} className="text-brass-400" />}
            <span className="truncate text-gray-200">{node.name}</span>
            {exact && <span className="ml-auto rounded bg-brass-500/15 px-1.5 py-0.5 text-[9px] text-brass-300">folder link</span>}
          </button>
        ) : (
          <button onClick={() => onToggle(node)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <FileText size={13} className="text-ink-600" />
            <span className="truncate text-gray-300">{node.name}</span>
          </button>
        )}
      </div>
      {node.is_dir && isOpen && node.children.map((child) => (
        <GlobalTreeRow key={child.rel_path} node={child} depth={depth + 1} query={query} selected={selected} onToggle={onToggle} />
      ))}
    </div>
  );
}

function deepMatch(node: ExportNode, query: string): boolean {
  return !query || node.rel_path.toLowerCase().includes(query) || node.children.some((child) => deepMatch(child, query));
}

function InstanceProfileCard({
  instance,
  profiles,
  onChanged,
  ensureSymlinkSupport,
}: {
  instance: Instance;
  profiles: GlobalFileProfile[];
  onChanged: () => Promise<unknown>;
  ensureSymlinkSupport: () => Promise<boolean>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const current = instance.global_files_profile ?? "default";
  const update = async (enabled: boolean, profileId = current) => {
    if (enabled && !(await ensureSymlinkSupport())) return;
    setBusy(true);
    try {
      const report = await api.setInstanceGlobalFiles(instance.id, enabled, profileId);
      await onChanged();
      reportToast(report, t);
    } catch (error) {
      toast(String(error), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-edge bg-ink-950/35 p-3">
      <div className="flex items-center gap-2">
        <HardDrive size={14} className={instance.global_files_enabled ? "text-brass-400" : "text-ink-600"} />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{instance.name}</span>
        <button disabled={busy} onClick={() => update(!instance.global_files_enabled)} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${instance.global_files_enabled ? "border-brass-500/40 bg-brass-500/10 text-brass-300" : "border-edge text-ink-600"}`}>
          {busy ? <Loader2 size={10} className="animate-spin" /> : instance.global_files_enabled ? <Link2 size={10} /> : <Unlink size={10} />}
          {t(instance.global_files_enabled ? "globalFiles.on" : "globalFiles.off")}
        </button>
      </div>
      <div className="mt-2 text-xs">
        <Dropdown
          disabled={busy || !instance.global_files_enabled}
          value={current}
          onChange={(value) => update(true, value)}
          options={profiles.map((profile) => ({
            value: profile.id,
            label: profile.name,
          }))}
        />
      </div>
      {instance.global_files_enabled && (
        <button disabled={busy} onClick={async () => {
          if (!(await ensureSymlinkSupport())) return;
          setBusy(true);
          try {
            const report = await api.syncGlobalFiles(instance.id);
            reportToast(report, t);
          } catch (error) {
            toast(String(error), "error");
          } finally {
            setBusy(false);
          }
        }} className="mt-2 flex items-center gap-1 text-[11px] text-ink-600 transition hover:text-brass-300">
          <RefreshCw size={11} /> {t("globalFiles.repairLinks")}
        </button>
      )}
    </div>
  );
}
