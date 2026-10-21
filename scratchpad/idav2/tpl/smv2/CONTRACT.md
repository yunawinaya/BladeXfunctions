# SM V2 / Location Transfer - the binding contract (WP0, 2026-10-16)

Single source of truth for packages A (PREPARE), B (SUBMIT + guarded classic), C (COMMIT + WORKER), D (client), E (checks).
Where the approved design (plan `gd-picking-packing-gr-fluffy-bentley`) decided something, it is copied VERBATIM and marked
**[design]**. Everything else copies a deployed convention and names its source (`grv2` = scratchpad/grv2 / GR Completion V2,
`pwv2` = Putaway V2, `gdc` = GD Completed V2, `gde` = GD Edit V2). Where the design is wrong against the code, the fix is
written here and listed under "Contract deviations" (end). A change to this file or to `code/shared/` goes through the
controller; never edit another package's folder.

Bases (exact snapshots, `base/`): classic `SM_LOCATION_TRANSFER` dev v82 (= prod v67, md5 48690c5886be1917615d1133aeadcaac),
form dev v107, list page dev v47. Ids: `ids.json`, `base/refs.md`. Columns / unique indexes: `base/columns.json`.

---------------------------------------------------------------------------------------------------------------------------
## 1. Names [design] and the namespace

- **Shells** (the user creates them in the dev designer, Save Workflow / Stock Movement): `LOT_V2_SUBMIT`, `LOT_V2_WORKER`,
  `LOT_V2_PREPARE`, `LOT_V2_COMMIT`. Ids go in `AsyncV2/ids.json` (and `scratchpad/smv2/ids.json`; "0" until created).
- **gd_async_job fields:** `command SAVE_LOT`; `correlation_id LOT|<lotId>`; `causation_id <lotId>`; `gd_id` / `gd_no` left
  empty; the idempotency key comes from the client, one per click and content.
- **Other keys:** document lock `gd_publish_step` `SMLT|<lotId>` / `LOCK|<n>`; engine operation `SMLT|<jobId>`; movements
  `M<n>` / `M<n>.2`; ledger `job_line_key` `<jobId>|<lineId>|<n>` (the column exists).
- **States:** QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_LOT -> COMPLETED. Terminal: FAILED, REQUIRES_REVIEW.
- **Form:** `stock_movement_status` gains the option `Processing` (never stored for a LOT before; mobile maps it to In
  Progress). New hidden fields `lot_v2_job_id` and `lot_idem_key` (the form publish creates the columns). A NEW badge key for
  Processing: `processing_status` is already the In Progress badge.

| Constant | Value | Notes |
|---|---|---|
| command | `SAVE_LOT` | workers of other commands filter by their own command; GD_JOB_RECONCILE (hand-run) scans by status for ANY command - never point it at SAVE_LOT jobs |
| correlation / causation | `LOT|<lotId>` / `<lotId>` | `''` / `''` in the insert of an Add until "link" |
| document lock rows | `job_id = SMLT|<lotId>`, `step_name = LOCK|<n>` | 24 chars <= varchar(32) |
| engine operation_key | `SMLT|<jobId>` | engine-owned rows `IBA|I|nnn`, `IBA|DONE`, `IBA|REVIEW` live under it |
| SUBMIT payload parts | `S|<nonce>|LINES|<nnn>` under `job_id = <jobId>` | COMPLETE / EDIT only |
| PREPARE manifest parts | `P|<nonce>|<PART>|<nnn>`, PART in ENGINE, LABELS, IT, HDR, ITEMS | under `job_id = <jobId>` |
| COMMIT step rows | `L0_REVALIDATE`, `L1_INVENTORY`, `L2_LINES`, `L3_LEDGER`, `L4_FINISH` | DONE rows; steps SQL `REGEXP '^L[0-9]_'` |
| worker claim gate | `W0_CLAIM_<row_version>` under `job_id = <jobId>` | grv2 |
| lease owners | `WRK|<24 hex>` (worker), `PUB|<24 hex>` (COMMIT), `SPLIT|<24 hex>` (hand-over) | grv2 |
| worker loop cache key | `lot_wrk_<nonce>` | grv2 `grc_wrk_` |
| movement keys | `M1`, `M1.2`, `M2`, ... | engine guard: 1-40 of `A-Za-z0-9._-`, unique |
| error codes | `LOT_*` (section 10), plus the shared `JOB_ILLEGAL_TRANSITION`, `JOB_ROW_VERSION_CONFLICT` | |

Namespace check (dev, 2026-10-16): no SAVE_LOT job, no `LOT|` correlation, no `SMLT|` step row exists (`base/refs.md`).

---------------------------------------------------------------------------------------------------------------------------
## 2. Actions

The action is derived from (stored status, saveAs, pageStatus) [design]. `pageStatus` `Clone` (the form's `isCopy`; `Copy`
accepted too) counts as `Add`, with the header id and every line id stripped [design]. `View` is INVALID.

