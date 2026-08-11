import "isomorphic-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { env } from "./env";

// App-only auth. The app is granted Mail.Read ONLY (spec §5) — none of the helpers
// below call sendMail / reply / createReply, and they never should.
let cachedClient: Client | null = null;

export function graphClient(): Client {
  if (cachedClient) return cachedClient;

  const credential = new ClientSecretCredential(
    env.tenantId,
    env.clientId,
    env.clientSecret
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });

  cachedClient = Client.initWithMiddleware({ authProvider });
  return cachedClient;
}

// The full message. Notifications carry only an id (spec §5).
export interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  sender?: { emailAddress?: { name?: string; address?: string } };
  replyTo?: { emailAddress?: { name?: string; address?: string } }[];
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  receivedDateTime?: string;
  conversationId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  isDraft?: boolean;
}

const MESSAGE_SELECT =
  "id,subject,from,sender,replyTo,toRecipients,ccRecipients,receivedDateTime,conversationId,internetMessageHeaders,body,bodyPreview,isDraft";

export async function fetchMessage(
  mailboxAddress: string,
  messageId: string
): Promise<GraphMessage> {
  return graphClient()
    .api(`/users/${mailboxAddress}/messages/${messageId}`)
    .header("Prefer", 'outlook.body-content-type="html"')
    .select(MESSAGE_SELECT)
    .get();
}

// Human-reply detection (spec §8, "Human got there first"): messages in the same
// conversation sent FROM the mailbox after the enquiry arrived.
export async function conversationSentAfter(
  mailboxAddress: string,
  conversationId: string,
  after: Date
): Promise<GraphMessage[]> {
  const res = await graphClient()
    .api(`/users/${mailboxAddress}/mailFolders/sentitems/messages`)
    .filter(
      `conversationId eq '${conversationId}' and sentDateTime gt ${after.toISOString()}`
    )
    .select("id,from,sender,toRecipients,ccRecipients,sentDateTime,conversationId")
    .top(10)
    .get();
  return res.value ?? [];
}

// Read-only inbox folder metadata — used to verify connectivity + Mail.Read scope.
export async function getInboxFolder(mailboxAddress: string): Promise<{
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}> {
  return graphClient()
    .api(`/users/${mailboxAddress}/mailFolders/inbox`)
    .select("displayName,totalItemCount,unreadItemCount")
    .get();
}

// Bounded read of the most recent inbox messages (newest first). Optional
// received-since cut-off. Read-only; used for local real-mail testing without webhooks.
export async function recentInboxMessages(
  mailboxAddress: string,
  top: number,
  sinceIso: string | null
): Promise<GraphMessage[]> {
  let api = graphClient()
    .api(`/users/${mailboxAddress}/mailFolders/inbox/messages`)
    .header("Prefer", 'outlook.body-content-type="html"')
    .select(MESSAGE_SELECT)
    .top(top)
    .orderby("receivedDateTime desc");
  if (sinceIso) api = api.filter(`receivedDateTime ge ${sinceIso}`);
  const res = await api.get();
  return res.value ?? [];
}

// ── Subscriptions (spec §5) ──────────────────────────────────────────────────

export interface GraphSubscription {
  id: string;
  resource: string;
  expirationDateTime: string;
  clientState?: string;
  notificationUrl: string;
}

// Mail subscriptions max out under 3 days; renew well inside that window.
export function maxExpiry(): string {
  return new Date(Date.now() + 60 * 60 * 1000 * 60).toISOString(); // ~2.5 days
}

export async function createSubscription(
  mailboxAddress: string,
  notificationUrl: string,
  lifecycleUrl: string,
  clientState: string
): Promise<GraphSubscription> {
  return graphClient()
    .api("/subscriptions")
    .post({
      changeType: "created",
      notificationUrl,
      lifecycleNotificationUrl: lifecycleUrl,
      resource: `/users/${mailboxAddress}/mailFolders('inbox')/messages`,
      expirationDateTime: maxExpiry(),
      clientState,
    });
}

export async function renewSubscription(
  subscriptionId: string
): Promise<GraphSubscription> {
  return graphClient()
    .api(`/subscriptions/${subscriptionId}`)
    .patch({ expirationDateTime: maxExpiry() });
}

export async function deleteSubscription(subscriptionId: string): Promise<void> {
  await graphClient().api(`/subscriptions/${subscriptionId}`).delete();
}

export async function listSubscriptions(): Promise<GraphSubscription[]> {
  const res = await graphClient().api("/subscriptions").get();
  return res.value ?? [];
}

// ── Delta backstop (spec §5) ─────────────────────────────────────────────────
// Notifications are not guaranteed; a timer sweeps for anything missed.
export interface DeltaResult {
  messages: GraphMessage[];
  deltaLink: string | null;
}

export async function deltaInbox(
  mailboxAddress: string,
  deltaLink: string | null
): Promise<DeltaResult> {
  const api = deltaLink
    ? graphClient().api(deltaLink)
    : graphClient()
        .api(`/users/${mailboxAddress}/mailFolders/inbox/messages/delta`)
        .select(MESSAGE_SELECT);

  const messages: GraphMessage[] = [];
  let page = await api.get();

  while (true) {
    if (Array.isArray(page.value)) messages.push(...page.value);
    if (page["@odata.nextLink"]) {
      page = await graphClient().api(page["@odata.nextLink"]).get();
      continue;
    }
    return { messages, deltaLink: page["@odata.deltaLink"] ?? null };
  }
}
