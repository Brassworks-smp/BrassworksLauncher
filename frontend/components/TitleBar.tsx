import { useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "@/lib/i18n";

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function TitleBar() {
  const showControls = inTauri && !isMac;
  return (
    <div
      data-tauri-drag-region
      className="relative flex h-7 shrink-0 items-center justify-center border-b border-edge bg-ink-850"
    >
      <span className="pointer-events-none font-mc text-[11px] tracking-[0.25em] text-gray-500">
        BRASSWORKS
      </span>
      {showControls && <WindowControls />}
    </div>
  );
}

function WindowControls() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const un = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      un.then((u) => u()).catch(() => {});
    };
  }, []);

  const win = () => getCurrentWindow();
  return (
    <div className="absolute right-0 top-0 flex h-full items-stretch">
      <Ctrl onClick={() => win().minimize().catch(() => {})} label={t("titleBar.minimize")}>
        <Minus size={14} />
      </Ctrl>
      <Ctrl
        onClick={() => win().toggleMaximize().catch(() => {})}
        label={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
      >
        {maximized ? <Copy size={11} /> : <Square size={11} />}
      </Ctrl>
      <Ctrl
        onClick={() => win().close().catch(() => {})}
        label={t("common.close")}
        danger
      >
        <X size={15} />
      </Ctrl>
    </div>
  );
}

function Ctrl({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex w-11 items-center justify-center text-ink-600 transition-colors ${
        danger
          ? "hover:bg-red-500 hover:text-white"
          : "hover:bg-ink-700 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
