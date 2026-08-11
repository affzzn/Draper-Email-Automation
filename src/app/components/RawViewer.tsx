"use client";

import { useState } from "react";

export default function RawViewer({
  subject,
  body,
  parseStatus,
  emailResolvedFrom,
}: {
  subject: string;
  body: string;
  parseStatus: string;
  emailResolvedFrom: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="linkbtn" onClick={() => setOpen(true)}>
        view
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{subject || "(no subject)"}</div>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-meta">
              <span>parse: {parseStatus}</span>
              <span>email resolved: {emailResolvedFrom}</span>
            </div>
            <pre className="modal-body">{body || "(empty message body)"}</pre>
          </div>
        </div>
      )}
    </>
  );
}
