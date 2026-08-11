// Spec §9. Who gets the lead. v1 ships a log-only sink — no claim buttons, no SLA
// timers, no suggestion logic. The eventual impl may be built or bought; assume nothing.

export interface AssignmentSuggestion {
  suggestedOwner: string | null; // always null in v1
  reason: string | null;
}

export interface AssignmentRecord {
  enquiryId: string;
  mailbox: string;
  intent: string | null;
  suggestion: AssignmentSuggestion;
  loggedAt: string;
}

export interface AssignmentSink {
  submit(record: Omit<AssignmentRecord, "loggedAt">): Promise<AssignmentRecord>;
}

export class LoggingAssignmentSink implements AssignmentSink {
  async submit(
    record: Omit<AssignmentRecord, "loggedAt">
  ): Promise<AssignmentRecord> {
    const full: AssignmentRecord = { ...record, loggedAt: new Date().toISOString() };
    // Persisted onto the Decision row by the pipeline; also echoed to logs.
    console.log("[assignment]", JSON.stringify(full));
    return full;
  }
}

export const defaultAssignmentSink: AssignmentSink = new LoggingAssignmentSink();
