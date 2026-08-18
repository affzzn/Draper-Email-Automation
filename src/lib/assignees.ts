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

// Negotiator emails, for cc'ing them on the reply (§2.4). Hardcoded per Affan.
const ASSIGNEE_EMAILS: Record<string, string> = {
  olivia: "olivia.rael-brook@draperlondon.com",
  craig: "craig.draper@draperlondon.com",
  aaron: "aaron.menashy@draperlondon.com",
  mitchell: "mitchell.murphy@draperlondon.com",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The negotiator's email for the cc. FAIL-SAFE: returns null for an unknown name, so
// we simply don't cc rather than cc a guess. An ASSIGNEE_EMAILS env var (same
// "Name=email;..." format) overrides the hardcoded map if ever needed, but is optional.
export function assigneeEmail(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  for (const pair of (process.env.ASSIGNEE_EMAILS ?? "").split(/[;,\n]/)) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim().toLowerCase() === key) {
      const email = pair.slice(eq + 1).trim();
      if (EMAIL_RE.test(email)) return email;
    }
  }
  const email = ASSIGNEE_EMAILS[key];
  return email && EMAIL_RE.test(email) ? email : null;
}