| stored status | saveAs | action | answer / job |
|---|---|---|---|
| (Add / Clone) | Draft | DRAFT | SAVED (no job) |
| (Add / Clone) | In Progress | STAGE | job, prevStatus `Draft` |
| (Add / Clone) | Completed | DIRECT | job, prevStatus `Draft` |
| (Add / Clone) | Cancelled | - | INVALID |
| Draft | Draft / In Progress / Completed | DRAFT / STAGE / DIRECT | as above, prevStatus `Draft` |
| Draft | Cancelled | - | STOP 400 `LOT_NOT_CANCELLABLE` |
| In Progress | In Progress | EDIT | job, prevStatus `In Progress` |
| In Progress | Completed | COMPLETE (`edited` 1 = the client's COMPLETE_EDITED) | job, prevStatus `In Progress` |
| In Progress | Cancelled | CANCEL | job, prevStatus `In Progress` |
| In Progress | Draft | - | STOP 400 `LOT_IP_TO_DRAFT` "An In Progress transfer can't be saved back to Draft." (ruling 2: the classic would demote it without reversing In Transit) |
| Processing, or an open SAVE_LOT job | any | - | BUSY 409 |
| Completed / Cancelled | any | - | STALE 409 |
| anything else | any | - | NOT_ELIGIBLE |

Order of the entry checks (copy of grv2 submit/entry.js): INVALID -> a job already holds this idempotency key -> its STATUS
answer -> `operation STATUS` -> STATUS answer -> Add / Clone goes on -> stored LOT missing -> STOP `LOT_NOT_FOUND` -> stored
`Processing` or an open SAVE_LOT job (QUEUED, VALIDATING, READY_TO_COMMIT, COMMITTING_LOT, REQUIRES_REVIEW) -> BUSY ->
`form.stock_movement_status` differs from the stored status -> STALE -> stored Completed / Cancelled -> STALE -> the action
table -> eligibility (section 7) -> gates -> limits -> writes.

**prevStatus** is the status the unlock restores: `Draft` (DIRECT, STAGE; an Add counts as Draft) or `In Progress`
(COMPLETE, EDIT, CANCEL). Nothing else is valid. Every unlock (WORKER, PREPARE - incl. a SUBMIT's stray LOT - and COMMIT; SUBMIT never unlocks) writes
`{ id: lotId, stock_movement_status: prevStatus }` only when `prevStatus` is one of the two (`lotPrevStatusOk`); otherwise it
writes NO unlock and the job goes to REQUIRES_REVIEW (`LOT_PREV_STATUS_UNKNOWN`) instead of FAILED [design: "NO
`prevStatus || "Draft"` default"]. The client switches [design]: `{DRAFT, DIRECT, STAGE, COMPLETE, COMPLETE_EDITED, EDIT,
CANCEL}`.

---------------------------------------------------------------------------------------------------------------------------
## 3. gd_async_job for SAVE_LOT (a)

### Columns written, by writer

| Writer | Columns |
|---|---|
| SUBMIT insert (`add_node`, `lib/v2build.JOB_ADD_COLS`) | organization_id, plant_id (= issuing_operation_faci), command `SAVE_LOT`, idempotency_key, job_status `QUEUED`, progress_percent 0, progress_message `Queued for processing`, attempt_count 0, row_version 0, cancel_requested 0, next_attempt_at = db_now + 120 s, request_payload (JSON text, below), causation_id (`<lotId>`; `''` for an Add), correlation_id (`LOT|<lotId>`; `''` for an Add), line_count, queued_at = db_now |
| SUBMIT link (Add only, after the read-back) | id, correlation_id `LOT|<lotId>`, causation_id `<lotId>`, request_payload (+ lotId, lotNo, issuedNo, lineFingerprint) |
| SUBMIT due (after the read-back) | id, next_attempt_at = db_now, request_payload (DIRECT / STAGE from a stored Draft: + lotNo, issuedNo, lineFingerprint; pwv2 due.js) |
| WORKER | `JOB_PROPS` (id, job_status, progress_percent, progress_message, attempt_count, next_attempt_at, lease_owner, lease_expires_at, row_version, error_code, error_message, error_details, finished_at); the dead-claim move: id, row_version, attempt_count |
| PREPARE | READY: id, job_status, progress_percent, progress_message, row_version, error_code, error_message, error_details, prepared_payload, line_count. FAILED: `JOB_PROPS` |
| COMMIT | `JOB_PROPS` (every row built by `jobRow`, grv2 commit/_common.js) |

Never written: gd_id, gd_no, picking_id, picking_no, payload_hash, confirmation_token / _hash, source_so_*, submitted_*,
started_at, gd_committed_at, picking_ready_at. Unique index `Idempotency Key` (tenant_id, organization_id, idempotency_key):
a twin click's insert fails and its SUBMIT run ends (grv2).

### request_payload (JSON text, written by SUBMIT only)

```json
{
  "v": 1,
  "action": "COMPLETE",
  "prevStatus": "In Progress",
  "saveAs": "Completed",
  "pageStatus": "Edit",
  "lotId": "2105231525751984129",
  "lotNo": "LOT-20260930/0078",
  "issuedNo": "",
  "lineFingerprint": "LF1:5:265dc303393b67f9",
  "incomingFingerprint": "LF1:5:0a1b2c3d4e5f6071",
  "edited": 1,
  "organizationId": "1123598813738675201",
  "plantId": "2018912822846582700",
  "lineCount": 5,
  "rowCount": 7,
  "movementCount": 14,
  "uid": "1123598821738675201",
  "source": "FORM",
  "nonce": "ab12cd34",
  "parts": { "LINES": ["S|ab12cd34|LINES|001"] }
}
```

| Key | Type | Meaning |
|---|---|---|
| action | DIRECT / STAGE / COMPLETE / EDIT / CANCEL | DRAFT never has a job |
| prevStatus | `Draft` / `In Progress` | section 2 |
| saveAs, pageStatus | text | as the classic takes them; Clone / Copy are stored as `Add` |
| lotId, lotNo | digit string, text | the stored number after SUBMIT's writes (read back); for an Add filled in by "link" |
| issuedNo | text | the number THIS submit made the platform issue (`'issued'` + rule); `''` when none (COMPLETE / EDIT / CANCEL, a Draft that reuses its number). The next SUBMIT of a Draft whose stored `stock_movement_no` equals the `issuedNo` of an earlier SAVE_LOT job of the same LOT (`correlation_id = LOT|<id>`, any status) writes WITHOUT the number props [design: "no second number is burned"] |
| lineFingerprint | `LF1:<n>:<hex16>` | `lotLineFingerprint` of the STORED lines (`code/shared/sql.py FP_LINES`) after SUBMIT's writes: read back for DIRECT / STAGE, read before the writes for COMPLETE / EDIT / CANCEL (SUBMIT does not touch their lines) |
| incomingFingerprint | `LF1:...` or `''` | COMPLETE / EDIT: `lotLineFingerprint` of the lines L2 will write (the filled-back incoming `flatLines`); `''` otherwise |
| edited | 0 / 1 | COMPLETE / EDIT: 1 when incomingFingerprint != lineFingerprint |
| organizationId, plantId | digit strings | the LOT's organization_id / issuing_operation_faci |
| lineCount | int | flat stock lines (bundle parents excluded): COMPLETE / EDIT = max(stored, incoming); drives the split tick (section 8) |
| rowCount | int | temp_qty_data entries with sm_quantity > 0 |
| movementCount | int | the engine movements SUBMIT expects (section 7, limits); PREPARE recounts exactly |
| uid | text | `{{system:uid}}` |
| source | `FORM` / `LIST` | |
| nonce | 8 of `[0-9A-Za-z]` | SUBMIT's run nonce (from `{{system:uuid}}`), names the S parts |
| parts | `{ "LINES": [step names] }` | COMPLETE / EDIT; `{}` otherwise. Names are known before the insert (the text length decides the chunk count) |

### Idempotency key [design: "one per click and content"; recipe = grv2 grc_onClick_completed.js idemKey]

`LOT:<organization_id>:<lotId | "new-" + pageToken>:<hash16>:<gen>`, characters outside `A-Za-z0-9|:_.-` replaced by `-`,
cut to 128; SUBMIT refuses anything else (8-128 of that set). `hash16` = FNV-1a 32 + djb2 32 (`lotFpHash`) over
`canon({ saveAs, pageStatus, record })` - **saveAs is part of the hashed content** (three buttons share one content; see
deviations). `record` = `this.getValues()` minus NOT_RECORD (`lot_v2_job_id`, `lot_idem_key`, `_data`, the dialog models
`sm_item_balance`, `dialog_apply_location`, and every other helper key D finds). `pageToken` is made once per form open and
kept in `_data`; `gen` starts at 1 and goes up after a FAILED answer for the same content. The list's Cancel:
`LOT:<org>:<lotId>:<clickToken>`, one `clickToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)` per
click of the bulk action (`Goods Receiving/RevertV2/grv_list_RevertCompletedGR.js` l.145-146: a lost answer re-sent with
the same key finds the same job).

### State machine

| From | To | Written by | When |
|---|---|---|---|
| - | QUEUED (next_attempt_at = now + 120 s) | SUBMIT insert | after the gates |
| QUEUED | QUEUED, due now | SUBMIT due | the read-back shows the LOT Processing under this job's lock (if SUBMIT dies first, the job falls due by itself) |
| QUEUED | VALIDATING (lease `WRK|`, 10 min) | WORKER claim | |
| VALIDATING | READY_TO_COMMIT (lease kept) | PREPARE | manifest + parts written |
| VALIDATING | FAILED (+ unlock) | PREPARE | the plan failed cleanly (section 9) |
| VALIDATING / READY_TO_COMMIT | same, attempt + 1, backoff 2 s x 2^n (max 30 s) | WORKER | a callee answered without a code / a dead lease or claim (max_retries 3) |
| VALIDATING / READY_TO_COMMIT | FAILED (+ unlock) | WORKER | a hard code (section 10) or retries exhausted |
| READY_TO_COMMIT | COMMITTING_LOT (lease `PUB|`) | COMMIT entry | |
| COMMITTING_LOT (phase A) | FAILED (+ unlock) | COMMIT | L0 fails, L1 400, L1 409 after 8 waits, an unusable manifest |
| COMMITTING_LOT (phase A) | COMMITTING_LOT, lease `SPLIT|` / PARK | COMMIT L1 | stock moved (section 8) |
| COMMITTING_LOT | COMMITTING_LOT, attempt + 1, backoff | COMMIT | a step did not complete (stepEnd) / L1 409 wait (lockWait) |
| COMMITTING_LOT | REQUIRES_REVIEW | COMMIT / WORKER | phase B failed 3 times or conflicts; L1 500; a dead COMMIT run 3 times; the LOT stays Processing |
| COMMITTING_LOT | COMPLETED | COMMIT finish | after L4 |
| any open | REQUIRES_REVIEW | whoever would unlock | prevStatus not Draft / In Progress (`LOT_PREV_STATUS_UNKNOWN`) |

progress_percent: QUEUED 0, VALIDATING >= 10, READY_TO_COMMIT 60, phase A 70, stock moved (SPLIT / PARK) 80, phase B 85,
COMPLETED 100, FAILED / REQUIRES_REVIEW 0 (grv2 / pwv2 values). progress_message is shown to the user.

---------------------------------------------------------------------------------------------------------------------------
## 4. gd_publish_step rows (b)

Unique `Job Step` (tenant_id, job_id, step_name): a second insert of the same name fails its run - that is the twin guard
everywhere below. Columns: job_id / organization_id / step_name varchar(32), step_status varchar(16), result_ref longtext.
Writes use `lib/v2build.step_add` (STEP_PROPS) or `PART_COLS`.

| Rows | job_id | step_name | step_status | result_ref | Written by | Read by |
|---|---|---|---|---|---|---|
| document lock | `SMLT|<lotId>` | `LOCK|<n>` (n = last + 1; Add: `LOCK|1` after the insert) | `LOCK` | the job's idempotency key | SUBMIT | WORKER (id column), PREPARE, COMMIT entry / L0, SUBMIT read-back |
| claim gate | `<jobId>` | `W0_CLAIM_<row_version>` | `DONE` | `WRK|<nonce>` | WORKER pick | WORKER poll / tick |
| SUBMIT payload part | `<jobId>` | `S|<nonce>|LINES|<nnn>` | `PAYLOAD` | <= 400,000 characters of the part's JSON text | SUBMIT (COMPLETE / EDIT) | PREPARE, COMMIT L2 |
| PREPARE manifest parts | `<jobId>` | `P|<nonce>|<PART>|<nnn>` | `PAYLOAD` | <= 400,000 characters | PREPARE | COMMIT |
| step done | `<jobId>` | `L0_REVALIDATE` ... `L4_FINISH` | `DONE` | a short note (<= 2,000 chars) | COMMIT (`doneRow`) | COMMIT entry |
| engine rows | `SMLT|<jobId>` | `IBA|I|<nnn>`, `IBA|DONE`, `IBA|REVIEW` | engine's | engine's | INVENTORY_BULK_APPLY | COMMIT L1 counts `IBA|I|%` (409 rule); the runbook clears `IBA|REVIEW` |

Chunking (grv2 / pwv2 / gdc, `lotPartRows` / `lotJoinChunks`): the value's `JSON.stringify` text cut every 400,000
characters into `<prefix><nnn>` (001, 002, ...; at least one row, even for `{}`); joined back in step-name order.

**Lock ownership (status-based, grv2):** a job owns its LOT when ALL hold: `sm_location_transfer.stock_movement_status =
'Processing'`, `lot_v2_job_id = <jobId>`, and the latest (MAX id) `LOCK|%` row of `SMLT|<lotId>` has `result_ref = <the job's
idempotency_key>`. **Release** = the status write: the unlock (`stock_movement_status = prevStatus`, before any stock moved)
or L4's final status. LOCK rows are never deleted; `lot_v2_job_id` is kept after the job (audit). The classic guard and every
writer that honours V2 refuse a Processing LOT.

---------------------------------------------------------------------------------------------------------------------------
## 5. The manifest and its parts (c)

`prepared_payload` (written by PREPARE with READY_TO_COMMIT; read whole by COMMIT's entry - keep it small):

```json
{
  "v": 1, "prepared_by": "LOT_V2_PREPARE", "job_id": "2111005120857767938", "lot_id": "2105231525751984129",
  "lot_no": "LOT-20260930/0078", "action": "COMPLETE", "prevStatus": "In Progress", "saveAs": "Completed",
  "organization_id": "1123598813738675201", "plant_id": "2018912822846582700", "nonce": "c9d8e7f6", "lineCount": 5,
  "lineFingerprint": "LF1:5:265dc303393b67f9", "incomingFingerprint": "LF1:5:0a1b2c3d4e5f6071",
  "parts": { "ENGINE": ["P|c9d8e7f6|ENGINE|001"], "LABELS": ["P|c9d8e7f6|LABELS|001"], "IT": ["P|c9d8e7f6|IT|001"],
             "HDR": ["P|c9d8e7f6|HDR|001"], "ITEMS": ["P|c9d8e7f6|ITEMS|001"] },
  "sparts": { "LINES": ["S|ab12cd34|LINES|001"] },
  "counts": { "lines": 5, "rows": 7, "movements": 18, "itCreates": 1, "itUpdates": 7, "items": 4 }
}
```

COMMIT's entry accepts it only when `job_id` = the job, `lot_id` is digits, `correlation_id = LOT|<lot_id>`, and every
PART above has a non-empty name list (pwv2 / grv2 entry.js); else FAILED + unlock (before L1) / REQUIRES_REVIEW (after).
It also requires a `LF1:` `lineFingerprint` and, for COMPLETE / EDIT, a non-empty `sparts.LINES`; else a clean FAILED
`LOT_INVALID_REQUEST` (+ unlock, before L1).
Lines are NOT copied into the manifest: L2 reads SUBMIT's `S|...|LINES` part [design].

### ENGINE = the exact INVENTORY_BULK_APPLY request

```json
{ "operation_key": "SMLT|2111005120857767938", "mode": "APPLY", "organization_id": "1123598813738675201",
  "movements": [
    { "movement_key": "M1", "direction": "SUBTRACT", "plant_id": "2018912822846582700", "organization_id": "1123598813738675201",
      "material_id": "2064633018934157313", "quantity": 3, "material_uom": "1940", "transaction_type": "LOT",
      "trx_no": "LOT-20260930/0078", "inventory_category": "In Transit", "location_id": "2018912822846582786",
      "batch_id": "2069333288379301890", "manufacturing_date": null, "expired_date": null, "doc_date": "2026-09-30 00:00:00",
      "isMovingInv": 1, "handling_unit_id": null },
    { "movement_key": "M1.2", "direction": "ADD", "plant_id": "2018912822846582700", "organization_id": "1123598813738675201",
      "material_id": "2064633018934157313", "quantity": 3, "material_uom": "1940", "transaction_type": "LOT",
      "trx_no": "LOT-20260930/0078", "inventory_category": "Unrestricted", "location_id": "2018912822846582786",
      "batch_id": "2069333288379301890", "manufacturing_date": null, "expired_date": null, "doc_date": "2026-09-30 00:00:00",
      "isMovingInv": 1, "handling_unit_id": null, "unit_price_from": "M1" } ] }
```

One pair per classic movement, in the classic's order; COMPLETE: the reconcile pairs first, then the main pairs [design].
Keys = the `workflow_node_LOT*{Sub,Add}` params (`base/SM_LOCATION_TRANSFER.v82.json`) minus `index` / `itemData`, plus
`movement_key`, `direction`, `unit_price_from` (ADD only; the SUBTRACT is unpriced) [design]. Values from the lifted
compute: `plant_id` / `organization_id` / `trx_no` / `doc_date` = the compute's `plant_id`, `organization_id`,
`stock_movement_no` (CANCEL: `<no>-Cancelled`), `doc_date`; per pair `material_id`, `quantity` (a NUMBER, q8),
`material_uom`, `batch_id` (digits or null), `handling_unit_id` (null), `manufacturing_date`, `expired_date`, the
SUBTRACT's `subtractCategory` / `subtractLocation`, the ADD's `addCategory` / `addLocation`. Not sent (the classic does not):
`unit_price`, `parent_trx_no`, `remark*`, `batch_number`. Engine checks (guard.js): `material_id`, `plant_id`,
`location_id` digits; `batch_id` digits or empty; every `organization_id` = the operation's; 1-5,000 movements. **No
engine PLAN** [design]. Zero movements (e.g. an EDIT of remarks only) = an ENGINE part with `"movements": []`: L1 skips
the call (guard.js l.25 rejects an empty list; gde `needCall`).

### LABELS = movement_key -> where it came from (read by L1 only on a 400)

```json
{ "M1":   { "line_index": "4", "line_id": "2105231525764567046", "item_code": "FG-0042", "item_name": "Widget",
            "bin": "A1-B2-C3", "bin_id": "2018912822846582786", "category": "In Transit", "side": "from" },
  "M1.2": { "line_index": "4", "line_id": "2105231525764567046", "item_code": "FG-0042", "item_name": "Widget",
            "bin": "A1-B2-C3", "bin_id": "2018912822846582786", "category": "Unrestricted", "side": "to" } }
```

`bin` = `bin_location.bin_location_combine` (PREPARE reads the plant's bins; the id when not found). Every pair has a line:
`code_node_uht83Wzh` builds its pairs line by line (only its ledger creates are line-less).
`lotMapEngineMessage(message, LABELS, ENGINE movement_key list)` (`code/shared/movekey.js`) turns the engine's
`"Insufficient quantity (movement M1)"` into `"Insufficient quantity - line 4 (FG-0042), from bin A1-B2-C3 (In Transit)"`.

### IT = the in-transit ledger writes (L3)

Shapes only (a STAGE job has creates, a COMPLETE job mostly updates):

```json
{ "creates": [ { "doc_type": "Location Transfer", "doc_id": "2105231525751984129", "doc_no": "LOT-20260930/0078",
                 "doc_line_id": "2105231525764567046", "line_no": 4, "parent_id": "", "parent_no": "", "parent_line_id": "",
                 "material_id": "2064633018934157313", "item_code": "FG-0042", "item_name": "Widget", "item_desc": "",
                 "item_uom": "1940", "batch_id": "2069333288379301890", "handling_unit_id": null, "plant_id": "2018912822846582700",
                 "organization_id": "1123598813738675201", "transit_bin": "2018912822846582786", "from_plant_id": "2018912822846582700",
                 "from_bin": "2018912822846582791", "from_category": "Unrestricted", "to_plant_id": "2018912822846582700",
                 "to_bin": "2018912822846582786", "to_category": "Unrestricted", "transit_qty": "3.00000000",
                 "received_qty": "0.00000000", "open_qty": "3.00000000", "status": "In Transit", "transit_date": "2026-09-30 00:00:00",
                 "received_date": null, "remark": "", "target_doc_type": "Location Transfer", "target_doc_id": "2105231525751984129",
                 "target_doc_no": "LOT-20260930/0078", "target_doc_line_id": "2105231525764567046", "source_transit_id": "",
                 "job_line_key": "2111005120857767938|2105231525764567046|1" } ],
  "updates": [ { "id": "2105231532412538883", "source": "MAIN",
                 "before": { "status": "In Transit", "open_qty": "3.00000000", "received_qty": "0.00000000", "transit_qty": "3.00000000" },
                 "after":  { "received_qty": "3.00000000", "open_qty": "0.00000000", "status": "Received", "received_date": "2026-09-30 00:00:00" } } ] }
```

- **creates**: complete rows with the add-node columns of `add_node_LOTmainCreate` / `add_node_LOTreconCreate`
  (`lib/v2build.IT_COLS` + `received_date`) + `job_line_key`, after the Enrich nodes filled item_code / name / desc. Values
  exactly as the classic computes them (decimals `qtyStr` strings, dates `YYYY-MM-DD HH:MM:SS`, ids digit strings, the
  classic's `""` / null kept). `job_line_key = <jobId>|<doc_line_id>|<n>`, n = 1-based among that line's creates; a reconcile
  create has no line (`doc_line_id ""`): `<jobId>|0|<n>`, n = 1-based among the job's line-less creates. A COMPLETE create
  folded with its close [design P4] is ONE create carrying the closed values.
- **updates**: `{ id, source, before, after }`; `after` holds exactly the columns the classic node writes for that row:
  `RECON` (update_node_LOTreconAdjust) transit_qty, open_qty, status; `MAIN` (update_node_LOTmainClose) received_qty,
  open_qty, status, received_date (= the doc date, LOTmainCompute); `CANCEL` (update_node_LOTcancelClose) open_qty, status;
  `FOLD` (an adjust then a close, one update [design P4]) the union. `before` = status, open_qty, received_qty, transit_qty
  of the row as PREPARE read it (pwv2 `IT_BEFORE`, same text forms).
- Compare as pwv2 `commit/p3_plan.js` / `p3_check.js`: **done** = every `after` column except received_date at the stored
  value (`sameStored`: the platform rounds a decimal column to the tenant's rule); **not written** = the row's status,
  open_qty, received_qty, transit_qty equal `before` (`sameVal`, decimals numerically); anything else is a conflict ->
  REQUIRES_REVIEW. L0 needs every update not written; L3 writes the not-written ones and skips the done ones.

### HDR = the header's final write (L4)

```json
{ "id": "2105231525751984129",
  "before": { "stock_movement_status": "Processing", "stock_movement_no": "LOT-20260930/0078" },
  "after":  { "stock_movement_status": "Cancelled", "stock_movement_no": "LOT-20260930/0078-Cancelled" } }
```

`after.stock_movement_status` = saveAs (Completed / In Progress / Cancelled). `after.stock_movement_no` only for CANCEL
(`<no>-Cancelled`, as `update_node_u5YASPXU`); other actions write the status only.

### ITEMS = the Item date stamp (L4)

```json
{ "itemDates": [ { "id": "2064633018934157313", "last_transaction_date": "2026-10-16T03:12:44.120Z" } ] }
```

DIRECT, STAGE, COMPLETE only [design]; `[]` for EDIT / CANCEL. = `code_node_0njluBVP`'s `updates` over the flatLines (unique
`item_selection`, `new Date().toISOString()` at PREPARE time - the classic's own value form; grv2 C5 does the same).

### S|...|LINES = what L2 writes (COMPLETE / EDIT; written by SUBMIT)

```json
{ "v": 1, "lotId": "2105231525751984129",
  "header": { "issuing_operation_faci": "...", "issue_date": "...", "movement_type": "...", "movement_type_id": "...",
              "movement_reason": "...", "issued_by": "...", "reference_documents": [], "organization_id": "...",
              "project_id": "...", "is_production_order": 0, "production_order_id": null, "remarks": "", "remark": "",
              "remark2": "", "remark3": "" },
  "stock_movement": [ "<the filled-back rows, as code_node_yPlLXIZW leaves allData.stock_movement>" ],
  "fingerprint": "LF1:5:0a1b2c3d4e5f6071" }
```

`header` + `stock_movement` = `update_node_TxDhhT03`'s 17 props minus `stock_movement_status` [design: "TxDhhT03's props
minus status"]: `header` holds its 15 header columns (values from the filled-back allData), `stock_movement` the filled-back tree; `fingerprint` =
`incomingFingerprint`. PREPARE's incoming document = stored header + `header` + `stock_movement`.

---------------------------------------------------------------------------------------------------------------------------
## 6. lineFingerprint and the shared helpers (d)

Written ONCE in `code/shared/` (WP0; unit tests `node test/shared/test_shared.js`, live SQL check `python3
test/shared/fp_live.py`). Include a shared file into a code node with `lib/v2build.include_js(<smv2>, "code/shared/x.js")`
(drops the `if (typeof module` export line). Every top-level name is prefixed `lot` / `LOT_`, so it concatenates with a
step's own `s` / `q8` / `list` / `parseJ` (tested against grv2 commit/_common.js + _cmp.js).

| File | Functions |
|---|---|
| `fingerprint.js` | `lotLineFingerprint(lines)` -> `LF1:<line count>:<16 hex>`; `lotFpCanonRows`, `lotFpCanon`, `lotFpHash` |
| `lot_common.js` | `lotS`, `lotQ8` (Number(toFixed(8))), `lotQtyStr` (max(0, q8).toFixed(8) - the ledger's text), `lotDigits`, `lotIdStr` (digit-string ids; an unsafe 19-digit NUMBER -> ""), `lotParseJ` (16+ digit integers read as strings), `lotList`, `lotJsonList` (JSON-text-or-array -> array), `lotRows` (sql `{ j }` rows or objects), `lotCategory` (UNR / BLK), `lotDbAddSeconds`, `LOT_PREV_STATUSES` / `lotPrevStatusOk`, `LOT_CHUNK` / `lotPartRows` / `lotJoinChunks` |
| `movekey.js` | `lotMovementKeyOf(message, keys)`, `lotMapEngineMessage(message, labels, keys)` |
| `sql.py` | `FP_LINES` - the stored lines of one LOT, one `j` per row, id order (tokens `@T`, `@LOT`) |

**lotLineFingerprint** uses, per line: `id`, `line_index`, `item_selection`, `quantity_uom`, `location_id` (target bin), and
per temp_qty_data entry (text or array): `material_id`, `location_id` (source bin), `batch_id`, `category` (UNR / BLK
normalized), `sm_quantity` (q8), `material_uom`, `handling_unit_id`. Lines sorted by id (numeric); entry order kept; a
temp_qty_data that does not parse is fingerprinted as its raw text. Not used: `total_quantity` and every other decimal
column (deviation 3), `parent_id` (bundles are not eligible; form rows do not carry it). The same function works on the
FP_LINES rows, on get-node / adapter lines and on the form's / yPlLXIZW's flatLines.

---------------------------------------------------------------------------------------------------------------------------
## 7. LOT_V2_SUBMIT (e) - synchronous; operations SUBMIT and STATUS

### Request (`request_json`, all strings except `form`)

| Param | Values |
|---|---|
| operation | `SUBMIT` (default) / `STATUS` |
| saveAs | `Draft` / `In Progress` / `Completed` / `Cancelled` (SUBMIT) |
| pageStatus | `Add` / `Edit` / `Clone` (`Copy` = `Clone`) - the form's `page_status`; the list's Cancel sends `Edit` |
| lot_id | digits for Edit, Cancel and STATUS; `''` for Add / Clone |
| idempotency_key | section 3 (required for SUBMIT, optional for STATUS: when given and it has a job, STATUS answers that job) |
| source | `FORM` (default) / `LIST` |
| min_lines | optional digits; absent / invalid / `0` = no effect. A CANCEL whose STORED flat line count (bundle parents excluded: the classic guard's count, `FACTS.line_count`) is <= `min_lines` (and <= 500) answers NOT_ELIGIBLE, reason `classic`, before any write. The list's Cancel sends `50`; other actions ignore it (their 50-line rule is client-side) |
| form | `any`: the form's record (`this.getValues()` minus NOT_RECORD); the list's Cancel: `{ id, stock_movement_status, stock_movement_no, organization_id }` |

### Answer (`response_json`; every field a string)

`route, code, message, reason, action, job_id, job_status, terminal, lot_id, lot_no, line_count, progress_percent,
progress_message, error_code, error_message, evidence`

| route | code | When | Client (D) |
|---|---|---|---|
| QUEUED | 200 | a job was queued and read back (DIRECT / STAGE / COMPLETE / EDIT / CANCEL) | DIRECT / STAGE: close the form at once, kick (an Add / Clone answered without a digit `lot_id`, here or by a non-terminal STATUS: the form stays open, gen + 1, "The save did not complete - please save again."); COMPLETE / EDIT: wait loop; list CANCEL: kick, refresh |
| SAVED | 200 | DRAFT written (no job); lot_id / lot_no of the saved (or twin-winning) LOT | success, close / refresh |
| STATUS | 200 | operation STATUS, or this key already has a job (a repeated click) | non-terminal = as QUEUED; COMPLETED = success; FAILED = show error_message, gen + 1; REQUIRES_REVIEW = warning |
| NOT_ELIGIBLE | 300 | eligibility screen (below), <= 500 lines; a CANCEL of <= `min_lines` stored lines (reason `classic`) | the classic handler via `triggerEvent` [design]; list CANCEL: the classic call (also when SUBMIT gives no usable answer: transport failure twice, or no contract `route`) |
| BUSY | 409 | stored Processing or an open SAVE_LOT job | warning (job_id / job_status / progress of the open job are filled) |
| STALE | 409 | payload status != stored, or stored Completed / Cancelled | warning: reopen the transfer |
| STOP | 400 | a gate, a limit, not cancellable, In Progress -> Draft, lines added, not found, NOT_ELIGIBLE above 500 lines (never for DRAFT) | error message |
| STOP | 500 | the queue writes did not read back | error "please try again" (the next click re-uses the key) |
| INVALID | 400 | the request itself (operation, saveAs, pageStatus, lot_id, key, tenant, form) | classic handler (nothing was written) |

`terminal` = `YES` when job_status is COMPLETED, FAILED, REQUIRES_REVIEW, CANCELLED or NONE (no job), else `NO`. `reason` = the
NOT_ELIGIBLE / STOP reason text. `evidence` = `{ v, workflow, operation, route, code, reason }` JSON (grv2 result.js).
SUBMIT never answers 401. **STATUS answer** = the same fields for one job: the job of `idempotency_key` when given and found,
else the LOT's latest SAVE_LOT job (`correlation_id = LOT|<lot_id>`, max id), else the job named by the LOT's
`lot_v2_job_id`: route STATUS, code 200, action (from its request), job_id, job_status, terminal, lot_id, lot_no,
progress_percent, progress_message, error_code, error_message. No job at all: job_status `NONE`, terminal `YES`, message
`no background save`.

### Write order [design], copied from GR V2 (idempotent)

- **DRAFT** [design: whole document, `'draft'` sentinel, no job]: Add / Clone: ONE add of the classic `add_node_5E9es34x`'s
  columns + `lot_idem_key = <idempotency_key>#<run uuid>`, then the twin read-back (rows with
  `SUBSTRING_INDEX(lot_idem_key, '#', 1) = <key>`): the oldest wins, a losing twin soft-deletes its own row and answers SAVED
  with the winner (copy of grv2/phase2b created/keydup). Edit: ONE update of `update_node_WKLUE7ka`'s columns. Answer SAVED.
  No Item date stamp (deliberate difference).
- **DIRECT / STAGE, Add / Clone:** job insert (the unique idempotency key stops a twin) -> document add of
  `add_node_xxQX3uMU`'s props + `lot_v2_job_id` (header + lines, `stock_movement_status 'Processing'`; the number props
  `stock_movement_no` + `stock_movement_no_type` as the classic's yPlLXIZW leaves them: `'issued'` + rule unless
  `stock_movement_no_type = -9999`) -> read the header back by `lot_v2_job_id` (+ its lines
  with FP_LINES' columns) -> `LOCK|1` -> link (correlation / causation / request + lotId, lotNo, issuedNo, lineFingerprint) -> due (QUEUED
  was inserted at now + 120 s).
