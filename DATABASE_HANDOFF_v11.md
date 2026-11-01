# Vityls OS v11.3 · Database connectivity handoff (Azure SQL)

For Henry. One app, one database, every edition. All data in the test builds is fictional.

## 1. What changed in v11.2 and v11.3

- **v11.3 · Surgical Planning module.** Plans are saved under the record key `planner-plans` and map to the new table `chart.surgical_plan` (see section 5). Each plan has two images: the marked image and the unmarked base photo. Today both stay in the browser (IndexedDB keys `plan:<id>` and `planphoto:<id>`) and are **not** sent to the API; they move to Azure Blob Storage, with the URLs in `marked_blob_url` / `base_photo_blob_url`. Each saved plan is also filed as a `core.document` of type "Surgical plan".

- **One app.** The build `Vityls_OS_v11.3` runs ASC, Surgery and Medical. The practice record decides the edition when the app loads (`core/practices.ts › runtime`). In production the practice comes from the signed-in user's membership; in the test build there is a practice switcher (bottom right). The three per-edition builds are still produced from the same source for testing.
- **Connected to a database.** The app saves every record to the browser cache (it reads synchronously, offline-first) **and** to the Vityls record store API. On load it fetches the practice's records first; every change goes to the API in batches; every 15 seconds it pulls changes made on other devices. A "Database · saved" badge shows the state.
- **Server.** `server.ts` serves `/api/v1/store` and stores records in **Azure SQL** when `AZURE_SQL_CONNECTION_STRING` is set (tables `app.record`, `app.record_history`, created on first start), otherwise in `data/vityls-store.json` for development.

## 2. Run it

```
npm install
# development (JSON file store), one app with the demo practices:
VITE_ONE=1 VITE_EDITION=ASC2 VITE_DEMO=1 npx tsx server.ts        # http://localhost:3000/?api=/api
# Azure SQL:
AZURE_SQL_CONNECTION_STRING="Server=tcp:<server>.database.windows.net,1433;Database=vityls;User Id=...;Password=...;Encrypt=true" \
VITYLS_API_TOKEN=<shared secret for the test> VITE_ONE=1 VITE_EDITION=ASC2 npx tsx server.ts
```

The app connects when it is opened with `?api=<url>` (remembered on the device; `?api=off` turns it off), or when built with `VITE_API_URL`. A packaged file can point at a remote API: `index.html?api=https://api.example.com/api` (CORS is open to the calling origin).

## 3. API (v1)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/v1/health` | | `{ ok, backend }` |
| GET | `/api/v1/store` | `?since=ISO` (optional) | `{ items: [{ k, v, at, by }], now }`: all records of the tenant, or those changed since |
| PUT | `/api/v1/store` | `{ items: [{ k, v | null }], by }` | `{ ok, at }`: upsert / delete in one transaction, history row per change |
| POST | `/api/v1/store-beacon` | same as PUT plus `tenant` | 204: last-moment save when a tab closes |

Headers: `X-Vityls-Tenant: <practice id>`, `Authorization: Bearer <VITYLS_API_TOKEN>` when set.

**Before real patient data** (what the test build does not do yet):
1. Tenant from the identity token, never from a header; enforce with row-level security (`sec.fn_tenant`, see phase 2 SQL).
2. Sign-in (Entra ID / Azure AD B2C), per-user tokens; PIN signatures checked on the server.
3. Blobs (photos, uploads, PDFs, surgical plan images) to Azure Blob Storage; today they live in the browser (IndexedDB / data URLs).
4. TLS only, BAA with Microsoft, Azure SQL TDE + backups + point-in-time restore, audit table append-only (no UPDATE/DELETE grants).
5. Conflicts: today last write wins per record; move hot records (visits, station records) to row-level tables (phase 2) first.

## 4. Phase 2: normalized tables (one database, every edition)

`db/vityls_v11_core_modules_azure_sql.sql` adds schemas **core, sched, chart, stations, forms, bank, billing, msg, notify, office, surgery, portal**; the ASC perioperative schema from v10.8 (`db/asc_vityls_v10_6_azure_sql.sql`, schema `asc`) stays as delivered. Every table has `tenant_id`, typed key columns and `data_json` with the full record, so each record family can move from `app.record` to its table one at a time behind the same API, without changing the screens.

