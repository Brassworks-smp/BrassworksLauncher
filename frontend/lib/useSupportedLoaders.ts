import { useEffect, useState } from "react";
import * as api from "@/lib/api";



const cache = new Map<string, string[]>();


export function useSupportedLoaders(mc: string): {
  supported: string[] | null;
  loading: boolean;
} {
  const [supported, setSupported] = useState<string[] | null>(
    mc && cache.has(mc) ? cache.get(mc)! : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mc) {
      setSupported(null);
      setLoading(false);
      return;
    }
    const cached = cache.get(mc);
    if (cached) {
      setSupported(cached);
      setLoading(false);
      return;
    }
    let alive = true;
    setSupported(null);
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .supportedLoaders(mc)
        .then((s) => {
          if (!alive) return;
          cache.set(mc, s);
          setSupported(s);
        })
        .catch(() => alive && setSupported(null))
        .finally(() => alive && setLoading(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [mc]);

  return { supported, loading };
}
