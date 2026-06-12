import React from "react";

const MC_COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000aa",
  "2": "#00aa00",
  "3": "#00aaaa",
  "4": "#aa0000",
  "5": "#aa00aa",
  "6": "#ffaa00",
  "7": "#aaaaaa",
  "8": "#555555",
  "9": "#5555ff",
  a: "#55ff55",
  b: "#55ffff",
  c: "#ff5555",
  d: "#ff55ff",
  e: "#ffff55",
  f: "#ffffff",
};


export function parseMotd(input: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let color: string | undefined;
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let buf = "";
  let key = 0;

  const flush = () => {
    if (!buf) return;
    const deco = [underline && "underline", strike && "line-through"]
      .filter(Boolean)
      .join(" ");
    nodes.push(
      <span
        key={key++}
        style={{
          color,
          fontWeight: bold ? 700 : undefined,
          fontStyle: italic ? "italic" : undefined,
          textDecoration: deco || undefined,
        }}
      >
        {buf}
      </span>,
    );
    buf = "";
  };

  const resetFormats = () => {
    bold = false;
    italic = false;
    underline = false;
    strike = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "§" && i + 1 < input.length) {
      const code = input[i + 1].toLowerCase();
      if (code === "#" && i + 7 < input.length) {
        flush();
        color = "#" + input.slice(i + 2, i + 8);
        resetFormats();
        i += 7;
        continue;
      }
      flush();
      if (code in MC_COLORS) {
        color = MC_COLORS[code];
        resetFormats();
      } else if (code === "l") {
        bold = true;
      } else if (code === "o") {
        italic = true;
      } else if (code === "n") {
        underline = true;
      } else if (code === "m") {
        strike = true;
      } else if (code === "r") {
        color = undefined;
        resetFormats();
      }
      i++;
      continue;
    }
    buf += ch;
  }
  flush();
  return nodes;
}
