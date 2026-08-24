---
name: debugging-bladex-prod
description: Use when investigating a BladeX ERP problem in prod or dev - a document (GD/SO/PO/GR/PI/SI/Packing/PP) behaving wrong, a workflow failing or returning a 409, a question about what actually happened to a record, or whether a repo workflow is live in prod. Also use before assuming any DB fact - collection names, FK shapes, subform tables, statuses.
---

# Debugging BladeX in prod

Live read-only MySQL access to both environments exists at `.dbtools/`. Most questions about
"what happened" are answerable from the database in seconds. Do not reason from the JS files
alone when the data can be read.

## Safety — non-negotiable

- The helper is **read-only** and refuses anything but SELECT/SHOW/DESC/EXPLAIN/WITH.
- **Never write without showing the statement and getting a yes.** Prod is SELECT-only at the
  grant level, but **dev has UPDATE on all of `bladex_boot`**. Writes go through a separate
  DEV-ONLY tool, `.dbtools/dbw "UPDATE ... WHERE ..."`, which previews by default (table, SET,
  WHERE, exact affected row count, current values) and writes only with `--execute`. Show the
  preview, wait for an explicit yes, then re-run with `--execute`. The flag is a safety catch,
  not the permission.
- Every call prints `[DEV]` or `[PROD]`. Check it. Investigate incidents on prod; explore on dev.
- **There is no default org.** Prod is multi-tenant (~30 tenant/org pairs, ~10 active). The
  document number determines the org — never assume a tenant, never scan across tenants casually.
  **Some orgs are internal test accounts but there is no list of which**, so treat every tenant's
  rows as potentially real customer data.

## Playbook: "something is wrong in prod"

1. **Get the document number** (e.g. `GD/20260821/354`). Ask for it if not given.
2. **Pull the trace** — every workflow run that touched it, in order:
   `.dbtools/wf --prod find GD/20260821/354`
   Look at `exit=` (the return node) and any `<-- ERROR`. The exit node usually names the failure
   (`return_node_inConflicts`, `..._inSuccess`).
3. **Open the failing run** — per-node inputs, outputs and source:
   `.dbtools/wf --prod trace <instance_id>`
   `.dbtools/wf --prod trace <instance_id> --node code_node_inConflictBatch`  (full payload)
4. **Verify the claim against the data.** A workflow saying "record X not found" does not mean it
   is missing — query it. False positives are common:
   `.dbtools/db --prod "SELECT * FROM on_reserved_gd WHERE id=..."`
5. **Check the repo matches prod before blaming the code.** This repo is DEV code; prod can lag.
   `.dbtools/wf --prod deployed "Goods Delivery/GDinventoryProcessWorkflow.json"`
   `DIFFERS` usually means dev is ahead pending release — not a bug.

## Tools

| Command | Purpose |
|---|---|
| `.dbtools/db --dev\|--prod [--json] [--limit N] "SQL"` | read-only query |
| `.dbtools/dbw "UPDATE ... WHERE ..."` [--execute] | DEV-ONLY guarded write; previews first |
| `.dbtools/wf --prod find <doc_no> [--full]` | every workflow run touching a document |
| `.dbtools/wf --prod runs <NAME\|id>` | recent executions (id = the one copied from the platform UI) |
| `.dbtools/wf --prod trace <id> [--node X]` | node-by-node inputs/outputs |
| `.dbtools/wf --prod deployed <repo.json>` | is this repo workflow live in prod? |
| `.dbtools/wf --prod list [pattern]` | workflow name → id |
| `.dbtools/form status <table> <repo_full.json>` | is the repo form live in dev / prod? |
| `.dbtools/form diff <table>` | dev-vs-prod form diff, per client handler |
| `.dbtools/form script --dev\|--prod <table> <handler>` | print a deployed handler's source |
| `.dbtools/form sync <table> <handler> -o <repo.js>` | is the repo .js the deployed code? |

Full schema notes: `.dbtools/SCHEMA.md`.

## Facts that prevent wrong queries

