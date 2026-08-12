import { getEnquiryRows, isReadOnly, snapshotGeneratedAt } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const out: Record<string, unknown> = {
    mode: process.env.RUN_MODE ?? "shadow",
    sends: false,
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
