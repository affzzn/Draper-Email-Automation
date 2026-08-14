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
} from "./graph";
import { isAllowlisted } from "./allowlist";

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
    if (!req.mailboxAddress || !req.originalMessageId) {
      throw new Error("GraphTransport requires mailboxAddress and originalMessageId");
    }

    // 1. Create a threaded draft reply (preserves conversationId + Re: + headers).
    const draft = await createReplyDraft(
      req.mailboxAddress,
      req.originalMessageId,
      req.replyAll === true
    );

    // 2. Set our generated HTML body and pin the recipient to the allowlisted
    //    address (not whatever the original carried) — extra safety.
    await updateMessage(req.mailboxAddress, draft.id, {
      body: { contentType: "HTML", content: req.body },
      toRecipients: [{ emailAddress: { address: req.toEmail } }],
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
