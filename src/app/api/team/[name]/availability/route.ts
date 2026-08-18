import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isReadOnly } from "@/lib/mode";
import { ASSIGNEES } from "@/lib/assignees";
import { z } from "zod";

const Body = z.object({ available: z.boolean() });

// §3.5: toggle a team member in/out. Router skips anyone "out" (falls to Craig).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (isReadOnly()) return NextResponse.json({ ok: true, readOnly: true });

  if (!(ASSIGNEES as readonly string[]).includes(name)) {
    return NextResponse.json({ error: "unknown member" }, { status: 400 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await prisma.teamMember.upsert({
    where: { name },
    create: { name, available: parsed.data.available },
    update: { available: parsed.data.available },
  });
  return NextResponse.json({ ok: true });
}
