# SA V2 / SC Review V2 — the binding contract (WP0, 2026-10-16)

Single source of truth for packages A (PREPARE), B (SUBMIT + guarded classics), C (COMMIT + WORKER), D (client), E (checks).
Plan: `~/.claude/plans/help-me-build-stock-frolicking-knuth.md` (approved 2026-10-16). Template: `tpl/smv2/CONTRACT.md` (Location
Transfer V2, f8) — where this file says "as smv2 §n", copy that mechanism verbatim with the names of §1. Sources: `grv2` = GR V2,
`pwv2` = Putaway V2, `gdc` = GD Completed V2, `gde` = GD Edit V2, `smv2` = LOT V2 (copies under `tpl/smv2/`, kit under `lib/`).
A change to this file or to `code/shared/` goes through the controller (session bladexfunctions-a3); never edit another package's
folder; never edit `scratchpad/smv2|gdc|grv2|pwv2|gde`.

Bases (exact snapshots, `base/`, `python3 base/snapshot.py --check`): STOCK_ADJUSTMENT v24 (= prod v18), STOCK_COUNT v10 (= prod,
key order only), CHECK_REQUIRED_FIELD v8, REORDER_SET_REDIS v21, GLOBAL_INVENTORY_VALIDATION v11, INVENTORY_BULK_APPLY v7,
INVENTORY_LOCK_TOKENS v4, ADD_INVENTORY v65, SUBTRACT_INVENTORY v59; SA form v313 (= prod), SC form v497, SA list v57, SC list v38;
table schemas; `columns.json`. Ids: `ids.json`.

-------------------------------------------------------------------------------------------------------------------------------
## 1. Names and constants

| Constant | Value | Notes |
|---|---|---|
| shells (user creates, dev designer, Save Workflow / Stock Adjustment) | `SA_V2_SUBMIT`, `SA_V2_WORKER`, `SA_V2_PREPARE`, `SA_V2_COMMIT` | ids → `ids.json` + `Stock Adjustment/AsyncV2/ids.json` ("0" until created) |
| command | `COMPLETE_SA` | the worker polls only it; GD_JOB_RECONCILE must never be pointed at it |
| correlation / causation | `SA|<saId>` / `<saId>` | `''` / `''` in the insert of a DIRECT / REVIEW until "link" |
| `gd_id` / `gd_no` / picking cols | empty | never written |
| SA document lock | `job_id = SAC|<saId>`, `step_name = LOCK|<n>` | ≤ 23 chars |
| review twin guard | `job_id = SCR|<scId>`, `step_name = LOCK|<n>` | taken FIRST by a REVIEW submit (unique Job Step index stops a twin) |
| engine operation_key | `SAC|<jobId>` | engine rows `IBA|I|nnn`, `IBA|DONE`, `IBA|REVIEW` under it |
| SUBMIT parts | `S|<nonce>|DOC|<nnn>` (COMPLETE), `S|<nonce>|SC|<nnn>` (REVIEW) | under `job_id = <jobId>` |
| PREPARE parts | `P|<nonce>|<PART>|<nnn>`, PART ∈ ENGINE, LABELS, SALINES, SC, HDR, ITEMS, REORDER | under `job_id = <jobId>` |
| COMMIT step rows | `A0_REVALIDATE`, `A1_SA_LINES`, `A2_INVENTORY`, `A3_STOCK_COUNT`, `A4_REORDER` (marker), `A4_FINISH` | step SQL `REGEXP '^A[0-9]_'` (S parts also start with `S`) |
| worker claim / leases / cache | `W0_CLAIM_<rv>`; `WRK|`, `PUB|`, `SPLIT|` + 24 hex; `sa_wrk_<nonce>` | as smv2 §1 |
| movement keys | `M1`, `M2`, … (one per entry) | engine guard `^[A-Za-z0-9._-]{1,40}$`, unique |
| error prefix | `SA_` (§10) + shared `JOB_ILLEGAL_TRANSITION`, `JOB_ROW_VERSION_CONFLICT` | |
| states | QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_SA → COMPLETED; terminal FAILED, REQUIRES_REVIEW | |
| prevStatus (unlock target) | `Draft` (source FORM) / `Cancelled` (source REVIEW); anything else → no unlock, REQUIRES_REVIEW `SA_PREV_STATUS_UNKNOWN` | no default anywhere |
| client switches (OFF at the cut) | SA form `ASYNC_SA_ENABLED`, `SA_V2_MIN_ENTRIES = 50`; SC form `ASYNC_SC_REVIEW_ENABLED`, `SC_V2_MIN_LINES = 50`; lists gate their kick on the same switch | |
| limits | V2 STOP > 5,000 entries (`SA_SPLIT_REQUIRED`); NOT_ELIGIBLE → classic ≤ 500 entries, above → STOP `SA_TOO_BIG`; any `balance_index` > 60,000 UTF-8 bytes → STOP `SA_LINE_TOO_LARGE`; PARK after COMMIT A when entries > 1,000 | |
| review split | ≤ 50 entries per built SA line (recompute `total_quantity`, `adj_summary` per chunk) | |

Namespace check (dev, 2026-10-16 17:50): 0 jobs COMPLETE_SA / `SA|` / `SC|`; 0 step rows `SAC|` / `SCR|` / `SA|`. Claimed with all 7
sessions the same day.

-------------------------------------------------------------------------------------------------------------------------------
## 2. Sources and actions

