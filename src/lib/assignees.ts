// Triage targets. Craig assigns each enquiry to the right person; defaults by channel,
// but any can be overridden (e.g. if someone is unavailable).
export const ASSIGNEES = ["Olivia", "Mitchell", "Aaron", "Craig"] as const;
export type Assignee = (typeof ASSIGNEES)[number];

// Default routing: sales -> Olivia, lettings -> Aaron, hello -> Craig.
export function defaultAssignee(mailbox: string): Assignee {
  if (mailbox === "lettings") return "Aaron";
  if (mailbox === "sales") return "Olivia";
  return "Craig";
}

// The negotiator's email, for cc'ing them on the reply (§2.4). Read from the
// ASSIGNEE_EMAILS env var, format "Olivia=olivia@draperlondon.com;Craig=craig@...".
// FAIL-SAFE: returns null if the name has no valid email configured, so we simply
// don't cc rather than cc a guess (important now that sending is live).
export function assigneeEmail(name: string | null | undefined): string | null {
  if (!name) return null;
  const raw = process.env.ASSIGNEE_EMAILS ?? "";
  for (const pair of raw.split(/[;,\n]/)) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const n = pair.slice(0, eq).trim();
    const email = pair.slice(eq + 1).trim();
    if (n.toLowerCase() === name.toLowerCase() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return email;
    }
  }
  return null;
}
