"use client";

import { useEffect, useRef, useState } from "react";

type TipState = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};


export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);
  const stored = useRef<string>("");
  const timer = useRef<number>(0);

  useEffect(() => {
    const DELAY = 420;

    const clearTimer = () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = 0;
      }
    };

    
    const restore = () => {
      const el = activeEl.current;
      if (el && stored.current && el.isConnected) {
        el.setAttribute("title", stored.current);
      }
      activeEl.current = null;
      stored.current = "";
    };

    const hide = () => {
      clearTimer();
      restore();
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const start = e.target as HTMLElement | null;
      const target = start?.closest?.("[title]") as HTMLElement | null;
      if (!target) return;
      if (target === activeEl.current) return;
      const text = target.getAttribute("title")?.trim();
      if (!text) return;

      
      hide();

      activeEl.current = target;
      stored.current = text;
      target.removeAttribute("title");

      timer.current = window.setTimeout(() => {
        const el = activeEl.current;
        if (!el || !el.isConnected) return hide();
        const r = el.getBoundingClientRect();
        const placement = r.top < 48 ? "bottom" : "top";
        setTip({
          text,
          x: r.left + r.width / 2,
          y: placement === "top" ? r.top : r.bottom,
          placement,
        });
      }, DELAY);
    };

    const onOut = (e: MouseEvent) => {
      const el = activeEl.current;
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return; 
      hide();
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
      clearTimer();
    };
  }, []);

  if (!tip) return null;

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[200] max-w-xs rounded-md border border-edge bg-ink-950/95 px-2 py-1 text-xs leading-snug text-gray-100 shadow-lg backdrop-blur-sm tip-fade"
      style={{
        left: tip.x,
        top: tip.placement === "top" ? tip.y - 8 : tip.y + 8,
        transform:
          tip.placement === "top"
            ? "translate(-50%, -100%)"
            : "translate(-50%, 0)",
      }}
    >
      {tip.text}
    </div>
  );
}
