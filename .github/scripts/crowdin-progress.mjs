import { writeFileSync } from "node:fs";

const projectId = process.env.CROWDIN_PROJECT_ID;
const token = process.env.CROWDIN_PERSONAL_TOKEN;
if (!projectId || !token) {
  console.error("Missing CROWDIN_PROJECT_ID or CROWDIN_PERSONAL_TOKEN");
  process.exit(1);
}

const url = `https://api.crowdin.com/api/v2/projects/${projectId}/languages/progress?limit=500`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`Crowdin API ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const FILE_CODE = { "en-PT": "en-PT" };

const { data } = await res.json();
const out = {};
for (const { data: d } of data) {
  const id = d.languageId;
  const code = FILE_CODE[id] ?? d.language?.twoLettersCode ?? id;
  out[code] = d.translationProgress;
}

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
const path = "frontend/lib/i18n/progress.json";
writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${path}:`, sorted);
