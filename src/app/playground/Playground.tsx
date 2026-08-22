"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaygroundResult, ScoreCheck, StageAlt } from "@/lib/playground";

// ── Prop types (shaped by the server page) ───────────────────────────────────
export interface PickerEnquiry {
  id: string;
  applicant: string | null;
  property: string | null;
  mailbox: string;
  intent: string | null;
  shape: string | null;
  hasMatch: boolean;
  hasDraft: boolean;
  receivedAt: string;
}
export interface VersionItem {
  id: string;
  name: string;
  systemPrompt: string;
  note: string | null;
  createdAt: string;
}
export interface TestSetItem {
  id: string;
  name: string;
  enquiryIds: string[];
  createdAt: string;
}
export interface RunHistoryItem {
  id: string;
  enquiryId: string;
  applicant: string | null;
  property: string | null;
  promptName: string;
  shape: string | null;
  generatedByLLM: boolean;
  wordCount: number | null;
  passCount: number;
  failCount: number;
  draftBody: string;
  batchId: string | null;
  createdAt: string;
}

type RunResult = PlaygroundResult | { enquiryId: string; error: string };
const isError = (r: RunResult): r is { enquiryId: string; error: string } =>
  "error" in r;

const PRODUCTION = "__production__";

function enquiryLabel(e: PickerEnquiry): string {
  const who = e.applicant ?? "—";
  const what = e.property ?? "(no property)";
  return `${who} · ${what}`;
}

async function callRun(body: {
  enquiryIds: string[];
  systemPrompt: string;
  promptVersionId?: string | null;
  promptName: string;
}): Promise<{ results: RunResult[] }> {
  const res = await fetch("/api/playground/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Run failed (${res.status})`);
  }
  return res.json();
}

