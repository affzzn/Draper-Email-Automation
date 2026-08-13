import type { GraphMessage } from "./graph";
import type { EmailResolvedFrom, ParseStatus, Source } from "@prisma/client";

export interface ParsedEnquiry {
  source: Source;
  applicantName: string | null;
  applicantEmail: string | null;
  applicantPhone: string | null;
  propertyReference: string | null;
  propertyAddress: string | null;
  propertyUrl: string | null;
  messageBody: string | null;
  budgetMax: number | null;
  budgetRaw: string | null;
  requirements: string | null;
  interestedIn: string | null;
  aboutApplicant: string | null;
  replyTo: string | null;
  emailResolvedFrom: EmailResolvedFrom;
  parseStatus: ParseStatus;
  parseNotes: string[];
}

const NO_REPLY_PATTERNS = [
  /no[-_.]?reply/i,
  /donotreply/i,
  /notifications?@/i,
  /mailer-daemon/i,
];

const PORTAL_RELAY_DOMAINS = [
  "rightmove.co.uk",
  "rightmove.com",
  "zoopla.co.uk",
  "zoopla.com",
  "onthemarket.com",
];

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectSource(fromAddr: string, subject: string, text: string): Source {
  const hay = `${fromAddr} ${subject} ${text}`.toLowerCase();
  if (hay.includes("rightmove")) return "rightmove";
  if (hay.includes("zoopla")) return "zoopla";
  if (hay.includes("onthemarket")) return "unknown";
  if (/draperlondon\.(com|co\.uk)|website enquiry|contact form/i.test(hay))
    return "website";
  return "unknown";
}

// Grab "Label: value" style fields (Rightmove/Zoopla templates and our simulator).
// The label must start a segment (line start, or after a ";") so e.g. the label
// "Property" does not match inside "Type of property". Handles both Zoopla's
// row-per-field layout (newlines) and Rightmove's single semicolon-delimited line.
function grabLabelled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(
      `(?:^|[\\n;])\\s*${label}\\s*[:\\-]\\s*(.+?)\\s*(?:;|\\n|$)`,
      "i"
    );
    const m = text.match(re);
    if (m && m[1] && m[1].trim() && !/^n\/?a$/i.test(m[1].trim())) {
      return m[1].trim();
    }
  }
  return null;
}

function firstEmailIn(text: string): string | null {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}

function isNoReply(addr: string): boolean {
  const a = addr.toLowerCase();
  if (NO_REPLY_PATTERNS.some((re) => re.test(a))) return true;
  const domain = a.split("@")[1] ?? "";
  return PORTAL_RELAY_DOMAINS.some((d) => domain.endsWith(d));
}

