// Minimal .env loader for standalone scripts (no dependency).
// Loads .env.local then .env (existing process.env always wins, e.g. on Render).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function load(file: string) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

load(".env.local");
load(".env");