- **DIRECT / STAGE, stored Draft:** `LOCK|n+1` (unique) -> job -> update of `update_node_0rtpXydw`'s props +
  `lot_v2_job_id`, `stock_movement_status 'Processing'` (header + lines; its number props `stock_movement_no` +
  `stock_movement_no_type` only when the stored number is not the `issuedNo` of an earlier SAVE_LOT job of this LOT) -> read back
  (header + FP_LINES) -> due (+ lotNo, issuedNo, lineFingerprint).
- **COMPLETE / EDIT:** `LOCK|n+1` -> job -> the `S|<nonce>|LINES|<nnn>` parts -> update (header `stock_movement_status
  'Processing'` + `lot_v2_job_id` ONLY [design]) -> read back (status, job link, latest lock, parts present) -> due. A line
  without an id -> STOP 400 `LOT_LINES_ADDED` before any write [design]; removed lines are allowed [design].
- **CANCEL:** stored flat lines <= `min_lines` (<= 500) -> NOT_ELIGIBLE `classic`, nothing written; else `LOCK|n+1` -> job -> update
  (Processing + `lot_v2_job_id`) -> read back -> due [design: ids only (list)].

The answer after the writes comes from the read-back (grv2 result.js): QUEUED only when the LOT is Processing under this job
(`lot_v2_job_id`), its latest lock is this key and the job is QUEUED; else STOP 500 `LOT_QUEUE_FAILED`. SUBMIT never
unlocks: a job whose SUBMIT stopped after its document write falls due by itself and PREPARE's entry releases the LOT.

