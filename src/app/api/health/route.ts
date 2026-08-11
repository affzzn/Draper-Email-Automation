import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const out: Record<string, unknown> = {
    mode: process.env.RUN_MODE ?? "shadow",
    sends: false,
    time: new Date().toISOString(),
  };
  try {
    out.enquiries = await prisma.enquiry.count();
    const subs = await prisma.subscription.findMany({
      select: { mailbox: true, expiresAt: true },
    });
    out.subscriptions = subs.map((s) => ({
      mailbox: s.mailbox,
      expiresAt: s.expiresAt,
      expiresInMinutes: Math.round((s.expiresAt.getTime() - Date.now()) / 60000),
    }));
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = (e as Error).message;
  }
  return Response.json(out);
}
