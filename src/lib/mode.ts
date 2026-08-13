// Data-source mode detection with NO heavy imports, so routes that only need to know
// "are we read-only?" (assign, grade) don't pull in the large snapshot JSON.
export function dataMode(): "db" | "snapshot" {
  const explicit = (process.env.DATA_SOURCE || "").toLowerCase();
  if (explicit === "snapshot" || explicit === "db") return explicit;
  return process.env.DATABASE_URL ? "db" : "snapshot";
}

export function isReadOnly(): boolean {
  return dataMode() === "snapshot";
}
