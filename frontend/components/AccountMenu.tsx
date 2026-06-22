import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  UserRound,
  Check,
  LogOut,
  MoreHorizontal,
  AlertTriangle,
  X,
  Plus,
  RefreshCw,
  Cookie,
  Loader2,
  Lock,
} from "lucide-react";
import type { Account, AccountStatus, AccountStore } from "@/lib/types";
import {
  avatarUrl,
  getFaceTexture,
  subscribeFaceTextures,
  accountStatus as fetchAccountStatus,
  clearMsLoginCookies,
  isTauri,
} from "@/lib/api";
import { useClosable } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";


function FaceImage({ url, size }: { url: string; size: number }) {
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
      ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, cv.width, cv.height);
      ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, cv.width, cv.height);
    };
    img.src = url;
  }, [url]);
  return (
    <canvas
      ref={ref}
      width={size * 2}
      height={size * 2}
      className="rounded-md"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

function Avatar({
  account,
  size,
  version = 0,
}: {
  account: Account;
  size: number;
  version?: number;
}) {
  const [failed, setFailed] = useState(false);
  const faceTex = useSyncExternalStore(
    subscribeFaceTextures,
    () => getFaceTexture(account.id),
    () => undefined,
  );
  useEffect(() => setFailed(false), [version]);
  if (faceTex) return <FaceImage url={faceTex} size={size} />;
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
    <img
      src={`${avatarUrl(account.uuid, size * 2)}?v=${version}`}
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
  avatarVersion = 0,
  activeId,
  overridden = false,
  onSelect,
  onRemove,
  onMicrosoftLogin,
  onAddOffline,
  recheckSignal = 0,
}: {
  store: AccountStore;
  avatarVersion?: number;
  activeId?: string | null;
  overridden?: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMicrosoftLogin: () => void;
  onAddOffline: (username: string) => Promise<void> | void;

  recheckSignal?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({});

  const [recheckNonce, setRecheckNonce] = useState(0);
  const [checking, setChecking] = useState(false);

  const effectiveSelected = activeId ?? store.selected;
  const active =
    store.accounts.find((a) => a.id === effectiveSelected) ?? store.accounts[0];

  
  
  
  const msIds = store.accounts
    .filter((a) => a.kind === "microsoft")
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const ids = msIds ? msIds.split(",") : [];
    if (ids.length === 0) {
      setChecking(false);
      return;
    }
    setChecking(true);
    Promise.all(
      ids.map((id) =>
        fetchAccountStatus(id)
          .then((s) => alive && setStatuses((m) => ({ ...m, [id]: s })))
          .catch(() => {}),
      ),
    ).finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [msIds, recheckNonce, recheckSignal]);

  const needsRelogin = (id: string) => statuses[id] === "needs_relogin";

  return (
    <>
      {open && (
        <AccountsModal
          store={store}
          selectedId={effectiveSelected}
          overridden={overridden}
          avatarVersion={avatarVersion}
          statuses={statuses}
          checking={checking}
          onClose={() => setOpen(false)}
          onSelect={onSelect}
          onRemove={onRemove}
          onMicrosoftLogin={onMicrosoftLogin}
          onAddOffline={onAddOffline}
          onRecheck={() => setRecheckNonce((n) => n + 1)}
        />
      )}

      <button
        onClick={() => setOpen(true)}
        title={t("account.manageAccounts")}
        className={`group flex w-full items-center gap-2.5 rounded-lg border bg-ink-850/70 px-2.5 py-2 text-left transition ${
          open ? "border-brass-600/50" : "border-edge hover:border-brass-600/40"
        }`}
      >
        {active ? (
          <Avatar account={active} size={32} version={avatarVersion} />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink-800 text-ink-600">
            <UserRound size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-100">
            {active ? active.username : t("account.noAccount")}
          </div>
          <div
            className={`flex items-center gap-1 text-[10px] ${
              active && needsRelogin(active.id)
                ? "text-amber-400"
                : overridden && active
                  ? "text-brass-400/90"
                  : "text-ink-600"
            }`}
          >
            {active && needsRelogin(active.id) ? (
              <>
                <AlertTriangle size={10} /> {t("account.reloginRequired")}
              </>
            ) : overridden && active ? (
              <>
                <Lock size={10} /> {t("account.instanceOverride")}
              </>
            ) : active ? (
              t("account.manageAccounts")
            ) : (
              t("account.addToPlay")
            )}
          </div>
        </div>
        <span
          title={t("account.manageAccounts")}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-600 transition group-hover:bg-ink-800/70 group-hover:text-brass-300"
        >
          <MoreHorizontal size={16} />
        </span>
      </button>
    </>
  );
}

function AccountsModal({
  store,
  selectedId,
  overridden,
  avatarVersion,
  statuses,
  checking,
  onClose,
  onSelect,
  onRemove,
  onMicrosoftLogin,
  onAddOffline,
  onRecheck,
}: {
  store: AccountStore;
  selectedId: string | null;
  overridden: boolean;
  avatarVersion: number;
  statuses: Record<string, AccountStatus>;
  checking: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMicrosoftLogin: () => void;
  onAddOffline: (username: string) => Promise<void> | void;
  onRecheck: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);
  const [offlineName, setOfflineName] = useState("");
  const [addingOffline, setAddingOffline] = useState(false);
  const [clearing, setClearing] = useState(false);

  const active =
    store.accounts.find((a) => a.id === selectedId) ?? store.accounts[0];
  const needsRelogin = (id: string) => statuses[id] === "needs_relogin";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const addOffline = async () => {
    const name = offlineName.trim();
    if (!name || addingOffline) return;
    setAddingOffline(true);
    try {
      await onAddOffline(name);
      setOfflineName("");
    } finally {
      setAddingOffline(false);
    }
  };

  const clearCookies = async () => {
    setClearing(true);
    try {
      await clearMsLoginCookies();
      toast(t("account.cookiesResetToast"), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className={`modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="rise flex max-h-[80vh] w-[460px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="flex items-center gap-2 font-mc text-base tracking-wide text-gray-100">
            <UserRound size={17} className="text-brass-400" /> {t("account.accounts")}
          </h2>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-600 transition hover:bg-ink-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          {}
          <div className="-mr-1 max-h-[40vh] min-h-0 overflow-y-auto pr-1">
          {store.accounts.length === 0 ? (
            <p className="rounded-lg border border-edge bg-ink-950/40 px-3 py-4 text-center text-xs text-ink-600">
              {t("account.noAccounts")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {store.accounts.map((a) => {
                const isActive = a.id === active?.id;
                return (
                  <div
                    key={a.id}
                    className={`group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition ${
                      isActive
                        ? "border-brass-600/40 bg-brass-500/10"
                        : "border-edge hover:bg-ink-800/60"
                    }`}
                  >
                    <Avatar account={a} size={32} version={avatarVersion} />
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelect(a.id)}
                    >
                      <div className="truncate text-sm text-gray-100">
                        {a.username}
                      </div>
                      <div className="text-[10px] text-ink-600">
                        {a.kind === "offline" ? t("account.offlineAccount") : t("account.microsoft")}
                        {isActive
                          ? ` · ${overridden ? t("account.instanceOverride") : t("account.active")}`
                          : ""}
                      </div>
                    </button>
                    {needsRelogin(a.id) && (
                      <button
                        onClick={onMicrosoftLogin}
                        title={t("account.reloginTitle")}
                        className="flex shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 transition hover:bg-amber-500/25"
                      >
                        <AlertTriangle size={11} /> {t("account.relogin")}
                      </button>
                    )}
                    {isActive && !needsRelogin(a.id) && (
                      <Check size={15} className="shrink-0 text-brass-400" />
                    )}
                    <button
                      onClick={() => onRemove(a.id)}
                      title={t("account.signOut")}
                      className="shrink-0 opacity-0 transition group-hover:opacity-100"
                    >
                      <LogOut size={14} className="text-ink-600 hover:text-red-400" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          </div>

          <button
            onClick={onMicrosoftLogin}
            className="shrink-0 flex w-full items-center justify-center gap-2 rounded-md border border-edge bg-ink-950/70 px-2 py-2 text-sm font-medium text-gray-100 transition hover:border-brass-600/40 hover:bg-ink-900"
          >
            <MicrosoftLogo /> {t("account.signInMicrosoft")}
          </button>

          <div className="shrink-0 rounded-lg border border-edge bg-ink-950/40 p-3">
            <div className="mb-1.5 text-xs font-medium text-ink-500">
              {t("account.addOffline")}
            </div>
            <div className="flex gap-2">
              <input
                value={offlineName}
                onChange={(e) => setOfflineName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOffline()}
                placeholder={t("account.username")}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md bg-ink-950/70 px-3 py-1.5 text-sm outline-none ring-1 ring-edge focus:ring-brass-500/60"
              />
              <button
                onClick={addOffline}
                disabled={!offlineName.trim() || addingOffline}
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brass-400 disabled:opacity-50"
              >
                {addingOffline ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Plus size={13} />
                )}
                {t("common.add")}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-600">
              {t("account.offlineHint")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-edge px-5 py-3">
          <button
            onClick={onRecheck}
            disabled={checking}
            title={t("account.recheckTitle")}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
          >
            <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
            {t("account.recheck")}
          </button>
          <button
            onClick={clearCookies}
            disabled={clearing}
            title={t("account.clearCookiesTitle")}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-600 transition hover:border-brass-600/40 hover:text-brass-300 disabled:opacity-50"
          >
            {clearing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Cookie size={13} />
            )}
            {t("account.clearCookies")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 23 23"
      aria-hidden
      style={{ filter: "saturate(0.62)" }}
    >
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}
