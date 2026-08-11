import { prisma } from "@/lib/prisma";
import GradeControls from "./components/GradeControls";
import RawViewer from "./components/RawViewer";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const LONDON = "Europe/London";
function fmt(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function nullable(v: string | null | undefined) {
  if (v === null || v === undefined || v === "")
    return <span className="null">null</span>;
  return <>{v}</>;
}

type SP = Record<string, string | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  const where: Prisma.EnquiryWhereInput = {};
  if (sp.mailbox) where.mailbox = sp.mailbox as Prisma.EnquiryWhereInput["mailbox"];
  if (sp.intent) where.intent = sp.intent as Prisma.EnquiryWhereInput["intent"];
  if (sp.parseStatus)
    where.parseStatus = sp.parseStatus as Prisma.EnquiryWhereInput["parseStatus"];
  if (sp.eligible === "yes") where.decision = { eligible: true };
  if (sp.eligible === "no") where.decision = { eligible: false };

  const [enquiries, total, eligibleCount, viewingCount, draftCount] =
    await Promise.all([
      prisma.enquiry.findMany({
        where,
        include: { decision: true },
        orderBy: { receivedAt: "desc" },
        take: 500,
      }),
      prisma.enquiry.count(),
      prisma.decision.count({ where: { eligible: true } }),
      prisma.enquiry.count({ where: { intent: "viewing_request" } }),
      prisma.decision.count({ where: { generatedBody: { not: null } } }),
    ]);

  const exportQs = new URLSearchParams(sp as Record<string, string>).toString();

  return (
    <div className="wrap">
      <header className="top">
        <h1>Draper London Enquiries</h1>
        <span className="badge">SHADOW MODE · NOTHING SENDS</span>
      </header>

      <div className="stats">
        <div className="stat"><div className="n">{total}</div><div className="l">Enquiries</div></div>
        <div className="stat"><div className="n">{viewingCount}</div><div className="l">Viewing requests</div></div>
        <div className="stat"><div className="n">{eligibleCount}</div><div className="l">Eligible</div></div>
        <div className="stat"><div className="n">{draftCount}</div><div className="l">Drafts</div></div>
      </div>

      <form className="controls" method="get">
        <select name="mailbox" defaultValue={sp.mailbox ?? ""}>
          <option value="">All mailboxes</option>
          <option value="sales">sales</option>
          <option value="lettings">lettings</option>
          <option value="hello">hello</option>
        </select>
        <select name="intent" defaultValue={sp.intent ?? ""}>
          <option value="">All intents</option>
          {["viewing_request","valuation_request","landlord_enquiry","tenant_or_maintenance","supplier","recruitment","press","spam","other"].map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <select name="eligible" defaultValue={sp.eligible ?? ""}>
          <option value="">Eligible: any</option>
          <option value="yes">Eligible only</option>
          <option value="no">Ineligible only</option>
        </select>
        <select name="parseStatus" defaultValue={sp.parseStatus ?? ""}>
          <option value="">Parse: any</option>
          <option value="full">full</option>
          <option value="partial">partial</option>
          <option value="failed">failed</option>
        </select>
        <button className="btn" type="submit">Filter</button>
        <a className="btn secondary" href="/">Reset</a>
        <span className="spacer" />
        <a className="btn secondary" href={`/api/export?${exportQs}`}>Export CSV</a>
      </form>

      <div className="tablewrap">
        <div className="tablescroll">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Mailbox</th>
                <th>Applicant</th>
                <th>Email</th>
                <th>Property</th>
                <th>Parse</th>
                <th>Intent</th>
                <th>Eligible</th>
                <th>Suppressed</th>
                <th>Send time</th>
                <th>Reply</th>
                <th>Raw</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e) => {
                const d = e.decision;
                return (
                  <tr key={e.id}>
                    <td className="time">{fmt(e.receivedAt)}</td>
                    <td>
                      <div>{e.mailbox}</div>
                      <div className="small">{e.source}</div>
                    </td>
                    <td>{nullable(e.applicantName)}</td>
                    <td>
                      {e.applicantEmail ? (
                        <>
                          <div className="mono">{e.applicantEmail}</div>
                          <div className="small">via {e.emailResolvedFrom}</div>
                        </>
                      ) : (
                        <span className="null">null</span>
                      )}
                    </td>
                    <td>{nullable(e.propertyAddress ?? e.propertyReference)}</td>
                    <td>
                      <span
                        className={`pill ${
                          e.parseStatus === "full"
                            ? "green"
                            : e.parseStatus === "partial"
                            ? "amber"
                            : "red"
                        }`}
                      >
                        {e.parseStatus}
                      </span>
                      {e.parseNotes.length > 0 && (
                        <ul className="notes">
                          {e.parseNotes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>
                      {e.intent ? (
                        <>
                          <span className="pill">{e.intent}</span>
                          <div className="small mono">{e.confidence?.toFixed(2) ?? ""}</div>
                        </>
                      ) : (
                        <span className="null">null</span>
                      )}
                    </td>
                    <td>
                      {d?.eligible ? (
                        <>
                          <span className="pill green">yes</span>
                          <div className="reason">
                            {e.intent}, confidence {e.confidence?.toFixed(2)}, applicant email and property present
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="pill">no</span>
                          <div className="reason">{d?.ineligibleReason}</div>
                        </>
                      )}
                    </td>
                    <td>
                      {d?.suppressed ? (
                        <>
                          <span className="pill amber">yes</span>
                          <div className="reason">{d?.suppressionReason}</div>
                        </>
                      ) : (
                        <span className="pill">no</span>
                      )}
                    </td>
                    <td className="time">
                      <div>{fmt(d?.wouldSendAtImmediate)}</div>
                      <div className="held">{fmt(d?.wouldSendAtHeld)}</div>
                    </td>
                    <td>
                      {d?.generatedBody ? (
                        <div className="reply" dangerouslySetInnerHTML={{ __html: d.generatedBody }} />
                      ) : (
                        <span className="reply none">none</span>
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
                    <td>
                      <GradeControls
                        enquiryId={e.id}
                        initialCorrect={e.gradedClassificationCorrect}
                        initialNote={e.gradingNote}
                      />
                    </td>
                  </tr>
                );
              })}
              {enquiries.length === 0 && (
                <tr><td colSpan={13} className="empty">No enquiries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
