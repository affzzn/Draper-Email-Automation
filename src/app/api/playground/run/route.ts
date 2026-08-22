import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReadOnly } from "@/lib/mode";
import { runPlaygroundForEnquiry, loadAvailability } from "@/lib/playground";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Preview one or more enquiries through the pipeline stages with an edited system prompt.
// READ-ONLY against enquiries: it never creates a Decision, never sets a send time, never
// touches the transport. It only records PlaygroundRun rows (the saved history).
const Body = z.object({
  enquiryIds: z.array(z.string()).min(1).max(50),
  systemPrompt: z.string().min(1),
  promptVersionId: z.string().nullish(),
  promptName: z.string().default("(unsaved edit)"),
  save: z.boolean().default(true),
});

export async function POST(req: Request) {
  if (isReadOnly()) {
    return NextResponse.json(
      { error: "Playground needs a database (this is a read-only snapshot deploy)." },
      { status: 400 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { enquiryIds, systemPrompt, promptVersionId, promptName, save } = parsed.data;

  const enquiries = await prisma.enquiry.findMany({
    where: { id: { in: enquiryIds } },
    include: { decision: true },
  });
  const byId = new Map(enquiries.map((e) => [e.id, e]));
  // Preserve the requested order, skip any ids that no longer exist.
  const ordered = enquiryIds.map((id) => byId.get(id)).filter(Boolean) as typeof enquiries;
  if (ordered.length === 0) {
    return NextResponse.json({ error: "No matching enquiries found." }, { status: 404 });
  }

  const isAvailable = await loadAvailability();
  const batchId = ordered.length > 1 ? crypto.randomUUID() : null;

  const results = [];
  for (const e of ordered) {
    try {
      const result = await runPlaygroundForEnquiry(e, systemPrompt, isAvailable);
      if (save) {
        await prisma.playgroundRun.create({
          data: {
            batchId,
            enquiryId: e.id,
            promptVersionId: promptVersionId ?? null,
            promptName,
            systemPrompt,
            draftBody: result.draft.body,
            shape: result.draft.shape,
            generatedByLLM: result.draft.generatedByLLM,
            wordCount: result.draft.wordCount,
            passCount: result.passCount,
            failCount: result.failCount,
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
      }
      results.push(result);
    } catch (err) {
      results.push({ enquiryId: e.id, error: (err as Error).message });
    }
  }

  return NextResponse.json({ batchId, results });
}
