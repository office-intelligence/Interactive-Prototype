# Office Intelligence — Database, API & Azure Deployment Handoff

**Purpose of this document:** the app in this repo is a fully-designed frontend (React 19 + TypeScript + Vite 6 + Express) running entirely on mock, in-memory/localStorage data — there is no database and no real API layer yet. This document catalogs exactly what exists today, proposes a starting Postgres schema and REST API surface derived from that catalog, and lays out an Azure deployment plan. It's written for the person picking this up next (your partner), so they can start designing/building rather than re-deriving all of this from the UI code.

Nothing here is final — it's a well-researched starting proposal. Sections marked **"Decision needed"** are genuine judgment calls left open for whoever builds this.

---

## 1. Current State (as of this handoff)

- **Stack:** React 19.0.1, Vite 6.2.3, TypeScript 5.8.2 (checked via `tsc --noEmit`, no separate build-time enforcement), Tailwind CSS 4, Express 4.21.2, `@google/genai` (Gemini) for the two existing AI endpoints.
- **Server (`server.ts`):** thin Express wrapper — in dev it mounts Vite's middleware; in production it serves the built `dist/` folder with SPA fallback (`app.get('*', ...)`). Only two real API routes exist, both AI, neither touching a database:
  - `GET /api/health`
  - `POST /api/ai/chat` (Gemini `gemini-3.6-flash`, falls back to a canned response if `GEMINI_API_KEY` is unset)
  - `POST /api/ai/analyze-bottlenecks` (same pattern)
- **No database client/ORM in `package.json`** (no `pg`, `prisma`, `drizzle`, `knex`, `mongoose`, etc.). All "persistence" today is:
  - React `useState` held at the top of `App.tsx` and passed down as props, or
  - `localStorage` (see `utils/portalMessageStore.ts`) — browser-local, per-device, non-durable, and invisible to any other user.