| source | stored → click | action | answer / job | prevStatus |
|---|---|---|---|---|
| FORM | (Add / Clone) → Completed | DIRECT | job | Draft |
| FORM | Draft → Completed | COMPLETE (`edited` 1 when the incoming fingerprint ≠ the stored one) | job | Draft |
| FORM | Processing, or an open COMPLETE_SA job for this SA | — | BUSY 409 | |
| FORM | Completed / Pending Post / Fully Posted / Cancelled, or payload status ≠ stored | — | STALE 409 | |
| REVIEW | SC with approved variance and the adjustment confirmed (lifted prep: `doProcess = 1` and `hasApprovedVariance = 1`) | REVIEW | job (a NEW SA) | Cancelled |
| REVIEW | prep says no SA would be created | — | NOT_ELIGIBLE (the classic Review handles it) | |
| REVIEW | the SC has a Processing SA, an open COMPLETE_SA job with `request.scId = scId`, or the `SCR` insert loses | — | BUSY 409 | |
| REVIEW | payload `stock_count_status` / `review_status` ≠ stored, or a stored line `Adjusted` that the payload shows `Approved` | — | STALE 409 | |
| any | `saveAs` ≠ `Completed` (FORM), `pageStatus` View, bad ids / key / tenant | — | INVALID 400 | |
| any | the latest `SAC` / `SCR` lock is < 120 s old, belongs to ANOTHER key and its job is missing or open (a submit between another's lock insert and job insert) | — | BUSY 409 (B2 ruling) | |
| FORM | the SA has `stock_count_id` and that SC has ANOTHER Processing SA (an open REVIEW) | — | BUSY 409 `SA_SC_BUSY` | |
| FORM | 0 moving entries; REVIEW: no default SA numbering rule (an 'issued' add would collide on the UNIQUE Document Number) | — | NOT_ELIGIBLE (classic) | |

Entry order (as smv2 §2): INVALID → this key already has a job → its STATUS → `operation STATUS` → STATUS answer → FORM Add goes on →
document missing (`SA_NOT_FOUND` / `SA_SC_NOT_FOUND`) → BUSY → STALE → action → eligibility (§7) → gates → limits → writes.

**Unlock everywhere** (SUBMIT stray, WORKER, PREPARE, COMMIT `failNoWrite`) writes `{ id: saId, stock_adjustment_status: prevStatus }`
only when prevStatus ∈ {Draft, Cancelled}; otherwise no unlock and REQUIRES_REVIEW `SA_PREV_STATUS_UNKNOWN` (smv2 deviation 4).
A REVIEW never touches the Stock Count before stock moved, so its failure needs no SC restore.

-------------------------------------------------------------------------------------------------------------------------------
## 3. gd_async_job (COMPLETE_SA)

Columns by writer: as smv2 §3 with `plant_id` = the SA header `plant_id`, command `COMPLETE_SA`, correlation / causation per §1.
Unique `Idempotency Key` (tenant, org, key) stops a twin click.

### request_payload (JSON text, SUBMIT only)

```json
{ "v": 1, "source": "FORM", "action": "COMPLETE", "prevStatus": "Draft", "saveAs": "Completed", "pageStatus": "Edit",
  "saId": "2104…", "saNo": "SA/20261016/0003", "issuedNo": "", "scId": "",
  "lineFingerprint": "SAF1:120:0a1b…", "incomingFingerprint": "SAF1:120:9f8e…", "edited": 1,
  "scFingerprint": "", "organizationId": "…", "plantId": "…", "lineCount": 120, "entryCount": 480, "movementCount": 480,
  "uid": "…", "source_form": "SA", "nonce": "ab12cd34", "parts": { "DOC": ["S|ab12cd34|DOC|001"] } }
```

| Key | Meaning |
|---|---|
| source | `FORM` / `REVIEW` |
| action | DIRECT / COMPLETE / REVIEW |
| saId, saNo | the stored SA after SUBMIT's writes (read back); DIRECT / REVIEW filled by "link" |
| issuedNo | the number THIS submit made the platform issue (`'issued'` + rule); `''` when none (manual `-9999`, or a reused number). The next FORM submit of a Draft whose stored `adjustment_no` equals the `issuedNo` of an earlier COMPLETE_SA job of that SA writes WITHOUT the number props |
| scId | REVIEW: the Stock Count id; FORM: the SA's `stock_count_id` or `''` |
| lineFingerprint | `saLineFingerprint` (§6) of the STORED SA lines after SUBMIT's writes (DIRECT: read back; COMPLETE: read before; REVIEW: `SAF1:0:…`, no lines yet) |
| incomingFingerprint | COMPLETE: of the DOC part's lines; REVIEW: of the BUILT lines (SUBMIT's build); DIRECT: = lineFingerprint |
| scFingerprint | REVIEW: `scLineFingerprint` (§6) of the stored SC lines at SUBMIT |
| counts | lines, entries (`sa_quantity > 0`), movements (= entries) |
| parts | `{ DOC: [...] }` (COMPLETE), `{ SC: [...] }` (REVIEW), `{}` (DIRECT) |

### Idempotency key (recipe: grv2 `grc_onClick_completed.js` idemKey + smv2 deviation 5)
FORM: `SA:<org>:<saId | "new-" + pageToken>:<hash16 of canon({saveAs, pageStatus, record})>:<gen>`; REVIEW:
`SCR:<org>:<scId>:<hash16 of canon({ createAdjustment, record })>:<gen>`. Characters outside `A-Za-z0-9|:_.-` → `-`, cut to 128;
SUBMIT refuses anything else (8-128 of that set). `record` = `this.getValues()` minus NOT_RECORD (`sa_v2_job_id`, `sa_idem_key`, `_data`,
the dialog models `table_item_balance`, `table_item_balance_raw`, `dialog_*`, `search_batch`, `material_uom`; SC: `_data`, dialog
models — D lists them). `gen` starts at 1, +1 after a FAILED answer for the same content; `pageToken` once per form open in `_data`.

### State machine — as smv2 §3 with COMMITTING_SA; progress 0 / ≥10 / 60 / 70 / 80 (stock moved) / 85 / 100.

-------------------------------------------------------------------------------------------------------------------------------
## 4. gd_publish_step rows

| Rows | job_id | step_name | status | result_ref | Written by | Read by |
|---|---|---|---|---|---|---|
| SA lock | `SAC|<saId>` | `LOCK|<n>` | `LOCK` | the job's idempotency key | SUBMIT | WORKER, PREPARE, COMMIT, SUBMIT read-back |
| review twin guard | `SCR|<scId>` | `LOCK|<n>` | `LOCK` | the job's idempotency key | SUBMIT (REVIEW, first write) | SUBMIT (BUSY check: latest row's job open) |
| claim gate | `<jobId>` | `W0_CLAIM_<rv>` | `DONE` | `WRK|<nonce>` | WORKER | WORKER |
| SUBMIT part | `<jobId>` | `S|<nonce>|DOC|nnn` / `S|<nonce>|SC|nnn` | `PAYLOAD` | ≤ 400,000 chars | SUBMIT | PREPARE only (COMMIT reads the P parts SALINES / SC) |
| PREPARE part | `<jobId>` | `P|<nonce>|<PART>|nnn` | `PAYLOAD` | ≤ 400,000 chars | PREPARE | COMMIT |
| step done | `<jobId>` | `A0_REVALIDATE` … `A4_FINISH` | `DONE` | note ≤ 2,000 chars | COMMIT | COMMIT entry |
| reorder marker | `<jobId>` | `A4_REORDER` | `DONE` | `'pre-call'` | COMMIT A4, BEFORE REORDER_SET_REDIS (unique: a retry finds it and skips the call — gdc build_gdc.py:494 / gde build_gde.py:783) | COMMIT A4 |
| engine rows | `SAC|<jobId>` | `IBA|I|nnn`, `IBA|DONE`, `IBA|REVIEW` | engine's | engine's | INVENTORY_BULK_APPLY | COMMIT A2 (409 rule), runbook |

