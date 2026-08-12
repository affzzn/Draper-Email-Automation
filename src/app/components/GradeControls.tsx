"use client";

import { useState } from "react";

export default function GradeControls({
  enquiryId,
  initialCorrect,
  initialNote,
  readOnly = false,
}: {
  enquiryId: string;
  initialCorrect: boolean | null;
  initialNote: string | null;
  readOnly?: boolean;
}) {
  const [correct, setCorrect] = useState<boolean | null>(initialCorrect);
  const [note, setNote] = useState(initialNote ?? "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(next: {
    classificationCorrect?: boolean | null;
    note?: string;
  }) {
    if (readOnly) return; // read-only demo: grading is disabled
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classificationCorrect:
            next.classificationCorrect !== undefined ? next.classificationCorrect : correct,
          note: next.note !== undefined ? next.note : note,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grade">
      <div className="row">
        <button
          className={correct === true ? "on-correct" : ""}
          disabled={busy || readOnly}
          onClick={() => {
            const v = correct === true ? null : true;
            setCorrect(v);
            save({ classificationCorrect: v });
          }}
        >
          ✓ Correct
        </button>
        <button
          className={correct === false ? "on-wrong" : ""}
          disabled={busy || readOnly}
          onClick={() => {
            const v = correct === false ? null : false;
            setCorrect(v);
            save({ classificationCorrect: v });
          }}
        >
          ✗ Wrong
        </button>
      </div>
      <textarea
        placeholder={readOnly ? "read-only" : "Note…"}
        value={note}
        disabled={readOnly}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => save({ note })}
      />
      {saved && <span className="saved">saved</span>}
    </div>
  );
}
