"use client";

import { useState } from "react";

type Member = { name: string; available: boolean };

// §3.5: per-person in/out toggle. Anyone "out" is skipped by the router (their
// enquiries fall to Craig) until they are toggled back in — no deploy needed.
export default function TeamToggles({
  members,
  readOnly = false,
}: {
  members: Member[];
  readOnly?: boolean;
}) {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(members.map((m) => [m.name, m.available]))
  );

  async function toggle(name: string) {
    if (readOnly) return;
    const next = !state[name];
    setState((s) => ({ ...s, [name]: next }));
    const res = await fetch(`/api/team/${name}/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: next }),
    });
    if (!res.ok) setState((s) => ({ ...s, [name]: !next })); // revert on failure
  }

  return (
    <div className="team-toggles">
      <span className="team-label">Who's in today</span>
      {members.map((m) => (
        <label key={m.name} className={`team-chip ${state[m.name] ? "in" : "out"}`}>
          <input
            type="checkbox"
            checked={state[m.name]}
            disabled={readOnly}
            onChange={() => toggle(m.name)}
          />
          {m.name}
          <span className="team-state">{state[m.name] ? "in" : "out"}</span>
        </label>
      ))}
    </div>
  );
}
