"use client";

import { useEffect, useRef, useState } from "react";
import { UserRound, Check, LogOut, ChevronUp } from "lucide-react";
import type { Account, AccountStore } from "@/lib/types";
import { avatarUrl } from "@/lib/api";

function Avatar({ account, size }: { account: Account; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !account.uuid) {
    let h = 0;
    for (const ch of account.username) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return (
      <span
        className="grid place-items-center rounded-md font-bold text-white/90"
        style={{
          width: size,
          height: size,
          background: `hsl(${h} 45% 45%)`,
          fontSize: size * 0.45,
        }}
      >
        {account.username.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl(account.uuid, size * 2)}
      alt={account.username}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded-md"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

export function AccountMenu({
  store,
  onSelect,
  onRemove,
  onMicrosoftLogin,
}: {
  store: AccountStore;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMicrosoftLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active =
    store.accounts.find((a) => a.id === store.selected) ?? store.accounts[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {open && (
        <div className="absolute bottom-[60px] left-0 right-0 rise rounded-lg border border-brass-700/30 bg-ink-850 p-2 shadow-2xl shadow-black/60">
          <div className="px-2 py-1 font-mc text-[10px] uppercase tracking-[0.2em] text-brass-400/70">
            Accounts
          </div>
          <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
            {store.accounts.map((a) => {
              const isActive = a.id === active?.id;
              return (
                <div
                  key={a.id}
                  className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 transition ${
                    isActive
                      ? "border-brass-600/40 bg-brass-500/10"
                      : "border-transparent hover:bg-ink-800/70"
                  }`}
                >
                  <Avatar account={a} size={26} />
                  <button
                    className="flex-1 truncate text-left text-sm"
                    onClick={() => onSelect(a.id)}
                  >
                    <span className="text-gray-100">{a.username}</span>
                    <span className="ml-1.5 text-[10px] text-ink-600">
                      Microsoft
                    </span>
                  </button>
                  {isActive && <Check size={14} className="text-brass-400" />}
                  <button
                    className="opacity-0 transition group-hover:opacity-100"
                    onClick={() => onRemove(a.id)}
                    title="Sign out"
                  >
                    <LogOut
                      size={13}
                      className="text-ink-600 hover:text-red-400"
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              onMicrosoftLogin();
            }}
            className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-[#2d7d2d]/40 bg-[#107c10]/15 px-2 py-2 text-sm text-[#7fe07f] transition hover:bg-[#107c10]/25"
          >
            <MicrosoftLogo /> Sign in with Microsoft
          </button>

          {store.accounts.length === 0 && (
            <p className="mt-1.5 px-1 pb-0.5 text-[11px] leading-snug text-ink-600">
              A Microsoft account is required to play on Brassworks.
            </p>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2.5 rounded-lg border bg-ink-850/70 px-2.5 py-2 text-left transition ${
          open
            ? "border-brass-600/50"
            : "border-edge hover:border-brass-600/40"
        }`}
      >
        {active ? (
          <Avatar account={active} size={32} />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink-800 text-ink-600">
            <UserRound size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-100">
            {active ? active.username : "No account"}
          </div>
          <div className="text-[10px] text-ink-600">
            {active ? "Click to switch" : "Add one to play"}
          </div>
        </div>
        <ChevronUp
          size={15}
          className={`text-ink-600 transition-transform ${open ? "" : "rotate-180"}`}
        />
      </button>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 23 23" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}
