"use client";

import { useState } from "react";
import { ASSIGNEES } from "@/lib/assignees";

export default function AssignControls({
  enquiryId,
  current,
  isDefault,
  readOnly = false,
}: {
  enquiryId: string;
  current: string;
  isDefault: boolean;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const [overridden, setOverridden] = useState(!isDefault);

  async function change(next: string) {
    setValue(next);
    setSaved(false);
    if (readOnly) return;
    const res = await fetch(`/api/enquiries/${enquiryId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo: next }),
    });
    if (res.ok) {
      setOverridden(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  return (
    <div className="assign">
      <select
        value={value}
        disabled={readOnly}
        onChange={(e) => change(e.target.value)}
      >
        {ASSIGNEES.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      <span className="assign-tag">
        {saved ? "saved" : overridden ? "assigned" : "default"}
      </span>
    </div>
  );
}