### Gates, lifted and run in-process [design]

`code_node_yPlLXIZW` (the fill-back; with the request's real saveAs / pageStatus - Clone as Add; for CANCEL the classic
runs it, and CHECK_REQUIRED_FIELD, over the STORED document `get_node_czmdH3Jw` - SUBMIT does the same from its SQL read),
`code_node_kuH3MokM` + CHECK_REQUIRED_FIELD v8 (`base/CHECK_REQUIRED_FIELD.v8.json`, `code_node_AeSdXE85`; the classic answers its
`data.message` with 400), `code_node_i8zWlzBw` (not Draft or Cancel: location 400, quantity 400), `code_node_LOTqtyComplete`
(DIRECT / STAGE: 400). Same codes and texts as the classic's return nodes (section 10).

### Checks done in SQL [design] (not left to PREPARE, so retries don't loop)

- **Eligibility** (user decision #3): HU entries (temp_hu_data / handling_unit_id), bundle lines (item_bundle_id /
  children), rows needing auto-allocation (requested_qty > 0, empty temp_qty_data, has an item), serialized items,
  production-order-linked transfers (`is_production_order`), items needing costing migration (the `cost` screen copied from
  `scratchpad/pwv2/prepare/sql.py` SUBMIT_SQL["cost"], keyed on the entries' material / batch at the LOT's plant), entry
  categories other than Unrestricted / Blocked -> NOT_ELIGIBLE (<= 500 lines; above -> STOP `LOT_TOO_BIG` with the reason).
  A DRAFT is never refused for size / eligibility: always NOT_ELIGIBLE (deviation 10).
