# Draper London — Inbound Enquiry Automation (v1, Shadow Mode)

> **The one rule (spec §0): nothing sends.** Not to applicants, not to staff, not to
> anyone. This service reads three Office 365 mailboxes, decides what it *would* do,
> writes that decision down, and stops. The app is granted **`Mail.Read` only**, so a
> send is impossible rather than merely unused. `RUN_MODE` must be `shadow` or the app
> refuses to boot.

v1 is a **measuring instrument**, not an email sender. It runs for ~a week on real
traffic and produces a graded dataset that decides whether phase 2 (actual sending) is
safe.

---

## Stack, and why

| Concern | Choice | Why |
|---|---|---|
| Runtime + framework | **Next.js (App Router) + TypeScript** | One deployable unit hosts *both* the Graph webhook endpoint and the review UI. |
| Database | **PostgreSQL + Prisma** | The graded records are the deliverable; a JSON file is explicitly not adequate (§3). |
| Mail access | **Microsoft Graph** (`@azure/identity` + `@microsoft/microsoft-graph-client`), app-only | Standard supported way to read M365 shared mailboxes. `Mail.Read` only. |
| LLM | **Anthropic Claude** (`ANTHROPIC_MODEL`, default `claude-sonnet-5`) | Used only for free-text + classification + generation, never as the primary parser. Has a deterministic fallback so the pipeline never hard-depends on it. |
| Host | **Render** — web service + managed Postgres + two cron jobs | Stable public HTTPS URL with a valid cert (Graph requires it), plus cron for renewal/backstop. |

## Architecture (spec §4)

```
Graph change notifications
        │  (webhook: /api/graph/notifications)
        ▼
  INGEST ─► PARSE ─► CLASSIFY ─┬─► ENRICH (null in v1)
                               └─► DECIDE ─► GENERATE ─► Persist + Review UI
                                                        Transport      = NoOp (saves, never sends)
                                                        AssignmentSink  = Logging only
```

Each component is a separate module under `src/lib/`. Phase 2 swaps exactly one
(`transport.ts`), phase 3 swaps exactly one more (`enrich.ts`). Nothing else changes.

- `src/lib/graph.ts` — auth, message fetch, subscriptions, delta, conversation lookup
- `src/lib/parse.ts` — deterministic extraction; applicant-email resolution From→Reply-To→body (§6.2)
- `src/lib/classify.ts` — Claude intent + confidence, deterministic heuristic fallback (§6.5)
- `src/lib/enrich.ts` — `EnrichmentProvider` + `NullEnrichmentProvider` (default) (§7.1)
- `src/lib/decide.ts` — eligibility gates, suppression, dedupe, send-windows (§8)
- `src/lib/generate.ts` — config-driven copy, ≤120 words, variation, stores exact prompt (§7.2)
- `src/lib/transport.ts` — `NoOpTransport` (§9). **No sendMail path exists.**
- `src/lib/assignment.ts` — `LoggingAssignmentSink` (§9)
- `src/lib/pipeline.ts` — orchestrates all of the above; idempotent on Graph message id

## Run locally

Prereqs: Node 20+, a local Postgres (or a Render/Neon URL).

```bash
npm install
cp .env.example .env.local        # fill in values; placeholders are fine to start
npx prisma migrate dev --name init
npm run dev                        # http://localhost:3000
```

You don't need live Graph credentials to see the whole thing work — feed synthetic
enquiries through the real pipeline:

```bash
npm run simulate
```

Then open http://localhost:3000, grade the rows, and try **Export CSV**. Run the
report:

```bash
npm run report
```

## Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point at this repo. `render.yaml` provisions the web
   service, Postgres, and the two cron jobs.
3. Set the `sync: false` secrets in the dashboard: `TENANT_ID`, `CLIENT_ID`,
   `CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `GRAPH_CLIENT_STATE` (a long random string),
   `CRON_SECRET`, `MAILBOX_SALES/LETTINGS/HELLO`, and `PUBLIC_URL` (your Render URL,
   e.g. `https://draper-shadow.onrender.com`).
4. First deploy runs `prisma migrate deploy` automatically.
5. Create the Graph subscriptions once the service is live and `PUBLIC_URL` is set:
   ```bash
   npm run subscriptions:create      # run against prod env (Render shell or locally with prod env)
   ```
   The renew cron (every 6h) and delta backstop (every 15m) then keep it healthy.

Health check: `GET /api/health` reports mode, `sends:false`, enquiry count, and
subscription expiry.

## Configuration without a deploy (spec §13)

Copy rules live in [`config/generation.json`](config/generation.json) — the system
prompt, the approved phrasings, the per-mailbox `{{SIGNATURE}}`, the word limit, and the
`confidenceThreshold`. Innate can tune these during the shadow week. Editing the file +
redeploy is the current mechanism; because it's a single JSON file (not code), it can be
promoted to a DB/remote-config lookup later without touching the pipeline.

## Rotating the Graph client secret

1. In Entra ID → App registrations → your app → Certificates & secrets, create a new
   secret and copy its **Value**.
2. Update `CLIENT_SECRET` in Render (and `.env.local`).
3. Redeploy. Set a calendar reminder before the new secret's expiry.

Graph credentials are tenant-wide credentials for a client's email — treat them
accordingly (§12). They live only in the host secret store, never in the repo.

## What breaks if a portal changes its email template

Parsing is deterministic (`src/lib/parse.ts`) against labelled lines. If Rightmove or
Zoopla changes its template, affected fields go null and `parse_status` becomes
`partial`/`failed` — **the pipeline never crashes** (§6.4); it persists the raw message
and continues. Watch the **parse-failure rate** in the report / review UI: a sudden rise
is the signal a template changed. Fix by adjusting the label lists in `parse.ts`; the raw
message is retained on every row so you can fix against the original.

## Human-reply metrics (spec §11 rows 6 & 7)

Reply-direct vs reply-all, and time-to-first-human-reply, require analysing **sent
items** across each enquiry thread (`conversationSentAfter` in `graph.ts` is the
building block). v1 stores the hooks (`isReplyAllRequired`) but does not populate them
automatically; the report flags these as "not captured" so they're filled deliberately
rather than guessed. This is the baseline the whole project is measured against — capture
it before go-live review.

## Data handling (spec §12)

- Applicant enquiries are members of the public's personal data. The approved LLM
  provider is **Anthropic** (confirmed). Confirm retention terms before go-live.
- Attachment **bodies** are never stored — metadata only.
- Set a retention policy on `Enquiry.rawBody*` from the start (a scheduled delete of rows
  older than the agreed window).
- No production data in dev/test environments.

## Safety notes

- `assertShadowMode()` runs at every entry point (routes + scripts). Any `RUN_MODE`
  other than `shadow` aborts startup.
- `NoOpTransport.send()` returns `sent: false` at the type level and has no Graph send
  call. `transport.ts` is the single file phase 2 will replace.
- The app requests `Mail.Read` only. If the tenant admin granted more, say so rather than
  using it (§5).
