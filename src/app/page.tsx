import GradeControls from "./components/GradeControls";
import RawViewer from "./components/RawViewer";
import AssignControls from "./components/AssignControls";
import TeamToggles from "./components/TeamToggles";
import { getEnquiryRows, getTeam, isReadOnly } from "@/lib/store";
import { defaultAssignee } from "@/lib/assignees";

export const dynamic = "force-dynamic";

const LONDON = "Europe/London";
function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const TYPE_LABEL: Record<string, string> = {
  viewing_request: "Viewing request",
  valuation_request: "Valuation",
  landlord_enquiry: "Landlord",
  tenant_or_maintenance: "Tenant / maintenance",
  supplier: "Supplier",
  recruitment: "Recruitment",
  press: "Press",
  spam: "Spam",
  other: "Other",
};

type Row = Awaited<ReturnType<typeof getEnquiryRows>>[number];

// Plain-English status for a client, derived from the internal decision.
function statusOf(e: Row): { label: string; tone: string } {
  const d = e.decision;
  if (d?.generatedBody) return { label: "Reply drafted", tone: "green" };
  const sr = d?.suppressionReason;
  if (sr === "human_replied_first") return { label: "Handled by team", tone: "mute" };
  if (sr === "one_reply_per_thread") return { label: "Already replied", tone: "mute" };
  if (sr === "repeat_enquiry") return { label: "Awaiting a call", tone: "amber" };
  if (sr === "auto_responder_guard") return { label: "Automated sender", tone: "mute" };
  if (["valuation_request", "landlord_enquiry", "tenant_or_maintenance"].includes(e.intent ?? ""))
    return { label: "Needs a person", tone: "mute" };
  if (["supplier", "spam", "recruitment", "press"].includes(e.intent ?? ""))
    return { label: "No action", tone: "mute" };
  if (e.intent === "viewing_request") return { label: "Needs review", tone: "amber" };
  return { label: "No action", tone: "mute" };
}