function firstUrlIn(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

export function parseMessage(msg: GraphMessage): ParsedEnquiry {
  const notes: string[] = [];
  const subject = msg.subject ?? "";
  const html = msg.body?.contentType === "html" ? msg.body?.content ?? "" : "";
  const text =
    msg.body?.contentType === "html"
      ? htmlToText(html)
      : (msg.body?.content ?? msg.bodyPreview ?? "");

  const fromAddr = msg.from?.emailAddress?.address ?? "";
  const replyToAddr = msg.replyTo?.[0]?.emailAddress?.address ?? null;
  const source = detectSource(fromAddr, subject, text);

  // ── Applicant email resolution: From → Reply-To → body (spec §6.2) ─────────
  let applicantEmail: string | null = null;
  let emailResolvedFrom: EmailResolvedFrom = "none";

  if (fromAddr && !isNoReply(fromAddr)) {
    applicantEmail = fromAddr;
    emailResolvedFrom = "from";
    notes.push("email: resolved from From header");
  } else if (replyToAddr && !isNoReply(replyToAddr)) {
    applicantEmail = replyToAddr;
    emailResolvedFrom = "reply_to";
    notes.push("email: From was relay/no-reply, used Reply-To");
  } else {
    const bodyEmail =
      grabLabelled(text, ["Email", "Email address", "Applicant email", "e-mail"]) ??
      firstEmailIn(text);
    if (bodyEmail && !isNoReply(bodyEmail)) {
      applicantEmail = bodyEmail;
      emailResolvedFrom = "body";
      notes.push("email: resolved from message body");
    } else if (bodyEmail) {
      applicantEmail = bodyEmail;
      emailResolvedFrom = "body";
      notes.push("email: only a no-reply/relay address found, marked partial");
    } else {
      notes.push("email: could not resolve a real applicant address");
    }
  }

  const applicantName =
    grabLabelled(text, ["Name", "Applicant name", "Contact name", "Full name"]) ??
    msg.from?.emailAddress?.name ??
    null;

  const applicantPhone = grabLabelled(text, [
    "Phone",
    "Telephone",
    "Tel",
    "Mobile",
    "Contact number",
    "Phone number",
  ]);

  const propertyReference = grabLabelled(text, [
    "PropReference",
    "Property reference",
    "Reference",
    "Ref",
    "Property ref",
  ]);

  let propertyAddress = grabLabelled(text, [
    "PropAddress",
    "Property Title",
    "Property address",
    "Address",
  ]);
  // Rightmove subject format, e.g. "Sales enquiry: Oberman Road - Tenant from SW8".
  // A fixed template, so recover the property from the subject when the body has none.
  if (!propertyAddress) {
    const sm = subject.match(
      /(?:sales|lettings)\s+enquiry:\s*(.+?)\s*-\s*(?:buyer|tenant)\s+from\b/i
    );
    if (sm && sm[1] && sm[1].trim()) {
      propertyAddress = sm[1].trim();
      notes.push("property: recovered from subject line");
    }
  }

  const propertyUrl =
    grabLabelled(text, ["PropUrl", "Property URL", "Listing", "Link"]) ??
    firstUrlIn(text);

  // Free text the applicant actually wrote (best-effort; LLM refines in pipeline).
  const messageBody =
    grabLabelled(text, [
      "Message",
      "Additional Comments",
      "Comments",
      "Enquiry",
      "Note",
      "Additional information",
    ]) ?? null;

  // Personalization signals from the portal's structured fields.
  const budgetRaw = grabLabelled(text, ["Price range", "Budget", "Max price"]);
  let budgetMax: number | null = null;
  if (budgetRaw) {
    const m = budgetRaw.replace(/,/g, "").match(/£?\s*(\d{3,})/);
    if (m) budgetMax = parseInt(m[1], 10);
  }
  const requirements = grabLabelled(text, ["Type of property", "Property type wanted"]);
  const interestedIn = grabLabelled(text, ["Interested in", "Must have"]);
  const aboutApplicant = grabLabelled(text, ["About"]);

  // ── Parse status ───────────────────────────────────────────────────────────
  let parseStatus: ParseStatus = "full";
  const noRealEmail =
    !applicantEmail || (applicantEmail !== null && isNoReply(applicantEmail));
  const missingProperty = !propertyReference && !propertyAddress;

  if (noRealEmail || missingProperty) parseStatus = "partial";
  if (!applicantEmail && !applicantName && !propertyAddress && !propertyReference) {
    parseStatus = "failed";
    notes.push("parse: no key fields found");
  }
  if (noRealEmail) parseStatus = parseStatus === "failed" ? "failed" : "partial";

  if (missingProperty) notes.push("property: no reference or address found");
  if (!applicantName) notes.push("name: not found");
  if (!applicantPhone) notes.push("phone: not found");

  return {
    source,
    applicantName,
    applicantEmail,
    applicantPhone,
    propertyReference,
    propertyAddress,
    propertyUrl,
    messageBody,
    budgetMax,
    budgetRaw,
    requirements,
    interestedIn,
    aboutApplicant,
    replyTo: replyToAddr,
    emailResolvedFrom,
    parseStatus,
    parseNotes: notes,
  };
}

export { isNoReply };
