// Spec §9. The sender interface exists so phase 2 is a one-component swap.
// The DRAFTING pipeline still ships ONLY the no-op (NoOpTransport) — it records
// what it was asked to send and sends nothing; `defaultTransport` stays no-op.
// Real sending is opt-in and lives ONLY in the sender worker (scripts/send-drafts.ts),
// which uses GraphTransport and is gated by the allowlist + SEND_MODE.

import {
  createReplyDraft,
  updateMessage,
  sendDraftMessage,
  markUnread,
  fetchMessage,
} from "./graph";
import { isAllowlisted } from "./allowlist";
import { isNoReply } from "./parse";

// Place our reply ABOVE the quoted original that Graph's createReply pre-fills, so the
// applicant sees our message first and can scroll down to the original enquiry (§2.2).
// Insert just after the opening <body> tag when present; otherwise put it on top.
function embedAboveQuote(replyHtml: string, quotedDraftHtml: string): string {
  const ours = `<div>${replyHtml}</div><br>`;
  if (!quotedDraftHtml) return ours;
  const m = quotedDraftHtml.match(/<body[^>]*>/i);
  if (m) {
    const at = quotedDraftHtml.indexOf(m[0]) + m[0].length;
    return quotedDraftHtml.slice(0, at) + ours + quotedDraftHtml.slice(at);
  }
  return ours + quotedDraftHtml;
}

export interface SendRequest {
  enquiryId: string;
  toEmail: string | null;
  subject: string;
  body: string;
  sendAt: Date | null;
  // Threading context — required by GraphTransport, ignored by NoOpTransport.
  mailboxAddress?: string; // the Draper mailbox that received the enquiry
  originalMessageId?: string; // Graph id of the original enquiry message
  replyAll?: boolean; // reply-all vs plain reply
  cc?: string[]; // §2.4: cc the routed negotiator
}

export interface SendResult {
  ok: boolean;
  sent: boolean; // NoOpTransport always returns false; GraphTransport true on success
  record: SendRequest & { recordedAt: string; graphReplyId?: string };
}

export interface Transport {
  send(req: SendRequest): Promise<SendResult>;
}

export class NoOpTransport implements Transport {
  async send(req: SendRequest): Promise<SendResult> {
    // Nothing leaves the building. We only return what we were asked to do.
    return {
      ok: true,
      sent: false,
      record: { ...req, recordedAt: new Date().toISOString() },
    };
  }
}

// Sends a real, threaded reply via Microsoft Graph. Used ONLY by the sender worker.
// Requires Azure Mail.Send + Mail.ReadWrite. Every call re-checks the allowlist as
// a final line of defence — even a caller bug cannot send to a non-allowlisted address.
export class GraphTransport implements Transport {
  async send(req: SendRequest): Promise<SendResult> {
    // Gate #4 (defence in depth): never send to a non-allowlisted recipient.
    if (!isAllowlisted(req.toEmail)) {
      throw new Error(
        `GraphTransport refused: ${req.toEmail ?? "(none)"} is not allowlisted`
      );
    }
    // Correctness backstop: even when the allowlist is lifted (fully-live "*"),
    // never reply into a portal relay or no-reply address — it bounces or lands
    // in a Rightmove/Zoopla relay thread instead of reaching the applicant.
    if (isNoReply(req.toEmail ?? "")) {
      throw new Error(
        `GraphTransport refused: ${req.toEmail ?? "(none)"} is a relay/no-reply address`
      );
    }
    if (!req.mailboxAddress || !req.originalMessageId) {
      throw new Error("GraphTransport requires mailboxAddress and originalMessageId");
    }

    // 1. Create a threaded draft reply (preserves conversationId + Re: + headers).
    //    Graph pre-fills its body with the original enquiry quoted beneath.
    const draft = await createReplyDraft(
      req.mailboxAddress,
      req.originalMessageId,
      req.replyAll === true
    );

    // 2. Keep that quoted original and put our reply ABOVE it (§2.2), instead of
    //    overwriting the whole body. Pin the recipient to the allowlisted address and
    //    cc the negotiator.
    const quoted = (await fetchMessage(req.mailboxAddress, draft.id)).body?.content ?? "";
    const cc = (req.cc ?? []).filter(Boolean);
    await updateMessage(req.mailboxAddress, draft.id, {
      body: { contentType: "HTML", content: embedAboveQuote(req.body, quoted) },
      toRecipients: [{ emailAddress: { address: req.toEmail } }],
      ...(cc.length
        ? { ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })) }
        : {}),
    });

    // 3. Send it.
    await sendDraftMessage(req.mailboxAddress, draft.id);

    // 4. Keep the original enquiry unread so a human still sees it flagged.
    await markUnread(req.mailboxAddress, req.originalMessageId);

    return {
      ok: true,
      sent: true,
      record: {
        ...req,
        recordedAt: new Date().toISOString(),
        graphReplyId: draft.id,
      },
    };
  }
}

// The DRAFTING pipeline uses this — deliberately the no-op.
export const defaultTransport: Transport = new NoOpTransport();