- **WA without a WA row at the plant** (`wa_costing_method` by material + plant + org [+ batch], as
  GLOBAL_INVENTORY_VALIDATION's search_node_GIVWa*) -> STOP 400 with GLOBAL_INVENTORY_VALIDATION's message (section 10).
  DIRECT and STAGE only (ruling 1: the classic prechecks only there, `if_PYPLDh47`); COMPLETE / EDIT / CANCEL do not check
  it (the classic prices such a SUBTRACT at 0 too).

### Limits [design]

STOP 400 `LOT_SPLIT_REQUIRED` when rows > 2,500 or movements > 5,000 ("split the transfer") - DIRECT / STAGE / COMPLETE /
EDIT / CANCEL; a DRAFT over a limit answers NOT_ELIGIBLE (deviation 10). Movements = 2 x the entries
with sm_quantity > 0 (DIRECT / STAGE / CANCEL: the lines' entries; COMPLETE: the incoming entries + the reconcile pairs;
EDIT: the reconcile pairs). The reconcile pair count is exact only by running `code_node_uht83Wzh` (pure; its ledger input
does not change the movement count) - B runs it lifted; PREPARE recounts and refuses > 5,000 as a backstop.

### V2.1 bundles (B, 2026-10-19; supersedes the bundle / auto-allocation lines above)

- **Eligibility:** bundle lines and rows needing auto-allocation are NO LONGER NOT_ELIGIBLE.
  - Still screened: HU, serial (line flag and item), production order, costing migration, entry categories, limits.
  - "Needs allocation" = `code_node_LOTallocPrep`'s rule (`lotNeedsAlloc`): requested_qty > 0, temp_qty_data not a
    non-empty / non-`[]` string, item_selection set. PREPARE allocates these lines; SUBMIT writes them unpicked.
- **Gates:** the classic allocates before `i8zWlzBw` / `LOTqtyComplete`. In SUBMIT, an allocation line reaches them as picked
  (sm_quantity = requested_qty), so the location / quantity / lines-without-stock texts are the classic's post-allocation
  ones.
- **Item screens for allocation lines** (their batch is unknown until PREPARE):
  - serial → NOT_ELIGIBLE;
  - costing migration → checked on the (item, no batch) key for non-batch items only;
  - DIRECT / STAGE: a WA item with no WA row at the plant at all → STOP `LOT_NO_WA_RECORD` (GLOBAL_INVENTORY_VALIDATION's
    text without the batch part).
  - A batch item's per-batch WA and costing checks happen after allocation (PREPARE / the engine).
- **Counts:** lineCount = flat lines (bundle parents excluded, children included; the guard's rule).
  - An allocation line = 1 row, 2 movements.
  - DIRECT / STAGE / DRAFT: movements = 2 × (picked entries + allocation lines).
  - COMPLETE: 2 × (incoming picked entries + allocation lines + reconcile pairs). EDIT: 2 × (reconcile pairs + allocation
    lines).
  - The reconcile estimate leaves allocation lines out on both sides.
  - CANCEL counts the STORED rows minus stored bundle parents (`item_bundle_id` set and no `parent_id`).
  - PREPARE enforces the real 5,000 cap after allocation.
- **Writes:** DIRECT / STAGE write `allData.stock_movement` as the tree (parents with nested `children`, fm_key /
  parent_fm_key, bundle fields), exactly as the classic's `add_node_xxQX3uMU` / `update_node_0rtpXydw` receive it from
  yPlLXIZW. The S|..|LINES `stock_movement` is the same tree.
- **Fingerprints are per STORED ROW, bundle parents included,** because FP_LINES reads every row back.
  - lineFingerprint is unchanged (stored rows).
  - **incomingFingerprint (COMPLETE / EDIT) = `lotLineFingerprint` over every row of the filled-back tree (parents +
    children), not over flatLines** (section 3's "flatLines" wording).
  - For a LOT without bundles the two are the same rows, so nothing changes there.
- **COMPLETE / EDIT:** every row of the incoming tree (bundle parents included) must be a stored row: a row without an id,
  or with an unknown id, is STOP 400 `LOT_LINES_ADDED`. A stored row arriving unpicked (the client cleared a child's
  picks after a parent qty change) is an allocation line: allowed.
- **For A / C (not SUBMIT's to fix):**
  1. Stored bundle children have `item_bundle_id` + `parent_id` but no `parent_fm_key`. The table has no fm_key columns; see
     get_node_LOTmainLines in dev run 2105231522690142210. yPlLXIZW's `isBundleParent` (`item_bundle_id && !parent_fm_key`)
     therefore drops them from flatLines whenever it runs over a STORED document.
     - This hits PREPARE's DIRECT / STAGE / CANCEL lift over the stored doc: bundle children would move nothing.
     - The classic's own CANCEL of a bundle LOT has the same latent defect.
  2. incomingFingerprint is the pre-allocation tree. When PREPARE merges allocated picks into the lines L2 writes, L2's
     read-back will not equal it; the post-allocation fingerprint must come from PREPARE (manifest).

---------------------------------------------------------------------------------------------------------------------------
## 8. LOT_V2_WORKER (f)

**Call:** `{ job_id: "<digits>" | "" }` - a job id drives that job only (the form's kick); empty drains up to 5 due SAVE_LOT
jobs of the session tenant, oldest first, within a 20 s tick budget (grv2).

**Answer** (strings): `worker_route` (`REJECTED` / `IDLE` / `WORKED`), `processed` (count of planned jobs), `jobs` (JSON text:
`[{ job_id, before, job_status, error_code, lot_id, attempt_count }]`), `job_id` / `job_status` / `result_code` /
`result_message` / `lot_id` of the first planned job, `evidence`. (grv2 result.js with `gr_id` -> `lot_id`.)

**Built by** `lib/v2build.build_worker(cfg)` from the GR worker [design], with these values (SQL checked read-only on dev):

```python
LOT_LOCK_JOIN = """LEFT JOIN sm_location_transfer g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^LOT\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SMLT|', SUBSTRING(j.correlation_id, 5)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
LOT_ID_COL = "(CASE WHEN g.stock_movement_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
LOT_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
cfg = V.worker_config(name="LOT_V2_WORKER", code_dir="<smv2>/code/worker", ids_base=<C's choice>, command="SAVE_LOT",
                      states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT"], lock_join=LOT_LOCK_JOIN,
                      id_col=LOT_ID_COL, prev_col=LOT_PREV_COL, corr_offset=5, id_alias="gr_id",
                      prepare=("LOT_V2_PREPARE", ids["LOT_V2_PREPARE"]), commit=("LOT_V2_COMMIT", ids["LOT_V2_COMMIT"]),
                      unlock=V.status_unlock("Location Transfer:Table:2013791389687349250", "stock_movement_status",
                                             {"stock_movement_status": "Stock Movement Status"}),
                      cache_prefix="lot_wrk_", renames=[("gr_id", "lot_id"), <C: node-id prefix, GR texts>])
```

Changes to the GR worker JS (`code/worker_src_grv2` -> C's `code/worker`) [design]: command `SAVE_LOT`, state
`COMMITTING_LOT`, the `LOT|` regex, `SUBSTRING(correlation_id, 5)` (also the final read, deviation 1), error prefix `LOT_`
with the hard-code list of section 10, and **no `prevStatus || "Draft"` default**: workerItem (plan.js, pick.js), claim.js
(base + unlock rows), after_prepare.js and after_publish.js unlock rows (deviation 4) - an unlock is written only when
`lotPrevStatusOk(prevStatus)`; otherwise the FAILED it would have written becomes REQUIRES_REVIEW `LOT_PREV_STATUS_UNKNOWN`.

**Tick rule** [design]: a tick runs PREPARE, then COMMIT A, then COMMIT B; it ends after COMMIT A when the job has more than
1,000 lines (node-data budget); the client re-kicks. Mechanism (deviation 2): COMMIT L1's hand-over row is
- `manifest.lineCount <= 1000`: SPLIT - `lease_owner SPLIT|<nonce>`, `lease_expires_at` = lease_until, `next_attempt_at`
  null, COMMITTING_LOT, progress 80 (GR); the worker's split.js calls COMMIT again in the same tick (unchanged);
- `manifest.lineCount > 1000`: PARK - `lease_owner` null, `lease_expires_at` null, `next_attempt_at` = db_now, COMMITTING_LOT,
  progress 80, message "Stock moved; the lines and the In Transit ledger are saved next". split.js sees no `SPLIT|` lease
  and ends the tick; the next tick's poll takes it (no lease, due) and the unchanged RESUME path (claim -> own -> mid:
  COMMITTING_LOT without a live lease) calls COMMIT for phase B. No retry is counted.
Both hand-over rows reset `attempt_count` to 0 (deviation 9).

---------------------------------------------------------------------------------------------------------------------------
## 9. LOT_V2_PREPARE and LOT_V2_COMMIT (g) - called by the worker only

| Workflow | Request | Answer (strings) |
|---|---|---|
| LOT_V2_PREPARE | `job_id` (digits) of a VALIDATING SAVE_LOT job the worker holds | `job_id, job_status, result_code, result_message, evidence` - the job row read back after the write is the truth (grv2 prepare/result.js) |
| LOT_V2_COMMIT | `job_id` (digits) of a READY_TO_COMMIT job, or COMMITTING_LOT to resume | `job_id, job_status, path, result_code, result_message, evidence` (`RES_FIELDS`); path = `REJECTED_INPUT` / `NO_WRITE` / `ENTRY_END` / `LOST` / `L<n>_END` / `L<n>PL_END` / `SPLIT` / `PARK` / `DONE` |

The worker never trusts an answer: it reads the job row back after each call (grv2).

### PREPARE [design]

- **Guard / entry** (grv2 prepare/entry.js): a VALIDATING `SAVE_LOT` job under a live lease; `correlation_id LOT|<id>` ->
  the LOT. No correlation (SUBMIT died before "link") -> the LOT found by `lot_v2_job_id = <jobId>`, Processing -> FAILED +
  unlock (`LOT_INVALID_REQUEST` "the save stopped before the Location Transfer was linked to its job: please save it
  again"). An unreadable request or a bad prevStatus -> FAILED (prevStatus bad: REQUIRES_REVIEW, no unlock).
- **Reads** [design]: ONE fork-join of uncapped SQL reads (`JSON_OBJECT` rows): the job and its payload parts; the header and
  stored lines; every `in_transit_detail` row of the document, all statuses (as the classic's search: `doc_id = '<lotId>'`,
  organization_id, not deleted; no doc_type filter); items (id, code, name, desc - `material_code`, `material_name`,
  `material_desc`, what the Enrich nodes read); and the plant's bins (id, `bin_location_combine`) for LABELS.
- **Lock check:** the job owns the LOT (section 4); else FAILED `LOT_NOT_LOCKED`, no unlock.
- **Adapter** (golden-tested) [design]: rebuild the get-node document (header + nested `stock_movement`, line_index order;
  ids of 16+ digits as digit strings, decimals as NUMBERS, JSON columns parsed); rebuild the search-node ledger rows
  (decimals NUMBERS - `open_qty + delta` concatenates strings; ids, material_id, batch_id, transit_bin exact strings;
  `transit_date` `YYYY-MM-DD HH:MM:SS`); **set the status to the job's prevStatus, never Processing** (Processing turns STAGE
  into DIRECT and skips the reconcile).
- **Lift context:** the lifted bodies run with `workflowparams = { allData, saveAs: request.saveAs, pageStatus: "Edit" }` -
  the document exists after SUBMIT, so the classic's Add branches (`add_node_xxQX3uMU`) are never taken - and the get-node
  outputs (`get_node_czmdH3Jw`, `get_node_Ij7YbXCA`, `get_node_lvTzXllZ`, `get_node_LOTmainLines`) = the rebuilt STORED
  document. `allData` = the stored document (DIRECT, STAGE, CANCEL) or stored header + S part (COMPLETE, EDIT).
- **Lifted v82 bodies** (`lib/lift`) [design]: `yPlLXIZW` all; `uht83Wzh` + `LOTreconEnrich` EDIT, COMPLETE; `LOTmainDocId`
  + `LOTmainCompute` + `LOTmainEnrich` DIRECT, STAGE, COMPLETE; `LOTcancelCompute` CANCEL. A shortage answer fails the job
  with the classic text (`LOT_TRANSIT_SHORTAGE` / `LOT_RECON_SHORTAGE`).
- **COMPLETE fold (P4)** [design]: apply the reconcile's ledger operations to the in-memory ledger first (creates get the
  ids `new:<k>`); run LOTmainCompute on that ledger; fold (a create then close = one insert; an adjust then close = one
  update); reconcile pairs first in the movement list.
- **No engine PLAN** [design]. **Ready** -> READY_TO_COMMIT with ENGINE, LABELS, IT, HDR, ITEMS (section 5); a failure ->
  FAILED + unlock (grv2 prepare/ready.js). > 5,000 movements -> FAILED `LOT_SPLIT_REQUIRED`. A plan that throws ->
  `LOT_PLAN_BROKEN`, with the unlock only when the throw came after the lock check passed.

### COMMIT [design]

Each step reads its part and fresh rows; compares (at the after-value = done, at the before-value = write, otherwise
conflict -> REVIEW); writes; reads back; writes a `<STEP> DONE` row. Step framework of pwv2 / grv2 commit.

| Step | Phase | Reads | Writes | Done when / failure |
|---|---|---|---|---|
| entry | - | job (+ db clock, lease_until, due), its `L` step rows, the manifest, the LOT's status / lot_v2_job_id / latest lock | lease claim `PUB|<nonce>`, COMMITTING_LOT, progress 70 / 85 | manifest invalid / LOT not owned before L1 -> FAILED + unlock; after L1 -> REQUIRES_REVIEW; no `LF1:` lineFingerprint, or COMPLETE / EDIT without a non-empty `sparts.LINES` -> clean FAILED `LOT_INVALID_REQUEST` (+ unlock, before L1) |
| L0_REVALIDATE | A | the LOT (lock owner, Processing), FP_LINES, the IT part + its updates' rows by id | - | owner = this job and Processing; every IT update not written (status / open_qty / received_qty / transit_qty at `before`, `sameVal`); `lotLineFingerprint(stored) = request.lineFingerprint` -> DONE; else FAILED + unlock (`LOT_NOT_LOCKED` / `LOT_LEDGER_CHANGED` / `LOT_LINES_CHANGED`) |
| L1_INVENTORY | A | ENGINE part; `IBA|I|%` count of `SMLT|<jobId>`; LABELS part only after a 400 | INVENTORY_BULK_APPLY APPLY `SMLT|<jobId>` (skipped with 0 movements) | 200 (incl. REPLAYED) -> DONE + SPLIT / PARK; 409 -> intents > 0 ? retry -> review : attempts >= 8 ? FAILED + unlock `LOT_INVENTORY_LOCK_BUSY` : lockWait (next_attempt_at = now + min(300, 15 x 2^n) s, attempt + 1, `LOT_LOCK_WAIT`); 400 -> `failNoWrite`: FAILED + unlock + the mapped message, code `LOT_INVENTORY_<engine result_code>`; anything else (500 / no answer) -> REQUIRES_REVIEW (gde e1.js) |
| L2_LINES | B | S LINES part; FP_LINES | ONE update of Location Transfer by id with `TxDhhT03`'s props minus status (the part's header + stock_movement) - never sliced: rows missing from the call get soft-deleted | COMPLETE / EDIT only. Before: stored fingerprint must be `lineFingerprint` (not written yet) or `incomingFingerprint` (written by an earlier attempt) - both write (the same content again is harmless); anything else -> REQUIRES_REVIEW. After: read back = `incomingFingerprint` -> DONE; else retry -> review |
| L3_LEDGER | B | IT part; the updates' rows by id; rows `job_line_key LIKE '<jobId>|%'` | IT updates by id (the `after` columns), IT creates (add), slices <= 250 | STAGE inserts by job_line_key; COMPLETE closes by id (incl. folded creates / updates); CANCEL Cancelled + open_qty 0; EDIT creates / adjusts [design]. Per pwv2 p3_plan.js: an update done (every `after` column but received_date, `sameStored`) is skipped, one not written (status / open_qty / received_qty / transit_qty at `before`, `sameVal`) is written, else REQUIRES_REVIEW; a create is added unless its job_line_key exists. Read back (p3_check.js): every update done, every create exactly once -> DONE |
| L4_FINISH | B | HDR + ITEMS parts; the header now | Item `last_transaction_date` (slices <= 250; DIRECT / STAGE / COMPLETE), then the header (status; CANCEL + number) | header at `after` -> DONE; at `before` -> write; else REQUIRES_REVIEW |
| finish | B | - | job COMPLETED, progress 100, finished_at, lease released | the header write was the unlock [design: "Unlock, then the job is COMPLETED"] |

**V2.1 bundles (L2, 2026-10-19).** PREPARE writes the ALLOC part `P|<nonce>|ALLOC|<nnn>` only when it auto-allocated rows (bundle
children with no stock picked): `{ "lines": [{ "id", "fm_key", "temp_qty_data": "<JSON text>", "total_quantity": <number> }],
"fingerprint": "LF1:..." }` (fingerprint = `lotLineFingerprint` of the merged lines). `manifest.parts.ALLOC` is optional; when
present it must be a non-empty list and the action not CANCEL, else the manifest is refused (FAILED before L1 / REVIEW after).
- L2 runs for COMPLETE / EDIT as before, and for DIRECT / STAGE when ALLOC exists (the stored picks must be the allocated ones:
  a later reconcile / cancel compares them). It runs in phase B (after L1), before L3.
- DIRECT / STAGE: reads the stored lines fresh with every line-schema column (minus the audit / tenant / parent-document
  columns: a column missing from a written row is stored NULL) and the header's `TxDhhT03` columns; writes ONE whole-subform
  update of ALL rows, as the classic sends `stock_movement` (top-level rows, bundle children nested under `children`, ids and
  `parent_id` kept), each ALLOC line's `temp_qty_data` + `total_quantity` set by id. Before: the stored lines at
  `lineFingerprint` with the ALLOC lines read blank (they had no stock picked), each ALLOC line blank or already at its picks;
  every ALLOC line at its picks (and the fingerprint) -> done without writing; else REQUIRES_REVIEW.
- COMPLETE / EDIT: the ALLOC values are merged into the `S|..|LINES` lines by id before the write.
- Target: `ALLOC.fingerprint` (checked against the merged lines before the write; without it: DIRECT / STAGE = `lineFingerprint`
  with the ALLOC lines blank, COMPLETE / EDIT = the merged lines), else `incomingFingerprint`. Fingerprints of the S tree and
  of the read-back are taken over every row or over the flat lines (bundle parents out, = yPlLXIZW's flatLines, which B's
  `incomingFingerprint` uses); either may equal the target. Without bundles the two views are the same rows.
- Done: read back at the target, every ALLOC line at its `temp_qty_data` text and `total_quantity` (numerically, `sameStored`),
  every row under the parent it was written under. No ALLOC part: as before.

Phase A ends after L1 (SPLIT / PARK). Phase B never unlocks and never fails: a step that does not complete retries with
backoff (2 s x 2^n, max 30 s, 3 retries) and then goes to REQUIRES_REVIEW `LOT_RECONCILIATION_MISMATCH` (grv2 stepEnd).
`failNoWrite` (phase A only) = job FAILED (progress_message `Not completed: <reason>`) + `{ id, stock_movement_status:
prevStatus }` when the job still owns the LOT and prevStatus is valid.

**REQUIRES_REVIEW runbook** [design]: clear the engine's `IBA|REVIEW` row, reset the job, re-kick (as on GR 10-15); prod is
SELECT-only, so prod recovery goes through the platform. A LOT in REQUIRES_REVIEW keeps the engine's locks (it blocks
GD / GR / Putaway V2 on those items) and stays Processing.

---------------------------------------------------------------------------------------------------------------------------
## 10. Error codes (h) - `job.error_code` / SUBMIT `error_code`; the message is what the user reads

| Code | Where | Route / job | User-facing message |
|---|---|---|---|
| LOT_INVALID_REQUEST | SUBMIT guard; PREPARE entry; COMMIT entry | INVALID 400; FAILED | SUBMIT: what is wrong ("saveAs must be Draft, In Progress, Completed or Cancelled" ...); PREPARE: "The save stopped before the Location Transfer was linked to its job: please save it again."; COMMIT (no `sparts.LINES` for COMPLETE / EDIT): "The lines of this save are missing: nothing was moved, please save it again."; COMMIT (no lineFingerprint): "The save has no line fingerprint: nothing was moved, please save it again." |
| LOT_NOT_FOUND | SUBMIT; PREPARE | STOP 400; FAILED | "Location Transfer not found - it may have been deleted." |
| LOT_BUSY | SUBMIT; classic guard | BUSY 409; classic 400 | "This Location Transfer is being processed in the background - please wait for it to finish." [design text] |
| LOT_UNDER_REVIEW | SUBMIT | BUSY 409 | "Its last save stopped half-way and is under review: please contact support." |
| LOT_STALE | SUBMIT | STALE 409 | "This Location Transfer was changed by someone else (it is now <status>). Please close it and open it again." |
| LOT_ALREADY_FINAL | SUBMIT | STALE 409 | "This Location Transfer is already <Completed / Cancelled>." |
| LOT_NOT_ELIGIBLE | SUBMIT | NOT_ELIGIBLE 300 | the reason (goes to the classic save) |
| LOT_TOO_BIG | SUBMIT (not DRAFT) | STOP 400 | "This Location Transfer has <n> lines and cannot be saved in the background (<reason>); the classic save handles at most 500 lines." |
| LOT_CLASSIC_TOO_BIG | classic guard | classic 400 | "This Location Transfer has <n> lines. A save of more than 500 lines is not supported here - please split it into smaller transfers." |
| LOT_SPLIT_REQUIRED | SUBMIT (not DRAFT); PREPARE | STOP 400; FAILED | "This Location Transfer has <rows> stock rows (<movements> stock movements). At most 2,500 rows and 5,000 movements can be saved at once - please split the transfer." |
| LOT_LINES_ADDED | SUBMIT | STOP 400 | "Lines can't be added to an In Progress transfer." [design] |
| LOT_NOT_CANCELLABLE | SUBMIT | STOP 400 | "Only an In Progress Location Transfer can be cancelled." |
| LOT_IP_TO_DRAFT | SUBMIT | STOP 400 | "An In Progress transfer can't be saved back to Draft." |
| LOT_REQUIRED_FIELDS | SUBMIT | STOP 400 | CHECK_REQUIRED_FIELD's `data.message` (classic return_node_aQxrHqh2) |
| LOT_LOCATION_REQUIRED | SUBMIT | STOP 400 | `code_node_i8zWlzBw` locationMessage ("Location ID is required for item <i> in Location Transfer") |
| LOT_NO_QUANTITY | SUBMIT | STOP 400 | "No quantity selected to transfer" |
| LOT_LINES_WITHOUT_STOCK | SUBMIT | STOP 400 | `code_node_LOTqtyComplete` incompleteMessage ("No stock selected for line <n>. Select stock for every line before saving.") |
| LOT_NO_WA_RECORD | SUBMIT (DIRECT / STAGE) | STOP 400 | GLOBAL_INVENTORY_VALIDATION v11's text: "No Weighted Average costing record for item <code> at this plant[ (batch <id>)]. The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock." |
| LOT_QUEUE_FAILED | SUBMIT | STOP 500 | "The save could not be queued: please try again." |
| LOT_NOT_LOCKED | PREPARE; COMMIT | FAILED | "The Location Transfer is no longer locked by this save: nothing was moved." |
| LOT_LINES_CHANGED | COMMIT L0 | FAILED | "The Location Transfer's lines changed while it was waiting: nothing was moved, please save it again." |
| LOT_LEDGER_CHANGED | COMMIT L0 | FAILED | "Its In Transit stock changed while it was waiting: nothing was moved, please save it again." |
| LOT_TRANSIT_SHORTAGE | PREPARE | FAILED | "Insufficient In Transit quantity to complete this Location Transfer." [classic return_node_LOTmainShort] |
| LOT_RECON_SHORTAGE | PREPARE | FAILED | "In Transit reconcile shortage on Location Transfer edit." [classic return_node_LOTreconShort] |
| LOT_PLAN_FAILED / LOT_PLAN_BROKEN | PREPARE | FAILED | "The save could not be prepared: <reason>" (internal invariant broken: BROKEN) |
| LOT_INVENTORY_<engine code> | COMMIT L1 400 | FAILED | the mapped engine message (section 5 LABELS), e.g. "Insufficient quantity - line 4 (FG-0042), from bin A1-B2-C3 (Unrestricted)" |
| LOT_INVENTORY_LOCK_BUSY | COMMIT L1 | FAILED | "The stock of its items stayed locked by another operation: nothing was moved, save it again later." |
| LOT_LOCK_WAIT, LOT_STEP_RETRY, LOT_WAIT, LOT_TRANSIENT | COMMIT / WORKER | transient (job stays open) | progress_message only |
| LOT_TRANSIENT_RETRIES_EXHAUSTED | WORKER | FAILED | "Temporary failures persisted; not saved." |
| LOT_RECONCILIATION_MISMATCH | COMMIT / WORKER | REQUIRES_REVIEW | "Under review: the save stopped half-way. Please contact support." |
| LOT_PREV_STATUS_UNKNOWN | any unlock | REQUIRES_REVIEW | "Under review: the status to restore is unknown. Please contact support." |
| LOT_INVALID_DATA | guards / entries | answer only / FAILED | internal (job not found, bad id, ...) |
| JOB_ILLEGAL_TRANSITION, JOB_ROW_VERSION_CONFLICT | shared (grv2) | answer only | internal |

Worker hard codes (fail at once, no retry; grv2 `PKC.hard`): `LOT_INVALID_REQUEST, LOT_INVALID_DATA, LOT_NOT_FOUND,
LOT_NOT_LOCKED, LOT_NOT_ELIGIBLE, LOT_LINES_CHANGED, LOT_LEDGER_CHANGED, LOT_TRANSIT_SHORTAGE, LOT_RECON_SHORTAGE,
LOT_SPLIT_REQUIRED, LOT_PLAN_BROKEN, JOB_ILLEGAL_TRANSITION`.

---------------------------------------------------------------------------------------------------------------------------
## 11. Classic guard (B) [design]

`AsyncV2/SM_LOCATION_TRANSFER.json` = `base/SM_LOCATION_TRANSFER.v82.json` + new first nodes, BEFORE `if_UCLsQLO6` and
`if_LOTallocGate`. If `allData.id` is digits: read the STORED `stock_movement_status` plus the stored line count, in one SQL;
Processing -> 400 `LOT_BUSY` text. More than 500 lines, counting stored lines for Cancel (its payload has none) -> 400
`LOT_CLASSIC_TOO_BIG` text. Draft is exempt from the 500 cap (classic Draft has no per-line loop). It reads only
`sm_location_transfer` (+ its line table) - NOT `gd_async_job`, so a prod LOT save can't break if that table is ever
missing (prod has no gd_async_job today, `base/refs.md`). Use 400, never 401 (mobile Misc Issue / Receipt treat 401 as a
prompt). Answer shape = the classic's `{ code, message }`. Not fixed: `code_node_OHjnEcVJ` loops `subformData` but declares
`subFormData` (user decision #5).

---------------------------------------------------------------------------------------------------------------------------
## 12. Client (D) [design], with the GR / GD Edit templates

- `lotV2_onClick_save` wraps the Draft, In Progress and Completed buttons; the list wraps Cancel. V2 when all hold:
  `ASYNC_LOT_ENABLED`, the per-action switch is ON, more than 50 flat stock lines, no HU or bundle rows. Anything else,
  including any exception before SUBMIT, a NOT_ELIGIBLE or an INVALID answer, goes to the classic handler through
  `triggerEvent`. Cut line: an action that isn't green on Tuesday ships OFF (order of confidence: DIRECT, STAGE, COMPLETE
  without edits, CANCEL, EDIT, COMPLETE_EDITED, DRAFT).
- COMPLETE vs COMPLETE_EDITED is decided client-side before SUBMIT: `lotLineFingerprint` (include
  `code/shared/fingerprint.js`) of the form's lines at mount vs at the click.
- DIRECT / STAGE / DRAFT: close the form at once and kick the worker (a failed Add leaves a Draft holding every line: the form
  must close or reload, never stay in Add mode). Exception: an Add / Clone whose QUEUED (or running STATUS) answer has no
  digit `lot_id` stays open, gen + 1, "The save did not complete - please save again.". COMPLETE / EDIT: wait for the verdict - STATUS every 2-3 s up to 180 s,
  re-kicking the worker every 15 s; verdict = a terminal job_status, or COMMITTING_LOT with progress_percent >= 80 (the stock
  moved); FAILED -> error shown, form and edits intact. Kick loop: WORKER `{ job_id }` until terminal, at most 10 calls.
- Mounted: the Processing view (read-only, the new badge, STATUS, re-kick every 15 s); a FAILED job shown once per browser.
- List 2013863255693197313 (live v47; the designing v48 differs only in the Print button's display attributes - check before
  publishing over it): mounted kick (throttled 2 min, chained while `processed > 0`), the Processing badge and filter,
  `Cancel.js` -> SUBMIT CANCEL (`min_lines` 50), NOT_ELIGIBLE or no usable answer -> the existing classic call (the guarded
  classic refuses a LOT that SUBMIT already made Processing). The v47 handler `bulkCancel_LOT` is identical to the repo's
  Cancel.js.
- Deploy order: the form publish (fields + the `Processing` option) must land before any V2 save writes `Processing`
  (a select stores a value it cannot label as a blank cell).

---------------------------------------------------------------------------------------------------------------------------
## 13. File ownership and the build (i)

| Owner | Files (all under `scratchpad/smv2/` unless a repo path is given) |
|---|---|
| WP0 / controller | `CONTRACT.md`, `ids.json`, `build_lot.py`, `lib/`, `base/`, `code/shared/`, `code/worker_src_grv2/`, `test/lib_smoke.py`, `test/shared/`; integration: `Stock Movement/Location Transfer/AsyncV2/ids.json`, `AsyncV2/README.md` |
| A - PREPARE | `build_prepare.py`, `code/prepare/`, `prepare/` (its SQL), `lift/` (lift config + lifted output), `test/prepare/` |
| B - SUBMIT + guarded classic | `build_submit.py`, `build_classic.py`, `code/submit/`, `code/classic/`, `submit/` (its SQL), `test/submit/` |
| C - COMMIT + WORKER | `build_commit.py`, `build_worker.py`, `code/commit/`, `code/worker/`, `commit/` (its SQL), `test/commit/` |
| D - client | `client/` (+ its tests), `Stock Movement/Location Transfer/AsyncV2/*.js`, `AsyncV2/LOTform.json`, `AsyncV2/LOTlistPage.json`, `Bulk Actions/Warehouse Management/Location Transfer/Cancel.js` |
| E - checks | `parity/`, `live/` |

Never touched: `Stock Movement/Location Transfer/LOTsaveWorkflow.json`, `LOTfullJSON.json` (they hold the unreleased Stock
Picking branch); scratchpad/gdc, grv2, pwv2, grrv, gde.

**Build:** `python3 scratchpad/smv2/build_lot.py [--write] [NAME ...]` imports `build_prepare` (A), `build_commit`,
`build_worker` (C), `build_submit`, `build_classic` (B) in that order; each exposes `BUILDERS = [("<NAME>", fn)]` with
NAME = LOT_V2_PREPARE / LOT_V2_COMMIT / LOT_V2_WORKER / LOT_V2_SUBMIT / SM_LOCATION_TRANSFER; `fn()` returns the FlowGram dict
(raise NotImplementedError to be skipped). Output: `Stock Movement/Location Transfer/AsyncV2/<NAME>.json` (indent 1).
Before a publish: `python3 scratchpad/validate.py <file>` and `lib/sqlcheck.py` on dev; published with
`.dbtools/wf_upload.mjs` (a compile-made sql-node never runs) - the user's yes per batch.

---------------------------------------------------------------------------------------------------------------------------
## 14. SQL conventions and the node-data budget (j)

1. Every table read is tenant-scoped: `<alias>.tenant_id = '{{node:<guard>.data.tenantId}}'` (the guard checked
   `{{system:tenantId}}` is digits), and `is_deleted = 0` on every document / line / ledger / step row (a job row is read by
   id and its `is_deleted` checked in code, grv2). Ledger reads also scope `organization_id` (as the classic).
2. Ids out of SQL: `CAST(x.id AS CHAR)` for every bigint id / FK; rows as `JSON_OBJECT(...) AS j`, parsed with
   `lotRows` / `parseJ` (16+ digit integers quoted). Never hand a bigint to JS as a number.
3. Ids into SQL: bare digit lists (`IN (0, 2105231525751984129)`, `'0'` / `0` for "none") built in a code node from
   digit-checked values; a varchar id column (doc_id, job_id, correlation_id) compared with a quoted digit string.
4. `COLLATE utf8mb4_general_ci` on every CAST / CONCAT / JSON_TABLE-made string compared with a column
   (`c.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)`).
5. A statement starts with SELECT or WITH (sql-nodes are read-only: "Only SELECT/WITH statements are allowed") and never
   holds the word SET anywhere (`CHARACTER SET` included: use `CONVERT(x USING utf8mb4)`; `scratchpad/validate.py`
   SQLSTART checks both).
6. Placeholders are hand-quoted in SQL (`'{{node:x.data.tenantId}}'`), never quoted in code nodes. No free text (names,
   remarks, document numbers, JSON) is ever substituted into SQL - only digits and the fixed keys above.
7. Lines <= 160 characters: `lib/v2build.wrap_doc_sql` breaks long lines after `, ` outside quotes (the platform's addDraft
   failed on a 5,681-character line, 2026-10-14). `build_lot.py` applies it.
8. No row caps on business reads (uncapped SQL; search-node limits are not applied anyway); `LIMIT 1` only for "the latest
   X" subqueries with `ORDER BY id DESC`.
9. Times from the DB clock (`NOW(3)` -> `db_now`, `DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s')`), never the JS clock - except the
   Item date stamp, which copies the classic's `new Date().toISOString()`.
10. Decimals written by us: computed values q8, ledger values `qtyStr` strings (the classic's forms); read-backs compared
    with `sameStored`. `sameVal` (COMMIT `_cmp.js`): a fraction's trailing zeros dropped, then numbers at 8 dp; 16+ digit
    integers (ids) exact text.

**Node-data budget** [design] (2,000-line estimates): SUBMIT 10-15 MB, PREPARE (no PLAN) ~12-20 MB, COMMIT A 12-15 MB,
COMMIT B 10-15 MB. The split tick above 1,000 lines keeps each synchronous chain at about 35 MB or less (the dev crashes
started near 60 MB); the 2k test measures it. Rules that keep it there: a part is read only by the step that needs it
(LABELS only after a 400), writes go in slices of <= 250 rows (L2 is one call by necessity), lines never enter the manifest,
code nodes reference a big input once, and the SUBMIT S part holds only the L2 props.

---------------------------------------------------------------------------------------------------------------------------
## Contract deviations

Each item: what the design says, what the code shows (evidence), what this contract does. Raised with the controller.

1. **`SUBSTRING(correlation_id, 5)` list is incomplete.** The design names `build_grv2.py` l.185, 188, 200, 465, 468. The
   worker scaffolding also reads `SUBSTRING(j.correlation_id, 4) AS gr_id` in its final read (`build_grv2.py` l.586); left
   at 4, every WORKER answer would carry `lot_id = "|<id>"`. (l.185 / 188 / 200 are GR COMMIT SQL and l.871 / 874 GR SUBMIT
   SQL - only relevant if copied.) Fix: `lib/v2build.build_worker` takes `corr_offset`; the LOT config uses 5 (section 8; a
   worker built with that config has 17 `SUBSTRING(j.correlation_id, 5)` and none with 4, and its 9 SQL nodes ran on dev).
2. **Ending the tick after COMMIT A leaves a live 10-minute `SPLIT|` lease.** GR's COMMIT hands over with `lease_owner
   SPLIT|<nonce>`, `lease_expires_at = now + 10 min` (`grv2/code/commit/c2.js`); the worker's poll skips a live lease
   (`build_grv2.py` l.545), pick.js skips it, and claim.js counts an expired lease as a retry. A tick that stops after COMMIT
   A would leave a > 1,000-line job untouched for 10 minutes and then burn a retry. Fix: COMMIT L1 PARKs instead
   (lease cleared, due now) when `lineCount > 1000`; the unchanged worker ends the tick and resumes through RESUME (section 8).
3. **"qty" in the fingerprint.** The line's `total_quantity` is a `decimal(65,8)` column (`base/columns.json`) that the
   platform rounds to the tenant's number rule on write (`grv2/code/commit/_cmp.js` `sameStored` exists for this); L2's
   read-back comparison would fail spuriously. The fingerprint uses the entries' `sm_quantity` inside `temp_qty_data`
   (text, stored verbatim) - the quantities that move stock - and not `total_quantity`.
4. **The `prevStatus || "Draft"` default is in more places than the worker.** Worker: plan.js / pick.js `workerItem`
   (`prevStatus: s(row.prev_status) || "Draft"`), claim.js (base `"Draft"`, unlock rows), after_prepare.js and
   after_publish.js unlock rows (`code/worker_src_grv2/`). GR PREPARE: `prepare/entry.js` (`prev = ... : "Draft"`). GR
   COMMIT: `commit/entry.js` (`prevStatus: s(job.prev_status) || "Draft"`) and `commit/_common.js` failNoWrite
   (`entry.prevStatus || "Draft"`). All of them follow the no-default rule (section 2) in the LOT copies.
5. **saveAs belongs in the idempotency key's content** (clarification). GR's recipe hashes the record only
   (`Goods Receiving/CompleteV2/grc_onClick_completed.js` idemKey); the LOT form saves one content through three buttons,
   so without saveAs a "Completed" click after an "In Progress" click on unchanged content would find the first job and
   answer its STATUS instead of queuing.
6. **The S|...|LINES part also carries the header props** (clarification). L2 writes "TxDhhT03's props minus status"
   [design], 15 of which are header columns (`update_node_TxDhhT03`); the part holds them (`header`) beside
   `stock_movement`, else a header edit made at COMPLETE / EDIT would be lost.
7. **A separate LABELS part** (clarification): ENGINE stays the exact engine request; the movement_key map is read only
   after a 400.
8. **`job_line_key` for a create without a line** (clarification): the reconcile's creates carry `doc_line_id ""`
   (`code_node_uht83Wzh`), so their key is `<jobId>|0|<n>`.
9. **Lock waits and the retry counter** (recommendation, C). GD's lockWait counts each 409 wait in `attempt_count`
   (`gdc/code/commit/c2.js`, `gde/code/commit/e1.js`), the same counter stepEnd compares with MAX_RETRIES 3, and the SPLIT
   row keeps it (`jobRow` default `attempt_count: entry.attempts`). After 3 waits, any phase-B hiccup would go straight to
   REQUIRES_REVIEW. The SPLIT / PARK hand-over row resets `attempt_count` to 0 (the waits were not failures).
10. **DRAFT is never refused for size / eligibility.** The classic Draft has no per-line loop and the classic guard exempts
   Draft from the 500 cap [design, section 11], so a DRAFT that fails an eligibility screen or a limit answers NOT_ELIGIBLE
   (the classic saves it). STOP for size / eligibility (`LOT_TOO_BIG`, `LOT_SPLIT_REQUIRED`) only for DIRECT / STAGE /
   COMPLETE / EDIT / CANCEL. Sections 7, 10.

### Rulings (controller, 2026-10-16)

1. The WA-without-WA-row STOP applies to DIRECT and STAGE only (the classic prechecks only there, `if_PYPLDh47`);
   COMPLETE / EDIT / CANCEL do not check it (the classic prices such a SUBTRACT at 0 too). Sections 7, 10.
2. Stored In Progress + saveAs Draft -> STOP 400, error_code `LOT_IP_TO_DRAFT`, message "An In Progress transfer can't be
   saved back to Draft." (NOT_ELIGIBLE would send it to the classic, which demotes it without reversing In Transit).
   Sections 2, 7, 10.
3. `page_status` "Clone" (and "Copy") = Add with line ids stripped - as written (section 2).
4. List page base = live v47; the designing v48 row is raised with the user at publish time.
5. Deviations 1-9: all accepted as written.

Fix round 1 (WP0 review): deviation 10; DIRECT / STAGE write sources (section 7); IT `before` + compare rules as pwv2
p3_plan.js (sections 5, 9); the list Cancel key (section 3); the STATUS fallback, `NONE`, "SUBMIT never unlocks" and the
COMMIT entry checks (sections 2, 5, 7, 9, 10); `lotParseJ` no longer quotes fraction digits (code/shared); example slips.

Fix wave (final review, 2026-10-16): SUBMIT `min_lines` + the list Cancel's classic fallback (sections 7, 12); an Add / Clone
answered without `lot_id` stays open (sections 7, 12); PREPARE's catch unlocks only after the lock check (section 9);
`sameVal` and long numeric text (section 14).
