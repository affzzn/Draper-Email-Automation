import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isReadOnly } from "@/lib/mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(120),
  enquiryIds: z.array(z.string()).min(1).max(50),
});

// Save a named, curated set of enquiries to run a prompt across (regression set).
export async function POST(req: Request) {
  if (isReadOnly()) {
    return NextResponse.json({ error: "Playground needs a database." }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { name, enquiryIds } = parsed.data;
  const set = await prisma.playgroundTestSet.create({ data: { name, enquiryIds } });
  return NextResponse.json({ id: set.id, name: set.name });
}

export async function DELETE(req: Request) {
  if (isReadOnly()) {
    return NextResponse.json({ error: "Playground needs a database." }, { status: 400 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await prisma.playgroundTestSet.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
