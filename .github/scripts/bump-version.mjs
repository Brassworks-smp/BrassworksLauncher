import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const TAURI_CONF = "frontend/src-tauri/tauri.conf.json";
const PKG_JSON = "frontend/package.json";
const CARGO_TOML = "Cargo.toml";

const fail = (msg) => {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${msg}` : msg);
  process.exit(1);
};

const current = JSON.parse(readFileSync(TAURI_CONF, "utf8")).version;

const input = (process.argv[2] ?? "").trim();
let next;
if (input) {
  next = input;
} else {
  const parts = current.split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  next = parts.join(".");
}

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  fail(`Invalid version '${next}' (expected X.Y.Z)`);
}

for (const path of [TAURI_CONF, PKG_JSON]) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = next;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

const cargo = readFileSync(CARGO_TOML, "utf8");
const bumped = cargo.replace(/^version = "\d+\.\d+\.\d+"/m, `version = "${next}"`);
if (bumped === cargo) fail(`Could not find version line in ${CARGO_TOML}`);
writeFileSync(CARGO_TOML, bumped);

console.log(`Bumped version ${current} -> ${next}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\nnew=${next}\n`);
}