- **No real auth.** `LoginPage.tsx` accepts any non-empty credentials and derives a fake name/role by substring-matching the entered email (`'ceo'` → CEO role, `'vance'`/`'mercer'` → surgeon, etc.). No password hashing, no tokens, no server-side check.
- **No real file storage.** Patient photo capture (`PatientChartPage.tsx`), document uploads (`AdministrationPage.tsx`, intake pipeline), and ID/insurance card images (`utils/cardTemplates.ts`) all use `URL.createObjectURL()` or generated SVG data-URIs — nothing is actually uploaded anywhere, and it's lost on refresh.
- **Data model is currently fragmented** — the same conceptual "patient" is represented three different ways in three different files, with an id-normalization hack bridging them (see §3, "Decision needed" #1). This is the single most important thing for whoever builds the real schema to resolve deliberately, rather than accidentally.

Everything below is derived from a full pass over `src/types.ts`, `src/data/*.ts`, and `src/utils/*.ts`.

---

## 2. Proposed Postgres Schema

This groups tables by domain. All tables get `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` unless noted. Every table except global/reference tables carries `practice_id` for multi-tenancy.

### Practice / Org
- **practices** — name, location_name, is_satellite, is_primary, practice_type, specialty, street_address, city, state, zip_code, country, telephone, email, website, calendar_start_time, calendar_end_time.
- **practice_rooms** — practice_id fk, name, color, type (`OR`/`Procedure`/`Consult`/`Recovery`).
- **practice_visit_types** — practice_id fk, name, color, duration_mins.
- **providers** — practice_id fk, first_name, last_name, degree, specialty, email, cell_phone, npi, color_code, is_primary.
- **eprescribe_configs** (1:1 practices) — surescripts_id, dea_number, epcs_token_serial, spi_number, state_license, default_pharmacy_network, two_factor_auth_enabled, status. *Store the actual secrets (tokens) in Key Vault, not raw columns.*
- **credit_card_configs** (1:1 practices) — merchant_account_id, gateway_provider, terminal_id, surcharge_pct, hsa_fsa_accepted, auto_receipt_mode, status.

### Users / Auth
- **users** — practice_id fk (nullable for CEO/global users), email (unique), password_hash, first_name, last_name, phone, role (`PRACTICE_ADMIN`/`STAFF`/`CEO`/`PROVIDER`/…), title, is_active, mfa_enabled, last_login_at.
- **employees** (1:1 users, HR-specific fields) — employment_status, pay_classification, hourly_rate, annual_salary, start_date, mobile_access_enabled, license_number, license_expiration, account_lock_state.
- **time_clock_entries** — employee_id fk, clock_in, clock_out, break_minutes, total_hours, role, status, flagged_for_review, flag_reason.
- **timesheet_periods** — practice_id fk, period_label, start_date, end_date, status, total_regular_hours, total_overtime_hours, total_pto_hours, employee_count, exceptions_count, approved_by fk users, approved_at.

### Patients (canonical — see Decision Needed #1)
- **patients** — practice_id fk, mrn (unique per practice), first_name, last_name, dob, gender, phone, email, street_address, city, state, zip_code, photo_blob_url, emergency_contact_name, emergency_contact_phone, preferred_pharmacy.
- **patient_insurance** — patient_id fk, payer_name, policy_id, group_number, prior_auth_number, verified_at, card_front_blob_url, card_back_blob_url.
- **patient_allergies** — patient_id fk, allergen, reaction_note, severity, is_drug_allergy bool (drives the header's NKDA/drug-allergy banner).
- **patient_medications** — patient_id fk, name, dosage, frequency, active bool.
- **patient_conditions** — patient_id fk, condition_name, status, noted_at.

### Encounters / Schedule (replaces `PatientCase` + hardcoded `dateCases.ts` + `HISTORICAL_APPOINTMENT_DATA`)
- **encounters** — practice_id fk, patient_id fk, scheduled_time, estimated_duration_mins, room_id fk, surgeon_id fk providers, anesthesiologist_id fk providers, procedure_description, ai_summary, previous_visit_summary, readiness_score, readiness_level, stage, pre_op_bay, pacu_bay, arrival_status, arrival_time, payment_type, notes.
- **encounter_labs** — encounter_id fk, name, value, status.
- **encounter_action_items** — encounter_id fk, text, type (`EKG`/`PHOTO`/`ANESTHESIA`/`IMPLANT`/`CONSENT`/`TRANSPORT`), done, urgent, resolved_at, resolved_by fk users. *This is the live "9-step checklist / readiness" data the Nightingale AI panel already reads from.*
- **encounter_bottleneck_alerts** — encounter_id fk, severity, title, impact, recommendation, ai_confidence, time_sensitivity, resolved_at.

### Tasks
- **tasks** — practice_id fk, title, patient_id fk nullable, encounter_id fk nullable, due_date, priority, category, completed, assigned_to fk users.

### Messaging (replaces `portalMessageStore.ts`'s localStorage store)
- **portal_messages** — practice_id fk, patient_id fk, provider_id fk nullable, sender_type (`patient`/`provider`/`system`), sender_name, sender_title, category, content, read bool.
- **message_attachments** — message_id fk, file_name, blob_url, size_bytes, content_type.

### Documents / Intake (OCR pipeline — maps to `IntakeDocument`/`ConfidenceScore`/`DocumentReviewDecision` types)
- **portal_documents** — patient_id fk, practice_id fk, file_name, file_type, blob_url, uploaded_by (`Practice`/`Patient`).
- **intake_documents** — practice_id fk, file_name, source, document_type, received_at, matched_patient_id fk nullable, overall_confidence, needs_human_review, review_reason, assigned_to fk users, status, blob_url.
- **intake_document_fields** — intake_document_id fk, field_name, extracted_value, confidence, match_status.
- **intake_document_review_decisions** (append-only audit log) — intake_document_id fk, decided_by fk users, decided_at, action, notes.
- **intake_forms** — patient_id fk, encounter_id fk nullable, form_key, title, status, submitted_at, `data jsonb` (form answers are arbitrary key/value in the mock data — jsonb is the right fit here rather than forcing a rigid column set).

### Billing
- **prescriptions** — patient_id fk, encounter_id fk nullable, medication_name, dosage, prescriber_id fk providers, pharmacy, status, sent_at.
- **bills** — patient_id fk, encounter_id fk nullable, total_charge, insurance_discount, patient_owes, status.
- **bill_line_items** — bill_id fk, description, charge, insurance_discount, patient_owes.

### Legal / Compliance (append-only, audit-grade)
- **legal_agreements** — category, title, summary, version, effective_date, body, required_for_roles text[].
- **agreement_acceptances** — agreement_id fk, version, accepted_at, accepted_by_user_id fk users, acceptance_method, ip_address. *Never update/delete rows here — insert-only, this is the e-signature audit trail.*

### CEO / Business Console
Recommend implementing `ceo_practice_summaries` and `ceo_business_metrics` as **Postgres views** (or materialized views, refreshed periodically) over the tables above — aggregating counts/revenue/compliance scores — rather than separate writable tables. See Decision Needed #4 for why this matters more than it looks.

---

## 3. Decisions Needed (flag these to your partner before they start)

1. **Canonical patient identity.** The mock data currently has *three* competing "patient" shapes: `PatientCase` (schedule-side), `MasterPatientRecord` (directory-side, in `patientDirectory.ts`), and `PortalPatientProfile` (portal-side, in `portalData.ts`) — plus a `normalizePatientId()` function that maps legacy `case-1`, `case-2`... IDs to numeric MRNs. The real schema should have **one** `patients` table with one PK and one unique MRN. Recommend the API layer's DTOs keep returning a `patientId` string field shaped like the frontend already expects (the MRN), so most components don't need to change — only the data-fetching layer does.
2. **ORM.** Prisma (best TypeScript DX, built-in migrations, matches the all-TS codebase) vs. Drizzle (lighter, more SQL-forward) vs. raw `pg` + hand-written queries. Your partner's call given their DB background — either is a fine fit for Azure Database for PostgreSQL.
3. **Auth approach.** Roll-your-own (bcrypt + JWT, fastest to stand up, full control) vs. Azure Entra ID External ID / B2C (more infrastructure, but offloads MFA/password policy/compliance surface). This is a healthcare app, so leaning toward whichever gets you to a defensible audit story fastest — worth a real conversation, not just a default.
4. **CEO console PHI isolation.** `App.tsx` already has a comment noting the CEO/business console is meant to be a "break-glass access model" — CEO users should see `CeoPracticeSummary`/`CeoBusinessMetrics` (revenue, compliance scores, seat counts) but **never** raw patient data. Recommend enforcing this at the database level (separate views/schema with restricted `GRANT`s, or Postgres Row-Level Security) rather than only in application code, since app-level-only enforcement is one bug away from a PHI leak.
5. **Multi-tenancy isolation.** Shared database with `practice_id` + Postgres Row-Level Security (simplest, probably right for the likely practice count) vs. schema-per-tenant vs. database-per-tenant. RLS is the usual right answer at this scale, but worth your partner's sign-off.
6. **Real-time messaging.** The current "live" message updates use a `localStorage` + `CustomEvent` hack that only works within one browser tab. A real deployment needs either Azure SignalR Service (true push), or a simpler polling interval as a v1 stopgap.

---

## 4. Proposed API Surface (REST, `/api/v1/*`)

Each line maps directly to a function already identified in the frontend (see the research catalog in §6 if you want the original file/line references).

```
Auth
  POST   /api/v1/auth/login
  POST   /api/v1/auth/logout
  POST   /api/v1/auth/refresh
  POST   /api/v1/auth/forgot-password
  GET    /api/v1/auth/me

Practices
  GET    /api/v1/practices
  POST   /api/v1/practices
  GET    /api/v1/practices/:id
  PATCH  /api/v1/practices/:id
  DELETE /api/v1/practices/:id
  GET    /api/v1/practices/:id/rooms
  GET    /api/v1/practices/:id/visit-types
  GET    /api/v1/practices/:id/providers

Patients
  GET    /api/v1/patients?search=&practiceId=      (typeahead: min 3 chars, matches name/DOB/MRN/phone today)
  POST   /api/v1/patients
  GET    /api/v1/patients/:id
  PATCH  /api/v1/patients/:id
  POST   /api/v1/patients/:id/photo                (multipart -> blob storage)
  GET    /api/v1/patients/:id/allergies
  POST   /api/v1/patients/:id/allergies
  GET    /api/v1/patients/:id/medications
  POST   /api/v1/patients/:id/medications
  GET    /api/v1/patients/:id/appointment-history

Encounters / Schedule
  GET    /api/v1/encounters?date=&practiceId=&patientId=
  POST   /api/v1/encounters
  GET    /api/v1/encounters/:id
  PATCH  /api/v1/encounters/:id
  GET    /api/v1/encounters/:id/action-items
  PATCH  /api/v1/encounters/:id/action-items/:itemId

Tasks
  GET    /api/v1/tasks
  POST   /api/v1/tasks
  PATCH  /api/v1/tasks/:id

Messages
  GET    /api/v1/messages?patientId=&unread=
  POST   /api/v1/messages
  PATCH  /api/v1/messages/:id/read
  DELETE /api/v1/messages/:id

Documents / Intake
  POST   /api/v1/documents                          (multipart upload)
  GET    /api/v1/documents/:id
  POST   /api/v1/documents/:id/review-decisions
  GET    /api/v1/intake-forms
  POST   /api/v1/intake-forms

Billing
  GET    /api/v1/patients/:id/bills
  POST   /api/v1/bills

Legal / Compliance
  GET    /api/v1/legal-agreements
  POST   /api/v1/legal-agreements/:id/accept

Payroll / HR
  GET    /api/v1/employees
  POST   /api/v1/employees/:id/time-clock
  GET    /api/v1/timesheet-periods

CEO / Business (separate auth scope — never touches patient tables)
  GET    /api/v1/ceo/practice-summaries
  GET    /api/v1/ceo/business-metrics

AI (already implemented — just add auth + rate limiting)
  POST   /api/ai/chat
  POST   /api/ai/analyze-bottlenecks
```

---

## 5. Azure Deployment Plan

| Concern | Recommendation |
|---|---|
| **App hosting** | Azure App Service (Linux, Node 22) — keep the existing `server.ts` pattern (Express serves both the API and the built SPA). Simplest path from what exists today; Azure Static Web Apps is an alternative if you want the frontend fully decoupled from the API later. |
| **Database** | Azure Database for PostgreSQL – Flexible Server. Enable SSL enforcement, VNet/private networking, automated backups. |
| **File/blob storage** | Azure Blob Storage, private containers, short-lived SAS URLs served to the frontend (never public blob URLs) — for patient photos, documents, ID/insurance card images, message attachments. |
| **Secrets** | Azure Key Vault — DB connection string, `GEMINI_API_KEY`, JWT signing secret, storage account keys. Reference via App Service's Key Vault–backed app settings. |
| **Real-time** | Azure SignalR Service for live message/dashboard updates (replaces the current localStorage event hack), or polling as a v1 fallback. |
| **Observability** | Azure Application Insights (Node SDK) wired into `server.ts` for request tracing and error logging. |
| **CI/CD** | GitHub Actions (or Azure DevOps Pipelines): build → `tsc --noEmit` → deploy to App Service (`azure/webapps-deploy`), with a separate migration step (e.g. `prisma migrate deploy`) gated before the app deploy. |
| **Environments** | Separate dev/staging/prod App Service slots and separate Postgres databases (or at least separate schemas) per environment. |
| **Compliance** | Since this handles PHI, you'll need Microsoft's Business Associate Agreement (BAA) for Azure's HIPAA-eligible services — a legal/account step, not a technical one, but it gates which regions/services are usable. |

---

## 6. Repo Handoff Mechanics

This build ran in a temporary cloud sandbox with **no git remote configured**, and the sandbox itself will be reclaimed after inactivity — so it isn't a durable source of truth. Two zip exports of the full source (with git history) have already been delivered in this conversation.

To hand this to your partner cleanly:
1. Create a repo on GitHub (or Azure DevOps Repos, if you want it in the same place as your Azure Pipelines).
2. Unzip the latest delivered archive locally, `git init` (or reuse the included `.git` history — the archive was made with `git archive`, so ask me to export the raw `.git` folder separately if you want full commit history preserved instead of a fresh history).
3. `git remote add origin <your-repo-url>` and push.
4. Add `.env` (gitignored) with at minimum `GEMINI_API_KEY`; your partner will add DB connection string, JWT secret, etc. as this gets built out.

If you'd like, in a future session I can push directly to a repo you create and grant me access to, instead of going through the zip/manual-unzip route.