export default function Playground({
  productionPrompt,
  enquiries,
  versions,
  testSets,
  history,
}: {
  productionPrompt: string;
  enquiries: PickerEnquiry[];
  versions: VersionItem[];
  testSets: TestSetItem[];
  history: RunHistoryItem[];
}) {
  const router = useRouter();

  // Prompt editor
  const [prompt, setPrompt] = useState(productionPrompt);
  const [sourceId, setSourceId] = useState<string>(PRODUCTION); // where the current text came from
  const sourcePrompt =
    sourceId === PRODUCTION
      ? productionPrompt
      : versions.find((v) => v.id === sourceId)?.systemPrompt ?? productionPrompt;
  const dirty = prompt !== sourcePrompt;
  const activeName =
    sourceId === PRODUCTION
      ? dirty
        ? "Production (edited)"
        : "Production"
      : (versions.find((v) => v.id === sourceId)?.name ?? "Version") + (dirty ? " (edited)" : "");

  // Save-version inline form
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enquiry selection
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [singleId, setSingleId] = useState(enquiries[0]?.id ?? "");
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [compareWith, setCompareWith] = useState<string>(""); // "", PRODUCTION, or versionId

  // Results
  const [running, setRunning] = useState(false);
  const [single, setSingle] = useState<PlaygroundResult | null>(null);
  const [compare, setCompare] = useState<PlaygroundResult | null>(null);
  const [batch, setBatch] = useState<RunResult[] | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enquiries;
    return enquiries.filter((e) =>
      `${e.applicant ?? ""} ${e.property ?? ""} ${e.intent ?? ""} ${e.mailbox}`
        .toLowerCase()
        .includes(q)
    );
  }, [enquiries, search]);

  function selectVersion(id: string) {
    setSourceId(id);
    setPrompt(id === PRODUCTION ? productionPrompt : versions.find((v) => v.id === id)?.systemPrompt ?? "");
    setShowSave(false);
  }

  async function saveVersion() {
    if (!saveName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/playground/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), systemPrompt: prompt, note: saveNote.trim() || null }),
      });
      if (!res.ok) throw new Error("Could not save version");
      setShowSave(false);
      setSaveName("");
      setSaveNote("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteVersion(id: string) {
    if (!confirm("Delete this prompt version? Saved runs are kept.")) return;
    await fetch(`/api/playground/versions?id=${id}`, { method: "DELETE" });
    if (sourceId === id) selectVersion(PRODUCTION);
    router.refresh();
  }

  const promptNameForRun = activeName;

  async function runSingle() {
    if (!singleId) return;
    setRunning(true);
    setError(null);
    setSingle(null);
    setCompare(null);
    try {
      const main = await callRun({
        enquiryIds: [singleId],
        systemPrompt: prompt,
        promptVersionId: dirty ? null : sourceId === PRODUCTION ? null : sourceId,
        promptName: promptNameForRun,
      });
      const first = main.results[0];
      if (first && !isError(first)) setSingle(first);
      else throw new Error(isError(first) ? first.error : "No result");

      if (compareWith) {
        const cmpPrompt =
          compareWith === PRODUCTION
            ? productionPrompt
            : versions.find((v) => v.id === compareWith)?.systemPrompt ?? productionPrompt;
        const cmpName =
          compareWith === PRODUCTION ? "Production" : versions.find((v) => v.id === compareWith)?.name ?? "Version";
        const cmp = await callRun({
          enquiryIds: [singleId],
          systemPrompt: cmpPrompt,
          promptVersionId: compareWith === PRODUCTION ? null : compareWith,
          promptName: cmpName,
        });
        const c = cmp.results[0];
        if (c && !isError(c)) setCompare(c);
      }
      router.refresh(); // refresh history
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function runBatch() {
    if (batchIds.length === 0) return;
    setRunning(true);
    setError(null);
    setBatch(null);
    try {
      const out = await callRun({
        enquiryIds: batchIds,
        systemPrompt: prompt,
        promptVersionId: dirty ? null : sourceId === PRODUCTION ? null : sourceId,
        promptName: promptNameForRun,
      });
      setBatch(out.results);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function toggleBatch(id: string) {
    setBatchIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  // Pick a diverse spread: distinct intent × shape × match-state, up to 10.
  function suggestDiverse() {
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const e of enquiries) {
      const key = `${e.intent ?? "?"}|${e.shape ?? "?"}|${e.hasMatch ? "m" : "n"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(e.id);
      if (picked.length >= 10) break;
    }
    setBatchIds(picked);
  }

  async function saveTestSet() {
    if (batchIds.length === 0) return;
    const name = window.prompt("Name this test set:", "Regression set");
    if (!name) return;
    await fetch("/api/playground/testsets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, enquiryIds: batchIds }),
    });
    router.refresh();
  }

  return (
    <div className="wrap pg">
      <div className="pg-head">
        <div>
          <h1 className="pagetitle" style={{ marginBottom: 4 }}>Playground</h1>
          <div className="small">Prompt sandbox. Test system-prompt versions against real enquiries.</div>
        </div>
        <span className="pill green pg-safe">● Read-only — nothing is ever sent</span>
      </div>

      <div className="pg-grid">
        {/* ── Prompt editor ─────────────────────────────────────────── */}
        <section className="pg-card pg-editor">
          <div className="pg-card-head">
            <span className="pg-card-title">System prompt</span>
            <span className="pg-active" title={activeName}>{activeName}</span>
          </div>

          <div className="pg-editor-controls">
            <select value={sourceId} onChange={(e) => selectVersion(e.target.value)}>
              <option value={PRODUCTION}>Production (baseline)</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <button className="btn secondary" onClick={() => setPrompt(sourcePrompt)} disabled={!dirty}>
              Reset
            </button>
            <button className="btn" onClick={() => setShowSave((s) => !s)}>Save as version</button>
            {sourceId !== PRODUCTION && (
              <button className="linkbtn pg-del" onClick={() => deleteVersion(sourceId)}>Delete</button>
            )}
          </div>

          {showSave && (
            <div className="pg-save">
              <input
                className="search"
                placeholder="Version name, e.g. v6 — ban gushing openers"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <input
                className="search"
                placeholder="Note: what changed and why (optional)"
                value={saveNote}
                onChange={(e) => setSaveNote(e.target.value)}
              />
              <button className="btn" onClick={saveVersion} disabled={busy || !saveName.trim()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}

          <textarea
            className="pg-textarea"
            spellCheck={false}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="pg-editor-foot small">
            <span>{prompt.length.toLocaleString()} chars</span>
            {dirty && <span className="pg-dirty">● unsaved edits</span>}
          </div>
        </section>

        {/* ── Run panel ─────────────────────────────────────────────── */}
        <section className="pg-card pg-run">
          <div className="pg-card-head">
            <span className="pg-card-title">Run</span>
            <div className="pg-mode">
              <button className={mode === "single" ? "on" : ""} onClick={() => setMode("single")}>Single</button>
              <button className={mode === "batch" ? "on" : ""} onClick={() => setMode("batch")}>Test set</button>
            </div>
          </div>

          <input
            className="search pg-search"
            placeholder="Search enquiries…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {mode === "single" ? (
            <>
              <div className="pg-picker">
                {filtered.map((e) => (
                  <label key={e.id} className={`pg-pick ${singleId === e.id ? "sel" : ""}`}>
                    <input
                      type="radio"
                      name="single"
                      checked={singleId === e.id}
                      onChange={() => setSingleId(e.id)}
                    />
                    <span className="pg-pick-main">{enquiryLabel(e)}</span>
                    <span className="pg-pick-tags">
                      <span className="pill mute">{e.mailbox}</span>
                      {e.shape && <span className="pill blue">Shape {e.shape}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div className="pg-compare-row">
                <label className="small">Compare with</label>
                <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
                  <option value="">— none —</option>
                  <option value={PRODUCTION}>Production (baseline)</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
              <button className="btn pg-runbtn" onClick={runSingle} disabled={running || !singleId}>
                {running ? "Running…" : "Run"}
              </button>
            </>
          ) : (
            <>
              <div className="pg-batch-controls">
                <button className="btn secondary" onClick={suggestDiverse}>Suggest diverse set</button>
                <button className="btn secondary" onClick={() => setBatchIds([])} disabled={!batchIds.length}>Clear</button>
                <button className="btn secondary" onClick={saveTestSet} disabled={!batchIds.length}>Save set</button>
                {testSets.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const t = testSets.find((x) => x.id === e.target.value);
                      if (t) setBatchIds(t.enquiryIds.filter((id) => enquiries.some((q) => q.id === id)));
                    }}
                  >
                    <option value="">Load saved set…</option>
                    {testSets.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.enquiryIds.length})</option>
                    ))}
                  </select>
                )}
                <span className="small pg-count">{batchIds.length} selected</span>
              </div>
              <div className="pg-picker">
                {filtered.map((e) => (
                  <label key={e.id} className={`pg-pick ${batchIds.includes(e.id) ? "sel" : ""}`}>
                    <input type="checkbox" checked={batchIds.includes(e.id)} onChange={() => toggleBatch(e.id)} />
                    <span className="pg-pick-main">{enquiryLabel(e)}</span>
                    <span className="pg-pick-tags">
                      <span className="pill mute">{e.mailbox}</span>
                      {e.shape && <span className="pill blue">Shape {e.shape}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <button className="btn pg-runbtn" onClick={runBatch} disabled={running || !batchIds.length}>
                {running ? `Running ${batchIds.length}…` : `Run across ${batchIds.length}`}
              </button>
            </>
          )}

          {error && <div className="pg-error">{error}</div>}
        </section>
      </div>

      {/* ── Results ─────────────────────────────────────────────────── */}
      {mode === "single" && single && (
        <SingleResult result={single} compare={compare} compareName={
          compareWith === PRODUCTION ? "Production" : versions.find((v) => v.id === compareWith)?.name ?? null
        } activeName={promptNameForRun} />
      )}

      {mode === "batch" && batch && <BatchResult results={batch} enquiries={enquiries} />}

      {/* ── Run history ─────────────────────────────────────────────── */}
      {history.length > 0 && (
        <section className="pg-card pg-history">
          <div className="pg-card-head"><span className="pg-card-title">Recent runs</span></div>
          <div className="tablescroll">
            <table className="pg-hist-table">
              <thead>
                <tr>
                  <th>When</th><th>Enquiry</th><th>Prompt</th><th>Shape</th><th>Words</th><th>Checks</th><th>Draft</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="time small">{new Date(h.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="small">{h.applicant ?? "—"}<div className="faintdash">{h.property ?? ""}</div></td>
                    <td className="small">{h.promptName}</td>
                    <td>{h.shape ? <span className="pill blue">{h.shape}</span> : "—"}{!h.generatedByLLM && <span className="pill amber" style={{ marginLeft: 4 }}>fallback</span>}</td>
                    <td className="mono small">{h.wordCount ?? "—"}</td>
                    <td><span className={`pill ${h.failCount === 0 ? "green" : "red"}`}>{h.passCount}/{h.passCount + h.failCount}</span></td>
                    <td><div className="reply pg-hist-reply" dangerouslySetInnerHTML={{ __html: h.draftBody }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Single result: stages + draft (+ optional compare column) ────────────────
function SingleResult({
  result,
  compare,
  compareName,
  activeName,
}: {
  result: PlaygroundResult;
  compare: PlaygroundResult | null;
  compareName: string | null;
  activeName: string;
}) {
  return (
    <div className="pg-results">
      <Stages result={result} />
      <div className={`pg-drafts ${compare ? "two" : "one"}`}>
        <DraftCard result={result} label={activeName} />
        {compare && compareName && <DraftCard result={compare} label={compareName} />}
      </div>
    </div>
  );
}

function Stages({ result }: { result: PlaygroundResult }) {
  const m = result.match;
  const c = result.classification;
  return (
    <div className="pg-stages">
      <StageRow label="Applicant">
        <div className="strong">{result.extraction.applicantName ?? "—"}</div>
        <div className="small mono">{result.extraction.applicantEmail ?? "no email"}</div>
        <div className="small faintdash">{result.extraction.source} · via {result.extraction.emailResolvedFrom}</div>
      </StageRow>

      <StageRow label="Listing match">
        {m.matched ? (
          <>
            <div className="strong">{m.title ?? "—"}</div>
            <div className="small mono">
              {[m.priceFormatted, m.bedrooms != null ? `${m.bedrooms} bed` : null, m.type].filter(Boolean).join(" · ")}
            </div>
            <div className="small">
              <span className={`pill ${m.trusted ? "green" : "red"}`}>{Math.round(m.confidence * 100)}% · {m.method}</span>
              {m.status && <span className="pill mute" style={{ marginLeft: 4 }}>{m.status}</span>}
              {!m.trusted && <span className="small faintdash" style={{ marginLeft: 6 }}>not trusted</span>}
            </div>
          </>
        ) : (
          <span className="faintdash">no listing match</span>
        )}
      </StageRow>

      <StageRow label="Alternatives">
        {result.alternatives.length ? (
          <ul className="pg-alts">
            {result.alternatives.map((a: StageAlt) => (
              <li key={a.id}>{a.title ?? a.url}{a.priceFormatted ? ` · ${a.priceFormatted}` : ""}</li>
            ))}
          </ul>
        ) : (
          <span className="faintdash">none picked</span>
        )}
      </StageRow>

      <StageRow label="Classification">
        <div className="strong">{c.intent ?? "—"}</div>
        <div className="small mono">{c.confidence != null ? c.confidence.toFixed(2) : "—"} · reused from stored</div>
        {c.factualQuestion && <div className="small">Q: {c.factualQuestion}</div>}
        {c.proposedTime && <div className="small">Proposed: {c.proposedTime}</div>}
      </StageRow>

      <StageRow label="Routing">
        <div className="strong">{result.routing.owner}</div>
        <div className="small faintdash">{result.routing.reason}</div>
      </StageRow>
    </div>
  );
}

function StageRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pg-stage">
      <div className="pg-stage-label">{label}</div>
      <div className="pg-stage-body">{children}</div>
    </div>
  );
}

function DraftCard({ result, label }: { result: PlaygroundResult; label: string }) {
  const d = result.draft;
  return (
    <div className="pg-draft">
      <div className="pg-draft-head">
        <span className="pg-draft-label">{label}</span>
        <span className="pg-draft-meta">
          <span className="pill blue">Shape {d.shape}</span>
          <span className="pill mute">{d.wordCount} words</span>
          {!d.generatedByLLM && <span className="pill amber">template fallback</span>}
        </span>
      </div>
      <div className="reply pg-draft-body" dangerouslySetInnerHTML={{ __html: d.body }} />
      <Scorecard checks={result.scorecard} />
    </div>
  );
}

function Scorecard({ checks }: { checks: ScoreCheck[] }) {
  return (
    <div className="pg-score">
      {checks.map((c) => (
        <span key={c.id} className={`pg-chk ${c.pass ? "ok" : "bad"}`} title={c.detail ?? ""}>
          {c.pass ? "✓" : "✕"} {c.label}
        </span>
      ))}
    </div>
  );
}

// ── Batch result: a grid of drafts + scorecards ──────────────────────────────
function BatchResult({ results, enquiries }: { results: RunResult[]; enquiries: PickerEnquiry[] }) {
  const label = (id: string) => {
    const e = enquiries.find((x) => x.id === id);
    return e ? enquiryLabel(e) : id;
  };
  const passed = results.filter((r) => !isError(r) && (r as PlaygroundResult).failCount === 0).length;
  const clean = results.filter((r) => !isError(r));
  return (
    <div className="pg-card pg-batch">
      <div className="pg-card-head">
        <span className="pg-card-title">Test set results</span>
        <span className="pill green">{passed}/{clean.length} pass all checks</span>
      </div>
      <div className="tablescroll">
        <table className="pg-batch-table">
          <thead>
            <tr><th>Enquiry</th><th>Shape</th><th>Words</th><th>Checks</th><th>Draft</th></tr>
          </thead>
          <tbody>
            {results.map((r) => {
              if (isError(r)) {
                return (
                  <tr key={r.enquiryId}><td className="small">{label(r.enquiryId)}</td><td colSpan={4} className="pg-error-cell">error: {r.error}</td></tr>
                );
              }
              const res = r as PlaygroundResult;
              return (
                <tr key={res.enquiryId}>
                  <td className="small">{label(res.enquiryId)}</td>
                  <td>
                    <span className="pill blue">{res.draft.shape}</span>
                    {!res.draft.generatedByLLM && <span className="pill amber" style={{ marginLeft: 4 }}>fallback</span>}
                  </td>
                  <td className="mono small">{res.draft.wordCount}</td>
                  <td>
                    <span className={`pill ${res.failCount === 0 ? "green" : "red"}`}>{res.passCount}/{res.passCount + res.failCount}</span>
                    {res.failCount > 0 && (
                      <div className="small pg-fail-list">
                        {res.scorecard.filter((c) => !c.pass).map((c) => c.label).join(", ")}
                      </div>
                    )}
                  </td>
                  <td><div className="reply pg-hist-reply" dangerouslySetInnerHTML={{ __html: res.draft.body }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
