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