**Lock ownership** (status-based, grv2): `stock_adjustment.stock_adjustment_status = 'Processing'`, `sa_v2_job_id = <jobId>`, and the
latest (MAX id) `LOCK|%` row of `SAC|<saId>` has `result_ref = <the job's idempotency key>`. Release = the status write (unlock, or A4's
`Completed`). LOCK rows are never deleted; `sa_v2_job_id` is kept (audit). Chunking: smv2 §4 (`saPartRows` / `saJoinChunks`).

-------------------------------------------------------------------------------------------------------------------------------
## 5. Manifest (`prepared_payload`) and parts

```json
{ "v": 1, "prepared_by": "SA_V2_PREPARE", "job_id": "…", "sa_id": "…", "sa_no": "…", "source": "REVIEW", "action": "REVIEW",
  "prevStatus": "Cancelled", "sc_id": "…", "organization_id": "…", "plant_id": "…", "nonce": "c9d8e7f6",
  "lineFingerprint": "SAF1:0:…", "incomingFingerprint": "SAF1:1873:…", "scFingerprint": "SCF1:2000:…", "scAfterFingerprint": "SCF1:2000:…",
  "parts": { "ENGINE": [...], "LABELS": [...], "SALINES": [...], "SC": [...], "HDR": [...], "ITEMS": [...], "REORDER": [...] },
  "counts": { "lines": 1873, "entries": 2000, "movements": 2000, "items": 640 } }
```
COMMIT's entry accepts it only when `job_id` = the job, `sa_id` digits, `correlation_id = SA|<sa_id>`, every listed PART non-empty
(SALINES only for REVIEW / edited COMPLETE; SC only for REVIEW or a FORM SA with `stock_count_id`). Else FAILED + unlock (before A2) /
REQUIRES_REVIEW (after).

- **ENGINE** = the exact INVENTORY_BULK_APPLY request `{ operation_key: "SAC|<jobId>", mode: "APPLY", organization_id, movements }`.
  One movement per balance entry with `sa_quantity > 0`, in the classic loop order (lines by `line_index`, entries in array order;
  duplicates and In+Out on one key stay in order). Fields = the classic `workflow_node_p9gVSMG0` / `workflow_node_ABYSBRCw` params
  minus `itemData`, plus `movement_key`, `direction`:
  `{ movement_key, direction: "ADD"|"SUBTRACT", plant_id (entry.plant_id || header plant — GmKmvMGe), organization_id (header),
  material_id (line), quantity (entry.sa_quantity, NUMBER q8, in the LINE uom), material_uom (line uom_id || ""), transaction_type "SA",
  trx_no (the STORED adjustment_no), inventory_category (entry.category || "Unrestricted"), location_id (entry), batch_id (entry ||
  null), manufacturing_date (entry || null), expired_date (entry || null), doc_date (header adjustment_date), isMovingInv 0,
  unit_price (parseFloat(line.unit_price) || 0), remark / remark2 / remark3 (ADD only: line item_remark / item_remark2 / item_remark3
  || null) }` — engine reads `remark`, `remark2`, `remark3` (core.js 310-351), never `remark1`. Direction from
  `entry.movement_type` case-insensitive: `in` → ADD, `out` → SUBTRACT (anything else was refused at SUBMIT). No engine PLAN.
  0 movements cannot happen (SUBMIT refuses).
- **LABELS** = `movement_key → { line_index, line_id, item_code, item_name, bin, bin_id, category, side: "in"|"out" }`; read by A2
  only after a 400; `saMapEngineMessage` (copy of smv2 movekey.js) → "Insufficient quantity - line 4 (FG-0042), bin A1-B2 (Unrestricted)".
