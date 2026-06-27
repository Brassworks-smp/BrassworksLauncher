import { useMemo, useState } from "react";
import {
  X,
  FileDown,
  FileJson,
  FileText,
  FileCode,
  Sheet,
  FileType,
  Loader2,
  Check,
} from "lucide-react";
import * as api from "@/lib/api";
import { toast, toastProgress, dismissToast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { useClosable, Toggle } from "./ui";
import type { InstalledMod } from "@/lib/types";

type Format = "html" | "markdown" | "text" | "csv" | "json";
type Column = "version" | "filename" | "author" | "url";

const FORMATS: {
  id: Format;
  label: string;
  ext: string;
  icon: typeof FileText;
  embeds: boolean;
}[] = [
  { id: "html", label: "HTML", ext: "html", icon: FileCode, embeds: true },
  { id: "markdown", label: "Markdown", ext: "md", icon: FileType, embeds: true },
  { id: "text", label: "Plain text", ext: "txt", icon: FileText, embeds: false },
  { id: "csv", label: "CSV", ext: "csv", icon: Sheet, embeds: false },
  { id: "json", label: "JSON", ext: "json", icon: FileJson, embeds: false },
];

interface Row {
  name: string;
  version: string;
  filename: string;
  author: string;
  url: string;
  icon: string | null;
  body: string;
  source: string;
  category: string;
}

const ENRICH_CONCURRENCY = 6;

function contentUrl(m: InstalledMod): string {
  if (!m.project_id) return "";
  if (m.source === "curseforge")
    return `https://www.curseforge.com/projects/${m.project_id}`;
  if (m.source === "modrinth")
    return `https://modrinth.com/project/${m.project_id}`;
  return "";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ExportContentModal({
  packName,
  instanceId,
  mods,
  onClose,
}: {
  packName: string;
  instanceId: string;
  mods: InstalledMod[];
  onClose: () => void;
}) {
  const t = useT();
  const { closing, close } = useClosable(onClose);

  const [format, setFormat] = useState<Format>("html");
  const [cols, setCols] = useState<Record<Column, boolean>>({
    version: true,
    filename: true,
    author: true,
    url: true,
  });
  const [embed, setEmbed] = useState(false);
  const [busy, setBusy] = useState(false);

  const fmt = FORMATS.find((f) => f.id === format)!;
  const supportsEmbed = fmt.embeds;
  const embedOn = supportsEmbed && embed;

  const toggleCol = (c: Column) => setCols((p) => ({ ...p, [c]: !p[c] }));

  // Build the rows, fetching project detail only when author or embedding needs it.
  const buildRows = async (): Promise<Row[]> => {
    const needDetail = cols.author || embedOn;
    const base: Row[] = mods.map((m) => ({
      name: m.title || m.name,
      version: m.version ?? "",
      filename: m.filename,
      author: "",
      url: contentUrl(m),
      icon: m.icon_url,
      body: "",
      source: m.source,
      category: m.category,
    }));
    if (!needDetail) return base;

    const targets = mods
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.source !== "local" && !!m.project_id);
    const total = targets.length;
    const progressKey = `export-fetch:${instanceId}`;
    let done = 0;
    if (total > 0) toastProgress(progressKey, t("exportContent.fetching"), 0);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const { m, i } = targets[cursor++];
        try {
          const d = await api.contentDetail(instanceId, m.project_id!, m.source);
          base[i].author = d.author || "";
          if (d.url) base[i].url = d.url;
          if (embedOn) {
            base[i].body = d.body || "";
            if (d.icon_url) base[i].icon = d.icon_url;
          }
        } catch {
          // best-effort enrichment
        }
        done++;
        if (total > 0)
          toastProgress(
            progressKey,
            t("exportContent.fetchingCount", { done, total }),
            done / total,
          );
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, worker),
      );
    } finally {
      if (total > 0) dismissToast(progressKey);
    }
    return base;
  };

  const generate = (rows: Row[]): string => {
    const active: Column[] = (["version", "filename", "author", "url"] as Column[]).filter(
      (c) => cols[c],
    );
    switch (format) {
      case "json":
        return genJson(rows, active);
      case "csv":
        return genCsv(rows, active);
      case "text":
        return genText(rows, active);
      case "markdown":
        return embedOn ? genMarkdownRich(rows, active) : genMarkdownTable(rows, active);
      case "html":
        return embedOn ? genHtmlRich(rows, active) : genHtmlTable(rows, active);
    }
  };

  const genJson = (rows: Row[], active: Column[]): string => {
    const out = rows.map((r) => {
      const o: Record<string, unknown> = { name: r.name };
      if (active.includes("version")) o.version = r.version;
      if (active.includes("filename")) o.filename = r.filename;
      if (active.includes("author")) o.author = r.author;
      if (active.includes("url")) o.url = r.url;
      o.source = r.source;
      o.category = r.category;
      return o;
    });
    return JSON.stringify({ pack: packName, content: out }, null, 2);
  };

  const genCsv = (rows: Row[], active: Column[]): string => {
    const head = ["Name", ...active.map((c) => colLabel(c))];
    const lines = [head.map(csvCell).join(",")];
    for (const r of rows) {
      const cells = [r.name, ...active.map((c) => fieldOf(r, c))];
      lines.push(cells.map(csvCell).join(","));
    }
    return lines.join("\n");
  };

  const genText = (rows: Row[], active: Column[]): string => {
    const lines = [`${packName} — ${rows.length} item(s)`, ""];
    for (const r of rows) {
      let line = `- ${r.name}`;
      if (active.includes("version") && r.version) line += ` (${r.version})`;
      const extra: string[] = [];
      if (active.includes("author") && r.author) extra.push(`by ${r.author}`);
      if (active.includes("filename")) extra.push(r.filename);
      if (active.includes("url") && r.url) extra.push(r.url);
      if (extra.length) line += `  —  ${extra.join("  ·  ")}`;
      lines.push(line);
    }
    return lines.join("\n");
  };

  const genMarkdownTable = (rows: Row[], active: Column[]): string => {
    const head = ["Name", ...active.map(colLabel)];
    const sep = head.map(() => "---");
    const body = rows.map((r) => {
      const cells = [
        r.name,
        ...active.map((c) =>
          c === "url"
            ? r.url
              ? `[link](${r.url})`
              : ""
            : c === "filename"
              ? `\`${r.filename}\``
              : mdCell(fieldOf(r, c)),
        ),
      ];
      return `| ${cells.join(" | ")} |`;
    });
    return [
      `# ${packName}`,
      "",
      `${rows.length} installed item(s).`,
      "",
      `| ${head.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...body,
      "",
    ].join("\n");
  };

  const genMarkdownRich = (rows: Row[], active: Column[]): string => {
    const out = [`# ${packName}`, "", `${rows.length} installed item(s).`, ""];
    for (const r of rows) {
      out.push("---", "");
      const head = r.icon
        ? `### <img src="${r.icon}" width="20" height="20" align="absmiddle" /> ${r.name}`
        : `### ${r.name}`;
      out.push(head);
      const meta: string[] = [];
      if (active.includes("version") && r.version) meta.push(`**Version:** ${r.version}`);
      if (active.includes("author") && r.author) meta.push(`**Author:** ${r.author}`);
      if (active.includes("filename")) meta.push(`**File:** \`${r.filename}\``);
      if (active.includes("url") && r.url) meta.push(`[Project page](${r.url})`);
      if (meta.length) out.push("", meta.join(" · "));
      if (r.body.trim()) {
        out.push(
          "",
          "<details><summary>About</summary>",
          "",
          r.body.trim(),
          "",
          "</details>",
        );
      }
      out.push("");
    }
    return out.join("\n");
  };

  const genHtmlTable = (rows: Row[], active: Column[]): string => {
    const ths = ["Name", ...active.map(colLabel)]
      .map((h) => `<th>${esc(h)}</th>`)
      .join("");
    const trs = rows
      .map((r) => {
        const tds = [
          `<td class="name">${esc(r.name)}</td>`,
          ...active.map((c) =>
            c === "url"
              ? `<td>${r.url ? `<a href="${esc(r.url)}">link</a>` : ""}</td>`
              : c === "filename"
                ? `<td><code>${esc(r.filename)}</code></td>`
                : `<td>${esc(fieldOf(r, c))}</td>`,
          ),
        ].join("");
        return `<tr>${tds}</tr>`;
      })
      .join("\n");
    return htmlDoc(
      `<h1>${esc(packName)}</h1><p class="sub">${rows.length} installed item(s).</p>` +
        `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`,
      false,
    );
  };

  const genHtmlRich = (rows: Row[], active: Column[]): string => {
    const cards = rows
      .map((r) => {
        const meta: string[] = [];
        if (active.includes("version") && r.version)
          meta.push(`<span class="tag">v${esc(r.version)}</span>`);
        if (active.includes("author") && r.author)
          meta.push(`<span class="by">by ${esc(r.author)}</span>`);
        if (active.includes("filename"))
          meta.push(`<code>${esc(r.filename)}</code>`);
        const link =
          active.includes("url") && r.url
            ? `<a class="link" href="${esc(r.url)}">Project page →</a>`
            : "";
        const icon = r.icon
          ? `<img class="icon" src="${esc(r.icon)}" alt="" />`
          : `<div class="icon placeholder"></div>`;
        const body = r.body.trim()
          ? `<div class="readme">${esc(r.body.trim())}</div>`
          : "";
        return `<article class="card">
  <div class="head">${icon}<div><h2>${esc(r.name)}</h2><div class="meta">${meta.join(" ")}</div>${link}</div></div>
  ${body}
</article>`;
      })
      .join("\n");
    return htmlDoc(
      `<h1>${esc(packName)}</h1><p class="sub">${rows.length} installed item(s).</p>` +
        `<div class="cards">${cards}</div>`,
      true,
    );
  };

  const htmlDoc = (inner: string, rich: boolean): string => {
    const style = `
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#16130f;color:#e7e2d8;margin:0;padding:40px;}
    h1{font-size:26px;margin:0 0 4px;}
    .sub{color:#9a907f;margin:0 0 28px;}
    a{color:#d9a441;text-decoration:none;}a:hover{text-decoration:underline;}
    code{font-family:ui-monospace,monospace;background:#23201a;padding:1px 5px;border-radius:4px;font-size:12px;}
    table{border-collapse:collapse;width:100%;font-size:14px;}
    th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #2c2820;}
    th{color:#bcae93;font-weight:600;}
    td.name{font-weight:600;color:#fff;}
    .cards{display:grid;gap:14px;}
    .card{background:#1d1a14;border:1px solid #2c2820;border-radius:12px;padding:16px;}
    .card .head{display:flex;gap:14px;align-items:flex-start;}
    .icon{width:54px;height:54px;border-radius:10px;object-fit:cover;flex:none;background:#23201a;}
    .icon.placeholder{display:block;}
    .card h2{margin:0 0 6px;font-size:17px;color:#fff;}
    .meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:#9a907f;font-size:12px;}
    .tag{background:#3a2f16;color:#e7c069;padding:1px 7px;border-radius:20px;}
    .link{display:inline-block;margin-top:8px;font-size:13px;}
    .readme{margin-top:12px;padding-top:12px;border-top:1px solid #2c2820;white-space:pre-wrap;font-size:13px;color:#c7bfb0;line-height:1.5;max-height:none;}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(packName)}</title><style>${style}</style></head><body>${inner}</body></html>`;
  };

  const colLabel = (c: Column): string =>
    c === "version"
      ? "Version"
      : c === "filename"
        ? "Filename"
        : c === "author"
          ? "Author"
          : "URL";
  const fieldOf = (r: Row, c: Column): string =>
    c === "version" ? r.version : c === "filename" ? r.filename : c === "author" ? r.author : r.url;
  const mdCell = (s: string): string => s.replace(/\|/g, "\\|");

  const doExport = async () => {
    setBusy(true);
    try {
      const rows = await buildRows();
      const content = generate(rows);
      const stem = `${packName} content`;
      const path = await api.writeExportFile(stem, fmt.ext, content);
      toast(t("exportContent.savedToast"), "success");
      api.revealPath(path).catch(() => {});
      close();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const colDefs = useMemo(
    () =>
      [
        { id: "version" as Column, label: t("exportContent.colVersion") },
        { id: "filename" as Column, label: t("exportContent.colFilename") },
        { id: "author" as Column, label: t("exportContent.colAuthor") },
        { id: "url" as Column, label: t("exportContent.colUrl") },
      ],
    [t],
  );

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-6 backdrop-blur-sm ${
        closing ? "modal-overlay-out" : ""
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <div className="rise relative flex max-h-full w-[460px] max-w-full flex-col overflow-hidden rounded-xl border border-brass-700/30 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
            <FileDown size={15} className="text-brass-300" />
            {t("exportContent.title")}
          </div>
          <button
            onClick={() => !busy && close()}
            className="grid h-7 w-7 place-items-center rounded-md text-ink-600 transition hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-2 text-xs text-ink-600">
              {t("exportContent.format")}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                const sel = f.id === format;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition ${
                      sel
                        ? "border-brass-500/70 bg-brass-500/10 text-brass-200"
                        : "border-edge text-ink-500 hover:border-brass-600/40 hover:text-gray-200"
                    }`}
                  >
                    <Icon size={18} />
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs text-ink-600">
              {t("exportContent.include")}
            </div>
            <div className="flex flex-col gap-2.5 rounded-lg border border-edge p-3">
              {colDefs.map((c) => (
                <Toggle
                  key={c.id}
                  label={c.label}
                  checked={cols[c.id]}
                  onChange={() => toggleCol(c.id)}
                />
              ))}
            </div>
          </div>

          {supportsEmbed && (
            <div className="rounded-lg border border-edge p-3">
              <Toggle
                label={t("exportContent.embed")}
                description={t("exportContent.embedHint")}
                checked={embed}
                onChange={setEmbed}
              />
            </div>
          )}

          <p className="text-[10px] leading-snug text-ink-600">
            {t("exportContent.countHint", { count: mods.length })}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-5 py-3.5">
          <button
            onClick={() => !busy && close()}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-500 transition hover:text-gray-200"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={doExport}
            disabled={busy || mods.length === 0}
            className="brass-btn flex items-center gap-2 rounded-lg bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {t("exportContent.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
