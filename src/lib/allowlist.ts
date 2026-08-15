// Send allowlist — the safety gate for REAL reply sending.
//
// A reply may only be sent to an applicant whose email passes BOTH:
//   1. the HARDCODED_ALLOWLIST below (the immutable floor), AND
//   2. the SEND_ALLOWLIST env var, when that var is set (an optional further
//      restriction). An env typo can only SHRINK the list — it can never add
//      a stranger, because the hardcoded floor always applies.
//
// This module is intentionally dependency-free and side-effect-free so it can be
// called cheaply from multiple points (the sender worker AND inside the transport,
// as defence in depth).

// The only addresses that may ever receive a real automated reply. Lowercased.
export const HARDCODED_ALLOWLIST: readonly string[] = [
  "affan@innateaiconsulting.com",
  "joseph@innateaiconsulting.com",
  "rayyan@innateaiconsulting.com",
];

function normalize(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

// Parse SEND_ALLOWLIST (comma/space/semicolon separated). Empty/unset => no
// additional restriction (the hardcoded floor still applies on its own).
function envAllowlist(): string[] {
  return (process.env.SEND_ALLOWLIST ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// True only if `email` is permitted to receive a real send.
export function isAllowlisted(email: string | null | undefined): boolean {
  const addr = normalize(email);
  if (!addr) return false; // fail closed on missing/unresolved applicant email
  if (!HARDCODED_ALLOWLIST.includes(addr)) return false; // must clear the floor
  const env = envAllowlist();
  if (env.length > 0 && !env.includes(addr)) return false; // env may only shrink
  return true;
}

// The master switch for the sender worker.
//   off  (default) — send nothing, worker no-ops.
//   dry            — select + log intended sends, but never call Graph.
//   live           — actually send to allowlisted recipients.
export type SendMode = "off" | "dry" | "live";

export function sendMode(): SendMode {
  const v = (process.env.SEND_MODE ?? "").trim().toLowerCase();
  if (v === "live" || v === "dry") return v;
  return "off";
}

// Freshness window (minutes). A reply is only sent if its due time is within the
// last N minutes — this prevents stale drafts (e.g. an enquiry that arrived while
// sending was disabled) from firing off the moment sending is enabled. Anything
// older is marked "stale" and never sent. Default 30; override with SEND_MAX_AGE_MINUTES.
export function maxSendAgeMinutes(): number {
  const v = parseInt(process.env.SEND_MAX_AGE_MINUTES ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 30;
}
