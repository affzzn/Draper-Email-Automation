// Minimal, dependency-free CSV. Values are quoted and internal quotes doubled.
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(cell).join(",");
  const body = rows
    .map((r) => columns.map((c) => cell(r[c])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}
