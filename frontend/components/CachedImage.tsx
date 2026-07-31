import {
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type ReactEventHandler,
} from "react";
import * as api from "@/lib/api";

const resolvedCache = new Map<string, string | null>();
const warming = new Set<string>();

const isRemote = (value: string) => /^https?:\/\//i.test(value);

function localSrc(path: string): string {
  try {
    return api.fileSrc(path);
  } catch {
    return path;
  }
}

type CachedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
};

/** Prefer the launcher's on-disk image cache, then warm it after a remote load. */
export function CachedImage({ src, onLoad, onError, ...props }: CachedImageProps) {
  const cacheable = api.isTauri() && isRemote(src);
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!cacheable) return src;
    return resolvedCache.get(src) ?? null;
  });

  useEffect(() => {
    let alive = true;
    if (!cacheable) {
      setResolved(src);
      return () => {
        alive = false;
      };
    }

    const known = resolvedCache.get(src);
    if (known) {
      setResolved(known);
      return () => {
        alive = false;
      };
    }

    setResolved(null);
    api
      .cachedImage(src)
      .then((path) => {
        if (!alive) return;
        const next = path ? localSrc(path) : null;
        resolvedCache.set(src, next);
        setResolved(next ?? src);
      })
      .catch(() => alive && setResolved(src));

    return () => {
      alive = false;
    };
  }, [cacheable, src]);

  const handleLoad: ReactEventHandler<HTMLImageElement> = (event) => {
    if (cacheable && resolved === src && !warming.has(src)) {
      warming.add(src);
      void api
        .cacheImages([src])
        .then(() => api.cachedImage(src))
        .then((path) => resolvedCache.set(src, path ? localSrc(path) : null))
        .catch(() => {});
    }
    onLoad?.(event);
  };

  const handleError: ReactEventHandler<HTMLImageElement> = (event) => {
    if (cacheable && resolved !== src) {
      resolvedCache.set(src, null);
      setResolved(src);
      return;
    }
    onError?.(event);
  };

  if (!resolved) return null;
  return (
    <img
      {...props}
      src={resolved}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
