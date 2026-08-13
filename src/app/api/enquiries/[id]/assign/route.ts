import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isReadOnly } from "@/lib/store";
import { ASSIGNEES } from "@/lib/assignees";
import { z } from "zod";

const Body = z.object({ assignedTo: z.enum(ASSIGNEES) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (isReadOnly()) return NextResponse.json({ ok: true, readOnly: true });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid assignee" }, { status: 400 });
  }
  try {
    await prisma.enquiry.update({
      where: { id },
      data: { assignedTo: parsed.data.assignedTo },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
