import type { Mailbox } from "@prisma/client";

// Placeholder addresses until Draper confirms the real ones.
// Only these three mailboxes are ever touched (spec §5).
export interface MailboxConfig {
  role: Mailbox;
  address: string;
}

export function getMailboxes(): MailboxConfig[] {
  return [
    { role: "sales", address: process.env.MAILBOX_SALES || "sales@draperlondon.example" },
    { role: "lettings", address: process.env.MAILBOX_LETTINGS || "lettings@draperlondon.example" },
    { role: "hello", address: process.env.MAILBOX_HELLO || "hello@draperlondon.example" },
  ];
}

export function mailboxByAddress(address: string): MailboxConfig | undefined {
  const a = address.toLowerCase();
  return getMailboxes().find((m) => m.address.toLowerCase() === a);
}

export function mailboxByRole(role: Mailbox): MailboxConfig {
  const m = getMailboxes().find((x) => x.role === role);
  if (!m) throw new Error(`No mailbox configured for role ${role}`);
  return m;
}
