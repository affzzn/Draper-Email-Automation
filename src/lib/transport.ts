// Spec §9. The sender interface exists so phase 2 is a one-component swap.
// v1 ships ONLY the no-op: it persists what it was asked to send and sends nothing.
// There is deliberately no code path here that reaches Graph sendMail/reply.

export interface SendRequest {
  enquiryId: string;
  toEmail: string | null;
  subject: string;
  body: string;
  sendAt: Date | null;
}

export interface SendResult {
  ok: boolean;
  sent: false; // always false in v1 — this is the type-level guarantee
  record: SendRequest & { recordedAt: string };
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

export const defaultTransport: Transport = new NoOpTransport();