- **Physical, lowercase table names in SQL** (`goods_delivery`) — unlike `db.collection()` in form
  code, which wants the display name (`Goods Delivery`). `su_code_tables` maps the two.
- **Subforms are real child tables**: `<parent>_<hash8>_sub`, joined by `<parent>_id`.
  `goods_delivery_fwii8mvb_sub` IS `table_gd`. The hash identifies the subform *type* and repeats
  across modules (`fwii8mvb` = line items, `hoosq80l` = Item Balance).
- **FK array-vs-scalar is checkable**, never guess: `information_schema.columns.column_type='json'`
  → array, wrap `[x]`; `varchar`/`bigint` → scalar.
- **Deployment authority is `su_code_workflow_history` where `status='enabled'`** (highest
  `version_number`). `su_code_workflow.script_json` is only the working copy and may hold an
  un-enabled `designing` edit. Statuses: `enabled` (live), `designing`/`draft` (being edited),
  `history` (superseded). `draft` is pretty-printed, `enabled` is minified — same content.
- **Form definitions work exactly like workflows.** `su_code_tables_history` with
  `status='enabled'` (highest `version_number`) is the LIVE form; `su_code_tables.form_json` is
  only the working copy. Forms are SHARED, one row per table at `tenant_id='000000'` — not
  per-tenant. Client handlers live at `config.eventScript[i].func` and nested `rules[j].options`;
  the tools find them by walking every `func` key.
- **`<MOD>fullJSON.json` and the repo `.js` files mirror DEV, not prod.** Verified: GDfullJSON.json
  is byte-identical to dev enabled v1432 while prod runs v660, and GDonMounted.js matches the dev
  `mounted` handler exactly. **Version numbers are NOT comparable across environments** (dev 1432
  vs prod 660) — compare content, never version numbers.
- **Dead tables, ignore**: `test_*`, `mc2_*`, `mkhr_*`, `act_*`. **`sm_*` is LIVE** — Stock
  Movement: `sm_misc_receipt` (MSR), `sm_misc_issue` (MSI), `sm_location_transfer` (LOT).
  `blade_*` is live platform infra (users/depts), not business data.
- Nearly every table has `tenant_id` + `is_deleted` — filter both.

## Two limits of `wf find`

- **Long-lived documents.** A LIKE over longtext is only affordable inside a narrow id window, but
  documents stay open for days (avg GD ~38h, seen 283h; 54% are updated >1h after creation). So it
  searches a 4h window around creation and another around the last update, and says so. If a run
  happened in between, pass **`--full`** to scan every 4h slice.
- **Duplicate document numbers across orgs.** Draft placeholders collide hard — `Draft/GD/0003`
  exists in 4 different organizations. `find` prints every match with its `org=`/`tenant=`, so
  CHECK which org you are looking at before drawing conclusions, and prefer a real issued number
  over a `Draft/...` one.

## Common mistakes

| Mistake | Reality |
|---|---|
| Filtering `su_code_workflow_inst` by `create_time` | No index on it + prod statement timeout → query killed. Filter by `workflow_id` or `id`. |
| Assuming a repo filename matches the deployed name | `GDinventoryProcessWorkflow.json` is deployed as **`GD_UNUSED_FN_NEW`**. Match by node id against `script_json`. |
| Identifying a workflow by one node id | Workflows get cloned and share ids (SI_TO_PI was cloned from GD_TO_GR). Rank candidates by how many of the file's node ids match. |
| Trusting a workflow's error message | Verify against the table. A `pp_restamp_missing` 409 was raised for a row that existed with `is_deleted=0`. |
| Treating `DIFFERS` as a bug | This repo is dev code; prod lags until the next release. |
| Reading `run_time` as wall-clock | Use `start_time_millis`/`end_time_millis` in `nodes_data` — if each node starts where the previous ended, the "parallel" branches are serial. |

## Notes

ids are snowflake (epoch `1288834974657`), so `ORDER BY id DESC` is chronological and uses the PK,
and a timestamp converts to an id bound via `(unix_ms - epoch) << 22`. That is how `wf find`
searches longtext cheaply inside a narrow window.
