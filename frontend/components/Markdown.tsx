import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import * as api from "@/lib/api";

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) api.openExternal(href).catch(() => {});
              }}
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Changelog({
  instanceId,
  projectId,
  versionId,
  source,
}: {
  instanceId: string;
  projectId: string;
  versionId: string;
  source: string;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .contentChangelog(instanceId, projectId, versionId, source)
      .then((t) => alive && setText(t))
      .catch(() => alive && setText("_Couldn't load changelog._"));
    return () => {
      alive = false;
    };
  }, [instanceId, projectId, versionId, source]);
  return (
    <div className="border-t border-edge/60 bg-ink-950/30 px-4 py-3">
      {text === null ? (
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <Loader2 size={13} className="animate-spin" /> Loading changelog…
        </div>
      ) : (
        <Markdown className="text-[12px]">{text}</Markdown>
      )}
    </div>
  );
}