type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const review = sp.review === "1" || sp.review === "true";
  const all = await getEnquiryRows();
  const team = await getTeam();

  const filtered = all.filter((e) => {
    if (sp.mailbox && e.mailbox !== sp.mailbox) return false;
    if (sp.intent && e.intent !== sp.intent) return false;
    return true;
  });

  const total = all.length;
  const viewingCount = all.filter((e) => e.intent === "viewing_request").length;
  const draftCount = all.filter((e) => e.decision?.generatedBody).length;

  const enquiries = filtered.slice(0, 500);
  const exportQs = new URLSearchParams(sp as Record<string, string>).toString();
  const readOnly = isReadOnly();
  const cols = 10 + (review ? 2 : 0);

  return (
    <div className="wrap">
      <h1 className="pagetitle">Enquiries</h1>

      <div className="stats">
        <div className="stat"><div className="n">{total}</div><div className="l">Enquiries</div></div>
        <div className="stat"><div className="n">{viewingCount}</div><div className="l">Viewing requests</div></div>
        <div className="stat"><div className="n">{draftCount}</div><div className="l">Replies drafted</div></div>
      </div>

      <TeamToggles members={team} readOnly={readOnly} />

      <form className="controls" method="get">
        {review && <input type="hidden" name="review" value="1" />}
        <select name="mailbox" defaultValue={sp.mailbox ?? ""}>
          <option value="">All inboxes</option>
          <option value="sales">Sales</option>
          <option value="lettings">Lettings</option>
          <option value="hello">Hello</option>
        </select>
        <select name="intent" defaultValue={sp.intent ?? ""}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <button className="btn" type="submit">Filter</button>
        <a className="btn secondary" href={review ? "/?review=1" : "/"}>Reset</a>
        <span className="spacer" />
        <a className="btn secondary" href={`/api/export?${exportQs}`}>Export</a>
      </form>

      <div className="tablewrap">
        <div className="tablescroll">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Inbox</th>
                <th>Applicant</th>
                <th>Property</th>
                <th>Type</th>
                <th>Status</th>
                <th>Send time</th>
                <th>Assign to</th>
                <th>Reply</th>
                <th>Message</th>
                {review && <th>Parse</th>}
                {review && <th>Grade</th>}
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e) => {
                const st = statusOf(e);
                return (
                  <tr key={e.id}>
                    <td className="time">{fmt(e.receivedAt)}</td>
                    <td>
                      <div className="cap">{e.mailbox}</div>
                      <div className="small cap">{e.source}</div>
                    </td>
                    <td>
                      <div className="strong">{e.applicantName ?? "—"}</div>
                      {e.applicantEmail && <div className="small mono">{e.applicantEmail}</div>}
                    </td>
                    <td>
                      <div>{e.propertyAddress ?? e.propertyReference ?? <span className="faintdash">—</span>}</div>
                      {e.matchMethod && e.matchMethod !== "none" ? (
                        <div className="small">
                          <span className="mono">
                            {[
                              e.matchedPrice != null ? `£${e.matchedPrice.toLocaleString()}` : null,
                              e.matchedBedrooms != null ? `${e.matchedBedrooms} bed` : null,
                              e.matchedType,
                            ].filter(Boolean).join(" · ")}
                          </span>
                          {e.matchConfidence != null && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                color:
                                  e.matchConfidence >= 0.8
                                    ? "#2e7d32"
                                    : e.matchConfidence >= 0.6
                                    ? "#b26a00"
                                    : "#b3261e",
                              }}
                            >
                              {Math.round(e.matchConfidence * 100)}% match
                              {review ? ` · ${e.matchMethod}` : ""}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="small faintdash">no listing match</div>
                      )}
                    </td>
                    <td>{e.intent ? TYPE_LABEL[e.intent] ?? e.intent : "—"}
                      {review && e.confidence != null && <div className="small mono">{e.confidence.toFixed(2)}</div>}
                      {review && e.factualQuestion && <div className="reason">Q: {e.factualQuestion}</div>}
                    </td>
                    <td>
                      <span className={`pill ${st.tone}`}>{st.label}</span>
                      {review && (e.decision?.ineligibleReason || e.decision?.suppressionReason) && (
                        <div className="reason">{e.decision?.suppressionReason ?? e.decision?.ineligibleReason}</div>
                      )}
                    </td>
                    <td className="time">{fmt(e.decision?.wouldSendAtHeld)}</td>
                    <td>
                      <AssignControls
                        enquiryId={e.id}
                        current={e.assignedTo ?? e.routedTo ?? defaultAssignee(e.mailbox)}
                        isDefault={!e.assignedTo}
                        readOnly={readOnly}
                      />
                      {!e.assignedTo && e.routedReason && (
                        <div className="small" style={{ color: "#7a7067", marginTop: 2 }}>{e.routedReason}</div>
                      )}
                    </td>
                    <td>
                      {e.decision?.generatedBody ? (
                        <div className="reply" dangerouslySetInnerHTML={{ __html: e.decision.generatedBody }} />
                      ) : (
                        <span className="reply none">—</span>
                      )}
                      {review && e.decision?.generatedBody && e.decision.generationMetadata?.generatedByLLM === false && (
                        <div className="reason" style={{ color: "#b3261e" }}>⚠ template fallback (model reply rejected)</div>
                      )}
                    </td>
                    <td>
                      <RawViewer
                        subject={e.rawSubject}
                        body={e.rawBodyText || e.rawBodyHtml || ""}
                        parseStatus={e.parseStatus}
                        emailResolvedFrom={e.emailResolvedFrom}
                      />
                    </td>
                    {review && (
                      <td>
                        <span className={`pill ${e.parseStatus === "full" ? "green" : e.parseStatus === "partial" ? "amber" : "red"}`}>{e.parseStatus}</span>
                        {e.parseNotes.length > 0 && (
                          <ul className="notes">{e.parseNotes.map((n, i) => (<li key={i}>{n}</li>))}</ul>
                        )}
                      </td>
                    )}
                    {review && (
                      <td>
                        <GradeControls
                          enquiryId={e.id}
                          initialCorrect={e.gradedClassificationCorrect}
                          initialNote={e.gradingNote}
                          readOnly={readOnly}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {enquiries.length === 0 && (
                <tr><td colSpan={cols} className="empty">No enquiries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