## 5. Record key → table map

Generated from the record store after opening ASC, Surgery and Medical (`scripts/gen_db_v11.py`). Keys are shown without the practice namespace prefix (`vityls-asc2~`, `vityls-surgery~`, `vityls-medical~`).

| Record key | Editions | Module | Phase 2 table | What it holds |
|---|---|---|---|---|
| `vityls:surgery:asc86-vitals` | ASC | ASC | `asc.flowsheet_vital` | PACU flowsheet vitals |
| `vityls:surgery:asc8-cases` | ASC | ASC | `asc.surgical_case (+ asc tables of the v10.8 handoff)` | ASC cases: day-of-surgery record, events, station values |
| `vityls:surgery:asc83-case-pay` | ASC | Billing | `billing.payment` | Payments and receipts (card data never stored: processor tokens only) |
| `vityls:surgery:patient-payments` | ASC, Surgery | Billing | `billing.payment` | Payments and receipts (card data never stored: processor tokens only) |
| `vityls:surgery:quotes` | Surgery | Billing | `billing.quote / billing.quote_version` | Price quotes with versions |
| `vityls:med:caregivers` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:med:careplans` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:med:intake` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:med:labs` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:med:meds` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:med:problems` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:med:vitals` | ASC, Medical, Surgery | Chart | `chart.<problem|medication|vitals|lab_result|intake_answer|care_plan|caregiver>` | Clinical record lists, one row per item |
| `vityls:surgery:asc86-orders` | ASC | Chart | `chart.order` | Orders (standing and one-off) |
| `vityls:surgery:orders` | Medical | Chart | `chart.order` | Orders (standing and one-off) |
| `vityls:surgery:contact-notes` | ASC, Medical, Surgery | Chart | `chart.scribe_session / chart.note` | Ambient scribe transcripts, quick jots, contact notes |
| `vityls:surgery:outside-hp-meds` | Surgery | Chart | `chart.scribe_session / chart.note` | Ambient scribe transcripts, quick jots, contact notes |
| `vityls:surgery:scribe` | Surgery | Chart | `chart.scribe_session / chart.note` | Ambient scribe transcripts, quick jots, contact notes |
| `vityls:surgery:v17-jots` | Medical, Surgery | Chart | `chart.scribe_session / chart.note` | Ambient scribe transcripts, quick jots, contact notes |
| `vityls:surgery:v17-notes` | Medical, Surgery | Chart | `chart.scribe_session / chart.note` | Ambient scribe transcripts, quick jots, contact notes |
| `vityls:surgery:surgical-history` | ASC, Medical, Surgery | Chart | `chart.surgical_history` | Past surgical history |
| `vityls:surgery:planner-plans` | (when used) | Chart | `chart.surgical_plan` | Surgical Planning: markings JSON per plan (marked and base images go to Blob Storage) |
| `vityls:med:notes` | ASC, Medical, Surgery | Chart | `office.visit_note` | Visit notes (SOAP), signed versions and addenda |
| `vityls:surgery:asc87-activity` | ASC | Core | `core.activity` | Activity feed (requests received, faxes filed...) |
| `vityls:v6:audit:asc8:<id>` | ASC | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:ep-consult-MED-2055` | Surgery | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:patient:<id>` | ASC, Medical, Surgery | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:practice` | ASC, Medical, Surgery | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:visit-daniel` | Surgery | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:visit-e` | Medical | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:visit-lena-consult` | Surgery | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:visit-m20-harold` | Medical | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:visit-m20-priya` | Medical | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:v6:audit:visit-ruth-consult` | Surgery | Core | `core.audit_event` | Append-only audit trail (per patient / case / practice) |
| `vityls:surgery:hipaa-v013` | ASC, Medical, Surgery | Core | `core.disclosure` | HIPAA accounting of disclosures (records packets sent) |
| `vityls:v6:facts:<subject>` | ASC, Medical, Surgery | Core | `core.fact` | Time stamps and facts per visit/case (arrived, roomed, checked out...) |
| `vityls:surgery:asc8-flags` | ASC | Core | `core.flag` | Flags and to-dos between teams |
| `vityls:surgery:v17-flags` | Medical, Surgery | Core | `core.flag` | Flags and to-dos between teams |
| `vityls:med:patients` | ASC, Medical, Surgery | Core | `core.patient` | Patient identity, demographics, allergies, contact, insurance (one row per patient) |
| `vityls:med:settings` | ASC, Medical, Surgery | Core | `core.practice_setting` | Practice settings (name, fees, reminders, Nightingale) |
| `vityls:surgery:settings` | ASC, Medical, Surgery | Core | `core.practice_setting` | Practice settings (name, fees, reminders, Nightingale) |
| `vityls:surgery:stations-v010` | Medical, Surgery | Core | `core.practice_setting` | Station configuration (office workflow) |
| `vityls:v7:providers` | ASC, Medical, Surgery | Core | `core.provider` | Providers, credentialing, signature PIN hashes |
| `vityls:surgery:coordinators` | ASC, Medical, Surgery | Core | `core.staff / core.role` | Staff, roles, who signs what |
| `vityls:surgery:roles-v011` | Medical, Surgery | Core | `core.staff / core.role` | Staff, roles, who signs what |
| `vityls:surgery:signers-v011` | Medical, Surgery | Core | `core.staff / core.role` | Staff, roles, who signs what |
| `vityls:surgery:asc87-uploads` | ASC | Core / Chart | `core.document / chart.photo / chart.body_chart` | Documents folder, uploads (blobs in Azure Blob Storage, metadata here), photos, body charts |
| `vityls:surgery:body-charts` | ASC, Medical, Surgery | Core / Chart | `core.document / chart.photo / chart.body_chart` | Documents folder, uploads (blobs in Azure Blob Storage, metadata here), photos, body charts |
| `vityls:surgery:documents` | ASC, Medical, Surgery | Core / Chart | `core.document / chart.photo / chart.body_chart` | Documents folder, uploads (blobs in Azure Blob Storage, metadata here), photos, body charts |
| `vityls:surgery:img-gen` | ASC, Medical, Surgery | Core / Chart | `core.document / chart.photo / chart.body_chart` | Documents folder, uploads (blobs in Azure Blob Storage, metadata here), photos, body charts |
| `vityls:surgery:photos` | ASC, Medical, Surgery | Core / Chart | `core.document / chart.photo / chart.body_chart` | Documents folder, uploads (blobs in Azure Blob Storage, metadata here), photos, body charts |
| `asc8-forms-config` | ASC | Forms | `forms.form_assignment` | ASC form configuration |
| `oi-premiere-official-html-library-v27-clean` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls-explicit-form-workflow-v3-clean` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls-form-requirement:<form>` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls-form-workflow:<form>` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls-my-forms:default-practice` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls:v6:form:<instance>:Admission_Form.html` | Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls:v6:form:<instance>:HIPAA_Authorization_Release.html` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls:v6:form:<instance>:Medical_History.html` | Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls:v6:form:<instance>:Patient_Registration.html` | Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls:v6:forms:<instance>` | ASC, Medical, Surgery | Forms | `forms.form_instance / forms.form_assignment` | Filled forms per visit/case, form-to-station assignments, requirements |
| `vityls:v6:signers:<form>` | ASC, Medical, Surgery | Forms | `forms.form_signer_rule` | Who signs each form |
| `vityls:med:messages` | ASC, Medical, Surgery | Messages | `msg.message` | Portal and staff messages |
| `vityls:surgery:os-daily-email` | (when used) | Notifications | `notify.daily_schedule_setting / notify.outbox` | 2 PM next-day schedule email settings and sends |
| `vityls:surgery:os-daily-email-log` | (when used) | Notifications | `notify.daily_schedule_setting / notify.outbox` | 2 PM next-day schedule email settings and sends |
| `vityls:surgery:asc10-answers` | (when used) | Question bank | `bank.answer` | Question bank answers with provenance (once per patient / case) |
| `vityls:surgery:o11-answers` | (when used) | Question bank | `bank.answer` | Question bank answers with provenance (once per patient / case) |
| `vityls:surgery:o11-bank` | (when used) | Question bank | `bank.practice_override` | Practice changes to the master bank: groups on/off, wording, options, station, added questions |
| `vityls:med:visits` | ASC, Medical, Surgery | Scheduling | `office.visit` | Appointments / office visits: date, time, provider, room, type, step |
| `vityls-surgery-v11-apptnotes` | ASC, Medical, Surgery | Scheduling | `sched.appointment_note` | Appointment notes |
| `vityls:surgery:appt-confirm` | ASC, Medical, Surgery | Scheduling | `sched.reminder / sched.confirmation` | Appointment reminders sent and confirmations |
| `vityls:surgery:confirmations` | Surgery | Scheduling | `sched.reminder / sched.confirmation` | Appointment reminders sent and confirmations |
| `vityls:surgery:reminder-sends` | ASC, Medical, Surgery | Scheduling | `sched.reminder / sched.confirmation` | Appointment reminders sent and confirmations |
| `vityls:surgery:reminders-since` | ASC, Medical, Surgery | Scheduling | `sched.reminder / sched.confirmation` | Appointment reminders sent and confirmations |
| `vityls:v6:stations:<visit>` | ASC, Medical, Surgery | Stations | `core.station_signoff` | Station verification (PIN sign-off) per visit |
| `vityls:surgery:asc107-checklists` | Medical | Stations | `stations.checklist_version / stations.checklist_item / stations.case_checklist_pin` | Facility checklist items, versions, pinned version per visit/case |
| `vityls:surgery:asc107-pins` | Medical | Stations | `stations.checklist_version / stations.checklist_item / stations.case_checklist_pin` | Facility checklist items, versions, pinned version per visit/case |
| `vityls:surgery:nurse` | Medical, Surgery | Stations | `stations.station_record (station = nurse)` | Nurse / MA intake per visit |
| `vityls:surgery:o11-nurse` | Medical | Stations | `stations.station_record (station = nurse)` | Nurse / MA intake per visit |
| `vityls:surgery:asc106-or` | (when used) | Stations | `stations.station_record + stations.station_record_value` | Every station answer (Talk/Manual, heard quote, confirmed), signatures |
| `vityls:surgery:asc108-clearance-demo` | ASC | Stations | `stations.station_record + stations.station_record_value` | Every station answer (Talk/Manual, heard quote, confirmed), signatures |
| `vityls:surgery:asc108-nursing` | (when used) | Stations | `stations.station_record + stations.station_record_value` | Every station answer (Talk/Manual, heard quote, confirmed), signatures |
| `vityls:surgery:o11-checkout` | (when used) | Stations | `stations.station_record + stations.station_record_value` | Every station answer (Talk/Manual, heard quote, confirmed), signatures |
| `vityls:surgery:o11-front` | (when used) | Stations | `stations.station_record + stations.station_record_value` | Every station answer (Talk/Manual, heard quote, confirmed), signatures |
| `vityls:surgery:o11-provider` | (when used) | Stations | `stations.station_record + stations.station_record_value` | Every station answer (Talk/Manual, heard quote, confirmed), signatures |
| `vityls:surgery:case-links` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:cases` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:episodes` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:flow-audit` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:flow-journeys-v13` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:flow-state` | Medical, Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:forms-packets` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |
| `vityls:surgery:journeys` | Surgery | Surgery | `surgery.episode / surgery.journey_step / surgery.case_request` | Surgical episodes: consult to surgery to post-op, booking, clearance, ASC hand-off |

Not migrated (seed markers, demo switches, test probes; device-only): `sync-probe`, `vityls:asc10:demo`, `vityls:med:network-seed`, `vityls:seed-version`, `vityls:surgery:asc8-seeded`, `vityls:surgery:asc81-seeded`, `vityls:surgery:asc83-seeded`, `vityls:surgery:asc86-seeded`, `vityls:surgery:asc87-seeded`, `vityls:surgery:block-seed`, `vityls:surgery:cases-migrated-v16`, `vityls:surgery:cases-seed-v16`, `vityls:surgery:episodes-seeded-v11`, `vityls:surgery:flow-seeded-v13`, `vityls:surgery:hipaa-seeded`, `vityls:surgery:journeys-seeded-v12`, `vityls:surgery:med20-seeded`, `vityls:surgery:o11-nurse-mode`, `vityls:surgery:v06-seeded`, `vityls:surgery:v12-seeded`, `vityls:surgery:v17-notes-since`, `vityls:surgery:v17-seeded`, `vityls:surgery:v18-seeded`.
