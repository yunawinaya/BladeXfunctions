# Item Assembly V2 - the binding contract (WP0, 2026-10-19)

Single source of truth for packages A (PREPARE), B (SUBMIT + the guarded classic IA_SAVE v12), C (COMMIT + WORKER), D (client
form + list), E (checks), F (Revert V2 + the guarded classic IA_REVERT v5: part "Revert V2", RV1-RV10). Plan: `~/.claude/plans/cheeky-shimmying-puffin.md` (approved 2026-10-19; its Design section is
binding). Template: `tpl/smv2/CONTRACT.md` (Location Transfer V2): "as LOT §n" = copy that mechanism verbatim with the names of
§1. Closest code analog: `tpl/sav2/` (Stock Adjustment V2, isMovingInv 0 with COST locks); batch insert and op-2 waits:
`tpl/grv2/commit/` (GR V2 C1 / C2). Marks: **[plan]** decided by the plan, **[controller n]** / **[review n]** the controller's
notes and the plan review (Contract deviations), anything else copies a template and names it. A change to this file or to
`code/shared/` goes through the controller; never edit another package's folder, `tpl/` or `base/`.

Bases (`base/`, exact snapshots of LIVE dev, `python3 base/snapshot.py --check`): IA_SAVE v11 (= prod v11), IA_REVERT v4,
CHECK_REQUIRED_FIELD v8, GLOBAL_INVENTORY_VALIDATION v11, GENERATE_BATCH v20, INVENTORY_BULK_APPLY v10, INVENTORY_LOCK_TOKENS v5,
INVENTORY_LOCK_SEED v5, ADD_INVENTORY v65, SUBTRACT_INVENTORY v59, ACC_PRODUCER v119, SQL_FETCH_POST_DATA v221, form
`ia_form_v34.json` [re-pinned 2026-10-19 after the dev drift; was v218 / v32], list `ia_list_v20.json`, schemas, `columns.json`. Ids: `ids.json` (verified, `base/refs.md`).

---------------------------------------------------------------------------------------------------------------------------
## 1. Names and constants [plan]

