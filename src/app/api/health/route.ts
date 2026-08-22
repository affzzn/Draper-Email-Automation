import { getEnquiryRows, isReadOnly, snapshotGeneratedAt } from "@/lib/store";
import { sendMode } from "@/lib/allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const mode = sendMode();
  const out: Record<string, unknown> = {
    mode: process.env.RUN_MODE ?? "shadow",
    // Reflect reality: true only when the sender worker is actually live. Was hardcoded
    // false, which lied once real sending was enabled.
    sends: mode === "live",
    sendMode: mode,
    dataSource: isReadOnly() ? "snapshot" : "db",
    snapshotGeneratedAt: snapshotGeneratedAt(),
    time: new Date().toISOString(),
  };
  try {
    out.enquiries = (await getEnquiryRows()).length;
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = (e as Error).message;
  }
  return Response.json(out);
}
