"use client";

import { Settings, Plus, Box, Star, Circle, Loader2, X } from "lucide-react";
import * as api from "@/lib/api";
import type { Instance } from "@/lib/types";

const LOADER_LABEL: Record<string, string> = {
  neo_forge: "NeoForge",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  vanilla: "Vanilla",
};

function loaderLabel(i: Instance): string {
  return LOADER_LABEL[i.loader] ?? i.loader;
}

export function InstancesView({
  instances,
  selectedId,
  runningId,
  installingId,
  onCancelInstall,
  onSelect,
  onOpenSettings,
  onStar,
  onAdd,
}: {
  instances: Instance[];
  selectedId: string | null;
  runningId: string | null;
  installingId?: string | null;
  onCancelInstall?: () => void;
  onSelect: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onStar: (instance: Instance) => void;
  onAdd: () => void;
}) {
  const featured = instances.filter((i) => i.featured);
  const custom = instances
    .filter((i) => !i.featured)
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

  const card = (i: Instance) => (
    <InstanceCard
      key={i.id}
      instance={i}
      selected={i.id === selectedId}
      running={i.id === runningId}
      installing={i.id === installingId}
      onCancelInstall={onCancelInstall}
      onSelect={() => onSelect(i.id)}
      onSettings={() => onOpenSettings(i.id)}
      onStar={() => onStar(i)}
    />
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4">
        <h1 className="font-mc text-2xl tracking-wide text-gray-100">Instances</h1>
        <button
          onClick={onAdd}
          className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
        >
          <Plus size={16} /> New instance
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {featured.length > 0 && (
          <Section title="Featured" icon={<Star size={13} />}>
            {featured.map(card)}
          </Section>
        )}
        <Section title="Your instances" icon={<Box size={13} />}>
          {custom.map(card)}
          <button
            onClick={onAdd}
            className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge text-ink-600 transition hover:border-brass-600/50 hover:text-brass-300"
          >
            <Plus size={22} />
            <span className="text-sm">New instance</span>
          </button>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brass-400/80">
        {icon}
        {title}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {children}
      </div>
    </section>
  );
}

function InstanceCard({
  instance,
  selected,
  running,
  installing,
  onCancelInstall,
  onSelect,
  onSettings,
  onStar,
}: {
  instance: Instance;
  selected: boolean;
  running: boolean;
  installing?: boolean;
  onCancelInstall?: () => void;
  onSelect: () => void;
  onSettings: () => void;
  onStar: () => void;
}) {
  return (
    <div
      onClick={installing ? undefined : onSelect}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-ink-900/40 transition ${
        installing
          ? "border-brass-500/40 cursor-default"
          : selected
            ? "border-brass-500/60 glow cursor-pointer"
            : "border-edge hover:border-brass-600/40 cursor-pointer"
      }`}
    >
      {installing && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-ink-950/75 backdrop-blur-[1px]">
          <Loader2 size={22} className="animate-spin text-brass-300" />
          <span className="font-mc text-[11px] tracking-wide text-brass-200">
            Downloading…
          </span>
          {onCancelInstall && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancelInstall();
              }}
              className="mt-1 flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20"
            >
              <X size={12} /> Cancel
            </button>
          )}
        </div>
      )}
      <div className="relative flex h-24 items-center justify-center overflow-hidden">
        {instance.banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={instance.banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="schem-bg absolute inset-0" />
        )}
        <div className="absolute inset-0 bg-linear-to-b from-transparent to-ink-900/85" />
        {instance.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={instance.icon}
            alt=""
            className="relative h-14 w-14 rounded-lg object-cover shadow-lg"
          />
        ) : (
          <span className="relative grid h-14 w-14 place-items-center rounded-lg border border-edge bg-ink-950/60 text-brass-400">
            <Box size={26} />
          </span>
        )}

        {}
        {!instance.featured && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStar();
            }}
            title={instance.pinned ? "Unpin" : "Pin to top"}
            className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border transition ${
              instance.pinned
                ? "border-brass-500/50 bg-brass-500/20 text-brass-300"
                : "border-edge bg-ink-950/60 text-ink-600 opacity-0 hover:text-brass-300 group-hover:opacity-100"
            }`}
          >
            <Star size={13} className={instance.pinned ? "fill-current" : ""} />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="truncate font-mc text-sm text-gray-100" title={instance.name}>
          {instance.name}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-600">
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-brass-300/90">
            {loaderLabel(instance)}
          </span>
          <span>{instance.minecraft_version}</span>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              running
                ? "border border-patina-500/40 bg-patina-500/10 text-patina-300"
                : selected
                  ? "border border-brass-500/50 bg-brass-500/15 text-brass-200"
                  : "brass-btn bg-brass-500 text-ink-950 hover:bg-brass-400"
            }`}
          >
            {running ? (
              <>
                <Circle size={9} className="animate-pulse fill-current" /> Running
              </>
            ) : selected ? (
              "Selected"
            ) : (
              "Select"
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSettings();
            }}
            title="Instance settings"
            className="grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
