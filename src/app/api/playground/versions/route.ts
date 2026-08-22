import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isReadOnly } from "@/lib/mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(120),
  systemPrompt: z.string().min(1),
  note: z.string().max(2000).nullish(),
});

// Save a new named prompt version.
export async function POST(req: Request) {
  if (isReadOnly()) {
    return NextResponse.json({ error: "Playground needs a database." }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { name, systemPrompt, note } = parsed.data;
  const version = await prisma.promptVersion.create({
    data: { name, systemPrompt, note: note ?? null },
  });
  return NextResponse.json({ id: version.id, name: version.name });
}

// Delete a version (its saved runs are kept; their promptVersionId is set null).
export async function DELETE(req: Request) {
  if (isReadOnly()) {
    return NextResponse.json({ error: "Playground needs a database." }, { status: 400 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await prisma.promptVersion.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