| Constant | Value | Notes |
|---|---|---|
| shells (the user creates them in the dev designer, folder Save Workflow / BOM + IA) | `IA_V2_SUBMIT`, `IA_V2_WORKER`, `IA_V2_PREPARE`, `IA_V2_COMMIT` | ids in `ids.json` ("0" until created) |
| command | `COMPLETE_IA` (Revert V2: `REVERT_IA`, RV1) | each worker polls only its own command; never point GD_JOB_RECONCILE at them |
| correlation / causation | `IA|<iaId>` / `<iaId>` (SHARED with REVERT_IA: one open job per IA) | `''` / `''` in the insert of an Add until "link"; `gd_id` / `gd_no` never written |
| document lock | `job_id = IAC|<iaId>`, `step_name = LOCK|<n>`, result_ref = the job's idempotency key (the ONE lock sequence of the IA, shared with REVERT_IA) | <= 23 chars |
| engine operation 1 (issue) | `IAC|<jobId>|I`, movements `M1` ... `Mn` (SUBTRACT, one per stock pick) | 25 chars; engine key regex `^[A-Za-z0-9|:._-]{1,32}$` |
| engine operation 2 (receipt) | `IAC|<jobId>|R`, movement `R1` (ADD of the assembled item) | 25 chars |
| PREPARE parts | `P|<nonce>|<PART>|<nnn>`, PART in ENGINE_I, ENGINE_R, BATCH, LABELS, ITEMS (no NONSTOCK: user decision ~15:45) | under `job_id = <jobId>`, <= 23 chars |
| COMMIT step rows | `I0_REVALIDATE`, `I1_BATCH`, `I2_ISSUE`, `I3_RECEIPT`, `I4_FINISH` (DONE); intent `I1|I|001` (INTENT) | steps SQL `REGEXP '^I[0-9]_'` (the intent row does not match it) |
| worker claim / leases / cache | `W0_CLAIM_<row_version>`; `WRK|`, `PUB|`, `SPLIT|` + 24 hex; `ia_wrk_<nonce>` | as LOT §1 |
| states | QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_IA -> COMPLETED; terminal FAILED, REQUIRES_REVIEW | |
| prevStatus (the unlock target) | `Draft` only (`IA_PREV_STATUSES`) | anything else: no unlock, REQUIRES_REVIEW `IA_PREV_STATUS_UNKNOWN`; no default anywhere |
| error prefix | `IA_` (§10) + the shared `JOB_ILLEGAL_TRANSITION`, `JOB_ROW_VERSION_CONFLICT` | |
| form | `item_assembly_status` gains `Processing` (dict row 1914500993831477249, parent 1914242988707749889, dev and prod); hidden inputs `ia_v2_job_id`, `ia_idem_key` (varchar 255; the form publish creates the columns); badge `processing_status` | §12 |
| client switches (OFF at the cut unless green) | `ASYNC_IA_ENABLED`, `IA_V2_ACTIONS = { COMPLETE, COMPLETE_POST }`, `IA_V2_MIN_PICKS = 50` | §12 |
| sizes (`code/shared/ia_common.js`) | V2 when picks > 50 (client); `IA_CLASSIC_MAX_PICKS = 250` (**the user's decision 2026-10-19**: caps the classic IA_SAVE Completed path and the classic IA_REVERT); op 1 <= 5,000 movements (`IA_MAX_PICKS`); PARK after COMMIT A above 1,000 picks (`IA_PARK_PICKS`) | NOT_ELIGIBLE -> classic only up to the classic cap, above it STOP `IA_TOO_BIG` |

Namespace check (dev, 2026-10-19): 0 jobs `COMPLETE_IA` / `IA|`, 0 step rows `IAC|`, no `IA_V2_*` workflow on dev or prod (`base/refs.md`).

**Picks.** A pick = a `temp_qty_data` entry with `sm_quantity > 0` (`iaPicks`: the classic `code_issue_line` filter, array
order, an unparseable value has none). `pickCount` = `iaPickCount(all lines)` - what the client and the classic v12 cap count
(no item read). Stock picks = the picks of lines whose item has `stock_control <> 0` = op 1's movements. Non-stock lines carry
no picks by the client rule (§12), so the two are equal in practice; the 5,000 limit and the PARK rule use op 1's movements.

---------------------------------------------------------------------------------------------------------------------------
## 2. Actions [plan]

| stored status | saveAs | result | prevStatus |
|---|---|---|---|
| (Add / Clone) | Completed | DIRECT: a job | Draft |
| Draft | Completed | DIRECT: a job | Draft |
| any (also Add / Clone) | Draft | NOT_ELIGIBLE 300, reason `draft` (Draft always stays classic; never STOP) | |
| Processing, or an open COMPLETE_IA **or REVERT_IA** job of `IA|<id>` (`IA_OPEN_JOB`: QUEUED, VALIDATING, READY_TO_COMMIT, COMMITTING_IA, COMMITTING_REVERT, REQUIRES_REVIEW) | any | BUSY 409 (`IA_BUSY`; `IA_UNDER_REVIEW` when that job is REQUIRES_REVIEW) | |
| the latest `IAC|<iaId>` lock is younger than 120 s, belongs to ANOTHER key and its job is missing or open (a submit between its lock and its job insert; SA's B2 rule) | any | BUSY 409 `IA_BUSY` | |
| the form's `item_assembly_status` differs from the stored one | any | STALE 409 `IA_STALE` | |
| Completed / Fully Posted | any | STALE 409 `IA_ALREADY_FINAL` | |
| any other stored status (`Issued`, blank, ...) | Completed | NOT_ELIGIBLE 300, reason `status <x>` | |
| saveAs not Draft / Completed, pageStatus View or unknown, bad ids / key / tenant, no form | - | INVALID 400 | |

`pageStatus` `Clone` (the form's `isCopy`; `Copy` accepted) counts as `Add`: SUBMIT strips the header id and every line id
before anything else (LOT §2; the desktop Clone keeps the source id [review 5]). Complete & Post is a DIRECT on the server;
only the client knows to post [plan].

Entry order (as LOT §2): INVALID -> a job already holds this idempotency key -> its STATUS answer -> `operation STATUS` ->
STATUS answer -> Add / Clone goes on -> stored IA missing -> STOP 400 `IA_NOT_FOUND` -> BUSY -> STALE -> the action table ->
eligibility (§7) -> gates (§7) -> limits -> the WA screen -> the GENERATE_BATCH pre-check and call -> writes. [review 9]: every
BUSY / STALE / eligibility / limit check runs before GENERATE_BATCH, which runs right before the first write.

**Unlock everywhere** (WORKER, PREPARE, COMMIT `failNoWrite`; SUBMIT never unlocks) writes `{ id: <iaId>, item_assembly_status:
"Draft" }` only when the job still owns the IA and `iaPrevStatusOk(prevStatus)`; otherwise no unlock and REQUIRES_REVIEW
`IA_PREV_STATUS_UNKNOWN` (LOT deviation 4).

---------------------------------------------------------------------------------------------------------------------------
## 3. gd_async_job for COMPLETE_IA (a)

### Columns written, by writer (as LOT §3)

| Writer | Columns |
|---|---|
| SUBMIT insert (`lib/v2build.JOB_ADD_COLS`) | organization_id, plant_id (= header `issuing_operation_faci`), command `COMPLETE_IA`, idempotency_key, job_status `QUEUED`, progress_percent 0, progress_message `Queued for processing`, attempt_count 0, row_version 0, cancel_requested 0, next_attempt_at = db_now + 120 s, request_payload (below), causation_id (`<iaId>`; `''` for an Add), correlation_id (`IA|<iaId>`; `''` for an Add), line_count (= pickCount), queued_at = db_now |
| SUBMIT link (Add / Clone, after the read-back) | id, correlation_id, causation_id, request_payload (+ iaId, iaNo, issuedNo, lineFingerprint) |
| SUBMIT due (after the read-back) | id, next_attempt_at = db_now, request_payload (stored Draft: + iaNo, issuedNo, lineFingerprint) |
| WORKER | `JOB_PROPS`; the dead-claim move: id, row_version, attempt_count |
| PREPARE | READY: id, job_status, progress_percent, progress_message, row_version, error_code, error_message, error_details, prepared_payload, line_count. FAILED: `JOB_PROPS` |
| COMMIT | `JOB_PROPS` (every row from `jobRow`) |

Never written: gd_id, gd_no, picking_id, picking_no, payload_hash, confirmation_token / _hash, source_so_*, submitted_*,
started_at, gd_committed_at, picking_ready_at. Unique `Idempotency Key` (tenant, organization, key) stops a twin click.

### request_payload (JSON text, written by SUBMIT only)

```json
{
  "v": 1,
  "action": "DIRECT",
  "prevStatus": "Draft",
  "saveAs": "Completed",
  "pageStatus": "Edit",
  "iaId": "2112073133161844738",
  "iaNo": "IA-2610-0042",
  "issuedNo": "IA-2610-0042",
  "lineFingerprint": "IF1:833:69698384367f7d26",
  "organizationId": "1123598813738675201",
  "plantId": "1123598813738675202",
  "lineCount": 833,
  "pickCount": 830,
  "nonStockLines": 3,
  "movementCount": 831,
  "uid": "1123598821738675201",
  "source": "FORM",
  "nonce": "ab12cd34",
  "parts": {}
}
```

| Key | Type | Meaning |
|---|---|---|
| action / prevStatus / saveAs | `DIRECT` / `Draft` / `Completed` | the only action (§2) |
| pageStatus | `Add` / `Edit` | as the classic takes it; Clone / Copy stored as `Add` |
| iaId, iaNo | digit string, text | the stored IA and its number after SUBMIT's writes (read back); an Add gets them in "link" |
| issuedNo | text | the number THIS submit made the platform issue (written with the `'issued'` sentinel); `''` when none (manual `-9999`, or the stored number kept) |
| lineFingerprint | `IF1:<n>:<hex16>` | `iaLineFingerprint(FP_LINES rows, FP_HEADER row)` of the IA read back after SUBMIT's writes (§6) |
| organizationId, plantId | digit strings | header `organization_id` / `issuing_operation_faci` |
| lineCount | int | component lines |
| pickCount | int | §1 Picks (also the job's `line_count`) |
| nonStockLines | int | lines whose item has `stock_control = 0` (no picks, no movement, nothing in the price: informational) |
| movementCount | int | engine movements of the job: op 1's stock picks + 1 (R1) |
| uid / source / nonce | text / `FORM` or `MOBILE` / 8 of `[0-9A-Za-z]` | `{{system:uid}}`; mobile V2 comes later and changes nothing on the server; SUBMIT's run nonce |
| parts | `{}` | SUBMIT writes the document itself; no S parts |

**Number rule [review 6]** (the 2026-09-14 rule; IA_REVERT keeps the number and sets Draft): DIRECT from a stored Draft writes
WITHOUT the number props (`stock_movement_no`, `stock_movement_no_type`) only when the stored number is the `issuedNo` of an
earlier COMPLETE_IA job of this IA (`FACTS.issued_by_job > 0`) AND no COMPLETED COMPLETE_IA job of `IA|<iaId>` ran under it
(`FACTS.completed_under = 0`, by request `iaNo`); otherwise it writes them as the fill-back leaves them (`'issued'`, or with
`stock_movement_no_type = -9999` the typed manual number). An Add always writes them.

### Idempotency key (recipe: grv2 `grc_onClick_completed.js` idemKey + LOT deviation 5)

`IA:<organization_id>:<iaId | "new-" + pageToken>:<hash16>:<gen>`, characters outside `A-Za-z0-9|:_.-` -> `-`, cut to 128;
SUBMIT refuses anything else (`IA_KEY_RE`, 8-128 of that set). `hash16` = FNV-1a 32 + djb2 32 over `canon({ saveAs:
"Completed", pageStatus, record })`; both buttons send the same content, so one key serves Completed and Complete & Post.
`record` = `this.getValues()` minus NOT_RECORD (§12). `pageToken` once per form open in `_data`; `gen` starts at 1, + 1 after
a FAILED answer for the same content. A lost answer re-sent with the same key finds the same job.

### State machine (as LOT §3, COMMITTING_IA)

| From | To | Written by | When |
|---|---|---|---|
| - | QUEUED (next_attempt_at = now + 120 s) | SUBMIT insert | after every check (§2 order) |
| QUEUED | QUEUED, due now | SUBMIT due | the read-back shows the IA Processing under this job's lock (if SUBMIT dies first, the job falls due by itself) |
| QUEUED | VALIDATING (lease `WRK|`, 10 min) | WORKER claim | |
| VALIDATING | READY_TO_COMMIT (lease kept) | PREPARE | manifest + parts written, both PLANs clean |
| VALIDATING | FAILED (+ unlock) | PREPARE | a clean plan failure (§9) |
| VALIDATING / READY_TO_COMMIT | same, attempt + 1, backoff 2 s x 2^n (max 30 s) | WORKER | a callee answered without a code / a dead lease or claim (max_retries 3) |
| VALIDATING / READY_TO_COMMIT | FAILED (+ unlock) | WORKER | a hard code (§10) or retries exhausted |
| READY_TO_COMMIT | COMMITTING_IA (lease `PUB|`) | COMMIT entry | |
| COMMITTING_IA (phase A) | FAILED (+ unlock, + this job's Batch row soft-deleted) | COMMIT | I0 fails, I1 fails or its re-PLAN refuses, I2 400 with a result_code, I2 lock waits exhausted, an unusable manifest - while op 1 has no engine row; once it has one, REQUIRES_REVIEW instead [ruling 10 R2] |
| COMMITTING_IA (phase A) | COMMITTING_IA, lease `SPLIT|` or PARK, attempt_count 0 | COMMIT I2 | op 1 applied (§8 tick rule) |
| COMMITTING_IA | COMMITTING_IA, attempt + 1, backoff | COMMIT | stepEnd / I2 lockWait |
| COMMITTING_IA (phase B) | COMMITTING_IA, due in 10 s, attempt unchanged | COMMIT I3 | op 2 transient (stepWait) until the deadline |
| COMMITTING_IA | REQUIRES_REVIEW | COMMIT / WORKER | I2 500 / intents with retries spent; I3 refused, timed out (30 min from I3's first transient answer [ruling 10 R4]), count mismatch, R1 not "200"; phase B 3 failures; a dead COMMIT run 3 times; a phase-A failure once op 1 has an engine row [ruling 10 R2]. The IA stays Processing |
| COMMITTING_IA | COMPLETED | COMMIT finish | after I4 |
| any open | REQUIRES_REVIEW | whoever would unlock | prevStatus not Draft (`IA_PREV_STATUS_UNKNOWN`) |

progress_percent: QUEUED 0, VALIDATING >= 10, READY_TO_COMMIT 60, phase A 70, after op 1 (SPLIT / PARK) **75** "Components
issued; receiving the assembled item", I3 DONE **80** "Assembled item received; finishing", phase-B entry 75 before I3 is DONE
and 85 after it, COMPLETED 100, FAILED / REQUIRES_REVIEW 0. COMMITTING_IA at >= 80 means both operations moved stock (the
client's "stock moved" verdict) [plan: "stock moved / 80 only after op 2"].

---------------------------------------------------------------------------------------------------------------------------
## 4. gd_publish_step rows (b)

Unique `Job Step` (tenant_id, job_id, step_name): a second insert of the same name fails its run - the twin guard everywhere
below. `job_id` / `step_name` varchar(32) [controller 5], `step_status` varchar(16), `result_ref` longtext. Writes:
`lib/v2build.step_add` (STEP_PROPS) or `PART_COLS`.

| Rows | job_id | step_name | step_status | result_ref | Written by | Read by |
|---|---|---|---|---|---|---|
| document lock | `IAC|<iaId>` | `LOCK|<n>` (n = last + 1; an Add `LOCK|1` after its insert) | `LOCK` | the job's idempotency key | SUBMIT | WORKER (lock join), PREPARE, COMMIT entry, SUBMIT read-back / BUSY rule |
| claim gate | `<jobId>` | `W0_CLAIM_<row_version>` | `DONE` | `WRK|<nonce>` | WORKER pick | WORKER poll / tick |
| PREPARE parts | `<jobId>` | `P|<nonce>|<PART>|<nnn>` | `PAYLOAD` | <= 400,000 characters | PREPARE | COMMIT |
| step done | `<jobId>` | `I0_REVALIDATE` ... `I4_FINISH` | `DONE` | a note <= 2,000 chars (I1: `{"batch_id","batch_number"}`; I2: op 1's summary) | COMMIT (`doneRow`) | COMMIT entry, I3 (I1 / I2 rows) |
| I1 intent | `<jobId>` | `I1|I|001` | `INTENT` | the planned Batch row's identity `{batch_number, material_id, plant_id, organization_id, transaction_no}` | COMMIT I1, BEFORE its insert | COMMIT I1, `failNoWrite` (the soft-delete set) |
| engine op 1 | `IAC|<jobId>|I` | `IBA|I|<nnn>`, `IBA|DONE`, `IBA|REVIEW` | engine's | engine's (`IBA|DONE` = `{results, summary}`) | INVENTORY_BULK_APPLY | I2 (intents), I3 (DONE summary, REVIEW), runbook |
| engine op 2 | `IAC|<jobId>|R` | same | engine's | engine's | INVENTORY_BULK_APPLY | I3 (intents), runbook |

Chunking: `iaPartRows` / `iaJoinChunks` (code/shared; LOT §4): the value's JSON text cut every 400,000 characters into
`<prefix><nnn>` (at least one row, even for `{}`), joined back in step-name order.

**Lock ownership (status-based, grv2):** a job owns its IA when ALL hold: `sm_item_assembly.item_assembly_status =
'Processing'`, `ia_v2_job_id = <jobId>` (varchar, compared as text), and the latest (MAX id) `LOCK|%` row of `IAC|<iaId>` has
`result_ref` = the job's idempotency key (`sql.py OWNER`). **Release** = the status write: the unlock (`Draft`, only before op 1
moved stock) or I4's `Completed`. LOCK rows are never deleted; `ia_v2_job_id` is kept after the job (audit). After op 1 the IA
stays Processing until I4. The guarded classic (§11) and the list refuse a Processing IA.

---------------------------------------------------------------------------------------------------------------------------
## 5. The manifest and its parts (c)

`prepared_payload` (PREPARE with READY_TO_COMMIT; read whole by COMMIT's entry - small):

```json
{ "v": 1, "prepared_by": "IA_V2_PREPARE", "job_id": "2112100000000000001", "ia_id": "2112073133161844738", "ia_no": "IA-2610-0042",
  "action": "DIRECT", "prevStatus": "Draft", "saveAs": "Completed", "organization_id": "1123598813738675201",
  "plant_id": "1123598813738675202", "nonce": "c9d8e7f6", "lineFingerprint": "IF1:833:69698384367f7d26", "batchMode": "insert",
  "parts": { "ENGINE_I": ["P|c9d8e7f6|ENGINE_I|001"], "ENGINE_R": ["P|c9d8e7f6|ENGINE_R|001"], "BATCH": ["P|c9d8e7f6|BATCH|001"],
             "LABELS": ["P|c9d8e7f6|LABELS|001"], "ITEMS": ["P|c9d8e7f6|ITEMS|001"] },
  "counts": { "lines": 833, "picks": 830, "movementsI": 830, "nonStockLines": 3, "items": 834 } }
```

`batchMode` = `insert` (batch-managed parent, 'According To System Settings') or `none` (non-batch parent; no BATCH part).
COMMIT's entry accepts the manifest only when `job_id` = the job, `ia_id` is digits, `correlation_id = IA|<ia_id>`, every
PART above has a non-empty name list (BATCH exactly when `batchMode = insert`), `lineFingerprint` starts `IF1:`; else FAILED +
unlock (before I2 is DONE) / REQUIRES_REVIEW (after).

### ENGINE_I = the exact INVENTORY_BULK_APPLY request of op 1

```json
{ "operation_key": "IAC|2112100000000000001|I", "mode": "APPLY", "organization_id": "1123598813738675201",
  "movements": [
    { "movement_key": "M1", "direction": "SUBTRACT", "plant_id": "1123598813738675202", "organization_id": "1123598813738675201",
      "material_id": "2094626841323700252", "quantity": 5, "material_uom": "2018906563477008392", "transaction_type": "IA",
      "trx_no": "IA-2610-0042", "parent_trx_no": "", "inventory_category": "Unrestricted", "location_id": "2018912822846582786",
      "batch_id": null, "manufacturing_date": null, "expired_date": null, "doc_date": "2026-10-20 00:00:00", "isMovingInv": 0,
      "handling_unit_id": null } ] }
```

One SUBTRACT per stock pick, in the classic's loop order: lines by `line_index` (numeric), picks in `temp_qty_data` array
order; non-stock lines (item `stock_control = 0`) give no movement. Keys = the classic `wf_subtract` params
(`base/IA_SAVE.v11.json`) minus `itemData`, plus `movement_key`, `direction`, `parent_trx_no`, `isMovingInv`:
`plant_id` / `organization_id` = header `issuing_operation_faci` / `organization_id`; `material_id` = line `item_selection`;
`quantity` = `iaQ8(pick.sm_quantity)` (a NUMBER); `material_uom` = line `quantity_uom` (digits, or `""` = the item's base UOM);
`trx_no` = the STORED `stock_movement_no`; `parent_trx_no` `""` (every classic 'IA' movement row holds `''`, dev and prod);
`inventory_category` = `iaCategory(pick.category)`; `location_id` / `batch_id` = the pick's (digits; `batch_id` null when
none); `manufacturing_date` / `expired_date` = the pick's or null; `doc_date` = the stored `item_assembly_date`
(`'YYYY-MM-DD HH:MM:SS'`, the wall clock the classic wrote); `isMovingInv` 0 (SUBTRACT_INVENTORY's own default `?? 0`);
`handling_unit_id` null (HU is not eligible). No `unit_price`, no remarks (the classic sends neither). The engine guard
checks digits for material / plant / location, 1-5,000 movements, one organization.

### ENGINE_R = the receipt request template of op 2 (+ `receiptBaseQty`, `assemblyCost`)

```json
{ "operation_key": "IAC|2112100000000000001|R", "mode": "APPLY", "organization_id": "1123598813738675201", "receiptBaseQty": 1, "assemblyCost": 0,
  "movements": [
    { "movement_key": "R1", "direction": "ADD", "plant_id": "1123598813738675202", "organization_id": "1123598813738675201",
      "material_id": "2094626841323700251", "quantity": 1, "material_uom": "2018906563477008392", "transaction_type": "IA",
      "trx_no": "IA-2610-0042", "parent_trx_no": "", "inventory_category": "Unrestricted", "location_id": "2018912822846582786",
      "batch_id": null, "unit_price": 0, "doc_date": "2026-10-20 00:00:00", "manufacturing_date": null, "expired_date": null,
      "remark": "", "remark2": "", "remark3": "", "isMovingInv": 0, "handling_unit_id": null } ] }
```

= the classic `wf_add` params (`code_receipt_prep`) minus `itemData` and `batch_number`, plus `movement_key`, `direction`,
`parent_trx_no`, `batch_id`, `handling_unit_id`: `material_id` = header `item_id`, `quantity` = `iaQ8(item_qty)` in
`item_uom`, `inventory_category` = header `inventory_category || "Unrestricted"`, `location_id` = header `location_id`,
dates = the stored header's or null, `remark` / `remark2` / `remark3` = header `remarks` / `remarks_2` / `remarks_3` or `""`.
COMMIT fills exactly two values before the call: `unit_price` (I3, §5 Receipt price) and, for a batch parent, `batch_id` (I1's
batch row). Never a `batch_number` (the engine refuses `UNSUPPORTED_NEW_BATCH` without a `batch_id`). `receiptBaseQty` =
`iaUomOf(parent item, item_qty, item_uom).baseQty` (price.js = the engine's `uomOf`) and `assemblyCost` = `iaQ8(parent item
assembly_cost)`, both fixed at PREPARE; neither is sent: the engine call passes
only `operation_key`, `mode`, `organization_id`, `movements` (workflow-node body params), so op 2's request is byte-identical
on every retry [plan, review 7].

### BATCH = the planned Batch row (batch parents only, `mode: "insert"` [review 4])

```json
{ "mode": "insert",
  "row": { "batch_number": "1016-005-0003", "material_id": "2092496804015906844", "initial_quantity": "300.00000000",
           "transaction_no": "IA-2610-0042", "plant_id": "1996821057533001730", "organization_id": "1996787068457861121",
           "remark": "", "remark2": "", "remark3": "", "manufacturing_date": "2026-10-20 00:00:00", "expired_date": "2028-10-19 00:00:00" } }
```

The 11 columns of ADD_INVENTORY v65 `add_node_F9KqZLfd` (`base/ADD_INVENTORY.v65.json`), valued as the classic receipt passes
them: `batch_number` = header `batch_no` (generated by SUBMIT's GENERATE_BATCH call), `material_id` = `item_id`,
`initial_quantity` = `iaQtyStr(receiptBaseQty)` (decimal written as a fixed-scale string), `transaction_no` = the IA number,
plant / organization from the header, remarks as ENGINE_R, the header's dates. No `parent_transaction_no` (the classic node
writes none). A non-batch parent gets NO Batch row (deliberate difference: the classic mints a blank one; IA_REVERT copes).

### Non-stock lines (stock_control 0: DL / IDL / VO) [user decision 2026-10-19 ~15:45]

Allowed without picks (v12 `code_validate`: `total_quantity > 0`, no picks; the client rule §12; an IA needs at least one stock
line [ruling 10 R5]), but they add NOTHING: no
movement (excluded from ENGINE_I) and nothing in the price. No NONSTOCK part, no labour value anywhere.

### Receipt price - today's semantics [plan, user decision]

`unit_price = q8(sum of this completion's 'IA' OUT total_price / receipt base qty + assembly_cost)` =
`receiptUnitPrice({ outTotals: [OUT_TOTALS.total], receiptBaseQty: ENGINE_R.receiptBaseQty, assemblyCost:
ENGINE_R.assemblyCost })`, 0 when the base qty is <= 0. The classic's `code_receipt_prep` is unchanged.
- V2 sums op 1's STORED rows in SQL (`sql.py OUT_TOTALS`: tenant, is_deleted 0, movement OUT, transaction_type 'IA', trx_no =
  the stored IA number, `id > <jobId>` - no index on `operation_effect_key`, the id bound keeps it cheap - and
  `operation_effect_key LIKE 'IAC|<jobId>|I|%'`) [review 7], never the APPLY answer (its totals are unrounded, also on a
  REPLAYED repeat [controller 4]).
- The engine prices ADD per BASE unit, so V2 divides by the receipt's base qty; the classic divides by `item_qty` in `item_uom`:
  identical when `item_uom` is the base UOM (every prod IA); V2 is right where they differ (deliberate).
- A Fixed Cost parent is received at `purchase_unit_price` on both paths (the engine / ADD_INVENTORY ignore the sent price).
- Verified: `receiptUnitPrice` reproduces all 56 classic receipts on prod (`test/shared/sql_live.py`).
- Deliberate V2 differences (README): no blank Batch row for a non-batch parent; the sum covers only this completion's rows (the
  classic's trx_no-only read also sums an earlier cycle of a Manual-numbered IA re-completed after a revert).

### LABELS = movement_key -> where it came from (read only after a refusal)

```json
{ "M1": { "line_index": "4", "line_id": "2112...", "item_code": "RM-0042", "item_name": "Steel plate", "bin": "A1-B2-C3",
          "bin_id": "2018912822846582786", "category": "Unrestricted", "side": "out" },
  "R1": { "line_index": "", "line_id": "", "item_code": "FG-0001", "item_name": "Assembly", "bin": "FG-01", "bin_id": "2018912822846582786",
          "category": "Unrestricted", "side": "in" } }
```

`bin` = `bin_location.bin_location_combine` (the id when not found). `iaMapEngineMessage(message, LABELS, keys)` (movekey.js)
turns `"Insufficient quantity (movement M1)"` into `"Insufficient quantity - line 4 (RM-0042), bin A1-B2-C3 (Unrestricted)"`.

### ITEMS = the Item date stamp (I4)

`{ "itemDates": [ { "id": "<parent item id>" }, { "id": "<component item id>" } ] }` - unique ids, parent first, then every
component line's `item_selection` in line order (`code_item_txn`: non-stock lines included). I4 stamps `new
Date().toISOString()` (the classic's value form) at I4 time [brief].

---------------------------------------------------------------------------------------------------------------------------
## 6. lineFingerprint and the shared helpers (d)

`code/shared/` (WP0; unit tests `node test/shared/test_shared.js` - 113 checks; live `python3 test/shared/sql_live.py`). Include a
file into a code node with `lib/v2build.include_js(<iav2>, "code/shared/x.js")` (drops the `if (typeof module` line). Every
top-level name is `ia` / `IA_`-prefixed (or the brief's own `receiptUnitPrice`), so the files concatenate
with each other and with a template step's `s` / `q8` / `list` / `parseJ` / `sameVal` / `sameStored` (tested against
`tpl/grv2/commit/_common.js` + `tpl/smv2/code/commit/_cmp.js`). fingerprint.js, movekey.js and price.js are self-contained.

| File | Functions |
|---|---|
| `ia_common.js` | `iaS`, `iaQ8`, `iaQtyStr`, `iaDigits`, `iaIdStr`, `iaParseJ` (16+ digit integer tokens as strings, never a float's fraction digits), `iaList`, `iaJsonList`, `iaRows`, `iaIdsSql`, `iaCategory`, `iaPicks`, `iaPickCount`, `iaLineHasHu`, `iaDbAddSeconds`, `iaDbSeconds`, `IA_PREV_STATUSES` / `iaPrevStatusOk`, the sizes of §1, `IA_LOCK_WAIT_TRIES` 8, `IA_RECEIPT_WAIT_S` 1800, `IA_RECEIPT_RETRY_S` 10, `IA_OK_CATEGORIES`, `IA_OPEN_JOB`, `IA_RUNNING_JOB`, `IA_TERMINAL_JOB`, `IA_FINAL`, `IA_KEY_RE`, `iaLockJob`, `iaCorrelation`, `iaOpKey`, `IA_CHUNK` / `iaPartRows` / `iaJoinChunks`, `iaSameVal` / `iaSameStored` (= tpl/smv2 `_cmp.js` sameVal / sameStored, bound to iaQ8), `IA_TEXT` (§10 texts several packages write; the revert's `rv*` wording of RV10, ruling 9) |
| `fingerprint.js` | `iaLineFingerprint(lines, header)` -> `IF1:<line count>:<16 hex>`; `iaFpCanonRows`, `iaFpCanonHeader`, `iaFpHash`, `iaFpParse`, `iaFpRows`, `iaFpId`, `iaFpQ8`, `iaFpEntries` |
| `movekey.js` | `iaMovementKeyOf(message, keys)`, `iaMapEngineMessage(message, labels, keys)` |
| `price.js` | `iaUomOf(item, quantity, uom)` (= INVENTORY_BULK_APPLY core `uomOf`: q8 qty, the line UOM else the base UOM, one conversion row of that alt UOM, else 1:1, `q8(altQty x base_qty)`), `iaUomConversions(item)` (`table_uom_conversion` array or the engine's `uom_conversion_json` text), `iaItemOf`, `iaPrIdEq`, `receiptUnitPrice({ outTotals, receiptBaseQty, assemblyCost })` (no labour helpers: user decision ~15:45) |
| `sql.py` | `FP_LINES`, `FP_HEADER`, `OWNER`, `job_obj(alias)`, `LOCKOBJ`, `FACTS` / `FACTS_COLS` / `facts(sub, T, IA, KEY, ORG)`, `ITEMS`, `OUT_TOTALS`, `OP_STATE` / `op_state(sub, T, JOB, SIDE)`, `BATCH_ROWS`, `CLASSIC_GUARD` (§14 conventions; all ran read-only on dev) |

**iaLineFingerprint** - per line: `id`, `line_index`, `item_selection`, `quantity_uom`, `total_quantity` (8-dp text), and per
`temp_qty_data` entry (text or array): `balance_id`, `location_id`, `batch_id`, `category` (blank = `Unrestricted`),
`sm_quantity` (8-dp text); header: `item_id`, `item_qty` (8-dp text), `item_uom`, `location_id`, `inventory_category` (blank =
`Unrestricted`), `batch_no`, `issuing_operation_faci` [brief]. Lines sorted by id (numeric; id-less lines first by
`line_index`); entry order kept; entries with `sm_quantity <= 0` kept; an entry list that does not parse is fingerprinted as its
raw text; an id that went through a JS number past 2^53 is marked `?`, never silently equal. It is always computed over STORED
rows (`FP_LINES` + `FP_HEADER`: SUBMIT's read-back, PREPARE, COMMIT I0), so the decimal columns' tenant rounding cannot make it
differ (contrast LOT deviation 3). Verified: identical over `{ j }` rows, parsed rows and a re-ordered copy (dev IA-2609-010).

**Ids.** Compare ids as exact text (`iaPrIdEq`). The platform keeps 19-digit ids exact through `String()` (prod IA_SAVE run
2112073133161844738 `code_batch_decide` matched `String(it.id) === String(entry.item_id)` while nodes_data holds JSON
numbers); a pure-JS replay of recorded rows must parse them with `iaParseJ`: the prod UOM ids `...758` and `...785` are ONE JS
double (`test_shared.js`).

---------------------------------------------------------------------------------------------------------------------------
## 7. IA_V2_SUBMIT (e) - synchronous; operations SUBMIT and STATUS

### Request (`request_json`; strings except `form`)

| Param | Values |
|---|---|
| operation | `SUBMIT` (default) / `STATUS` |
| saveAs | `Completed` (`Draft` answers NOT_ELIGIBLE) |
| pageStatus | `Add` / `Edit` / `Clone` (`Copy` = `Clone`) - the form's `page_status` |
| ia_id | digits for Edit and STATUS; `''` (or `"0"`) for Add / Clone |
| idempotency_key | §3 (required for SUBMIT; optional for STATUS: when given and it has a job, STATUS answers that job) |
| source | `FORM` (default) / `MOBILE` |
| form | `any`: the record (`getValues()` minus NOT_RECORD, §12); `{}` for STATUS |

### Answer (`response_json`; every field a string)

`route, code, message, reason, action, job_id, job_status, terminal, ia_id, ia_no, line_count, progress_percent,
progress_message, error_code, error_message, evidence`

| route | code | When | Client (§12) |
|---|---|---|---|
| QUEUED | 200 | a job was queued and read back | follow: STATUS every 2.5 s <= 420 s (ruling 11), worker kick every 15 s (an Add answered without a digit `ia_id` waits for its link with the SAME key, SA `awaitLink`) |
| STATUS | 200 | operation STATUS, or this key already has a job | non-terminal = as QUEUED; COMPLETED = success (+ post for Complete & Post); FAILED = error, gen + 1; REQUIRES_REVIEW = warning |
| NOT_ELIGIBLE | 300 | Draft; another stored status; an eligibility reason with pickCount <= `IA_CLASSIC_MAX_PICKS`; no stock pick | the byte-identical classic handler via `triggerEvent` |
| BUSY | 409 | §2 | warning (job fields of the open job filled) |
| STALE | 409 | §2 | warning: reopen the IA |
| STOP | 400 | a gate, the WA screen, a limit, an eligibility reason above the classic cap (`IA_TOO_BIG`), the GENERATE_BATCH pre-check, not found | error message, nothing written |
| STOP | 500 | the queue writes did not read back (`IA_QUEUE_FAILED`) | error "please try again"; the next click re-uses the key |
| INVALID | 400 | the request itself | the classic handler (nothing was written) |

`terminal` = `YES` for COMPLETED, FAILED, REQUIRES_REVIEW, CANCELLED, NONE, else `NO`. `evidence` = `{ v, workflow, operation,
route, code, reason }` JSON (grv2 result.js). SUBMIT never answers 401 and never unlocks. **STATUS answer**: the job of
`idempotency_key` when given and found, else the IA's latest job of either command (`correlation_id = IA|<ia_id>`, max id;
its `command` / `action` say which), else the job its `ia_v2_job_id` names; route STATUS, code 200, action / job fields / ia_id / ia_no; no job: `job_status NONE`,
`terminal YES`, message `no background save`.

**A run SUBMIT cannot answer** [contract deviation 1]: a GENERATE_BATCH refusal fails SUBMIT's run at its workflow node (dev
evidence `base/refs.md`); the client then gets the platform's envelope `{ code: 400, success: false, data: null, msg:
"执行工作流节点[Generate Batch]报错[<text>]" }` - nothing was written (the call is the last check before the first write).

### Reads (one SQL each, the fork-joins as small as the order allows)

1. Guard (code): operation, saveAs, pageStatus, ia_id, key (`IA_KEY_RE`), source, session tenant / uid / uuid nonce, the
   form's `organization_id` (digits). The job's organization = the stored IA's (Edit) or the form's (Add / Clone).
2. `FACTS` (`sql.py facts(...)`): db_now, key_job, the stored IA (number, status, posted status, organization, plant, number
   rule, `ia_v2_job_id`), `ia_lock` (LOCKOBJ: step, ref, young, job), open / latest / linked jobs of EITHER command (job
   objects carry `command` and `action`; RV2), `issued_by_job`, `completed_under` (COMPLETE_IA only), `batch_cfg` (`{n, level, date_format}` of the organization's default `batch_number_config` rows:
   `item_id IS NULL AND item_category_id IS NULL`, GENERATE_BATCH's own read).
3. Keys (code, from the filled-back form): the item ids (parent + components) and the pick tuples (digits only).
4. ONE fork-join: `ITEMS` (`sql.py`), the costing screen, the WA screen, the duplicate-balance screen (B's SQL, below; bound
   tuple lists reach SQL as one JSON text of digit arrays unpacked by `JSON_TABLE`, the engine guard's method).

Execution order (§2): guard -> FACTS -> entry (key job, STATUS, BUSY, STALE, action) -> lifted `code_fillback` (pure; the keys
and screens read its allData) -> keys -> the fork-join -> eligibility -> the other gates (`code_required` + CHECK_REQUIRED_FIELD,
`code_validate`) -> limits -> the WA screen -> the GENERATE_BATCH pre-check and call -> writes.

### Gates, lifted and run in-process [plan]

`workflowparams = { allData: <form, Clone ids stripped>, saveAs: "Completed", pageStatus: <Add | Edit> }`, `search_items.data.data`
= the ITEMS rows (ids as text). Bodies (`lib/lift`): `code_fillback`, `code_required` + CHECK_REQUIRED_FIELD v8
(`base/CHECK_REQUIRED_FIELD.v8.json` `code_node_AeSdXE85`; failure -> STOP 400 `IA_REQUIRED_FIELDS` with its `data.message`, the
classic `return_required_400` text), `code_item_ids`, `code_validate` **as patched in v12** (§11 item 2; the lift source is B's
built `AsyncV2/IA_SAVE.json`, the others `base/IA_SAVE.v11.json`; failure -> STOP 400 `IA_ASSEMBLY_INVALID` with its message,
the classic's 401 text, never 401). `code_idem_guard` and the per-pick GLOBAL_INVENTORY_VALIDATION loop are replaced by STALE
(§2) and by PREPARE's PLAN + the WA screen.

### Checks done in SQL [plan, review 4 / 8] (so PREPARE does not fail on every retry)

Eligibility -> NOT_ELIGIBLE (pickCount <= `IA_CLASSIC_MAX_PICKS`) or STOP 400 `IA_TOO_BIG` (above), reason:
- `handling units`: a pick with `handling_unit_id`, a line with a non-empty `temp_hu_data` (`iaLineHasHu`), or a non-empty
  header `table_hu`;
- `serial numbers`: the parent or a component with `serial_number_management = 1`;
- `assembled item not stock controlled`: parent `stock_control = 0`;
- `manual batch number`: a batch-managed parent whose `batch_number_genaration` is not `According To System Settings`
  (Manual Input and a blank rule) [review 4];
- `<category> stock`: a stock pick whose `iaCategory` is not Unrestricted / Blocked;
- `costing migration`: the costing screen (copy of `scratchpad/pwv2/prepare/sql.py` SUBMIT_SQL["cost"], read-only source) keyed
  on every stock pick's (material, batch or 0) AND the parent's (item_id, 0) [review 8], at the header plant + organization,
  stock-controlled items: flagged when FIFO and WA rows both exist, or a FIFO item has WA rows and no FIFO row, or a WA item has
  FIFO rows and no WA row (= the engine's UNSUPPORTED_COSTING rule);
- `duplicate balance rows`: more than one `item_balance` row per (material, location, plant, organization) for a stock pick or
  the receipt bin (parent, header `location_id`), or more than one `item_batch_balance` row per (material, location, batch,
  plant, organization) for a batch pick (the engine's DUPLICATE_BALANCE);
- `no stock to issue`: no stock pick (the engine refuses an empty movement list);
- an item the IA names does not exist (`item <id> not found`).

Then the WA screen [review 8]: a stock pick of a Weighted Average item without a `wa_costing_method` row (material + plant +
organization, + batch for a batch pick; GLOBAL_INVENTORY_VALIDATION v11 `search_node_GIVWa*`) -> STOP 400 `IA_NO_WA_RECORD` with
its `code_node_hDa6pSw5` text. Limits: op 1 movements > 5,000 -> STOP 400 `IA_SPLIT_REQUIRED` [plan].

### GENERATE_BATCH (batch-managed parent, 'According To System Settings' only) [plan, review 9]

1. Pre-check from `FACTS.batch_cfg` - GENERATE_BATCH v20's own refusals, exact texts -> STOP 400 `IA_BATCH_FAILED`:
   `n` <> 1, or `level` not one of `Item Level` / `Item Category Level` / `Organization Level` / `Item Group Level` ->
   `No default batch found.`; `date_format` `Document Date` without `item_assembly_date` -> `Document Date is required.`;
   `Expired Date` without `expired_date` -> `Expired Date is required.`; `Manufacturing Date` without `manufacturing_date` ->
   `Manufacturing Date is required.`; `Document Created Date` passes; anything else -> `Invalid date format configuration.`.
2. The call (workflow-node 2060178784435535873) as the classic `wf_generate_batch` + `organization_id` = the IA's organization
   (the classic omits it): `item_id`, `document_date` = the fill-back's `item_assembly_date || null`, `manufacturing_date`,
   `expired_date` (`|| null`). An empty `batch_number` -> STOP 400 `IA_BATCH_FAILED` with the classic `code_normalize_batch`
   text `Could not generate a batch number. Check the Batch Number Configuration for this item.`. A residual refusal
   (`Duplicate Batch Format found.`: another writer took the number since the pre-check) ends the run as stated above.
3. The number goes into the document write's `batch_no`; a non-batch parent writes `batch_no ''` (the classic
   `code_batch_number`). The number GENERATE_BATCH issued stays used if a later write fails (as the classic).

### Write order [plan: LOT DIRECT orders; contract deviation 11]

- **Add / Clone:** job insert -> ONE add of `add_ia`'s props minus `posted_status` (24: the fill-back's allData with
  `item_assembly_status 'Processing'`, `batch_no` as above, `stock_movement_no` / `_type` as the fill-back left them) +
  `ia_v2_job_id`, `ia_idem_key` (= the key) -> read back by `ia_v2_job_id` (FP_HEADER + FP_LINES of that id) -> `LOCK|1` ->
  link (correlation / causation / request + iaId, iaNo, issuedNo, lineFingerprint) -> due.
- **Stored Draft:** `LOCK|n+1` (unique; n from `FACTS.ia_lock`) -> job insert -> ONE update of `update_ia`'s props minus
  `posted_status` (25 incl. `id`; minus `stock_movement_no` / `_type` under the number rule) with `item_assembly_status
  'Processing'`, `ia_v2_job_id`, `ia_idem_key` -> read back (OWNER + FP_HEADER + FP_LINES) -> due (+ iaNo, issuedNo,
  lineFingerprint). The whole-subform `stock_movement` update keeps the classic's semantics (rows missing from the call are
  soft-deleted, rows without an id inserted).
- The answer comes from the read-back (grv2 result.js): QUEUED only when the IA is Processing under this job (`ia_v2_job_id`),
  its latest lock is this key and the job is QUEUED and linked (`IA|<id>`); else STOP 500 `IA_QUEUE_FAILED`. A job whose SUBMIT
  stopped after its document write falls due by itself and PREPARE's entry releases the IA.

---------------------------------------------------------------------------------------------------------------------------
## 8. IA_V2_WORKER (f)

**Call:** `{ job_id: "<digits>" | "" }` - a job id drives that job only (the form's kick); empty drains up to 5 due
COMPLETE_IA jobs of the session tenant, oldest first, within a 20 s tick budget (grv2). **Answer** (strings): `worker_route`
(`REJECTED` / `IDLE` / `WORKED`), `processed`, `jobs` (JSON text `[{ job_id, before, job_status, error_code, ia_id,
attempt_count }]`), `job_id` / `job_status` / `result_code` / `result_message` / `ia_id` of the first planned job, `evidence`.

**Built by** `lib/v2build.build_worker(cfg)` [plan]:

```python
IA_LOCK_JOIN = """LEFT JOIN sm_item_assembly g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^IA\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
   AND g.is_deleted = 0
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('IAC|', SUBSTRING(j.correlation_id, 4))
                   AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
IA_ID_COL = "(CASE WHEN g.item_assembly_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
IA_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
cfg = V.worker_config(name="IA_V2_WORKER", code_dir="<iav2>/code/worker", ids_base=<C's choice>, command="COMPLETE_IA",
                      states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"], lock_join=IA_LOCK_JOIN,
                      id_col=IA_ID_COL, prev_col=IA_PREV_COL, corr_offset=4, id_alias="gr_id",
                      prepare=("IA_V2_PREPARE", ids["IA_V2_PREPARE"]), commit=("IA_V2_COMMIT", ids["IA_V2_COMMIT"]),
                      unlock=V.status_unlock("Item Assembly:Table:2098256587713404929", "item_assembly_status",
                                             {"item_assembly_status": "Item Assembly Status"}),
                      cache_prefix="ia_wrk_", renames=[("gr_id", "ia_id"), <C: node-id prefix, GR / SA texts>])
```

C's `code/worker/` = the GR worker JS `tpl/smv2/code/worker_src_grv2/*` (c-brief; LOT's route) or SA's already de-LOT'd copy
`tpl/sav2/code/worker/*`, ending in the same state: prevStatus set `IA_PREV_STATUSES` with NO `"Draft"` default anywhere
(workerItem in plan.js / pick.js, claim.js, after_prepare.js, after_publish.js - LOT deviation 4), the unlock column
`item_assembly_status`, prefix `IA_`, state `COMMITTING_IA`, the `IA|` regex / offset 4 / `IAC|` lock, IA texts. Hard codes (fail at once, no retry): `IA_INVALID_REQUEST, IA_INVALID_DATA, IA_NOT_FOUND,
IA_NOT_LOCKED, IA_NOT_ELIGIBLE, IA_LINES_CHANGED, IA_SPLIT_REQUIRED, IA_PLAN_BROKEN, IA_PLAN_SKIPPED, JOB_ILLEGAL_TRANSITION`.

**Tick rule** [plan; LOT deviations 2 and 9]: a tick runs PREPARE, then COMMIT A, then COMMIT B. COMMIT I2's hand-over row is
SPLIT (`lease_owner SPLIT|<nonce>`, `lease_expires_at` = lease_until, next_attempt_at null; split.js calls COMMIT again in the
same tick) when op 1 has <= 1,000 movements (`max(manifest counts.movementsI, ENGINE_I count)`), PARK above (lease cleared,
`next_attempt_at` = db_now: the next tick resumes phase B through RESUME). Both reset `attempt_count` to 0 and set progress 75.

---------------------------------------------------------------------------------------------------------------------------
## 9. IA_V2_PREPARE and IA_V2_COMMIT (g) - called by the worker only

| Workflow | Request | Answer (strings) |
|---|---|---|
| IA_V2_PREPARE | `job_id` (digits) of a VALIDATING COMPLETE_IA job the worker holds | `job_id, job_status, result_code, result_message, evidence` (the job row read back is the truth; grv2 prepare/result.js) |
| IA_V2_COMMIT | `job_id` of a READY_TO_COMMIT job, or COMMITTING_IA to resume | `RES_FIELDS` = `job_id, job_status, path, result_code, result_message, evidence`; path `REJECTED_INPUT` / `NO_WRITE` / `ENTRY_END` / `LOST` / `I<n>_END` / `SPLIT` / `PARK` / `DONE` |

### PREPARE [plan]

- **Entry** (as LOT §9): a VALIDATING COMPLETE_IA job under a live lease; `IA|<id>` -> the IA. No correlation (SUBMIT died
  before "link") -> the IA found by `ia_v2_job_id = <jobId>` and Processing -> FAILED + unlock `IA_INVALID_REQUEST` ("The
  completion stopped before the Item Assembly was linked to its job: please complete it again."), the link written WITH the
  FAILED row (correlation `IA|<id>`, causation `<id>`, request + `iaId`, `iaNo`, `issuedNo`; one job update after the unlock),
  so STATUS by the key answers the IA [ruling 10 R8]. An unreadable request ->
  FAILED; prevStatus not Draft -> REQUIRES_REVIEW (no unlock).
- **Reads** (ONE fork-join of uncapped tenant-scoped SQL): the job; `OWNER`; `FP_HEADER`; `FP_LINES`; `ITEMS` (parent +
  components); the bins of every pick location and the header bin (`bin_location`: id, `bin_location_combine`).
- **Checks:** the job owns the IA (else FAILED `IA_NOT_LOCKED`, no unlock); `iaLineFingerprint(FP_LINES, FP_HEADER)` =
  `request.lineFingerprint` (else FAILED + unlock `IA_LINES_CHANGED`); fresh item facts still eligible (parent stock
  controlled, its batch rule system-generated when batch-managed, `batch_no` non-empty then; else FAILED + unlock
  `IA_PLAN_FAILED` with the reason); at least one and at most 5,000 op-1 movements (`IA_PLAN_FAILED` / `IA_SPLIT_REQUIRED`).
- **Builds** ENGINE_I (stock-controlled lines only), ENGINE_R (+ receiptBaseQty, assemblyCost), BATCH (batch parents), LABELS,
  ITEMS exactly as §5; `batchMode`.
- **Engine PLAN** of ENGINE_I (`mode PLAN`, key `IAC|<jobId>|I`) and of ENGINE_R (`mode PLAN`, `IAC|<jobId>|R`, `unit_price 0`,
  `batch_id null`): PLAN takes no lock, ignores the key's DONE / REVIEW rows and writes nothing (engine `code_node_IBstate`), so
  the real keys are safe. The answer's `results` are read as an array or its JSON text (unreadable -> `IA_PLAN_FAILED`) [ruling 10
  R7]. 200 with every per-movement result `code "200"` -> go on; any other per-movement code (incl. `"401"`,
  stock control 0) -> FAILED + unlock `IA_PLAN_SKIPPED`, message `iaMapEngineMessage(result.message + " (movement <key>)", LABELS,
  keys) + ": nothing was moved."` [review 2]; 400 -> FAILED + unlock `IA_INVENTORY_<result_code>` with the LABELS-mapped
  message; anything else -> FAILED + unlock `IA_PLAN_FAILED`. (A crashed engine run fails the PREPARE run: the worker's dead
  lease rule retries it.)
- **Ready** -> READY_TO_COMMIT (progress 60) with the manifest; a failure -> FAILED + unlock (grv2 prepare/ready.js). A plan
  that throws -> `IA_PLAN_BROKEN`, unlocking only when the throw came after the lock check passed.

### COMMIT [plan; step framework of `tpl/sav2/code/commit` + `tpl/grv2/commit`]

Each step reads its part and fresh rows; at the after-value = done, at the before-value = write, otherwise REQUIRES_REVIEW;
writes; reads back; writes `<STEP> DONE`. `jobRow`'s default progress = the entry's progress of this pass (phase A 70, phase B
75 / 85, §3) - never the template's constant 70 [deviation 7].

| Step | Phase | Reads | Writes | Done when / failure |
|---|---|---|---|---|
| entry | - | job (+ db_now, lease_until, due, error_details), its `I*` step rows (name, status, result_ref, `finished_at`), the manifest, `OWNER`, `OP_STATE(I)` of `IAC|<jobId>|I` [ruling 10 R2] | lease `PUB|<nonce>`, COMMITTING_IA, progress 70 / 75 / 85 | phase = B when I2_ISSUE is DONE. Phase A: manifest invalid or IA not owned -> FAILED + unlock, but REQUIRES_REVIEW once op 1 has an engine row (`failNoWrite` below) [ruling 10 R2]. Phase B: the IA must read Processing or Completed (I4 may have written it before a run ended) under this job's `ia_v2_job_id` and lock key, else REQUIRES_REVIEW (SA entry.js) |
| I0_REVALIDATE | A | OWNER, FP_HEADER, FP_LINES | - | owner + Processing and `iaLineFingerprint` = manifest `lineFingerprint` -> DONE; else FAILED + unlock (`IA_NOT_LOCKED` / `IA_LINES_CHANGED`) |
| I1_BATCH | A | BATCH part, the `I1|I|001` intent, the I1 DONE row, `BATCH_ROWS` (organization, parent item) | intent row (before the insert), the Batch row (add-node, BATCH.row's 11 columns), I1 DONE `{"batch_id","batch_number"}` | batch parents only. **Ours** = the batch id in the I1 DONE row; without one, the live rows matching the intent's planned values (`batchKey(number)`, material, plant, organization, `transaction_no`) with `id > <jobId>` [review 3]. Ours exists -> adopt. Else **duplicate check** [controller 1]: a live Batch row of the parent with the same `batchKey(number)` (lower-case, trailing spaces cut: grv2 `batchKey`) that is not ours -> FAILED + unlock `IA_BATCH_DUPLICATE` "Duplicate Batch Format found."; else intent -> insert -> read back: exactly one ours -> **re-PLAN** ENGINE_R with `batch_id` = ours, `unit_price 0` [review 3] (catches the batch-balance DUPLICATE_BALANCE, engine core l.329-331, that PREPARE's batch-less PLAN skips): 200 + R1 `"200"` -> DONE; a refusal -> `failNoWrite` (+ ours soft-deleted) with PREPARE's mapping; two ours -> `failNoWrite` (both soft-deleted) "the batch row was inserted twice"; none -> stepEnd (then FAILED + unlock) |
| I2_ISSUE | A | ENGINE_I part; `OP_STATE(I)` intents; LABELS only after a 400 | INVENTORY_BULK_APPLY APPLY `IAC|<jobId>|I` | an empty ENGINE_I (SUBMIT and PREPARE refuse one; defensive, c-brief) -> DONE without a call (the template's `needCall`), and I3 then skips its op-1 checks (OUT total 0); 200 (incl. REPLAYED; `"401"` skips inside a 200 tolerated: classic parity [review 2]) -> DONE (ref = the answer's summary) + SPLIT / PARK (§8), progress 75; 400 WITH a result_code -> `failNoWrite` + this job's Batch row soft-deleted, code `IA_INVENTORY_<result_code>`, LABELS-mapped message; 409, no answer, or 400 WITHOUT a result_code (a dead child run) -> op-1 intents > 0 ? stepEnd (retry -> REVIEW) : attempts >= 8 ? `failNoWrite` `IA_INVENTORY_LOCK_BUSY` : lockWait (15 s x 2^n, cap 300 s, attempt + 1, `IA_LOCK_WAIT`); 500 or anything else -> REQUIRES_REVIEW |
| I3_RECEIPT | B | ENGINE_R part, `OUT_TOTALS`, `OP_STATE(I)` (done_summary, review; the entry's read [ruling 10 R2]), `OP_STATE(R)` intents, the I1 DONE row (batch_id), the job's `error_details.waitFrom` [ruling 10 R4] | APPLY `IAC|<jobId>|R`; job progress 80 | never unlocks [review 1]. Op 1 must be DONE with no `IBA|REVIEW` (never start op 2 while op 1 is under review) and `OUT_TOTALS.n` = op 1's code-200 results (`done_summary.movements`), else REQUIRES_REVIEW `IA_RECEIPT_COUNT_MISMATCH`. Price `receiptUnitPrice(...)` (§5), R1 `unit_price` = it, `batch_id` = I1's. 200 (incl. REPLAYED) with R1 result `code "200"` -> DONE; R1 any other code (incl. `"401"`) -> REQUIRES_REVIEW `IA_RECEIPT_REFUSED` (never Completed without a receipt); 409, no answer, 400 WITHOUT a result_code -> stepWait 10 s (attempt not counted, grv2 c2.js) until 1,800 s after I3's FIRST transient answer (`waitFrom`, kept in the job's `error_details` while I3 waits; the runbook's reset clears it) [ruling 10 R4], then REQUIRES_REVIEW `IA_RECEIPT_TIMEOUT` (checked only when I3 would wait); 400 WITH a result_code or 500 -> REQUIRES_REVIEW `IA_RECEIPT_REFUSED` |
| I4_FINISH | B | ITEMS part, OWNER | Item `last_transaction_date` (slices <= 250, by id, one `new Date().toISOString()` per pass), then the header `{ id, item_assembly_status: "Completed", posted_status: "Unposted" }` | header `Completed` -> DONE (nothing written again); Processing under this job -> write; anything else -> REQUIRES_REVIEW; read back Completed -> DONE, else stepEnd |
| finish | B | - | job COMPLETED, progress 100, `finished_at = endNow(entry)`, lease released | the header write was the unlock |

`failNoWrite` (phase A only) = job FAILED (`progress_message` "Not completed: <reason>") + the unlock (§2) when the job still
owns the IA + `{ id, is_deleted: 1 }` for ours (I1's set; ids filtered in code: update-node WHERE is not enforced). Once op 1 has an
`IBA|I|` or `IBA|DONE` row (the entry's `OP_STATE(I)`), every phase-A `failNoWrite` (entry, I0, I1, I2) writes REQUIRES_REVIEW
`IA_RECONCILIATION_MISMATCH` instead (`error_details.step` I2_ISSUE, `wouldFail` = the code it would have written): no unlock, no
Batch soft-delete [ruling 10 R2]. Phase B never
unlocks and never fails: stepEnd (2 s x 2^n, max 30 s, 3 retries) -> REQUIRES_REVIEW `IA_RECONCILIATION_MISMATCH`.

**REQUIRES_REVIEW runbook** [review 13; C writes it into `Item Assembly & BOM/AsyncV2/README.md`, c-brief]: the IA stays
Processing and the engine keeps its locks (they block GD / GR / SA / Putaway V2 on those items) until resolved.
1. Read the job (`error_code`, `error_details.step`) and BOTH operations' rows: `gd_publish_step` where `job_id IN
   ('IAC|<jobId>|I', 'IAC|<jobId>|R')` (`IBA|I|nnn`, `IBA|DONE`, `IBA|REVIEW`), the job's own `I*` rows and `I1|I|001`.
2. Op 1 under review (`IAC|<jobId>|I` has `IBA|REVIEW`): fix the cause, soft-delete that `IBA|REVIEW` row, reset the job
   (`COMMITTING_IA`, attempt_count 0, lease cleared, next_attempt_at now, error cleared), re-kick: COMMIT resumes at I2 (I2 not
   DONE) - op 2 never starts first.
3. Op 1 DONE, op 2 under review or I3 stopped: check op 1's OUT rows (`OUT_TOTALS`), fix, soft-delete op 2's `IBA|REVIEW` if
   any, reset the job the same way, re-kick: COMMIT resumes at I3 (same price, same request; the reset's cleared `error_details`
   opens a fresh 30-minute window) [ruling 10 R4].
4. Dev: the user runs the writes (`.dbtools/dbw`, one yes each). Prod is SELECT-only: the same rows are changed through the
   platform by the user / support; never by a session.

---------------------------------------------------------------------------------------------------------------------------
## 10. Error codes (h) - `job.error_code` / SUBMIT `error_code`; the message is what the user reads

| Code | Where | Route / job | Message |
|---|---|---|---|
| IA_INVALID_REQUEST | SUBMIT guard; PREPARE / COMMIT entry | INVALID 400; FAILED | SUBMIT: what is wrong ("saveAs must be Draft or Completed" ...); PREPARE: "The completion stopped before the Item Assembly was linked to its job: please complete it again." |
| IA_NOT_FOUND | SUBMIT; PREPARE | STOP 400; FAILED | "Item Assembly not found - it may have been deleted." |
| IA_BUSY | SUBMIT; classic v12 | BUSY 409; classic 400 | `IA_TEXT.busy` "This Item Assembly is being processed in the background - please wait for it to finish." [plan text] |
| IA_UNDER_REVIEW | SUBMIT | BUSY 409 | `IA_TEXT.underReview` "Its last completion stopped half-way and is under review: please contact support."; `IA_TEXT.rvUnderReview` when the job under review is a REVERT_IA [ruling 10, fix wave B] |
| IA_STALE | SUBMIT | STALE 409 | `IA_TEXT.stale(status)` "This Item Assembly was changed by someone else (it is now <status>). Please close it and open it again." |
| IA_ALREADY_FINAL | SUBMIT | STALE 409 | `IA_TEXT.alreadyFinal(status)` "This Item Assembly is already <Completed / Fully Posted>." |
| IA_CLASSIC_FINAL | classic v12 (Edit + saveAs Draft) | classic 409 | `IA_TEXT.classicFinal(status)` "This Item Assembly is already <status> and cannot be saved again." (= `code_idem_guard`'s text) |
| IA_NOT_ELIGIBLE | SUBMIT | NOT_ELIGIBLE 300 | the reason (goes to the classic save) |
| IA_TOO_BIG | SUBMIT | STOP 400 | `IA_TEXT.tooBig(n, reason, IA_CLASSIC_MAX_PICKS)` "This Item Assembly has <n> stock picks and cannot be completed in the background (<reason>); the classic save handles at most <cap> picks." |
| IA_CLASSIC_TOO_BIG | classic v12 | classic 400 | `IA_TEXT.classicTooBig(n, IA_CLASSIC_MAX_PICKS)` "This Item Assembly has <n> stock picks; this save can process at most <cap> at once. Split it into smaller assemblies, or complete it from the web form if background completion is switched on." (integration: review minor 7) |
| IA_SPLIT_REQUIRED | SUBMIT; PREPARE | STOP 400; FAILED | `IA_TEXT.splitRequired(n)` "This Item Assembly has <n> stock picks. At most 5,000 can be issued at once - please split the assembly." |
| IA_REQUIRED_FIELDS | SUBMIT | STOP 400 | CHECK_REQUIRED_FIELD's `data.message` (classic `return_required_400`) |
| IA_ASSEMBLY_INVALID | SUBMIT | STOP 400 | `code_validate`'s message (the classic answers it with 401) |
| IA_NO_WA_RECORD | SUBMIT | STOP 400 | GLOBAL_INVENTORY_VALIDATION v11: "No Weighted Average costing record for item <code> at this plant[ (batch <id>)]. The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock." |
| IA_BATCH_FAILED | SUBMIT | STOP 400 | GENERATE_BATCH v20's text (§7), or the classic `code_normalize_batch` text when it returns no number |
| IA_QUEUE_FAILED | SUBMIT | STOP 500 | `IA_TEXT.queueFailed` "The completion could not be queued: please try again." |
| IA_NOT_LOCKED | PREPARE; COMMIT | FAILED | `IA_TEXT.notLocked` "The Item Assembly is no longer locked by this completion: nothing was moved." |
| IA_LINES_CHANGED | PREPARE; COMMIT I0 | FAILED | `IA_TEXT.linesChanged` "The Item Assembly's lines changed while it was waiting: nothing was moved, please complete it again." |
| IA_PLAN_SKIPPED | PREPARE; COMMIT I1 | FAILED | the LABELS-mapped engine message + ": nothing was moved." (a per-movement result other than "200") [review 2] |
| IA_PLAN_FAILED / IA_PLAN_BROKEN | PREPARE | FAILED | "The completion could not be prepared: <reason>" (BROKEN = an internal invariant broke) |
| IA_INVENTORY_<engine code> | PREPARE PLAN 400; COMMIT I1 re-PLAN / I2 400 | FAILED | the LABELS-mapped engine message, e.g. "Insufficient quantity - line 4 (RM-0042), bin A1-B2-C3 (Unrestricted)" |
| IA_INVENTORY_LOCK_BUSY | COMMIT I2 | FAILED | `IA_TEXT.lockBusy` "The stock of its components stayed locked by another operation: nothing was moved, please try again later." |
| IA_BATCH_DUPLICATE | COMMIT I1 | FAILED | `IA_TEXT.batchDuplicate` "Duplicate Batch Format found." [controller 1] |
| IA_RECEIPT_COUNT_MISMATCH | COMMIT I3 | REQUIRES_REVIEW | `IA_TEXT.review` (details: stored rows vs op 1's code-200 results) |
| IA_RECEIPT_REFUSED | COMMIT I3 | REQUIRES_REVIEW | `IA_TEXT.review` (details: the engine answer / R1's code) |
| IA_RECEIPT_TIMEOUT | COMMIT I3 | REQUIRES_REVIEW | `IA_TEXT.review` (details: waited 1,800 s from I3's first transient answer) [review 1; ruling 10 R4] |
| IA_LOCK_WAIT, IA_STEP_RETRY, IA_WAIT, IA_TRANSIENT | COMMIT / WORKER | transient (job open) | progress_message only |
| IA_TRANSIENT_RETRIES_EXHAUSTED | WORKER | FAILED | "Temporary failures persisted; not completed." |
| IA_RECONCILIATION_MISMATCH | COMMIT / WORKER | REQUIRES_REVIEW | `IA_TEXT.review` "Under review: the completion stopped half-way. Please contact support." (also a phase-A failure once op 1 has engine rows [ruling 10 R2]) |
| IA_PREV_STATUS_UNKNOWN | any unlock | REQUIRES_REVIEW | `IA_TEXT.prevUnknown` "Under review: the status to restore is unknown. Please contact support." |
| IA_INVALID_DATA | guards / entries | answer only / FAILED | internal (job not found, bad id, ...) |
| JOB_ILLEGAL_TRANSITION, JOB_ROW_VERSION_CONFLICT | shared (grv2) | answer only | internal |

---------------------------------------------------------------------------------------------------------------------------
## 11. The classic IA_SAVE v12 (B) - ships in the cut whatever the switches [plan]

`Item Assembly & BOM/AsyncV2/IA_SAVE.json` = `base/IA_SAVE.v11.json` (deployed v11 = prod v11; B asserts canonical equality with
the live version before patching) + exactly two changes (user decision ~15:45: `code_receipt_prep` is NOT touched); every other
node byte-identical (B proves it node by node, as
`scratchpad/smv2/classic/diff_v82.py`, read-only). Answers keep the classic's return-node shape `{ code, message }` (status
200), never 401.

1. **New first nodes, between `start` and `code_fillback`** (ids B's; e.g. `code_ia_guard_in` -> `if_ia_guard_read` [true:
   `sql_ia_guard`] -> `code_ia_guard` -> `if_ia_guard` [true: `return_ia_guard`]):
   - the stored-status checks run ONLY when `pageStatus === 'Edit'` and `allData.id` is digits [review 5]: ONE SQL,
     `sql.py CLASSIC_GUARD` (the stored `item_assembly_status`, `sm_item_assembly` only; no stored pick count: a JSON_TABLE
     over a malformed stored `temp_qty_data` would block every save - SA ruling 2026-10-16); stored `Processing` -> 400
     `IA_TEXT.busy` (any saveAs); stored `Completed` / `Fully Posted` with saveAs `Draft` -> 409 `IA_TEXT.classicFinal(status)`
     (the stale-tab double move);
   - saveAs `Completed` (Add, Clone or Edit) with `iaPickCount(allData.stock_movement) > CLASSIC_MAX_PICKS` -> 400
     `IA_TEXT.classicTooBig(n, CLASSIC_MAX_PICKS)`; `CLASSIC_MAX_PICKS` = `IA_CLASSIC_MAX_PICKS` = 250 (one constant; the user's
     decision 2026-10-19 [review 5]; the classic IA_REVERT v5 uses it too, RV9).
   - It reads neither `gd_async_job` nor any V2 table (prod has none until the full deployment).
2. **`code_validate`**: a line whose item has `stock_control === 0` (from `search_items`) needs no picks, only
   `q8(total_quantity) > 0` (else `'Line <i> (<label>): quantity must be greater than zero.'`); stock lines unchanged. The IA
   needs at least one stock line: one of non-stock lines only -> v11's own `'There are no components to consume. Add at least one
   component line.'` [ruling 10 R5] (SUBMIT answers it NOT_ELIGIBLE `no stock to issue` before its gates).

Not changed: the classic's own GENERATE_BATCH call without `organization_id` (`{{global:firstLvDeptId}}` resolves on real user
runs: prod IA_SAVE run 2112073133161844738 generated batch `1016-005-0003` through it); `code_receipt_prep` (today's receipt
cost; non-stock lines add nothing); its blank Batch row for non-batch parents; `code_idem_guard`.

---------------------------------------------------------------------------------------------------------------------------
## 12. Client (D) [plan], form base `base/ia_form_v34.json` [re-seeded from v32 after the dev drift], list base `base/ia_list_v20.json`

- **Handlers:** one source `client/src/iaV2_onClick_completed.js` (template `tpl/sav2/client/src/saV2_onClick_completed.js`)
  built into two events: `iaV2_onClick_completed` (POST false, classic `onClick_saveAsCompleted`, key `iasvcomp`) bound to
  `button_completed` (widget key `dxpzlyqp`) and `iaV2_onClick_completed_post` (POST true, classic
  `onClick_saveAsCompletedPost`, key `aymq6q8z`) bound to `comp_post_button` (`lnfr8gna`). New event keys: 8 of `[a-z0-9]`,
  unique in the form. The classic handlers stay byte-identical (rollback = rebind).
- **Route:** V2 when `ASYNC_IA_ENABLED`, the action is ON (`COMPLETE` for the Completed button; `COMPLETE_POST` or, when it is
  OFF, `COMPLETE` for the post button), `ASYNC_IA_REVERT_ENABLED` is ON too [ruling 10 R9], the workflow ids are set (the
  revert pair's as well [ruling 10 R9]), the page is Add / Clone / Edit with stored Draft, pickCount >
  `IA_V2_MIN_PICKS` (every pick with `sm_quantity > 0`; no item read at click time [review 11]) and no HU (`iaLineHasHu`);
  serial items are screened by SUBMIT. Anything else, an exception before SUBMIT, a NOT_ELIGIBLE or an INVALID answer ->
  `this.triggerEvent(<classic>)`. The V2 path first runs the classic's `this.validate()` and its `confirmBomVariance` (copied
  verbatim; Cancel ends the click); a NOT_ELIGIBLE fallback therefore shows that confirm a second time (accepted: the classic
  stays unchanged).
- **NOT_RECORD** (verified against real payloads: dev run 2110917562163441665, prod run 2111001816408920065): `ia_v2_job_id`,
  `ia_idem_key`, `_data`, `$_v`, `_vts`, `isTrusted`, `sm_item_balance`, `button_draft`, `button_completed`,
  `comp_post_button`, `button_post`, `draft_status`, `issued_status`, `completed_status`, `fullyposted_status`,
  `processing_status`, `flex_2det1nd2`, `flex_t6y2yh5r`, `item_assembly_tittle`, every `dialog_*` key. `sia_uuid` and
  `page_status` are columns: they stay in the record.
- **Answers** (SA template): QUEUED / running STATUS -> follow (STATUS every 2.5 s <= 420 s (ruling 11), worker kick every 15 s; an Add
  without a digit `ia_id` -> `awaitLink` with the same key); STOP 500 or no answer -> keep the key, message. A SUBMIT answer
  without a `route` (the platform envelope, §7) -> show its `msg` (the inner text of `执行工作流节点[<node>]报错[<text>]` when
  wrapped), keep the key [deviation 1]. FAILED -> error, `gen + 1`; a new IA that failed is a saved Draft: close the form.
- **Verdict:** Completed button -> terminal, or COMMITTING_IA at >= 80 ("the stock moved; finishing in the background") then
  the kick loop (<= 10 worker calls). Complete & Post -> post ONLY on a COMPLETED verdict by running the classic
  `postToAccounting(iaId, organizationId)` body unchanged (organizationId as the classic computes it); when the wait ends first:
  `IA_TEXT.postLater` "Still completing in the background; post it from the list once it shows Completed." Never copy SA V2's
  Complete & Post (it drops the post). With `COMPLETE_POST` OFF a big IA's post button still completes via V2 and says "post it
  from the list once it shows Completed".
- **Posting limit** [review 12]: the posting fetch refuses more than 1,000 distinct item ids: an IA above ~1,000 components
  cannot be posted (830 is fine).
- **mounted:** the Processing view (read-only, `processing_status` badge, the status map gains `Processing`, hide
  `button_draft` / `button_completed` / `comp_post_button` / `button_post` [review 11], lock the components table, STATUS +
  re-kick every 15 s - the completion worker for a COMPLETE_IA job, the revert worker for a REVERT_IA job (STATUS's `command` /
  `action`; "being reverted in the background"); a FAILED job shown once per browser, `localStorage
  ia_v2_failed_seen_<jobId>`). Inert while OFF.
- **Form fields:** hidden inputs `ia_v2_job_id`, `ia_idem_key` (varchar 255, dataBind); `processing_status` html badge; the
  `Processing` leaf (`dict_key equal 'Processing'`, a new unique 13-digit filter id) in the `any` branch of
  `item_assembly_status`'s datasource (select key `4cjp73ay`, dict parent 1914242988707749889).
- **Non-stock lines (DL / IDL / VO)** [plan, review 11; no cost: user decision ~15:45]: the BOM explode (`onChange_assembledItem`), the line item picker
  (`onAfterUpdate_item`, `onConfirm_batchAddItem`) and auto-allocate read `stock_control` (in the `.field()` list), every such
  read with an explicit `.limit()`, 500-id chunks and a re-read when clamped (`Goods Delivery/GDonMounted.js` ~l.416); non-stock
  lines get `total_quantity` = the requested qty, no picks, no allocation; `onChange_componentQty`
  (`ItemAssemblyAllocateLine.js` ~l.349) keeps a typed qty as `total_quantity` for stock_control-0 lines; their Transfer Stock
  link is disabled. Same rule in the classic path.
- **List** (base v20): a first `mounted` script (throttled worker kick, 2 min, chained while `processed > 0`, gated by
  `ASYNC_IA_ENABLED`); the Edit row action's `hidden` gains `|| arguments[0].row.item_assembly_status === 'Processing'` (list
  rows carry the grid's columns + id; the status is a grid column, a plain string); `delete` (`oh26x9gl`) refuses Processing as
  it refuses Completed / Fully Posted and re-reads the stored status before deleting [review 11]; the Status column's badge
  content gains a `Processing` div.
- **Post** (whatever the switches): the form's `onClick_post` (`e9ib2r8i`) and the list's bulk Post (`z4qy8mae`) re-read the
  STORED `item_assembly_status` / `posted_status` (with the accounting read) before writing Pending Post, and refuse unless
  Completed and Unposted / Failed Post / blank; a postable IA posts exactly as the base [ruling 10 R3].
- **Publish order** [plan, controller 3]: form + list (switches OFF) and IA_SAVE v12 first, then IA_V2_PREPARE -> IA_V2_COMMIT
  -> IA_V2_WORKER -> IA_V2_SUBMIT, then the switches ON in a client publish. D's builder builds OFF unless `--on`, and refuses
  an ON build with COMPLETE / COMPLETE_POST but without REVERT [ruling 10 R9]. A select
  stores a value it cannot label as a blank cell: the form must land before any V2 save writes `Processing`.
- **Mobile** (controller, not D): until the mobile V2 release mobile uses the guarded classic; tell sudu-mobile-expo-15 that
  its client-side delete must refuse Processing and non-stock lines need `total_quantity` without picks.

---------------------------------------------------------------------------------------------------------------------------
## 13. File ownership and the build (k)

| Owner | Files (`scratchpad/iav2/` unless a repo path is given) |
|---|---|
| WP0 / controller | `CONTRACT.md`, `ids.json`, `build_ia.py`, `lib/` (verbatim + README line), `base/` (snapshots + `refs.md`), `code/shared/`, `test/lib_smoke.py`, `test/shared/`, `deploy/`; integration: `Item Assembly & BOM/AsyncV2/ids.json`, merging F's README section |
| A - PREPARE | `build_prepare.py`, `code/prepare/**`, `prepare/**` (its SQL), `lift/**` (PREPARE's lifted classic bodies), `test/prepare/**`; built `AsyncV2/IA_V2_PREPARE.json` |
| B - SUBMIT + classic v12 | `build_submit.py`, `code/submit/**`, `submit/**` (its SQL and its own lift config / lifted gates), `classic/**` (the v12 patch script + its tests; may expose `build_classic.py`), `test/submit/**`; built `AsyncV2/IA_V2_SUBMIT.json`, `AsyncV2/IA_SAVE.json` |
| C - COMMIT + WORKER | `build_commit.py`, `build_worker.py`, `code/commit/**`, `code/worker/**`, `commit/**` (its SQL), `test/commit/**`; built `AsyncV2/IA_V2_COMMIT.json`, `IA_V2_WORKER.json`; `Item Assembly & BOM/AsyncV2/README.md` (c-brief: the completion README with the §9 runbook) |
| D - client | `client/**` (+ its tests), `Item Assembly & BOM/AsyncV2/*.js` (handler sources), `AsyncV2/IAform.json`, `AsyncV2/IAlistPage.json` |
| E - checks | `live/**` |
| F - Revert V2 + classic IA_REVERT v5 | `build_revert.py`, `code/revert/**`, `revert/**` (incl. `revert/README_REVERT.md`: its README section, merged into `AsyncV2/README.md` by the controller - one writer per file), `test/revert/**`; built `Item Assembly & BOM/AsyncV2/IA_REVERT_V2_*.json` and `AsyncV2/IA_REVERT.json` (v5) |

D also owns the list's Revert action routing (RV8; template `tpl/grrv_client/grv_list_RevertCompletedGR.js`).

Never touched in this cut: `Item Assembly & BOM/ItemAssemblySaveWorkflow.json`, `ItemAssemblyFullJSON.json`, `ItemAssembly*.js`,
`ItemAssemblyListPageJSON.json`, `RevertCompletedIA/*` (the repo mirrors already differ from live v34 [re-pinned]; a `.dbtools/form sync`
after the publish is the user's call); `scratchpad/gdc, smv2, sav2, grv2, pwv2, grrv, gde, iarv`; `tpl/`.

**Build:** `python3 scratchpad/iav2/build_ia.py [--write] [NAME ...]` imports `build_prepare` (A), `build_commit`,
`build_worker` (C), `build_submit`, `build_classic` (B), `build_revert` (F) in that order (the publish order); each exposes
`BUILDERS = [("<NAME>", fn)]` with NAME = IA_V2_PREPARE / IA_V2_COMMIT / IA_V2_WORKER / IA_V2_SUBMIT / IA_SAVE, F:
IA_REVERT_V2_PREPARE / _COMMIT / _WORKER / _SUBMIT / IA_REVERT; `fn()` returns the FlowGram
dict (raise NotImplementedError to be skipped; a missing module is skipped). Output `Item Assembly & BOM/AsyncV2/<NAME>.json`
(indent 1). IA_SAVE v12 and IA_REVERT v5 may instead come from B's / F's patch scripts (`classic/**`, `revert/**`); then
`build_ia.py` skips those names. Before a publish: `python3 scratchpad/validate.py <file>`, `lib/sqlcheck.py` on dev (until the form publish creates
the column, `missing_cols` `{"h.ia_v2_job_id": "NULL", "g.ia_v2_job_id": "NULL"}` + any other alias a package uses - never the
bare name, which would also rewrite `AS ia_v2_job_id`), the switch-OFF regression; published with `.dbtools/wf_upload.mjs` and our
own plan file `deploy/wf_upload.ia.<batch>.plan.json` (`wf --dev backup` first, one user yes per batch).

**Test data (from -41, 2026-10-19):** tenant 711077 is -41's GD test tenant: never pick item "blade, loose"
2105492637718319110 at bin 2106278340907413505 (plant 2105200506810306561), never deliver / edit / cancel SO/20261016-034 or
-035; -41 messages before / after its live GD tests.

**E's verification method** [review 14]: twins = replay the classic run's recorded child calls through the engine core
(`scratchpad/sav2/parity/replay_sa.js` method, read-only) + one live V2 run reconciled by formula (shared FIFO stock makes live
twin deltas differ); no revert measurement above the classic cap.

---------------------------------------------------------------------------------------------------------------------------
## 14. SQL conventions and the node-data budget (l) - LOT §14 verbatim, plus

1. Every table read is tenant-scoped (`'<guard>.data.tenantId'`, digits checked) with `is_deleted = 0` on every document /
   line / ledger / step / batch row (a job row read by id has `is_deleted` checked in code, grv2). Ledger reads also scope
   `organization_id`.
2. Ids out of SQL: `CAST(x.id AS CHAR)` for every bigint id / FK; rows as `JSON_OBJECT(...) AS j` parsed with `iaRows` /
   `iaParseJ`. Never hand a bigint to JS as a number.
3. Ids into SQL: bare digit lists (`iaIdsSql`: `IN (0, 2105...)`) built in a code node from digit-checked values; tuples as ONE
   JSON text of digit arrays unpacked by `JSON_TABLE` (the engine guard's `balTuplesJson`); a varchar id column (`job_id`,
   `correlation_id`, `ia_v2_job_id`, `doc_id`) compared with a quoted digit string.
4. `COLLATE utf8mb4_general_ci` on every CAST / CONCAT / JSON-made string compared with a column.
5. A statement starts with SELECT or WITH and never holds the word SET (`CHARACTER SET` included; `scratchpad/validate.py`
   SQLSTART checks both).
6. Placeholders hand-quoted in SQL, never quoted in code nodes. No free text (names, remarks, document or batch numbers, JSON
   with text) is ever substituted into SQL: the IA number is read from the header row (`OUT_TOTALS`), a batch number is
   compared in JS (`BATCH_ROWS`).
7. Lines <= 160 characters: `lib/v2build.wrap_doc_sql` (applied by `build_ia.py`).
8. No row caps on business reads; `LIMIT 1` only for "the latest X" with `ORDER BY id DESC`. Not `lines` as an alias (MySQL
   reserved word).
9. Times from the DB clock (`NOW(3)` -> `db_now`, `DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s')`); the job / step timestamps are written
   from it, so their comparisons hold. Business `timestamp` columns hold the wall clock the app wrote, read verbatim by
   DATE_FORMAT (memory: db timezone skew). JS time only for the Item date stamp (`new Date().toISOString()`, the classic's).
10. Decimals written by us: computed values q8; decimal columns written as fixed-scale strings (`iaQtyStr`); read-backs compared
    with `iaSameStored` / `iaSameVal`; remainders clamped at 0.

**Node-data budget** (estimates; E measures the 830 and 2,000 runs): SUBMIT 10-15 MB at 830 picks (the lifted gates, one
document write, the read-back), PREPARE 15-25 MB (two PLANs: the engine's reads of every pick's balances / costing rows), COMMIT
A 12-20 MB (the re-PLAN of one movement, op 1's APPLY), COMMIT B < 10 MB (op 2 is one movement; OUT_TOTALS is one row; item
dates in slices). One tick at <= 1,000 picks (PREPARE + A + B) should stay near or under ~35 MB; above 1,000 the PARK splits it
(the dev crashes started near 60 MB). Rules: a part is read only by the step that needs it (LABELS only after a refusal), op 1's
results are never read back whole (summary via JSON_EXTRACT), OUT rows are summed in SQL, writes go in slices of <= 250 rows,
code nodes reference a big input once.

---------------------------------------------------------------------------------------------------------------------------
# Revert V2 (user decision 2026-10-19 15:25) - package F (+ D for the list routing)

Modelled on GR Revert V2: the copies `tpl/grrv/` (= scratchpad/grrv: GRRV_DESIGN.md, build_grrv.py, code/commit/r*.js incl.
r2_lock_*.js, lift/runtime.js) and `tpl/grrv_client/` (README = `Goods Receiving/RevertV2/README.md`, the list handler). Oracle: the classic IA_REVERT v4 (`base/IA_REVERT.v4.json`, dev = prod),
whose `code_node_iaRvParams`, `code_node_iaRvPrep` and `code_node_iaRvBuild` are lifted VERBATIM. Everything not said here
copies the completion part (§1-§14) or grrv and names it.

## RV1. Names and constants [user decision]

| Constant | Value | Notes |
|---|---|---|
| shells (the user creates them, Save Workflow / BOM + IA) | `IA_REVERT_V2_SUBMIT`, `IA_REVERT_V2_WORKER`, `IA_REVERT_V2_PREPARE`, `IA_REVERT_V2_COMMIT` | `ids.json` ("0" until created) |
| command | `REVERT_IA` | the revert worker polls only it |
| correlation / causation | `IA|<iaId>` / `<iaId>` - SHARED with COMPLETE_IA | one open job per IA, whatever it does |
| document lock | the SAME `IAC|<iaId>` / `LOCK|<n>` rows (one sequence) | a revert and a completion can never overlap |
| engine operation | `IAV|<jobId>` (ONE operation, 23 chars), movements `M1` ... `Mn` | `iaRvOpKey` |
| cost-row lock owner | `IAV|<jobId>|C` (25 chars) on `COST|<parent item>|<plant>` | `iaRvCostOwner`; GR Revert R2's `GRV|<job>|R2` pattern (`tpl/grrv/code/commit/r2_lock_*.js`) |
| PREPARE parts | `P|<nonce>|<PART>|<nnn>`, PART in ENGINE, COST, BATCH, HDR, LABELS | |
| COMMIT steps | `V0_REVALIDATE`, `V1_INVENTORY`, `V2_COST`, `V3_BATCH`, `V4_FINISH` | steps SQL `REGEXP '^V[0-9]_'` |
| states | QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_REVERT -> COMPLETED; FAILED; REQUIRES_REVIEW | `COMMITTING_REVERT` is in `IA_OPEN_JOB` |
| prevStatus | `Completed` only (`IA_RV_PREV_STATUSES`) | unlock = `{ id, item_assembly_status: "Completed" }`; anything else -> REQUIRES_REVIEW `IA_RV_PREV_STATUS_UNKNOWN` |
| idempotency key | `IAV:<org>:<iaId>:<clickToken>` | one clickToken per click of the bulk action (LOT list Cancel; `tpl/grrv_client/grv_list_RevertCompletedGR.js`) |
| worker cache | `iarv_wrk_<nonce>` | |
| error prefix | `IA_RV_` (RV10) | |
| list switch | `ASYNC_IA_REVERT_ENABLED` (OFF = the classic IA_REVERT for every IA); `IA_RV_MIN_ROWS = 50` sent as `min_picks` | |
| sizes | live rows <= 50 -> the classic; NOT_ELIGIBLE -> classic only up to `IA_CLASSIC_MAX_PICKS` (250) COMPONENT rows (`liveOut` = the picks; the receipt row not counted) [ruling 10 R1], above STOP `IA_RV_TOO_BIG`; <= 5,000 movements (one engine op); PARK after COMMIT A above 1,000 movements | |

**Live rows** = `code_node_iaRvPrep`'s `liveOut` + `liveIn`: the classic's own pairing of the IA's movement rows
(`RV_MOVES` = its `sql_node_iaRvMovs`), one reverse movement each. The count drives `min_picks` and the 5,000 limit; the 250
caps (SUBMIT's eligibility, the classic v5) count the component rows `liveOut` only [ruling 10 R1].

## RV2. Shared with the completion

- Both SUBMITs answer BUSY on stored Processing, an open COMPLETE_IA OR REVERT_IA job of `IA|<id>` (`FACTS.open_jobs`), or a
  young lock of another key (§2). One Processing state, one `ia_v2_job_id`, one lock sequence.
- `FACTS` (`sql.py`, shared by both SUBMITs): `last_job` / `link_job` = the latest / linked job of either command; job
  objects carry `command` and `action`. The number rule counts COMPLETE_IA jobs only.
- Ownership = §4 (Processing + `ia_v2_job_id` + the latest `IAC|<id>` LOCK = the job's key); both workers use §8's
  `IA_LOCK_JOIN` / `IA_ID_COL`.
- The classic IA_SAVE v12 refuses a Processing IA whatever job holds it; IA_REVERT refuses anything not Completed.
- After a V2 revert the IA is Draft with its number kept; a V2 completion of it issues a new number (§3 number rule: a
  COMPLETED job ran under that number).

## RV3. gd_async_job for REVERT_IA

Columns by writer: as §3 (command `REVERT_IA`, plant_id = header `issuing_operation_faci`, line_count = live rows).

```json
{ "v": 1, "action": "REVERT", "prevStatus": "Completed", "iaId": "2112073133161844738", "iaNo": "IAH-2610-3",
  "organizationId": "1996787068457861121", "plantId": "1996821057533001730", "liveRows": 832, "liveOut": 831, "liveIn": 1,
  "movesFingerprint": "IM1:832:601bed0fc6e2d2eb", "uid": "1123598821738675201", "source": "LIST", "nonce": "ab12cd34", "parts": {} }
```

State machine as §3 with COMMITTING_REVERT. progress: QUEUED 0, VALIDATING >= 10, READY_TO_COMMIT 60, phase A 70, after V1
(SPLIT / PARK) 80 "Stock taken back; restoring the costing rows", phase B 85, COMPLETED 100, FAILED / REQUIRES_REVIEW 0.

## RV4. IA_REVERT_V2_SUBMIT (synchronous; SUBMIT / STATUS)

**Request** (strings except `form`): `operation` (SUBMIT / STATUS), `ia_id` (digits), `idempotency_key` (RV1), `source`
(`LIST` default), `min_picks` (digits; the list sends `50`; absent / `0` = no effect), `form` = the list row `{ id,
item_assembly_status, stock_movement_no, organization_id }` (list rows carry the grid's columns + id; `organization_id` is a
hidden column). **Answer**: §7's fields. Routes: QUEUED 200, STATUS 200, NOT_ELIGIBLE 300 (reason `classic` or the
eligibility reason), BUSY 409, STALE 409, STOP 400 / 500, INVALID 400. Never 401, never unlocks.

Order: INVALID -> the key's job -> its STATUS -> `operation STATUS` -> the stored IA missing -> STOP 400 `IA_RV_NOT_FOUND` ->
BUSY -> STALE (the row's `item_assembly_status` differs from the stored one) -> reads (`FACTS`, `RV_MOVES`, the IA's Batch
rows as `search_node_iaRvBatch` reads them: `transaction_no` + organization) -> lifted `code_node_iaRvParams` +
`code_node_iaRvPrep` -> `refuse` -> STOP 400 `IA_RV_REFUSED` with its `refuseMessage` (the classic's texts: not found / posted
to accounting / "Only Completed Item Assembly can be reverted (this one is <status>).") -> live rows (or `headerOnly`) <=
`min_picks` -> NOT_ELIGIBLE reason `classic` -> eligibility: a live row with `handling_unit_id`, or a serial-numbered item
among the live rows' items (GR Revert V2's rule: the engine has no serial handling) -> NOT_ELIGIBLE (component rows `liveOut` <=
250 [ruling 10 R1]) / STOP
400 `IA_RV_TOO_BIG` -> live rows > 5,000 -> STOP 400 `IA_RV_SPLIT_REQUIRED` -> writes.

**Writes** [user decision]: `LOCK|n+1` (unique) -> job (QUEUED, due + 120 s) -> header `{ id, item_assembly_status:
"Processing", ia_v2_job_id }` -> read back (`OWNER`) -> due. QUEUED only when the IA reads Processing under this job and its
latest lock is this key; else STOP 500 `IA_RV_QUEUE_FAILED`.

## RV5. IA_REVERT_V2_WORKER

`lib/v2build.build_worker(cfg)` with command `REVERT_IA`, states `["QUEUED", "VALIDATING", "READY_TO_COMMIT",
"COMMITTING_REVERT"]`, `lock_join` / `id_col` / `prev_col` = §8's `IA_LOCK_JOIN` / `IA_ID_COL` / `IA_PREV_COL`, corr_offset 4,
prepare / commit = the revert pair, `unlock` = §8's `status_unlock(...)` (it writes `prevStatus`, here `Completed`),
`cache_prefix "iarv_wrk_"`, renames. JS: F copies `tpl/sav2/code/worker/*` (or C's route, `tpl/smv2/code/worker_src_grv2`) into
`code/revert/worker/` and makes it the revert's: `IA_RV_PREV_STATUSES` (no default), prefix `IA_RV_`, state
`COMMITTING_REVERT`. Hard codes: `IA_RV_INVALID_REQUEST, IA_RV_INVALID_DATA,
IA_RV_NOT_FOUND, IA_RV_NOT_LOCKED, IA_RV_NOT_ELIGIBLE, IA_RV_REFUSED, IA_RV_ROWS_CHANGED, IA_RV_CONFLICTS,
IA_RV_SPLIT_REQUIRED, IA_RV_PLAN_BROKEN, IA_RV_PLAN_SKIPPED, JOB_ILLEGAL_TRANSITION`. Tick rule as §8 (PARK above 1,000
movements).

## RV6. IA_REVERT_V2_PREPARE

- **Entry** as §9 (a VALIDATING REVERT_IA job under a live lease; `IA|<id>`; prevStatus must be `Completed`).
- **Reads** (uncapped, tenant-scoped, the classic's filters, fork-joins): round 1 - the job, `OWNER`, the header (the whole row
  as `get_node_iaRvIa` gives it: id + organization), `RV_MOVES`, the IA's Batch rows; round 2, needing prep's ids -
  `sql_node_iaRvFifo` / `sql_node_iaRvWa` / `sql_node_iaRvCostCounts` (their own SQL, tenant added), Item Balance (material IN
  `assembledIds`, plant, organization), Item Batch Balance (batch IN `batchIds`, plant, organization), Handling Unit (id IN
  `huIds`), Items (id IN `itemIds`: whole rows incl. `table_uom_conversion`, ids as text - §6 Ids), the bins of the live rows
  (labels).
- **Lifted VERBATIM** (`lib/lift`): `code_node_iaRvParams`, `code_node_iaRvPrep`, `code_node_iaRvBuild`, on an adapter that
  rebuilds their inputs (search-node `{ total, count, data }`, sql-node rows) with the header's `item_assembly_status` shown as
  the job's prevStatus `Completed`, NEVER `Processing` (prep would refuse it; LOT §9's adapter rule). The reads the classic caps (Item Balance, Item
  Batch Balance, Item at 1,000; Handling Unit at 100) are handed on in full as grrv's `__Uncapped` row views
  (`tpl/grrv/lift/runtime.js`: `ceiling()` stays inert while every `for...of` sees all rows; F copies that runtime into its
  folder - `lib/lift/runtime.js` has no `__Uncapped`); `search_node_iaRvBatch` stays a plain array (prep reads it with
  `.filter`; an IA has few Batch rows).
- prep `refuse` -> FAILED + unlock `IA_RV_REFUSED` (its text); the build's `hasConflicts` -> FAILED + unlock `IA_RV_CONFLICTS`,
  message = `IA_TEXT.rvConflicts` ("Revert blocked: the assembled item has been used or its stock has moved on.") + the first
  conflicts' messages, `error_details = { step, conflicts }` (grrv GRV_STALE); the eligibility of RV4 re-checked (FAILED
  `IA_RV_NOT_ELIGIBLE`).
- **Parts** (from the build's outputs, before anything is written):
  - **ENGINE** = `{ operation_key: "IAV|<jobId>", mode: "APPLY", organization_id, movements }`, one movement per build
    `subtracts[i]` then `adds[j]` in `index` order, `movement_key` `M<index + 1>`. SUBTRACT = `workflow_node_iaRvSubtract`'s
    params minus `index` / `itemData`: `{ direction: "SUBTRACT", plant_id: prep plantId, organization_id, material_id,
    quantity, material_uom, unit_price, transaction_type: "IA-R", trx_no: iaNo, inventory_category, location_id, batch_id,
    doc_date, isMovingInv: 1, parent_trx_no: "" }`. ADD = `workflow_node_iaRvAdd`'s params minus `index` / `itemData` /
    `batch_number` (the classic's `'-'` means "no new batch"; the engine needs none): `{ direction: "ADD", ..., batch_id
    (the original), handling_unit_id: null, isMovingInv: 0, unit_price, parent_trx_no: "" }`. `doc_date` = the build's
    `docDate` (`new Date().toISOString()`, the classic's own value); `parent_trx_no ""` = every classic `IA-R` row (dev).
  - **COST** = the parent's cost rows the classic writes per subtract (`update_node_iaRvFifoDel` / `_WaDel` / `_WaUpd`):
    `{ material_id: <parent>, plant_id, fifo: [{ id, before: { fifo_initial_quantity, fifo_available_quantity }, after: {
    is_deleted: 1 } }], waDelete: [{ id, before: { wa_quantity, wa_cost_price }, after: { is_deleted: 1 } }], waRestate: [{
    id, before: { wa_quantity, wa_cost_price }, after: { wa_quantity: <build waQuantity>, wa_cost_price: <build waCostPrice>
    } }] }` - `before` = the rows as PREPARE read them, `after` = the classic's values verbatim.
  - **BATCH** = `{ batchDeletes: [<id>] }` (the build's `batchDeletes`).
  - **HDR** = `{ id, before: { item_assembly_status: "Processing" }, after: { item_assembly_status: "Draft", posted_status:
    "" } }` (`update_node_iaRvIa`; the number is kept).
  - **LABELS** = `M<n>` -> `{ item_code, item_name, bin, bin_id, category, side: "out" | "in" }`.
- `movesFingerprint` = `iaMovesFingerprint(RV_MOVES rows)` (`IM1:`; V0 re-reads it).
- **Engine PLAN** of ENGINE (`mode PLAN`, key `IAV|<jobId>`): as §9 PREPARE (`results` as an array or its JSON text [ruling 10
  R7]) - any per-movement code other than "200" ->
  FAILED + unlock `IA_RV_PLAN_SKIPPED`; 400 -> `IA_RV_INVENTORY_<code>` (LABELS-mapped); else `IA_RV_PLAN_FAILED`.
- Ready -> READY_TO_COMMIT; a throw -> `IA_RV_PLAN_BROKEN` (unlock only after the lock check passed).

## RV7. IA_REVERT_V2_COMMIT

| Step | Phase | Writes | Done when / failure |
|---|---|---|---|
| entry | - | lease `PUB|`, COMMITTING_REVERT, progress 70 / 85 | as §9 entry (manifest: `job_id`, `ia_id`, `IA|<ia_id>`, every PART listed, `IM1:` fingerprint; it also counts `IAV|<jobId>`'s `IBA|I|` / `IBA|DONE` rows, `sql_node_IVCops` [ruling 10 R2]); phase B when V1 is DONE: the IA must read Processing or Draft under this job's key, else REQUIRES_REVIEW |
| V0_REVALIDATE | A | - | owner + Processing and `iaMovesFingerprint(RV_MOVES)` = the manifest's -> DONE; else FAILED + unlock (`IA_RV_NOT_LOCKED` / `IA_RV_ROWS_CHANGED`) |
| V1_INVENTORY | A | APPLY `IAV|<jobId>` | 200 (incl. REPLAYED; "401" inside a 200 tolerated as I2) -> DONE + SPLIT / PARK, progress 80; 400 WITH a result_code -> `failNoWrite` `IA_RV_INVENTORY_<code>` (LABELS-mapped; back to Completed); 409, no answer, 400 WITHOUT a result_code -> intents > 0 ? stepEnd : attempts >= 8 ? `failNoWrite` `IA_RV_INVENTORY_LOCK_BUSY` : lockWait (15 s x 2^n, cap 300 s); 500 -> REQUIRES_REVIEW |
| V2_COST | B | the COST rows (FIFO `{ id, is_deleted: 1 }`, WA batch `{ id, is_deleted: 1 }`, WA restate `{ id, wa_quantity, wa_cost_price }`), slices <= 250 | first `COST|<parent>|<plant>` held as `IAV|<jobId>|C` exactly as grrv `r2_lock_keys / seed / claim` -> INVENTORY_LOCK_TOKENS TAKE -> `verify`, given back (`release` + GIVE) on every exit and after DONE, then `released` (a lock still held -> stepEnd). Then each row read fresh: at `after` -> done; at `before` -> write; anything else -> REQUIRES_REVIEW `IA_RV_COST_CHANGED`; read back at `after` -> DONE. Lock BUSY / not taken -> stepWait 5 s (not counted) until 1,800 s after V2's FIRST busy wait (`waitFrom` in the job's `error_details` while V2 waits; a reset clears it) [ruling 10 R4] -> REQUIRES_REVIEW `IA_RV_COST_TIMEOUT` |
| V3_BATCH | B | `{ id, is_deleted: 1 }` for BATCH's ids (slices <= 250; absolute) | read back all deleted -> DONE, else stepEnd |
| V4_FINISH | B | the header `{ id, item_assembly_status: "Draft", posted_status: "" }` | at `after` (Draft) -> DONE; Processing under this job -> write; else REQUIRES_REVIEW |
| finish | B | job COMPLETED, progress 100, `finished_at = endNow(entry)` | the header write was the unlock |

Binding for V2_COST (f-brief): (1) **ordering** - never hold `COST|<mat>|<plant>` as `IAV|<jobId>|C` while the engine operation
`IAV|<jobId>` runs (the engine treats a lock as its own only when the owner equals its operation key exactly): V2_COST starts
only after V1_INVENTORY is DONE, as grrv R2 follows R1. (2) **the copy trap** - the owner string lives in three places in grrv
and all become `IAV|<jobId>|C`: `r2_lock_keys.js` opKey (TAKE), `r2_lock_release.js` op (clear + GIVE), and the release SQL
(`build_grrv.py` `S["lkrel"]`), which names it TWICE (owner_operation_id and last_owner_operation_id); a unit test asserts
all four are equal. (3) **INVENTORY_LOCK_TOKENS inputs** - operation_id `IAV|<jobId>|C`; ids = the lock rows' ids as digit
strings, no duplicates; `claimed_at` `YYYY-MM-DD HH:MM:SS` on TAKE and `""` on GIVE; the seeded key byte-identical to the
engine's: `"COST|" + material_id + "|" + plant_id` with plain digit ids.

`failNoWrite` (phase A only) = FAILED + `{ id, item_assembly_status: "Completed" }` when owned and prevStatus is Completed;
once `IAV|<jobId>` has an engine row, every phase-A `failNoWrite` (entry, V0, V1) writes REQUIRES_REVIEW
`IA_RV_RECONCILIATION_MISMATCH` (step V1_INVENTORY) instead, no unlock [ruling 10 R2].
Phase B never unlocks: stepEnd -> REQUIRES_REVIEW `IA_RV_RECONCILIATION_MISMATCH`. **Runbook**: as §9 with the one key
`IAV|<jobId>` (its `IBA|REVIEW`) and the lock owner `IAV|<jobId>|C` (`inventory_balance_lock` rows it still holds); a reset
job resumes at V1 (V1 not DONE) or at V2 (same COST part). The IA stays Processing until resolved.

## RV8. Client - D: the list's "Revert Completed" (`8r9xuzc4`, IArevertCompleted)

Template `tpl/grrv_client/grv_list_RevertCompletedGR.js` (= `Goods Receiving/RevertV2/`'s). The action keeps its own filters
(Completed only) and
confirm; then per selected IA, when `ASYNC_IA_REVERT_ENABLED` and the workflow ids are set: IA_REVERT_V2_SUBMIT `{ operation:
"SUBMIT", ia_id, idempotency_key: "IAV:<org>:<id>:<clickToken>", source: "LIST", min_picks: "50", form: <the row> }`.
NOT_ELIGIBLE, or no usable answer (a transport failure twice, no contract `route`) -> the existing classic IA_REVERT call
for that row, unchanged; QUEUED -> collect; STOP / BUSY / STALE -> that row's message. Then kick IA_REVERT_V2_WORKER and keep
it going while it finds work (<= 10 calls); after each tick STATUS for the queued IAs; FAILED -> a "Revert did not finish"
alert with `error_message` (the conflicts are in the job's `error_details`); refresh. The list's mounted kick (§12) also kicks
IA_REVERT_V2_WORKER, gated by `ASYNC_IA_REVERT_ENABLED`. Switch OFF -> every row takes the classic call.

## RV9. The classic IA_REVERT v5 (F) - ships in the cut whatever the switches

`Item Assembly & BOM/AsyncV2/IA_REVERT.json` = `base/IA_REVERT.v4.json` + ONE change: after `code_node_iaRvPrep`, before
`if_iaRvRefuse`, more than `IA_CLASSIC_MAX_PICKS` (250) component rows (`liveOut`, the picks; the message counts all stock
rows) [ruling 10 R1; was live rows `liveOut` + `liveIn`] -> the classic's answer shape `{ code:
"400", message: IA_TEXT.rvClassicTooBig(n, 250), conflicts: [] }`, nothing written. It still refuses anything not Completed
(prep), so a Processing IA. Every other node byte-identical (node-by-node diff, as §11). Not 401.

## RV10. Error codes (`IA_RV_*`)

| Code | Where | Route / job | Message |
|---|---|---|---|
| IA_RV_INVALID_REQUEST / IA_RV_INVALID_DATA | guard / entries | INVALID 400 / FAILED | what is wrong / internal |
| IA_RV_NOT_FOUND | SUBMIT; PREPARE | STOP 400; FAILED | "Item Assembly not found - it may have been deleted." |
| IA_RV_BUSY / IA_RV_UNDER_REVIEW | SUBMIT | BUSY 409 | `IA_TEXT.busy` / `IA_TEXT.rvUnderReview` when the job under review is a REVERT_IA, `IA_TEXT.underReview` when a COMPLETE_IA |
| IA_RV_STALE | SUBMIT | STALE 409 | `IA_TEXT.stale(status)` |
| IA_RV_REFUSED | SUBMIT; PREPARE | STOP 400; FAILED | `code_node_iaRvPrep`'s `refuseMessage` (the classic's 400 texts) |
| IA_RV_NOT_ELIGIBLE | SUBMIT; PREPARE | NOT_ELIGIBLE 300; FAILED | `classic` / the reason |
| IA_RV_TOO_BIG | SUBMIT | STOP 400 | `IA_TEXT.rvTooBig(n, reason, 250)` |
| IA_RV_CLASSIC_TOO_BIG | classic v5 | classic 400 | `IA_TEXT.rvClassicTooBig(n, 250)` "This Item Assembly has <n> stock rows; this revert can process at most 250 at once. Revert it from the Item Assembly list if background revert is switched on, or contact support." (integration: review minor 7; `code/revert/classic/cap.js` carries the same text, `classic_sim.js` asserts it) |
| IA_RV_SPLIT_REQUIRED | SUBMIT; PREPARE | STOP 400; FAILED | `IA_TEXT.rvSplitRequired(n)` |
| IA_RV_QUEUE_FAILED | SUBMIT | STOP 500 | `IA_TEXT.rvQueueFailed` "The revert could not be queued: please try again." |
| IA_RV_NOT_LOCKED / IA_RV_ROWS_CHANGED | PREPARE; COMMIT V0 | FAILED | `IA_TEXT.rvNotLocked` "The Item Assembly is no longer locked by this revert: nothing was reverted." / "The Item Assembly's stock movements changed while it was waiting: nothing was reverted, please revert it again." |
| IA_RV_CONFLICTS | PREPARE | FAILED | `IA_TEXT.rvConflicts` + the conflicts' messages (details: the list) |
| IA_RV_PLAN_SKIPPED / IA_RV_PLAN_FAILED / IA_RV_PLAN_BROKEN | PREPARE | FAILED | as §10's IA_PLAN_* |
| IA_RV_INVENTORY_<engine code> / IA_RV_INVENTORY_LOCK_BUSY | PREPARE PLAN; COMMIT V1 | FAILED | the LABELS-mapped engine message / `IA_TEXT.lockBusy` |
| IA_RV_COST_CHANGED / IA_RV_COST_TIMEOUT | COMMIT V2 | REQUIRES_REVIEW | `IA_TEXT.rvReview` "Under review: the revert stopped half-way. Please contact support." (details: the row / waited 1,800 s from V2's first busy wait [ruling 10 R4]) |
| IA_RV_LOCK_WAIT, IA_RV_STEP_RETRY, IA_RV_WAIT, IA_RV_TRANSIENT | COMMIT / WORKER | transient | progress_message only |
| IA_RV_TRANSIENT_RETRIES_EXHAUSTED / IA_RV_RECONCILIATION_MISMATCH / IA_RV_PREV_STATUS_UNKNOWN | WORKER / COMMIT / any unlock | FAILED / REQUIRES_REVIEW / REQUIRES_REVIEW | as §10, worded for the revert: `IA_TEXT.rvNotReverted` "Temporary failures persisted; not reverted." / `IA_TEXT.rvReview` / `IA_TEXT.prevUnknown`; a STATUS without a job answers `IA_TEXT.rvNoJob` "no background revert" |

**Verification (E, with F):** a classic-sized IA reverted classic vs V2 (twins: equal movement / balance / FIFO / WA / Batch
deltas except `operation_effect_key`); a V2-completed 830-pick IA reverted by V2 (timing, every lock given back); a used
parent FIFO layer -> FAILED in PREPARE with the classic's conflict list, nothing written; a COST lock held by another
operation -> V2_COST waits, then completes. The plan's "measure the classic IA_REVERT at 830" is superseded (the classic is
capped at 250).

---------------------------------------------------------------------------------------------------------------------------
## Contract deviations

Each: what the plan / brief says, what the code shows (evidence), what this contract does. Raised with the controller.

1. **A GENERATE_BATCH refusal cannot become a SUBMIT answer.** Brief e: "GENERATE_BATCH as a gate", h: "IA_BATCH_FAILED
   (GENERATE_BATCH's text)". GENERATE_BATCH refuses through end nodes with code 401, and that FAILS the calling run at its
   workflow node (dev SM_MISC_RECEIPT 2098295611508183041, GOODS_RECEIVING 2091804770166583298, SM_OPENING_BALANCE
   2105180515746615298: `执行工作流节点[Generate Batch]报错[No default batch found.]`); a try/catch keeps the run going but the
   HTTP caller still gets `{code 400, data null, msg}` (memory: try/catch semantics). So SUBMIT pre-checks every refusal that
   one config row predicts (§7: no / several default configs, unknown level, the date formats) and answers STOP 400
   `IA_BATCH_FAILED` with GENERATE_BATCH's exact text; the residual `Duplicate Batch Format found.` race ends the run before any
   write and the client shows the envelope's `msg` (§12).
2. **No stored pick count in the classic guard** (brief i: "stored status + pick count in one SQL"). SA ruling 2026-10-16: a
   JSON_TABLE over a malformed stored blob would block every save; the plan counts the picks from allData anyway. The guard SQL
   reads the stored status only (`sql.py CLASSIC_GUARD`).
3. **The fingerprint's decimal columns** (`total_quantity`, `item_qty`) are 8-dp text and safe: both sides are always STORED rows
   (SUBMIT's read-back, PREPARE, I0); V2 never compares a written value with its read-back here (contrast LOT deviation 3).
4. **Ids compare as exact text** (review 10's "as strings", sharpened): the prod UOM ids 2092460418772639758 and
   ...785 are ONE JS double, so any numeric fallback matches the wrong conversion row; the platform keeps 19-digit ids exact
   through `String()` (prod run 2112073133161844738); a pure-JS replay must parse rows with `iaParseJ` (`test_shared.js`).
5. **OUT_TOTALS reads `trx_no` from the header row** (review 7 says "trx_no = iaNo"): the IA number is free text (Manual Input),
   which never goes into SQL (§14.6); the subquery gives the same number - nobody else writes it while the IA is Processing.
6. **I1's duplicate rule** (controller 1: "same batch_number + material_id (+ plant_id)"): a live Batch row of the parent item in
   the organization with the same `batchKey(number)`, any plant, not ours. GR C1's org-wide auto-number variant (any item) would
   need the number in SQL (GR escapes it into a JSON_TABLE); we keep free text out and read the parent's rows (22k batch rows on
   prod, no index needed).
7. **Progress and `jobRow`**: the templates' `jobRow` default progress is 70 and their phase-B entry claims 85, so a phase-B pass
   would show "stock moved" (>= 80) before op 2 ran or drop to 70 on a retry. IA: phase-B entry 75 until I3 is DONE, I3 writes
   80, 85 after; `jobRow` defaults to the entry's progress.
8. **ITEMS = ids only** (brief c / g): I4 stamps `new Date().toISOString()` at I4; the templates stamp at PREPARE.
9. **`receiptBaseQty` and `assemblyCost` live in the ENGINE_R part** and are never sent: the engine call passes only
   its four params, so op 2's request is byte-identical on every retry (review 7).
10. **`parent_trx_no: ""`** (brief c) verified: every classic 'IA' movement row holds `''` (dev 31, prod 197 rows).
11. **Write order of a stored Draft** (plan: "job -> header + lines -> read back -> LOCK|n -> link -> due"): that is LOT's Add
    order. A stored Draft takes `LOCK|n+1` FIRST (LOT §7 DIRECT from Draft): two submits of different keys would otherwise both
    write the header and leave it pointing at the loser's job with the winner's lock - no job could unlock it.
12. **The classic cap** (brief i: 500): `CLASSIC_MAX_PICKS` = 250, the user's decision 2026-10-19 (review 5 proposed it); SUBMIT's
    NOT_ELIGIBLE / `IA_TOO_BIG` split, the classic guards (IA_SAVE v12, IA_REVERT v5) and the texts use `IA_CLASSIC_MAX_PICKS`.
13. **`pickCount`** = every pick with `sm_quantity > 0` (what the client and the classic count, review 11); op 1's movements (stock
    lines only) drive the 5,000 limit and the PARK rule. Equal in practice (non-stock lines carry no picks).
14. **The PLANs use the job's real operation keys** (`mode PLAN`): the engine routes PLAN before any DONE / REVIEW / intent
    handling and writes nothing (`code_node_IBstate`), so PREPARE's and I1's PLANs cannot disturb the later APPLY.
15. **Clone strips ids in SUBMIT; the v12 status checks are Edit-only** (review 5): the desktop Clone keeps the source id.
16. **No labour / overhead roll-in** (plan decision 6, brief d / i: NONSTOCK, `nonStockValue`, v12 `code_receipt_prep`):
    superseded by the user decision 2026-10-19 ~15:45 (below).

### User decisions (2026-10-19, via the controller)

- **user decision 2026-10-19 15:25 (A)** - `CLASSIC_MAX_PICKS` = 250 (replaces review 5's placeholder): it caps the classic
  IA_SAVE Completed path (§11) and the classic IA_REVERT (RV9); SUBMIT's NOT_ELIGIBLE / `IA_TOO_BIG` split uses it.
- **user decision 2026-10-19 15:25 (B)** - **Revert V2 is in this cut** (part "Revert V2", RV1-RV10; package F, D for the list):
  command `REVERT_IA`, the shared `IA|<id>` correlation and `IAC|<id>` lock, op `IAV|<jobId>`, cost-row lock owner
  `IAV|<jobId>|C`, steps V0-V4, `COMMITTING_REVERT`, `IA_RV_*`, the list's Revert routing with `min_picks` 50, the classic
  IA_REVERT v5 capped at 250. Supersedes the plan's "Revert V2 after the cut / measure the classic IA_REVERT at 830" and
  verification step 8. Both SUBMITs now treat an open job of either command as BUSY (§2, `FACTS`).
- **user decision 2026-10-19 ~15:45** - **no labour / overhead roll-in** (supersedes plan decision 6 and brief items d / i):
  non-stock (stock_control 0) lines are allowed without picks (v12 `code_validate`: `total_quantity > 0`, no picks) but add
  NOTHING to the cost. NONSTOCK is dropped everywhere (no part, no `nonStockValue`); `receiptUnitPrice({ outTotals,
  receiptBaseQty, assemblyCost })` = q8(sum(outTotals) / receiptBaseQty + assemblyCost), 0 when the base qty is <= 0;
  `assemblyCost` moves into ENGINE_R; the classic IA_SAVE v12 does NOT touch `code_receipt_prep` (only the guard nodes +
  `code_validate`'s non-stock rule). The client rule stays (non-stock lines carry total_quantity = requested qty, no picks).
  Reason: an agreed business contract excludes new labour / machine costing and requires today's receipt-cost semantics.
  (V2 still divides by the receipt's BASE qty, the engine's per-base-unit price: identical to the classic whenever item_uom
  is the base UOM - every prod IA, 56 / 56 verified.)

### Revert V2 clarifications (WP0, from the code)

1. **Live rows** = `code_node_iaRvPrep`'s `liveOut` + `liveIn` (the classic's own pairing; one reverse movement each), the count
   behind `min_picks`, the 250 cap and the 5,000 limit - not a raw SQL count, which would also count an earlier, already
   reverted cycle's rows.
2. **V0's "live-row set unchanged"** = `iaMovesFingerprint` (`IM1:`) over every movement row the classic reads (`RV_MOVES`),
   computed by PREPARE, re-read by V0 - no lifted body needed in COMMIT. `RV_MOVES` returns exactly the classic's
   `sql_node_iaRvMovs` rows (dev IA-2609-010, `test/shared/sql_live.py`), tenant-scoped, number / organization from the header.
3. **`parent_trx_no: ""`** on the revert movements: every classic `IA-R` row holds `''` (dev 8 rows); the engine writes null
   when the key is absent.
4. **Serial-numbered items are NOT_ELIGIBLE** for Revert V2 (GR Revert V2's rule: the engine has no serial handling).
5. **The classic's fetch ceilings** (`ceiling()`: Item Balance / Item Batch Balance / Item at 1,000, Handling Unit at 100) are
   neutralized as grrv does (`__Uncapped` row views, `tpl/grrv/lift/runtime.js`); `lib/lift/runtime.js` lacks them, so F copies
   that runtime. `search_node_iaRvBatch` stays a plain array (prep calls `.filter` on it).
6. **The revert ADDs carry no `batch_number`**: the classic sends `'-'` ("no new batch"), which the engine needs no form of.
7. **The revert worker JS** comes from `tpl/sav2/code/worker/*` (de-SA'd by F), not from C's folder - no cross-package wait.
8. **`inventory_movement.operation_effect_key`** (OUT_TOTALS, the engine) exists on dev only until the full deployment (prod
   answered "Unknown column"), like the V2 tables.

### Contract vs the package briefs (for the controller; the contract wins until ruled otherwise)

1. **b-brief write order** "job -> doc -> read back -> LOCK|n -> link -> due" is kept for an Add / Clone; a stored Draft takes
   `LOCK|n+1` first (deviation 11).
2. **b-brief "GENERATE_BATCH failure -> STOP with its text"** holds for every refusal the config row predicts; the residual
   `Duplicate Batch Format found.` ends SUBMIT's run (deviation 1) and D shows the envelope's text.
3. **f-brief "live 'IA' rows counted with the classic's sql_node_iaRvMovs filter"** = the rows of that filter after the
   classic's own pairing (`liveOut` + `liveIn`, Revert V2 clarification 1).
4. **README**: c-brief makes C the writer of `AsyncV2/README.md`; the f-brief's runbook goes to `revert/README_REVERT.md` and
   the controller merges it (one writer per file).
5. **Worker JS source**: c-brief names `tpl/smv2/code/worker_src_grv2`; SA's de-LOT'd `tpl/sav2/code/worker` is equally allowed
   (§8, RV5) - the required end state is the same.
6. **Ownership** follows the briefs (A `lift/**`, B `classic/**` + `submit/**` incl. its lifts, E `live/**`), §13.

### Folded in (controller and review notes)

- **controller 1** I1 duplicate check, `IA_BATCH_DUPLICATE` "Duplicate Batch Format found.", our own earlier insert counts as
  done; the number is still generated at SUBMIT (no config write in COMMIT) - §9 I1, §10 (rule: deviation 6).
- **controller 2** GR Revert removes batches by `parent_transaction_no`; ours carry `transaction_no` = the IA number: no overlap.
- **controller 3** publish order PREPARE -> COMMIT -> WORKER -> SUBMIT; the client builds OFF unless `--on` - §12, §13.
- **controller 4** a REPLAYED op 1 answers its stored unrounded totals; I3 prices from the stored rows - §5, §9.
- **controller 5** `gd_publish_step.job_id` varchar(32) (`IAC|<19 digits>|I` = 25), `operation_effect_key` varchar(255) - §1, §4.
- **review 1** I3: wall-clock deadline (I2 DONE + 30 min) -> `IA_RECEIPT_TIMEOUT`; 409 / no answer / 400 without a result_code
  wait; 400 with a result_code / 500 -> review; R1 must be "200"; never start while op 1 is under review - §9 I3.
- **review 2** PREPARE refuses any non-"200" per-movement PLAN result (`IA_PLAN_SKIPPED`); I2 tolerates "401" inside a 200; I3
  counts code-200 results - §9.
- **review 3** I1 re-PLANs ENGINE_R with the real batch_id before op 1; the soft-delete set is only this job's inserts - §9 I1.
- **review 4** Manual Input and blank-rule batch parents NOT_ELIGIBLE; BATCH `insert` only - §5, §7.
- **review 5** v12 status checks Edit-only; `CLASSIC_MAX_PICKS` 250 (then decided by the user) - §11, deviation 12.
- **review 6** number rule (issuedNo of an earlier job AND no COMPLETED job under it; `iaNo` in the request) - §3, `FACTS`.
- **review 7** the I3 read; `assemblyCost` fixed at PREPARE (in ENGINE_R since NONSTOCK was dropped) - §5, `sql.py OUT_TOTALS`.
- **review 8** the parent in the costing screen; the WA STOP for components - §7.
- **review 9** GENERATE_BATCH right before the job insert - §2, §7.
- **review 10** price.js = the engine's `uomOf`, ids as strings - §6 (deviation 4).
- **review 11** client: pick count, `.limit()` + chunking, non-stock qty, Transfer Stock disabled, Processing view, Delete
  re-read - §12.
- **review 12** posting limit of 1,000 distinct items - §12.
- **review 13** runbook for both keys and the prod path - §9.
- **review 14** E's twin / reconcile method - §13.

### Rulings (controller, 2026-10-19 ~16:00)

1. "Contract vs the package briefs" 1-6 are ACCEPTED as written: the stored-Draft write order takes `LOCK|n+1` first
   (deviation 11); GENERATE_BATCH's predictable refusals are pre-checked (STOP 400 `IA_BATCH_FAILED`) and the residual
   `Duplicate Batch Format found.` race ends SUBMIT before any write, the client showing the envelope's `msg` with the form
   kept open (deviation 1); Revert "live rows" = `liveOut` + `liveIn` after the classic's pairing; C writes
   `Item Assembly & BOM/AsyncV2/README.md`, F writes `scratchpad/iav2/revert/README_REVERT.md` and the controller merges; either
   worker template.
2. Deviations 1-16 are ACCEPTED. Where a brief and this contract disagree, this contract wins; report anything new as
   NEEDS_CONTEXT.
3. Shell ids stay "0" in ids.json until the user creates the 8 shells; every builder must build with "0" (skip nothing) and
   rebuild with the real ids at integration (plan.md Task F).
4. (A, ~16:40) PREPARE: an unreadable request -> REQUIRES_REVIEW `IA_PREV_STATUS_UNKNOWN` (not FAILED: FAILED without an unlock
   would strand the IA Processing; LOT / SA entries do the same); a PLAN 400 without a result_code -> FAILED + unlock
   `IA_PLAN_FAILED` (nothing moved; the user completes again). A's per-iteration context trimming for the lifted
   code_issue_line is accepted (tested equal; avoids O(n^2) context growth).
5. (C, ~17:00) `IA_LOCK_JOIN` (§8, shared by IA_V2_WORKER and IA_REVERT_V2_WORKER) gains `AND g.is_deleted = 0` on the
   sm_item_assembly join: a soft-deleted IA then reads as not owned ('0'), so no worker unlock path can write a status onto it.
   C's deviations (I0 via FP_HEADER + the entry's lock read; the I1 read-back bounded `id > <jobId>`; phase-A exit order unlock ->
   Batch soft-delete -> job row; IA_BATCH_FAILED / IA_PLAN_FAILED in COMMIT; Manual-parent manifests refused at the entry) are
   ACCEPTED. The op-2 deadline counts from I2 DONE; the runbook's reset covers a timed-out job.
6. (D, ~17:05) D's deviations ACCEPTED: the list's existing Processing pill kept; the form's `processing_status` badge is
   display-only (dataBind false); `onRowRemove_item` + a non-stock guard in `onClick_select_stock`; Complete & Post does not
   post when SUBMIT's STATUS says the job was already COMPLETED (no double post); an INVALID answer from IA_REVERT_V2_SUBMIT ->
   that row's classic IA_REVERT; client/README_CLIENT.md is merged by the controller into AsyncV2/README.md. RISK carried to
   live verification item 12 (FIRST in Tuesday's list): whether the client API caps the BOM's subform array on an 830-line BOM.
7. (B, ~17:20) B's interpretations ACCEPTED: the 250 cap applies to every non-Draft saveAs (= Completed in practice); with
   -9999 the typed number is always written (classic parity); items with stock_control NULL -> NOT_ELIGIBLE; a stored Draft's job
   request carries the old number until `due` rewrites it (as GR SUBMIT v8's relink). Publish order: the form publish (creates
   ia_v2_job_id / ia_idem_key) BEFORE IA_V2_SUBMIT.
8. (controller) Prod-derived fixtures live OUTSIDE the repo in /Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/<pkg>/ (tests
   skip with a notice when absent; read-only re-pull scripts); dev fixtures may stay in the repo.
9. (F, ~18:00) F's deviations ACCEPTED (projected header / Item reads; the HU read skipped since HU IAs are NOT_ELIGIBLE; the
   extra IM1 check in PREPARE). Go / no-go rule: COMPLETE (and COMPLETE_POST) may be ON only when REVERT is ON too, else an IA
   completed with more than 250 picks could never be reverted (v5 refuses it). Integration (plan.md Task F) adds revert-specific
   texts to code/shared (IA_TEXT rv*: not locked, review, under review, queue failed, "not reverted.", "no background revert")
   and one cross-package sim: an IA completed by C's BUILT COMMIT, then reverted by F's BUILT revert.
10. (controller, ~18:05, the fresh review) Fix wave R1-R9 in `.superpowers/sdd/ia-v2-cheeky-shimmying-puffin/fixwave-brief.md`
    is binding: R1 revert caps compare `liveOut > IA_CLASSIC_MAX_PICKS`; R2 a phase-A FAIL with any op-1 (`IAC|<job>|I`) /
    revert-op (`IAV|<job>`) intent or DONE row becomes REQUIRES_REVIEW (no unlock, no Batch soft-delete); R3 both Post handlers
    re-read the stored status; R4 waits' deadlines count from the step's first transient attempt; R5 v12 code_validate needs
    at least one stock line with picks; R6 texts; R7 PREPAREs accept engine `results` as array or JSON text; R8 PREPARE's
    unlinked-find branch writes the link with FAILED; R9 the client enforces COMPLETE only with REVERT. Minor 5 accepted.

### Integration (plan.md Task F, 2026-10-19, controller's delegate)

- Ruling 9 applied: `IA_TEXT` gains `rvNotLocked`, `rvReview`, `rvUnderReview`, `rvQueueFailed`, `rvNotReverted`, `rvNoJob` (RV10 above); F's
  code uses them (SUBMIT BUSY picks `rvUnderReview` / `underReview` by the command of the job under review).
- Review minor 7: `IA_TEXT.classicTooBig` and `IA_TEXT.rvClassicTooBig` reworded (section 10 / RV10 above).
- `ia_common.js` is embedded whole in every package's build (and `IA_TEXT` in the client), so A, B, C, D and F were rebuilt: each output
  differs from its previous build only by the `IA_TEXT` block (F also by the switched call sites); every package suite re-run green.


### Ruling 11 (controller, 2026-10-19 ~20:10, from the live 830-pick runs in 711077)

- Measured: op 1 of the 830-component IA (830 distinct materials) = 236.7 s in one APPLY, of which the engine's lock bookkeeping
  is 175 s (INVENTORY_LOCK_TOKENS TAKE 60.0 s + GIVE 60.0 s: one atomic-count per key, 1,660 keys, ~36 ms each; the lock-row
  release update 55.2 s, ~33 ms per row) and the balance / FIFO updates 55.6 s (~33 ms per row); inserts are batched (1.8 s).
  The cost follows DISTINCT keys, not lines (~0.285 s per distinct pick). COMMIT B = 42.8 s, of which the I4 Item stamps 41.4 s
  (~50 ms per Item row). Whole job: SUBMIT 6 s + one tick 285 s. Revert V2 of the same IA: one tick 217 s.
- The COMMIT lease (`lease_until` of IA_V2_COMMIT `sql_node_IACjob` and IA_REVERT_V2_COMMIT `sql_node_IVCjob`) is 30 minutes,
  not the template's 10: at 2,000 distinct picks op 1 alone is ~575 s, and a lease that ends during a live APPLY lets a kick take
  the job over and re-run the same operation (the engine RESUMEs and inserts the movements it does not see yet: duplicates). The
  worker's own 10-minute lease and claim window stay (they cover PREPARE only). Cost: a run that truly dies holds its job 30 min.
- The client follows a job for 420 s (`IA_WAIT_MS`, `IA_BG_WAIT_MS`), not 180 s, so the driver's largest BOM (~290 s) is
  followed to its verdict and Complete & Post posts it; beyond 420 s the existing "post it from the list" path applies.
- No engine change (decision 5): the lock-token cost is reported to the engine owner (-41) as an FYI.
- (~21:40) The 10-19 dev rates are ~7x the 10-16 ones for writes only (INVENTORY_LOCK_TOKENS atomic-count median 35 ms vs 5 ms on
  10-15 / 10-16 runs of 2,000+ keys; engine SQL reads unchanged): the timings above are pessimistic; the 30-minute lease and the
  420 s window stay (conservative either way).
