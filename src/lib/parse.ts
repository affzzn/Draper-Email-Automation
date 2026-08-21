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

// Tokens that mean a candidate is not a usable personal name.
const NAME_STOPWORDS = new Set([
  "and", "or", "the", "from", "of", "&",
  "team", "enquiries", "enquiry", "sales", "lettings", "info", "admin", "office",
  // Portal/brand sender names are never a person — reject so we drop to no name.
  "rightmove", "zoopla", "onthemarket", "noreply", "no-reply", "donotreply",
  // Rightmove/Zoopla template + "Enquiry Manager" section words. These appear directly
  // after an applicant's sign-off in a portal lead and were being grabbed as the signed
  // name (e.g. "APPLICANT WOULD LIKE" -> "Dear APPLICANT", "SOFT CREDIT CHECK CONSENT" ->
  // "Dear SOFT"). No person's name contains these, so rejecting them is safe.
  "applicant", "message", "consent", "credit", "check", "soft", "moving", "duration",
  "employment", "affordability", "guarantor", "adverse", "smokers", "pets", "viewing",
  "book", "details", "contact", "would", "like", "property", "properties", "view",
  "renter", "household", "income", "date", "manager",
]);

// Return the raw string only if it looks like a real personal name. Rejects
// emails, ids, sentences, and dangling fragments such as "Viola And" so the reply
// falls back to "Dear Sir or Madam" rather than guessing (spec item 5.4).
function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .replace(/^(dear|hi|hello)\s+/i, "")
    .replace(/[,.;:!]+$/, "")
    .trim();
  if (!s || s.length < 2 || s.length > 40) return null;
  if (/[@\d]/.test(s)) return null; // emails, phone fragments, listing ids
  const tokens = s.split(/\s+/);
  if (tokens.length > 4) return null; // a sentence, not a name
  if (tokens.some((t) => NAME_STOPWORDS.has(t.toLowerCase()))) return null;
  // Each token must be alphabetic; allow hyphen/apostrophe (O'Brien, Anne-Marie).
  if (!tokens.every((t) => /^[a-z][a-z'’-]*$/i.test(t))) return null;
  return s;
}

// How the applicant signed the body, e.g. the line after "Kind regards,".
// GUARDED: a sign-off word can also appear inside the applicant's own message (e.g. a
// Rightmove Enquiry Manager lead where the message ends "…thanks" and the next line is
// an ALL-CAPS section header like "APPLICANT WOULD LIKE"). A real signature is a short,
// mixed-case name, so we reject candidates that are all-caps (a header) or more than
// three words (a template line such as "Contact X now"). cleanName() applies the rest.
function signedNameFrom(text: string): string | null {
  const m = text.match(
    /\b(?:kind regards|best regards|warm regards|many thanks|best wishes|kind wishes|yours sincerely|yours faithfully|sincerely|regards|thanks|thank you|cheers|all the best|best)\b[,.!]?\s*\n+\s*([^\n]{2,40})/i
  );
  if (!m) return null;
  const line = m[1].trim().replace(/^[-–—•*]+\s*/, "");
  if (!line) return null;
  if (line.split(/\s+/).length > 3) return null; // a template line, not a signature
  if (!/[a-z]/.test(line)) return null; // ALL-CAPS -> a section header, not a name
  return line;
}

// Rightmove's newer "Enquiry Manager" lead format has NO "Label: value" lines — it is
// free-form with ALL-CAPS section headers. Real tenant-lead shape:
//   Hi, {First} has enquired about this property
//   {property address, incl. full postcode}
//   £{price} pcm • {n} bed
//   {applicant full name}
//   {applicant email}
//   {applicant phone}
//   {applicant's own address}
//   MOVING DATE ... / DURATION ... / EMPLOYMENT ...
//   MESSAGE FROM APPLICANT
//   {their message}
//   APPLICANT WOULD LIKE
//   ...
// Returns the fields recoverable from this layout, or null if it isn't this format.
function parseRightmoveEnquiryManager(text: string): {
  applicantName: string | null;
  applicantPhone: string | null;
  propertyAddress: string | null;
  messageBody: string | null;
} | null {
  if (!/has enquired about this property/i.test(text)) return null;

  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Property: the line immediately after "has enquired about this property" (skip it if
  // that line is the price, e.g. "£9,000 pcm • 4 bed").
  let propertyAddress: string | null = null;
  const enqIdx = lines.findIndex((l) => /has enquired about this property/i.test(l));
  if (enqIdx !== -1 && lines[enqIdx + 1] && !/^£/.test(lines[enqIdx + 1])) {
    propertyAddress = lines[enqIdx + 1];
  }

  // Applicant name is the line just before the first standalone email; phone is the
  // line just after it.
  const emailLine = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const emailIdx = lines.findIndex((l) => emailLine.test(l));
  let applicantName: string | null = null;
  let applicantPhone: string | null = null;
  if (emailIdx > 0) {
    applicantName = cleanName(lines[emailIdx - 1]);
    const after = lines[emailIdx + 1] ?? "";
    const digits = after.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15 && /^[+\d\s()-]+$/.test(after)) {
      applicantPhone = after;
    }
  }
  // Fallback name from the greeting line if the block name did not validate.
  if (!applicantName) {
    const m = text.match(/Hi,\s*([^\n,]+?)\s+has enquired about this property/i);
    if (m) applicantName = cleanName(m[1]);
  }

  // Message: the lines after "MESSAGE FROM APPLICANT" up to the next ALL-CAPS section
  // header (MOVING DATE, SOFT CREDIT CHECK CONSENT, APPLICANT WOULD LIKE, …) or footer.
  let messageBody: string | null = null;
  const msgIdx = lines.findIndex((l) => /^MESSAGE FROM APPLICANT/i.test(l));
  if (msgIdx !== -1) {
    const collected: string[] = [];
    for (let i = msgIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^[A-Z][A-Z0-9 &'-]{3,}$/.test(l)) break; // next ALL-CAPS section header
      if (/^©|Rightmove Group Limited|Go to Enquiry Manager|Find out more/i.test(l)) break;
      collected.push(l);
    }
    const joined = collected.join(" ").trim();
    if (joined) messageBody = joined;
  }

  return { applicantName, applicantPhone, propertyAddress, messageBody };
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

  // Rightmove's newer "Enquiry Manager" lead format carries NO "Label: value" lines,
  // so grabLabelled finds nothing. Parse it specially and use its fields as fallbacks
  // wherever the label-based parse comes up empty (fully additive).
  const em = source === "rightmove" ? parseRightmoveEnquiryManager(text) : null;

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

  // Prefer how they actually signed the body, then the labelled field, then the
  // From display name. Reject malformed candidates (spec item 5.4).
  const signedName = signedNameFrom(text);
  const labelledName = grabLabelled(text, [
    "Name",
    "Applicant name",
    "Contact name",
    "Full name",
  ]);
  const headerName = msg.from?.emailAddress?.name ?? null;
  const applicantName =
    cleanName(signedName) ??
    cleanName(labelledName) ??
    cleanName(headerName) ??
    em?.applicantName ??
    null;
  if (!applicantName && (signedName || labelledName || headerName)) {
    notes.push("name: candidate rejected as malformed, using no name");
  }

  const applicantPhone =
    grabLabelled(text, [
      "Phone",
      "Telephone",
      "Telephone number",
      "Mobile",
      "Mobile number",
      "Tel",
      "Contact number",
      "Phone number",
    ]) ?? em?.applicantPhone ?? null;

  // Order matters (first match wins): prefer the agency-reference forms that carry a
  // usable token (Rightmove PropReference "83517_DRL260226"; Zoopla "Your property ref"
  // which is sometimes "164621_DRL260149_L"). "Unique Reference" is deliberately NOT
  // matched — it is only a Zoopla listing id, never our agency reference.
  const propertyReference = grabLabelled(text, [
    "PropReference",
    "Property reference",
    "Your property ref",
    "Property ref",
    "Rightmove reference",
    "Reference",
    "Ref",
  ]);

  let propertyAddress = grabLabelled(text, [
    "PropAddress",
    "Property Title",
    "Property address",
    "Address",
  ]);
  // Rightmove Enquiry Manager format: the property (with its full postcode) is the line
  // after "has enquired about this property". Prefer this over the subject fragment, which
  // is less complete and can even name a different property than the one enquired about.
  if (!propertyAddress && em?.propertyAddress) {
    propertyAddress = em.propertyAddress;
    notes.push("property: recovered from Rightmove Enquiry Manager format");
  }
  // Rightmove subject format fallback, e.g. "Sales enquiry: Oberman Road - Tenant from SW8".
  // A fixed template, so recover the property from the subject when the body has none.
  if (!propertyAddress) {
    // Separator may be a hyphen, en dash or em dash; role may be buyer/tenant/
    // landlord/applicant. This was silently discarding a block of good leads.
    const sm = subject.match(
      /enquiry:\s*(.+?)\s*[-–—]\s*(?:buyer|tenant|landlord|applicant)\b/i
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
    ]) ?? em?.messageBody ?? null;

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