- **SALINES** (REVIEW, edited COMPLETE) = the exact `stock_adjustment` array A1 writes: every SA column on every row (§9 A1), REVIEW
  rows without ids, COMPLETE rows with their ids (new rows without), + `fingerprint` (= incomingFingerprint). Plus `header` (COMPLETE:
  the DOC part's header props; REVIEW: `{}`).
- **SC** = REVIEW: `update_node_sc`'s props MINUS `stock_count_no`, `stock_count_no_type` (= `code_fillback(code_review_mark(
  code_review_prep(S|SC part)))` lifted), + `beforeFingerprint` (= scFingerprint), `afterFingerprint` (`scLineFingerprint` of the props'
  lines). FORM with `stock_count_id`: `{ mode: "PARITY", scId }` (A3 computes at run time, §9).
- **HDR** = `{ id, before: { stock_adjustment_status: "Processing" }, after: { stock_adjustment_status: "Completed" } }`.
- **ITEMS** = `{ itemDates: [{ id, last_transaction_date }] }` = `code_node_WFXy3gHI` over the SA lines (unique material_id, one
  `new Date().toISOString()` taken at PREPARE time — the classic's own value form).
- **REORDER** = `{ document_type: "SA_COMPLETED", latest_data: <the SA lines as the classic passes O4tWJ5JH's allData.stock_adjustment>,
  organization_id }`.

-------------------------------------------------------------------------------------------------------------------------------
## 6. Fingerprints and shared helpers (`code/shared/`, controller-owned; prefix `sa` / `SA_`)

| File | From | Functions |
|---|---|---|
| `sa_common.js` | smv2 `lot_common.js` (with f8's lotParseJ fix) | `saS`, `saQ8`, `saQtyStr`, `saDigits`, `saIdStr`, `saParseJ`, `saList`, `saJsonList`, `saRows`, `saDbAddSeconds`, `SA_PREV_STATUSES = ["Draft","Cancelled"]` / `saPrevStatusOk`, `SA_CHUNK` / `saPartRows` / `saJoinChunks` |
| `fingerprint.js` | smv2 `fingerprint.js` | `saLineFingerprint(lines)` → `SAF1:<n>:<16 hex>` — **id-free** (reviewer A3): per line in `line_index` order: `line_index`, `material_id`, `uom_id`, `total_quantity` (as text, trimmed), `unit_price` (q8), the `balance_index` TEXT verbatim (or `JSON.stringify` when an array arrives); `scLineFingerprint(lines)` → `SCF1:<n>:<16 hex>` per line sorted by id: `id`, `line_status`, `review_status`, `is_counted`, `count_qty` (q8), `adjusted_qty` (q8 or ""), `variance_qty` (q8) |
| `movekey.js` | smv2 `movekey.js` | `saMovementKeyOf`, `saMapEngineMessage` |
| `sql.py` | smv2 `sql.py` | `FP_SA_LINES` (stored SA lines, one `j` per row, line_index order, tokens `@T`, `@SA`), `FP_SC_LINES` |

`unit_price` is `decimal(65,8)` (the platform rounds on write → compare with `sameStored`, grv2 `_cmp.js` with f8's 16+ char fix);
`total_quantity` is VARCHAR (verbatim). Unit tests `node test/shared/test_shared.js`; live check `python3 test/shared/fp_live.py`.

-------------------------------------------------------------------------------------------------------------------------------
## 7. SA_V2_SUBMIT (synchronous; operations SUBMIT / STATUS)

**Request** (`request_json`, strings except `form`): `operation` (SUBMIT / STATUS), `source` (FORM / REVIEW), `saveAs` (Completed),
`pageStatus` (Add / Edit / Clone; Copy = Clone), `sa_id` (FORM Edit / STATUS), `sc_id` (REVIEW), `idempotency_key`, `form` (FORM: the
SA record; REVIEW: the SC record), `organization_id`, `nickname` (REVIEW: adjusted_by), `adjustment_date` (REVIEW: the client's
`YYYY-MM-DD`, as the classic Review sends `adjustmentDate`), `create_adjustment` (REVIEW: `"Yes"` / `""`).
**Answer**: `route, code, message, reason, action, job_id, job_status, terminal, sa_id, sa_no, sc_id, line_count, progress_percent,
progress_message, error_code, error_message, evidence` — routes as smv2 §7 (QUEUED 200, STATUS 200, NOT_ELIGIBLE 300, BUSY 409, STALE
409, STOP 400 / 500, INVALID 400). Never 401.

### Write orders (idempotent; job inserted QUEUED with next_attempt_at = db_now + 120 s, then made due)
- **DIRECT** (FORM Add / Clone): job → ONE add of `add_node_Yk7ukSPp`'s props from the lifted fillback (`stock_adjustment_status
  'Processing'`, `adjustment_no 'issued'` unless `-9999`, `posted_status` per fillback) + `sa_v2_job_id` + `sa_idem_key` → read back by
  `sa_v2_job_id` (header + FP_SA_LINES) → `SAC LOCK|1` → link → due.
- **COMPLETE** (FORM, stored Draft): `SAC LOCK|n+1` → job → `S|…|DOC` parts (`{ v, saId, header: the 13 header props of
  update_node_bYNSsj0v minus stock_adjustment_status / adjustment_no / adjustment_no_type, lines: the filled-back lines, fingerprint }`)
  → header update: `stock_adjustment_status 'Processing'`, `sa_v2_job_id`, and the number props — `'issued'` + rule, or with `-9999` the
  typed manual number (a manual edit made at Complete is kept) — skipped ONLY when the stored number is an earlier job's `issuedNo`
  → read back → due. (REVIEW request_payload also carries `createAdjustment`, `nickname`, `adjustmentDate`; pageStatus "Add".)
- **REVIEW**: `SCR LOCK|n+1` → job → ONE add of the SA HEADER only (`add_node_sa`'s header props from the BUILT doc: status
  `'Processing'`, `adjustment_no 'issued'`, `adjustment_no_type` = the default rule id (text), `stock_count_id`, `adjustment_date`,
  `adjustment_type 'Stock Count'`, `adjusted_by`, `plant_id`, remarks 1-3, `organization_id`, + `posted_status` from the lifted
  fillback, `sa_v2_job_id`, `sa_idem_key`) → read back by `sa_v2_job_id` → `SAC LOCK|1` → `S|…|SC` parts (the incoming SC record) →
  link → due.
- Answer from the read-back (smv2 §7): QUEUED only when the SA is Processing under this job, its latest SAC lock is this key and the job
  is QUEUED; else STOP 500 `SA_QUEUE_FAILED` (the next click re-uses the key).

### Gates (lifted, in-process; classic texts; nothing written on failure)
- FORM: `code_node_O4tWJ5JH` (context: the request's pageStatus, saveAs Completed) → `code_node_EZJK1Hzm` + CHECK_REQUIRED_FIELD v8
  (failure → STOP 400 `SA_REQUIRED_FIELDS` with its `data.message`, the classic `return_node_OVwXCPK5` text); every entry's
  `movement_type` ∈ {in, out} case-insensitive (else STOP `SA_INVALID_MOVEMENT_TYPE` "Invalid Movement Type" + line); every line
  with `total_quantity` > 0 has an entry with `sa_quantity > 0` (else STOP `SA_LINES_WITHOUT_STOCK`); every `balance_index` ≤ 60,000
  bytes (STOP `SA_LINE_TOO_LARGE`).
- REVIEW (SQL reads rebuilt into search-node shapes; reviewer A4 shape traps): `code_review_prep` on the REQUEST's SC record (it tests
  `is_counted === 1`, `variance_qty !== 0` strictly — form values, not SQL rows) → `code_review_required` + CHECK_REQUIRED_FIELD →
  `code_review_build_sa` (inputs: ids as digit strings on both sides of every `===`; `get_sa_prefix` ONE object, rule id cast to
  text; balance rows filtered by material IN + location IN only, tenant-scoped; build error → STOP 400 `SA_REVIEW_BUILD_FAILED` with
  its `errorMessage`, = the classic 406 text) → `code_node_O4tWJ5JH` on the built doc (context: pageStatus "Add", saveAs Completed —
  adds `plant_id`, `line_index`, q8 `unit_price`, `posted_status`) → split lines at ≤ 50 entries (recompute `total_quantity` =
  Σ sa_quantity as the build does, `adj_summary`) → `code_node_EZJK1Hzm` + CHECK_REQUIRED_FIELD on the built doc → the FORM entry checks.
- SQL screens (B's `submit/submit_sql.py`): eligibility (serialized lines: SA `is_serialized_item = 1` / SC `is_serialized = 1`;
  HU on any entry; categories outside Unrestricted / Blocked / Quality Inspection; costing migration = copy of
  `tpl/smv2/prepare/…` / `scratchpad/pwv2/prepare/sql.py` SUBMIT_SQL["cost"] keyed on the entries' material / batch at the entry
  plant) → NOT_ELIGIBLE (≤ 500 entries) / STOP `SA_TOO_BIG`; a SUBTRACT of a WA item with no `wa_costing_method` row at the plant
  (material + plant + org [+ batch]) → STOP `SA_NO_WA_RECORD` with GLOBAL_INVENTORY_VALIDATION v11 `code_node_hDa6pSw5`'s text.
- Limits: entries > 5,000 → STOP `SA_SPLIT_REQUIRED`.

-------------------------------------------------------------------------------------------------------------------------------
## 8. SA_V2_WORKER

`lib/v2build.build_worker(cfg)` (smv2 §8), cfg:
```python
SA_LOCK_JOIN = """LEFT JOIN stock_adjustment g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^SA\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SAC|', SUBSTRING(j.correlation_id, 4))
                   AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
SA_ID_COL = "(CASE WHEN g.stock_adjustment_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
SA_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
cfg = V.worker_config(name="SA_V2_WORKER", code_dir="<sav2>/code/worker", command="COMPLETE_SA",
                      states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"], lock_join=SA_LOCK_JOIN,
                      id_col=SA_ID_COL, prev_col=SA_PREV_COL, corr_offset=4, id_alias="gr_id",
                      prepare=("SA_V2_PREPARE", ids["SA_V2_PREPARE"]), commit=("SA_V2_COMMIT", ids["SA_V2_COMMIT"]),
                      unlock=V.status_unlock("Stock Adjustment:Table:1902274108952006658", "stock_adjustment_status",
                                             {"stock_adjustment_status": "Stock Adjustment Status"}),
                      cache_prefix="sa_wrk_", renames=[("gr_id", "sa_id"), ...])
```
**De-LOT the copied JS** (`tpl/smv2/code/worker/*` → `code/worker/`; reviewer claim 7): prevStatus set `["Draft","In Progress"]`
(`_common.js:63`) → `SA_PREV_STATUSES`; the unlock column (`:90`) → `stock_adjustment_status`; error prefix `SA_`; state
`COMMITTING_SA`; the `LOT|` regex / offset 5 / `SMLT|` in every SQL the copies carry (`tpl/smv2/build_commit.py:123,126`,
`tpl/smv2/submit/submit_sql.py:127,132`) → `SA|` / 4 / `SAC|`. Hard codes (fail at once): `SA_INVALID_REQUEST, SA_INVALID_DATA,
SA_NOT_FOUND, SA_SC_NOT_FOUND, SA_NOT_LOCKED, SA_NOT_ELIGIBLE, SA_LINES_CHANGED, SA_SC_CHANGED, SA_SPLIT_REQUIRED, SA_PLAN_BROKEN,
SA_REVIEW_BUILD_FAILED, JOB_ILLEGAL_TRANSITION`. Tick: PREPARE → COMMIT A → COMMIT B; PARK (smv2 deviation 2) when entries > 1,000.

-------------------------------------------------------------------------------------------------------------------------------
## 9. SA_V2_PREPARE and SA_V2_COMMIT (called by the worker only; answers as smv2 §9)

### PREPARE
- Guard / entry (smv2 §9): VALIDATING COMPLETE_SA job under a live lease; `SA|<id>` → the SA; no correlation → find by
  `sa_v2_job_id`, FAILED + unlock `SA_INVALID_REQUEST`; lock check (§4) else FAILED `SA_NOT_LOCKED` (no unlock).
- Reads (ONE fork-join of uncapped tenant-scoped SQL, `JSON_OBJECT` rows): job + its S parts; SA header + lines; items (`material_code`,
  `material_name`, UOM conversion table, costing method, stock_control, serial flag); bins (`bin_location_combine`, plant) of every entry
  location; REVIEW also: the SC header + lines, `item_balance` / `item_batch_balance` (material IN + location IN), UOMs, batches, the
  SA prefix rule, costs (`sql_review_costs` copy).
- **Lift context** for `qrsgEz2F` / `GmKmvMGe` (reviewer A1): `workflowparams = { pageStatus: "Edit", saveAs: "Completed" }`,
  `code_node_O4tWJ5JH.data.stock_adjustment_status = "Draft"`, `get_node_Rs3nGg9f.data.data` = the READ-BACK header (one object, the
  stored `adjustment_no`), loop variable = each line of the plan's lines (FORM DIRECT: stored lines; COMPLETE: DOC lines; REVIEW: built
  lines). Never Processing, never the `'issued'` literal.
- REVIEW chain on fresh reads = SUBMIT's (§7): prep(S|SC part) → build → O4tWJ5JH → split → SALINES; SC part = fillback(mark(prep)).
  A build failure now (stock changed since SUBMIT) → FAILED + unlock (SA → Cancelled) `SA_REVIEW_BUILD_FAILED`.
- Movements, LABELS, HDR, ITEMS, REORDER per §5. > 5,000 → FAILED `SA_SPLIT_REQUIRED`. Ready → READY_TO_COMMIT (grv2 ready.js).

### COMMIT (step framework: smv2 `code/commit/_common.js` + `_cmp.js`; each step reads its part + fresh rows → after = done, before =
write, else REQUIRES_REVIEW → write → read back → `<STEP> DONE`)

| Step | Phase | Writes | Done / failure |
|---|---|---|---|
| entry | — | lease `PUB|`, COMMITTING_SA, progress 70 / 85 | manifest invalid / SA not owned before A2 → FAILED + unlock; after → REVIEW |
| A0_REVALIDATE | A | — | owner + Processing; FORM: stored `saLineFingerprint` ∈ {lineFingerprint, incomingFingerprint}; REVIEW: stored `scLineFingerprint` = scFingerprint and no OTHER Processing SA for the SC → DONE; else FAILED + unlock (`SA_NOT_LOCKED` / `SA_LINES_CHANGED` / `SA_SC_CHANGED`) |
| A1_SA_LINES | A | REVIEW / edited COMPLETE: ONE update of `stock_adjustment` by id: `{ id, …header props (COMPLETE), stock_adjustment: SALINES rows with EVERY column }` — NEVER `adjustment_no`, `adjustment_no_type`, `stock_adjustment_status` (reviewer A2: would re-issue a number under the worker's session) | stored fingerprint = incomingFingerprint (+ header props `sameStored`) → DONE; = lineFingerprint → write; else REVIEW. Never sliced (rows missing from the call are soft-deleted; rows without id inserted) |
| A2_INVENTORY | A | INVENTORY_BULK_APPLY APPLY `SAC|<jobId>` | 200 / REPLAYED → DONE + SPLIT / PARK; 409 → intents > 0 ? stepEnd : attempts ≥ 8 ? FAILED + unlock `SA_INVENTORY_LOCK_BUSY` : lockWait (15 s × 2^n, cap 300 s; gdc c2.js); 400 → failNoWrite + LABELS message, code `SA_INVENTORY_<engine code>`; else REQUIRES_REVIEW |
| A3_STOCK_COUNT | B | REVIEW: ONE update of `stock_count` by id with the SC part's props (never the number props); FORM with `stock_count_id` (parity of `update_node_ArYV2yrs` + `code_node_SZmrixfL`): read SC lines → ids with `line_status 'Approved'` → update THOSE ids to `Adjusted` (id list computed in code; skip when empty) → recompute `adjustment_status` over all lines → header update | REVIEW: stored scFingerprint = afterFingerprint → DONE, = beforeFingerprint → write, else REVIEW; PARITY: no Approved left + header = computed → DONE |
| A4_FINISH | B | Item `last_transaction_date` (ITEMS, slices ≤ 250, by id); `A4_REORDER` marker row (insert; a duplicate = already called → skip) then REORDER_SET_REDIS (REORDER part, `organization_id` passed); header `stock_adjustment_status 'Completed'` (HDR) | header at after → DONE; at before → write; else REVIEW |
| finish | B | job COMPLETED, progress 100, `finished_at`, lease released | |

Phase B never unlocks and never fails: stepEnd (2 s × 2^n, max 30 s, 3 retries) → REQUIRES_REVIEW `SA_RECONCILIATION_MISMATCH`.
`failNoWrite` (phase A only) = FAILED (`Not completed: <reason>`) + the unlock (§2) when the job still owns the SA.
**REQUIRES_REVIEW runbook** (README): clear the engine's `IBA|REVIEW`, reset the job, re-kick (as GR 10-15); the SA stays Processing
(blocks its SC) and the engine keeps its locks.

-------------------------------------------------------------------------------------------------------------------------------
## 10. Error codes (`SA_*`; message = what the user reads)

`SA_INVALID_REQUEST` (INVALID 400 / FAILED) · `SA_NOT_FOUND` / `SA_SC_NOT_FOUND` (STOP 400 / FAILED) · `SA_BUSY` "This Stock Adjustment is
being processed in the background - please wait for it to finish." (BUSY 409; classic guard 400) · `SA_SC_BUSY` "A Stock Adjustment from
this Stock Count is being processed in the background - please wait for it to finish." (BUSY 409; classic STOCK_COUNT guard 400) ·
`SA_UNDER_REVIEW` (BUSY) · `SA_STALE` / `SA_SC_STALE` (409: changed by someone else, reopen) · `SA_ALREADY_FINAL` (409) ·
`SA_NOT_ELIGIBLE` (300) · `SA_TOO_BIG` (400: "<n> entries … at most 500") · `SA_CLASSIC_TOO_BIG` (classic guards: "This Stock Adjustment
has <n> entries. Adjust at most 500 at a time." / "This review has <n> approved lines with a variance. Review at most 500 lines at a time.")
· `SA_SPLIT_REQUIRED` (> 5,000 entries) · `SA_LINE_TOO_LARGE` ("Line <n> holds too many bins (<bytes> bytes); split it into several lines.")
· `SA_RESERVED` (classic guard, 2026-10-22: "Line <n>: Reserved stock belongs to another document. Release it there first.") · `SA_STOCK_LOCKED` (classic guard, 2026-10-22: "Some of this stock is being moved by another background operation (<owner>). Please try again in a minute.") · `SA_REQUIRED_FIELDS` · `SA_INVALID_MOVEMENT_TYPE` · `SA_LINES_WITHOUT_STOCK` · `SA_NO_WA_RECORD` · `SA_REVIEW_BUILD_FAILED` ·
`SA_QUEUE_FAILED` (500) · `SA_NOT_LOCKED` · `SA_LINES_CHANGED` · `SA_SC_CHANGED` · `SA_PLAN_FAILED` / `SA_PLAN_BROKEN` ·
`SA_INVENTORY_<engine code>` · `SA_INVENTORY_LOCK_BUSY` · transient `SA_LOCK_WAIT`, `SA_STEP_RETRY`, `SA_WAIT`, `SA_TRANSIENT` ·
`SA_TRANSIENT_RETRIES_EXHAUSTED` · `SA_RECONCILIATION_MISMATCH` · `SA_PREV_STATUS_UNKNOWN` · `SA_INVALID_DATA`.

-------------------------------------------------------------------------------------------------------------------------------
## 11. Guarded classics (B) — deployed base + new FIRST nodes; ship to prod at the cut

Both read only document tables (never `gd_async_job` — prod has none until the full deployment), never answer 401, and add nothing
else: every other node byte-identical to the base (B proves it with a node-by-node diff, as `tpl/smv2/classic/diff_v82.py`).
- **`Stock Adjustment/AsyncV2/STOCK_ADJUSTMENT.json`** = base v24 + guard before `code_node_O4tWJ5JH`. Refusals answer like the
  classic's own failures: a **return node** `{ code: "400", message }` (status 200) — the SA form reads `workflowResult.data.code`.
  1. `allData.id` digits → ONE SQL: stored `stock_adjustment_status` only (ruling 2026-10-16: no stored entry count — a JSON_TABLE over
     a malformed / truncated stored `balance_index` would block every save of that SA). Stored `Processing` → `SA_BUSY` text.
  2. Entries in the PAYLOAD (lines × `balance_index` entries with `sa_quantity > 0`; parse failures count as 0) > 500 →
     `SA_CLASSIC_TOO_BIG` text. Only when `saveAs` ≠ Draft (the Draft branch moves nothing).
  3. Any payload line's `balance_index` > 60,000 UTF-8 bytes → `SA_LINE_TOO_LARGE` text (prod would truncate it silently).
  4. (2026-10-22, RF-03 with bladexfunctions-9d, user's call) a moving entry (`sa_quantity > 0`) whose category is Reserved (trimmed,
     any case) → `SA_RESERVED` text, saveAs ≠ Draft only; checked after the entry cap, before the line size. V2 never moves Reserved
     (SUBMIT's allow-list sends it here as NOT_ELIGIBLE); this stops it before the classic writes the header Completed.
  5. (2026-10-22, 9d's proposal, user's call) a non-Draft save whose movements' engine lock keys (ITEM|mat|bin, BATCH|mat|bin|batch,
     COST|mat|plant - as INVENTORY_BULK_APPLY builds them) include one HELD by a background operation (free_token 0, owner set, not
     9d's classic `CL|`) → `SA_STOCK_LOCKED` text naming the owner; read in the same SQL as the stored status (UNION ALL). Checked
     last (after Processing and the payload refusals). Leaked locks with no owner never refuse.
- **`Stock Count/AsyncV2/STOCK_COUNT.json`** = base v10 + guard before `cond_save_as`. Refusals answer like the classic's own failures:
  an **end node** `back_data_type Default, code 400, msg` → envelope `{code 400, success false, data null, msg}` — the web handlers'
  error path and mobile's `normalizeWorkflowResult` both show `msg` (Putaway V2 Mobile / Packing V2 confirmed; tell Packing V2 before
  publishing).
  1. `allData.id` digits → ONE SQL: `EXISTS stock_adjustment WHERE stock_count_id = <id> AND stock_adjustment_status = 'Processing'
     AND is_deleted = 0` (tenant-scoped) → `SA_SC_BUSY` text. Applies to every saveAs (covers mobile "Stock Count" saves).
  2. saveAs `Review` AND the classic would build an SA AND its itemsWithVariance > 500 → the review `SA_CLASSIC_TOO_BIG` text — using
     `code_review_prep`'s exact predicates (ruling 2026-10-16, B1 question 3: a review that declines the adjustment builds no SA and
     must not be refused): after dropping `line_status "Cancel"`, allApproved = every line_status ∈ {Approved, Adjusted};
     approvedItems = review_status === "Approved" && line_status !== "Adjusted"; itemsWithVariance = approvedItems with
     `variance_qty !== 0` (strict, as the classic) && line_status === "Approved"; doProcess = approvedItems.length > 0 && (allApproved ||
     `workflowparams.createAdjustment === "Yes"`).
  Guards read only `allData.id` / `allData.table_stock_count` / `saveAs` / `createAdjustment` (mobile sends `pageStatus` as an object).
  Known limits (accepted): a classic Review (≤ 50 approved-variance lines with V2 ON; any size ≤ 500 with V2 OFF) groups one material +
  plant + direction + price into ONE SA line — a group above ~90 bins (~650 B / entry) exceeds 60,000 bytes, the guarded completion
  refuses that SA while the classic Review has already marked the SC lines Adjusted (before: silent truncation on prod). Prod max SC =
  132 lines. Lines 60,000-65,535 bytes that used to store intact are now refused (prod max line 7.6 KB). The SC guard's SQL scans
  `stock_adjustment` (no index on `stock_count_id`; ~1k rows on prod). The status check is read-then-write (no CAS), as LOT's guard.

-------------------------------------------------------------------------------------------------------------------------------
## 12. Client (D) — built on the PULLED live versions (SA form v313, SC form v497, SA list v57, SC list v38); switches OFF at the cut

**SA form** (`Stock Adjustment/AsyncV2/SAform.json`; base `base/sa_form_v313.json`):
- New events `saV2_onClick_completed` / `saV2_onClick_completed_post` (`client/src/saV2_onClick_completed.js`, one source, the classic
  name a constant); the Completed and Completed & Post buttons are rebound to them. V2 when `ASYNC_SA_ENABLED` and entries > 50 and no
  serialized line; anything else, any exception before SUBMIT, NOT_ELIGIBLE or INVALID → `this.triggerEvent("onClick_completed" |
  "onClick_completed_post")` — the classic rule handlers stay byte-identical (rollback = rebind). Waits for the verdict (STATUS every
  2.5 s ≤ 180 s, re-kick WORKER every 15 s; verdict = terminal or progress ≥ 80); FAILED → error, gen + 1; an Edit keeps the form,
  a NEW SA (Add / Clone) closes it — it is already a saved Draft, a retry from the open form would add a second SA (D ruling). A new
  SA keeps its idempotency key until its job is linked (f8's lesson); while its completion may already be saved (no answer, STOP 500,
  not linked in 90 s) the client hides Save as Draft. STATUS polls: FORM new SA = `sa_id "0"` + the key; SC view = source REVIEW,
  sa_id, sc_id, empty key — SUBMIT resolves key → sa_id → sa_v2_job_id regardless of source.
- `onClick_draft` (rule func, key `uk4w8v1h`): on Edit, re-read the stored `stock_adjustment_status` first; refuse unless `Draft`
  ("This Stock Adjustment is <status> and can't be saved as Draft.") — reviewer A6.
- Status select filter += `Processing` (dict 1914500993831477249) and `Cancelled` (1914500943030067202); mounted badge cases for both;
  the Post button hidden for Processing / Cancelled (`disabledEditField` path); mounted Processing view (read-only, STATUS, re-kick
  every 15 s; FAILED shown once per browser) — inert while OFF.
- Schema: hidden `sa_v2_job_id`, `sa_idem_key` (varchar 255; the form publish creates the columns).
**SA list** (`SAlistPage.json`; v57): mounted kick (throttled 2 min, chained while `processed > 0`, gated by `ASYNC_SA_ENABLED`);
Processing badge / filter if the list renders statuses; bulk Post / Delete already exclude Processing (verify).
**SC form** (`SCform.json`; v497): new event `scV2_onButtonReviewClick` = the live `onButtonReviewClick` body + ONE inserted branch after
the confirmations (V2 when `ASYNC_SC_REVIEW_ENABLED`, `createAdjustment`/allApproved would create an SA, approved variance lines > 50) —
the Review button is rebound to it; the classic `onButtonReviewClick` stays byte-identical (rollback = rebind). Mounted: a Processing
SA for this SC → read-only + banner + re-kick (gated).
**SC list** (`SClistPage.json`; v38): mounted kick, gated.
**Fall-through regression** (`client/check_fallthrough.js`, copy of smv2's): with switches OFF every rebound button reaches the
unchanged classic code path.

-------------------------------------------------------------------------------------------------------------------------------
## 13. Ownership and build

| Owner | Files (`scratchpad/sav2/` unless a repo path is given) |
|---|---|
| controller | `CONTRACT.md`, `PROGRESS.md`, `ids.json`, `build_sa.py`, `lib/` (verbatim), `tpl/` (verbatim, never edited), `base/`, `code/shared/`, `code/worker_src_grv2/`, `test/lib_smoke.py`, `test/shared/`, `Stock Adjustment/AsyncV2/ids.json`, READMEs |
| A PREPARE | `build_prepare.py`, `code/prepare/`, `prepare/`, `lift/`, `test/prepare/` |
| B SUBMIT + classics | `build_submit.py`, `build_classic.py`, `code/submit/`, `code/classic/`, `submit/`, `test/submit/`, `test/classic/` |
| C COMMIT + WORKER | `build_commit.py`, `build_worker.py`, `code/commit/`, `code/worker/`, `commit/`, `test/commit/` |
| D client | `client/`, `Stock Adjustment/AsyncV2/{SAform,SAlistPage}.json` + `*.js`, `Stock Count/AsyncV2/{SCform,SClistPage}.json` + `*.js` |
| E checks | `parity/`, `race/`, `live/` |

Build: `python3 scratchpad/sav2/build_sa.py [--write] [NAME ...]` (each `build_*.py` exposes `BUILDERS = [("<NAME>", fn)]`; names
SA_V2_PREPARE / SA_V2_COMMIT / SA_V2_WORKER / SA_V2_SUBMIT / STOCK_ADJUSTMENT / STOCK_COUNT). Outputs: `Stock Adjustment/AsyncV2/<NAME>.json`
and `Stock Count/AsyncV2/STOCK_COUNT.json` (indent 1). Before a publish: `python3 scratchpad/validate.py <file>`, `lib/sqlcheck.py` on
dev, the switch-OFF regression; published with `.dbtools/wf_upload.mjs` + my own `--plan` file (`deploy/`), `wf --dev backup` first,
one user yes per batch.

-------------------------------------------------------------------------------------------------------------------------------
## 14. SQL conventions and node-data budget — smv2 §14 verbatim (tenant-scoped, CAST ids, COLLATE utf8mb4_general_ci, SELECT/WITH only,
no `SET`, hand-quoted placeholders, ≤ 160-char lines via `wrap_doc_sql`, no business row caps, DB clock). Budget at 2,000 entries:
SUBMIT REVIEW ≤ 25 MB (build gate + parts), PREPARE ≤ 25 MB, COMMIT A ≤ 20 MB, COMMIT B ≤ 20 MB; PARK keeps each chain ≤ ~35 MB.

-------------------------------------------------------------------------------------------------------------------------------
## 15. Cost-row race (E) and the engine proposal

Scenarios on dev (user yes; dedicated test items; op keys `SACRACE|<run>|<A|B>`; tenant announced first), each 10×, reconciler =
cost-row delta vs movement delta per (material, plant[, batch]):
- R1 FIFO SUBTRACT vs SUBTRACT (overlapping); R2 WA ADD vs ADD; R3 FIFO ADD vs ADD (duplicate `fifo_sequence`);
- **R0 the silent interleaving (eb):** B = a large SA-shaped op (≥ 1,000 movements: a wide read → write window) with the shared
  material; A = a small op on that material + plant in another bin, fired just after B's read → expect A DONE, then B overwrites with
  stale absolutes and is DONE too (A's consumption / re-average lost);
- R4 a 2k SA V2 job vs a GD V2 completion on overlapping items (after the cut).
Evidence → bladexfunctions-eb + -a6 + the user. Proposal bar (eb's conditions, 2026-10-16): `COST|<material>|<plant>` keys derived
INSIDE APPLY (callers unchanged — a6) for isMovingInv 0 movements on FIFO / WA items, in the same sorted TAKE as ITEM / BATCH;
INVENTORY_LOCK_TOKENS' BALANCE_TYPE_INVALID path + GIVE re-read accept `COST`; before publish: the 7,489-call replay byte-identical,
`scratchpad/gdc/engine/test_core.js`, eb's commit_sim / test_hu / test_c2_lock, a live completion re-run. Yes from eb, a6, a3 and the
user (the engine's builder, 8a, is gone — engine changes are the user's call). Note (a6): GR Revert V2's R2 writes cost rows itself, so
an engine COST lock does not cover it.

-------------------------------------------------------------------------------------------------------------------------------
## 16. The shared review chain (owned by package A; used by A PREPARE and B SUBMIT — exception to "code/shared is controller")

Both SUBMIT (gate) and PREPARE (plan) run the SAME chain, so it is ONE module + ONE SQL file:
- `code/shared/review_sql.py` (A): `REVIEW_READS = { "items", "balances", "batch_balances", "bins", "uoms", "batches", "costs",
  "prefix" }` — SQL texts reproducing the classic `par_review_fetch` reads (search_item: id IN materialIds; search_item_balance /
  search_item_batch_balance: material IN materialIds AND location IN locationIds AND is_deleted 0 — NO plant / org filter, as the
  classic; search_bin_location: id IN locationIds; search_uom: id IN baseUomIds; search_batch: id IN batchIds; get_sa_prefix:
  business_type 'Stock Adjustment' AND department_id = org AND is_default 1 (+ is_deleted 0) `ORDER BY is_draft, id` — prefer the
  non-draft default (ruling: 7 dev departments have both; prod has one per department → unchanged); sql_review_costs verbatim), every one
  tenant-scoped (`tenant_id = '@T'`), ids bare digit lists from prep's `materialIds` / `locationIds` / `baseUomIds` / `batchIds`
  (`0` for none), one `JSON_OBJECT … AS j` per row with every column the build reads (ids `CAST(… AS CHAR)`).
- `code/shared/review_chain.js` (A), pure JS, no platform calls:
  `saReviewChain({ scRecord, createAdjustment, organizationId, nickname, adjustmentDate, reads })` →
  `{ prep, required, built, saDoc, scAfter, counts }` where
  - `reads` = the SQL rows of `REVIEW_READS` (`{ j }` rows or objects); the chain adapts them to the EXACT search-node / get-node /
    sql-node shapes the classic nodes received (search-node rows: bigint ids as digit STRINGS, NULL / '' keys DROPPED, decimals as the
    platform hands them; get_sa_prefix ONE object, `{}` when none; sql_review_costs rows as the sql-node returns them) — golden-tested
    against recorded STOCK_COUNT Review runs (node outputs in `nodes_data`);
  - `prep` = lifted `code_review_prep` over `scRecord` (the REQUEST's SC record — never SQL rows), `required` = `code_review_required`'s
    `{ required_fields, data }` (the caller runs lifted CHECK_REQUIRED_FIELD on it), `built` = lifted `code_review_build_sa`
    (`{ stockAdjustmentDoc, hasError, errorMessage, hasLines }`), `saDoc` = `built.stockAdjustmentDoc` after lifted
    `code_node_O4tWJ5JH` (context pageStatus "Add", saveAs "Completed") and the ≤ 50-entry split, `scAfter` =
    `code_fillback(code_review_mark(prep))` (lifted; `code_review_mark` only when `prep.doProcess === 1`), `counts` = { lines, entries }.
  - The split (`saSplitLines(doc)`, exported): a built line with > 50 entries becomes ⌈n / 50⌉ lines in order, each a copy of the line
    with its slice of `balance_index`, `total_quantity` = q8 Σ slice `sa_quantity`, `adj_summary` rebuilt in the build's format
    (`Total: <q> <uom>\nDETAILS:\n1. …` — the detail texts are carried per entry by the chain); `line_index` renumbered after
    O4tWJ5JH's numbering.
  - Lift sources: `base/STOCK_COUNT.v10.json` (code_review_prep, code_review_required, code_review_build_sa, code_review_mark,
    code_fillback) and `base/STOCK_ADJUSTMENT.v24.json` (code_node_O4tWJ5JH) via `lib/lift/lift.py` + `runtime.js` (declared-keys
    filtering, number / string coercion as the platform does).

-------------------------------------------------------------------------------------------------------------------------------
## Rulings (plan + reviewer, 2026-10-16)
1. Reviewer A1-A12 are folded in: A1 lift context (§9), A2 A1 never writes number / status, A3 id-free fingerprint, A4 `remark*` keys +
   entry category, A5 `SCR` twin guard + Adjusted-shown-Approved STALE, A6 Draft re-read, A7 `A4_REORDER` marker, A8 O4tWJ5JH + CHECK on
   the built review doc, A9 A3 writes update_node_sc's props, A10 status filter / badges / Post button, A11 60,000-byte refusal (V2 and
   classic), A12 COMPLETE carries the header props.
2. B2: the guarded classics keep the 500 cap (prod max SC 132 lines / SA 50 entries; a review can be done in batches).
3. B3: a FORM SA with `stock_count_id` = classic parity (every Approved → Adjusted, then the header recompute).
4. B4: REVIEW writes the SA lines (A1) BEFORE the stock (A2); a failed review leaves a Cancelled SA holding its lines (audit).
5. B5: REORDER_SET_REDIS gets `organization_id`; its session-org precedence is the known GD V2 limit.
6. B6: no reuse of a Cancelled review SA; number gaps accepted in v1.
7. Deliberate differences (plan): atomic stock; status after stock; invalid movement_type / lines without stock / > 60 KB lines refused
   before any write; SC lines Adjusted after stock moved; twin review 409.
