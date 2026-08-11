import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const Body = z.object({
  classificationCorrect: z.boolean().nullable().optional(),
  note: z.string().max(5000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.classificationCorrect !== undefined)
    data.gradedClassificationCorrect = parsed.data.classificationCorrect;
  if (parsed.data.note !== undefined) data.gradingNote = parsed.data.note;

  try {
    await prisma.enquiry.update({ where: { id }, data });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
