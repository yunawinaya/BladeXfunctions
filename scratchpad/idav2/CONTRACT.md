# Item Disassembly V2 - the binding contract (WP0, 2026-10-21)

Single source of truth for packages A (PREPARE), B (SUBMIT + the guarded classic IDA_SAVE v7), C (COMMIT + WORKER), D (form +
list client), E (checks, sims, live kit). Authority, in order: the plan (`.superpowers/sdd/there-s-this-item-dissasembly-binary-sonnet/plan.md`,
incl. its 3 user decisions) > progress.md "WP0 design rulings" (cited **[WP0 1-9]** in their order there) > `FACTS.md` > this file.
Template: `tpl/iav2/CONTRACT.md` sections 1-14 ("as IA §n" = that mechanism with the names of §1 here); the batch step: GR V2
C1 / C1B (`tpl/grv2/commit/c1_plan.js`, `c1_decide.js`, `c1_check.js`, `c1b_*.js`, `_batchnum_adapter.js`, `tpl/grv2/shared/batchnum.js`).
Marks: **[plan]**, **[WP0 n]**, **[IA k]** (an IA ruling kept, listed in "IA rulings kept"), **[ruling]** (decided here, listed with
its reason in "Contract rulings (WP0)"). A change to this file or to `code/shared/` goes through the controller; never edit another
package's folder, `tpl/`, `base/` or `lib/`.

Bases (`base/`, exact snapshots of LIVE dev, `python3 base/snapshot.py --check`; md5 in `base/MANIFEST.json`): IDA_SAVE v6
`e79c2d2e7de55f8e232612d9e9ef6c4b` (code bodies `base/ida_code/<node id>.js`), form `ida_form_v35.json` `861002407efae6a2f0c2c9e5c464c761`,
list `ida_list_v16.json` `d2c264874160c423ea02b16c2ce6549d`, CHECK_REQUIRED_FIELD v8, GLOBAL_INVENTORY_VALIDATION v11, GENERATE_BATCH
v20, INVENTORY_BULK_APPLY v10, INVENTORY_LOCK_TOKENS v5, INVENTORY_LOCK_SEED v5, ADD_INVENTORY v65, SUBTRACT_INVENTORY v59, HANDLING_UNIT
v38, ACC_PRODUCER v119, SQL_FETCH_POST_DATA v225, ATC_FETCH_POST_DATA v146, schemas, `columns.json`. Ids: `ids.json`.

---------------------------------------------------------------------------------------------------------------------------
## 1. Names and constants [plan]

| Constant | Value | Notes |
|---|---|---|
| shells (the user creates them, folder Save Workflow / IDA) | `IDA_V2_SUBMIT`, `IDA_V2_WORKER`, `IDA_V2_PREPARE`, `IDA_V2_COMMIT` | ids in `ids.json` ("0" until created; every builder builds with "0") |
| command | `COMPLETE_IDA` | its worker polls only it; never point GD_JOB_RECONCILE at it |
| correlation / causation | `IDA|<idaId>` / `<idaId>` | `''` / `''` in an Add's insert until "link"; `gd_id` / `gd_no` never written |
| document lock | `job_id = IDC|<idaId>`, `step_name = LOCK|<n>`, result_ref = the job's idempotency key | <= 23 chars |
| engine op 1 (issue) | `IDC|<jobId>|I`, movements `M1`..`Mn` (one SUBTRACT per source pick) | 25 chars; key regex `^[A-Za-z0-9|:._-]{1,32}$` |
| engine op 2 (receipt) | `IDC|<jobId>|R`, movements `R1`..`Rn` (one ADD per stock-controlled recovery line) | 25 chars |
| PREPARE parts | `P|<nonce>|<PART>|<nnn>`, PART in `ENGINE_I`, `ENGINE_R`, `BATCH`, `LABELS`, `ITEMS` | under `job_id = <jobId>`, <= 23 chars |
| COMMIT steps / intent | `D0_REVALIDATE`, `D1_BATCH`, `D2_ISSUE`, `D3_RECEIPT`, `D4_FINISH` (DONE); intent `D1|I|<nnn>` (INTENT) | steps SQL `step_name REGEXP '^D[0-9]_'` |
| worker claim / leases / cache | `W0_CLAIM_<row_version>`; `WRK|`, `PUB|`, `SPLIT|` + 24 hex; `ida_wrk_<nonce>` | as IA §1 |
| states | QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_IDA -> COMPLETED; terminal FAILED, REQUIRES_REVIEW | |
| prevStatus (unlock target) | `Draft` only (`IDA_PREV_STATUSES`) | anything else: no unlock, REQUIRES_REVIEW `IDA_PREV_STATUS_UNKNOWN`; no default anywhere |
| error prefix | `IDA_` (§10) + the shared `JOB_ILLEGAL_TRANSITION`, `JOB_ROW_VERSION_CONFLICT` | |
| form | `item_disassembly_status` gains the `Processing` leaf (dict row 1914500993831477249, parent 1914242988707749889); hidden `ida_v2_job_id`, `ida_idem_key` (varchar 255, the form publish creates the columns); badge `processing_status` | §12 |
| client switches (OFF at the cut unless green) | `ASYNC_IDA_ENABLED`, `IDA_V2_ACTIONS = { COMPLETE, COMPLETE_POST }` | §12 |
| sizes (`code/shared/ida_common.js`) | `IDA_V2_MIN_MOVES` 50 (client: V2 when moves > 50); `IDA_CLASSIC_MAX_MOVES` 250 (classic Completed cap; NOT_ELIGIBLE vs `IDA_TOO_BIG`); `IDA_MAX_MOVES` 5000 per leg (`IDA_SPLIT_REQUIRED`; PREPARE's backstop = the engine limit) - the V2 cap at SUBMIT is 2,500 per leg (`IDA_V2_MAX_LEG`, SUBMIT-own; controller ruling 10-21 from the integration measure: 5,000 receipts = ~98 MB in one request, 2,000 = 29 MB); `IDA_PARK` 1000 (PARK when op 1 OR op 2 has more movements) | [WP0 1, 2] |
| lease (COMMIT entry, every pass) | `idaLeaseSeconds(n) = min(5400, 600 + ceil(0.6 x max(0, n)))`, n = manifest `counts.movementsI + counts.movementsR`, from the DB clock (GR V2 `leaseFor`) | 2,000 lines = 1,801 s [WP0 3]; a phase-B pass with `counts.movementsR > IDA_PARK` takes 5,400 s [final review I1: a COMMIT B outliving its lease is resumed into a second APPLY of the same engine operation] |

**Moves [WP0 1].** A pick = a header `temp_qty_data` entry with `sm_quantity > 0` (`idaPicks(header)`: array order; an unparseable
text has none - `code_issue_prep`'s filter). A recovery line = a `stock_movement` row with a non-empty `item_selection`
(`idaRecoveryLines`). `moves = idaPickCount(header) + idaRecoveryLines(lines).length` - what the client (> 50), the classic v7 cap
(> 250) and SUBMIT's NOT_ELIGIBLE / `IDA_TOO_BIG` split count, with no item read. Op 1 movements = the picks (the source is
stock-controlled, else NOT_ELIGIBLE); op 2 movements = the recovery lines whose item has `stock_control` set and not 0.

---------------------------------------------------------------------------------------------------------------------------
## 2. Actions [plan]

| stored status | saveAs | result | prevStatus |
|---|---|---|---|
| (Add / Clone) | Completed | DIRECT: a job | Draft |
| Draft | Completed | DIRECT: a job | Draft |
| any (also Add / Clone) | Draft | NOT_ELIGIBLE 300, reason `draft` (Draft always stays classic; never STOP) | |
| Processing, or an open COMPLETE_IDA job of `IDA|<id>` (`IDA_OPEN_JOB`: QUEUED, VALIDATING, READY_TO_COMMIT, COMMITTING_IDA, REQUIRES_REVIEW) | any | BUSY 409 `IDA_BUSY` (`IDA_UNDER_REVIEW` when that job is REQUIRES_REVIEW) | |
| the latest `IDC|<idaId>` LOCK is younger than 120 s, of ANOTHER key, and its job missing or open (SA's B2 rule) | any | BUSY 409 `IDA_BUSY` | |
| the form's `item_disassembly_status` differs from the stored one | any | STALE 409 `IDA_STALE` | |
| Completed / Fully Posted | any | STALE 409 `IDA_ALREADY_FINAL` | |
| any other stored status (`Issued`, blank, ...) | Completed | NOT_ELIGIBLE 300, reason `status <x>` | |
| saveAs not Draft / Completed, pageStatus View or unknown, bad ids / key / tenant / organization, no form | - | INVALID 400 `IDA_INVALID_REQUEST` | |

`pageStatus` `Clone` (the form's `page_status` on a copy; `Copy` accepted) counts as `Add`: SUBMIT strips the header id, every line id,
`ida_v2_job_id` and `ida_idem_key` before anything else [IA dev 15]. Complete & Post is a DIRECT on the server; only the client posts.

Entry order (as IA §2): INVALID -> a job already holds this key -> its STATUS answer -> `operation STATUS` -> STATUS answer -> Add / Clone
goes on -> stored IDA missing -> STOP 400 `IDA_NOT_FOUND` -> BUSY -> STALE -> the action table -> eligibility -> the lifted gates ->
the typed-number check -> limits -> the WA screen -> the batchnum dry run -> writes (§7). Every check runs before the first write.

**Unlock everywhere** (WORKER, PREPARE, COMMIT `failNoWrite`; SUBMIT never unlocks) writes `{ id: <idaId>, item_disassembly_status:
"Draft" }` only while the job owns the IDA (§4) and `idaPrevStatusOk(prevStatus)`; otherwise no unlock and REQUIRES_REVIEW
`IDA_PREV_STATUS_UNKNOWN` [IA ruling 4].

---------------------------------------------------------------------------------------------------------------------------
## 3. gd_async_job for COMPLETE_IDA

| Writer | Columns |
|---|---|
| SUBMIT insert (`lib/v2build.JOB_ADD_COLS`) | organization_id, plant_id (= header `issuing_operation_faci`), command `COMPLETE_IDA`, idempotency_key, job_status `QUEUED`, progress_percent 0, progress_message `Queued for processing`, attempt_count 0, row_version 0, cancel_requested 0, next_attempt_at = db_now + 600 s, request_payload, causation_id (`<idaId>`; `''` for an Add), correlation_id (`IDA|<idaId>`; `''` for an Add), line_count (= moves [ruling]), queued_at = db_now |
| SUBMIT link (Add / Clone, after the read-back) | id, correlation_id, causation_id, request_payload (+ idaId, idaNo, issuedNo, lineFingerprint) |
| SUBMIT due (after the read-back) | id, next_attempt_at = db_now, request_payload (stored Draft: + idaNo, issuedNo, lineFingerprint) |
| WORKER | `JOB_PROPS`; the dead-claim move: id, row_version, attempt_count |
| PREPARE | READY: id, job_status, progress_percent, progress_message, row_version, error_code, error_message, error_details, prepared_payload, line_count (= moves). FAILED / REVIEW: `JOB_PROPS` (+ the unlinked case's link columns, §9) |
| COMMIT | `JOB_PROPS` (every row from `jobRow`) |

Never written: gd_id, gd_no, picking_id, picking_no, payload_hash, confirmation_token / _hash, source_so_*, submitted_*, started_at,
gd_committed_at, picking_ready_at. The unique `Idempotency Key` (tenant, organization, key) stops a twin click.

**request_payload** (JSON text, SUBMIT only; never holds lines):

```json
{ "v": 1, "action": "DIRECT", "prevStatus": "Draft", "saveAs": "Completed", "pageStatus": "Edit",
  "idaId": "2112073133161844738", "idaNo": "IDA-2610-0042", "issuedNo": "IDA-2610-0042", "lineFingerprint": "DF1:2000:69698384367f7d26",
  "organizationId": "1123598813738675201", "plantId": "1123598813738675202", "lineCount": 2000, "pickCount": 1, "moveCount": 2001,
  "stockLines": 1998, "nonStockLines": 2, "uid": "1123598821738675201", "source": "FORM", "nonce": "ab12cd34", "parts": {} }
```

| Key | Meaning |
|---|---|
| action / prevStatus / saveAs | `DIRECT` / `Draft` / `Completed` |
| pageStatus | `Add` / `Edit` (Clone / Copy stored as `Add`) |
| idaId, idaNo | the stored IDA and its number after SUBMIT's writes (read back); an Add gets them in "link" |
| issuedNo | the number THIS submit made the platform issue (written with the `'issued'` sentinel); `''` when none (manual -9999, or the stored number kept) |
| lineFingerprint | `idaLineFingerprint(FP_LINES, FP_HEADER)` of the rows read back after SUBMIT's writes (§6) |
| lineCount / pickCount / moveCount | recovery lines / picks / moves (§1) |
| stockLines / nonStockLines | recovery lines whose item has `stock_control` not 0 (= op 2 movements) / = 0 |
| uid / source / nonce | `{{system:uid}}`; `FORM` (or `MOBILE`, accepted, unused); SUBMIT's run nonce (8 of `[0-9A-Za-z]`) |

**Number rule** [IA review 6]: a DIRECT from a stored Draft writes WITHOUT `stock_movement_no` / `stock_movement_no_type` only when the
stored number is the `issuedNo` of an earlier COMPLETE_IDA job of this IDA (`FACTS.issued_by_job > 0`) AND no COMPLETED COMPLETE_IDA
job ran under it (`FACTS.completed_under = 0`, by request `idaNo`); otherwise it writes them as `code_fillback` left them (`'issued'`,
or with `stock_movement_no_type = -9999` the typed number [IA ruling 7]). An Add always writes them.

**Idempotency key** (as IA §3): `IDA:<organization_id>:<idaId | "new-" + pageToken>:<hash16>:<gen>`, characters outside
`A-Za-z0-9|:_.-` -> `-`, cut to 128; SUBMIT refuses anything else (`IDA_KEY_RE` = `/^[A-Za-z0-9|:_.-]{8,128}$/`). `hash16` = FNV-1a 32
+ djb2 32 (= `idaFpHash`) over `canon({ saveAs: "Completed", pageStatus, record })` (keys sorted, undefined dropped); one key serves
both buttons. `record` = `this.getValues()` minus NOT_RECORD (§12). `pageToken` once per form open (`_data.ida_page_token`); `gen`
starts at 1, + 1 after a FAILED answer. A lost answer re-sent with the same key finds the same job.

**State machine** (as IA §3 with COMMITTING_IDA):

| From | To | Written by | When |
|---|---|---|---|
| - | QUEUED (next_attempt_at = now + 600 s [final review M1: a SUBMIT stalled past it would leave a Processing IDA under a FAILED job]) | SUBMIT insert | after every check (§2 order) |
| QUEUED | QUEUED, due now | SUBMIT due | the read-back shows the IDA Processing under this job's lock (else it falls due by itself) |
| QUEUED | VALIDATING (lease `WRK|`, 10 min) | WORKER claim | |
| VALIDATING | READY_TO_COMMIT (lease kept) | PREPARE | manifest + parts written, both PLANs clean |
| VALIDATING | FAILED (+ unlock) | PREPARE | a clean plan failure (§9) |
| VALIDATING / READY_TO_COMMIT | same, attempt + 1, backoff 2 s x 2^n (max 30 s) | WORKER | a callee answered without a code / a dead lease or claim (max_retries 3) |
| VALIDATING / READY_TO_COMMIT | FAILED (+ unlock) | WORKER | a hard code (§8) or retries exhausted |
| READY_TO_COMMIT | COMMITTING_IDA (lease `PUB|`, `idaLeaseSeconds`; a phase-B pass of more than `IDA_PARK` receipts: 5,400 s) | COMMIT entry | |
| COMMITTING_IDA (phase A) | FAILED (+ unlock, + our Batch rows soft-deleted) | COMMIT `failNoWrite` | §9 phase-A failures, while NEITHER op has an engine row; else REQUIRES_REVIEW [IA R2, ruling] |
| COMMITTING_IDA (phase A) | COMMITTING_IDA, `SPLIT|` lease or PARK, attempt_count 0, progress 75 | COMMIT D2 | op 1 applied (§8 tick rule) |
| COMMITTING_IDA | COMMITTING_IDA, attempt + 1, backoff | COMMIT | `stepEnd` / D2 `lockWait` / D1 `d1Renumber` (5 s or 20-30 s, D1 rows 4 / 6 / 10) |
| COMMITTING_IDA (phase B) | COMMITTING_IDA, due in 10 s, attempt unchanged | COMMIT D3 | op 2 transient (`stepWait`) until its deadline |
| COMMITTING_IDA | REQUIRES_REVIEW | COMMIT / WORKER | §9 review cases; phase B 3 failures; a dead COMMIT run 3 times. The IDA stays Processing |
| COMMITTING_IDA | COMPLETED | COMMIT finish | after D4 |
| any open | REQUIRES_REVIEW | whoever would unlock | prevStatus not Draft (`IDA_PREV_STATUS_UNKNOWN`) |

progress_percent: QUEUED 0, VALIDATING >= 10, READY_TO_COMMIT 60, phase A 70 ("Issuing the item being disassembled (<n> source
pick(s))"), after op 1 (SPLIT / PARK) **75** `P75` "Source issued; receiving the recovered components", D3 DONE **80** `P80` "Components
received; finishing", phase-B entry 75 before D3 is DONE and 85 after, COMPLETED 100, FAILED / REQUIRES_REVIEW 0. COMMITTING_IDA at
>= 80 = both operations moved stock (the client's "stock moved" verdict) [IA dev 7].

---------------------------------------------------------------------------------------------------------------------------
## 4. gd_publish_step rows

Unique `Job Step` (tenant_id, job_id, step_name): a second insert of a name fails its run - the twin guard. `job_id` / `step_name`
varchar(32), `step_status` varchar(16), `result_ref` longtext. Writes: `lib/v2build.step_add` (STEP_PROPS) or `PART_COLS`.

| Rows | job_id | step_name | step_status | result_ref | Written by | Read by |
|---|---|---|---|---|---|---|
| document lock | `IDC|<idaId>` | `LOCK|<n>` (n = last + 1; an Add `LOCK|1` after its insert) | `LOCK` | the job's idempotency key | SUBMIT | WORKER (lock join), PREPARE, COMMIT entry, SUBMIT |
| claim gate | `<jobId>` | `W0_CLAIM_<row_version>` | `DONE` | `WRK|<nonce>` | WORKER pick | WORKER |
| PREPARE parts | `<jobId>` | `P|<nonce>|<PART>|<nnn>` | `PAYLOAD` | <= 400,000 chars each | PREPARE | COMMIT |
| step done | `<jobId>` | `D0_REVALIDATE` ... `D4_FINISH` | `DONE` | a note <= 2,000 chars (D0 the fingerprint; D1 `{"rows","inserted","adopted"}`; D2 `{"called":"YES","code","result_code","summary"}`; D3 `{"out_rows","out_total","movements","result_code"}`; D4 `Completed / <number>`) | COMMIT `doneRow` | COMMIT entry, D3 (D2 row) |
| D1 intent | `<jobId>` | `D1|I|<nnn>` | `INTENT` | `{ "numbers": { "<BATCH row key>": "<generated number>" }, "configs": [{ "id", "before": {running_number, last_reset_date}, "after": {...} }] }` (AUTO rows only; `{}` / `[]` when none) | COMMIT D1, BEFORE any config / Batch write; D1's renumber retires it (`{ id, step_name: "D1|X|<its id>", is_deleted: 1 }`: the unique `Job Step` keeps deleted rows, the rename frees `D1|I|<nnn>` for the next numbering) | D1, D3, D4, every failure path (the soft-delete set) |
| engine op 1 | `IDC|<jobId>|I` | `IBA|I|<nnn>`, `IBA|DONE`, `IBA|REVIEW` | engine's | engine's (`IBA|DONE` = `{results, summary}`) | INVENTORY_BULK_APPLY | D2, D3, entry (`OP_STATE`), runbook |
| engine op 2 | `IDC|<jobId>|R` | same | engine's | engine's | INVENTORY_BULK_APPLY | D3, entry, runbook |

Chunking (`idaPartRows` / `idaJoinChunks`, as IA §4): the value's JSON text cut every 400,000 characters (`IDA_CHUNK`) into
`<prefix><nnn>` (001.., at least one row even for `{}`), joined back in step-name order. Parts are `PAYLOAD`, intents `INTENT`.

**Lock ownership** (status-based): a job owns its IDA when ALL hold: `sm_item_disassembly.item_disassembly_status = 'Processing'`,
`ida_v2_job_id = <jobId>` (varchar, text compare), and the latest (MAX id) `LOCK|%` row of `IDC|<idaId>` has `result_ref` = the job's
key (`sql.py OWNER`). **Release** = the status write: the unlock (`Draft`, only before op 1 moved stock) or D4's `Completed`. LOCK rows
are never deleted; `ida_v2_job_id` is kept after the job (audit). The guarded classic (§11) and the list refuse a Processing IDA.

---------------------------------------------------------------------------------------------------------------------------
## 5. The manifest and its parts

`prepared_payload` (PREPARE, READY_TO_COMMIT; read whole by COMMIT's entry):

```json
{ "v": 1, "prepared_by": "IDA_V2_PREPARE", "job_id": "2112100000000000001", "ida_id": "2112073133161844738", "ida_no": "IDA-2610-0042",
  "action": "DIRECT", "prevStatus": "Draft", "saveAs": "Completed", "organization_id": "1123598813738675201", "plant_id": "1123598813738675202",
  "nonce": "c9d8e7f6", "lineFingerprint": "DF1:2000:69698384367f7d26", "batchMode": "insert",
  "parts": { "ENGINE_I": ["P|c9d8e7f6|ENGINE_I|001"], "ENGINE_R": ["P|c9d8e7f6|ENGINE_R|001", "P|c9d8e7f6|ENGINE_R|002"],
             "BATCH": ["P|c9d8e7f6|BATCH|001"], "LABELS": ["P|c9d8e7f6|LABELS|001"], "ITEMS": ["P|c9d8e7f6|ITEMS|001"] },
  "counts": { "lines": 2000, "picks": 1, "movementsI": 1, "movementsR": 1998, "nonStockLines": 2, "batchRows": 40, "autoRows": 30,
              "typedRows": 10, "items": 2001 } }
```

`batchMode` = `insert` when the BATCH part has at least one row, else `none` (no BATCH part). COMMIT's entry accepts the manifest only
when `job_id` = the job, `ida_id` is digits and `correlation_id = IDA|<ida_id>`, `action` DIRECT, a nonce, every PART above listed
with >= 1 name (BATCH exactly when `insert`), `lineFingerprint` starts `DF1:`, `counts.movementsI >= 1` and `counts.movementsR >= 1`
[ruling], the organization the job's; else FAILED + unlock (phase A) / REQUIRES_REVIEW (phase B).

**Line order** [ruling]: numeric `line_index` (the fill-back's `index + 1`, written by SUBMIT), ties by id - the classic's array order.
It fixes the allocation's last line, the R numbering and the AUTO numbering order.

### ENGINE_I = the exact INVENTORY_BULK_APPLY request of op 1

```json
{ "operation_key": "IDC|2112100000000000001|I", "mode": "APPLY", "organization_id": "1123598813738675201",
  "movements": [
    { "movement_key": "M1", "direction": "SUBTRACT", "plant_id": "1123598813738675202", "organization_id": "1123598813738675201",
      "material_id": "2105489115887079441", "quantity": 1, "material_uom": "2018906563477008392", "transaction_type": "IDA",
      "trx_no": "IDA-2610-0042", "parent_trx_no": "", "inventory_category": "Unrestricted", "location_id": "2106278340907413505",
      "batch_id": null, "manufacturing_date": null, "expired_date": null, "doc_date": "2026-10-21 00:00:00", "isMovingInv": 0,
      "handling_unit_id": null } ] }
```

One SUBTRACT per pick in `temp_qty_data` order = the classic `wf_subtract` params (`code_issue_prep` + `code_issue_pick`) minus
`itemData`, plus `movement_key`, `direction`, `parent_trx_no`: `plant_id` / `organization_id` = header `issuing_operation_faci` /
`organization_id`; `material_id` = header `item_id`; `quantity` = `idaQ8(pick.sm_quantity)` (a NUMBER); `material_uom` = header
`item_uom` (digits, or `""` = the item's base UOM); `transaction_type` `IDA`; `trx_no` = the STORED `stock_movement_no`; `parent_trx_no`
`""` (every classic `IDA` row on dev holds `''`, OUT and IN); `inventory_category` = `idaCategory(pick.category)`; `location_id` /
`batch_id` = the pick's (`batch_id` null when none); `manufacturing_date` / `expired_date` = the pick's or null; `doc_date` = the stored
`item_disassembly_date` (`DATE_FORMAT '%Y-%m-%d %H:%i:%s'`) or null; `isMovingInv` 0; `handling_unit_id` null (HU is not eligible).
No `unit_price`, no remarks (the classic sends neither).

### ENGINE_R = the receipt request template of op 2, plus `alloc` (never sent)

```json
{ "operation_key": "IDC|2112100000000000001|R", "mode": "APPLY", "organization_id": "1123598813738675201",
  "movements": [
    { "movement_key": "R1", "direction": "ADD", "plant_id": "1123598813738675202", "organization_id": "1123598813738675201",
      "material_id": "2094626841323700252", "quantity": 5, "material_uom": "2018906563477008392", "transaction_type": "IDA",
      "trx_no": "IDA-2610-0042", "parent_trx_no": "", "inventory_category": "Unrestricted", "location_id": "2018912822846582786",
      "batch_id": null, "unit_price": 0, "doc_date": "2026-10-21 00:00:00", "manufacturing_date": null, "expired_date": null,
      "remark": "", "remark2": "", "remark3": "", "isMovingInv": 0, "handling_unit_id": null } ],
  "alloc": [
    { "line_id": "2112...", "line_index": "1", "item_id": "2094626841323700252", "share_qty": 5, "base_qty": 5, "movement_key": "R1", "batch_key": "B1" },
    { "line_id": "2112...", "line_index": "2", "item_id": "2070758892513914881", "share_qty": 1, "base_qty": 1, "movement_key": "", "batch_key": "" } ] }
```

- `movements`: one ADD per stock-controlled recovery line in line order, `R<k>` numbered over those lines = the classic `wf_add`
  params (`code_cost_alloc` receipts + `wf_add` constants) minus `itemData` and `batch_number`, plus `movement_key`, `direction`,
  `parent_trx_no`, `batch_id`, `isMovingInv`, `handling_unit_id`: `plant_id` = line `issuing_plant || header issuing_operation_faci`,
  `organization_id` = line `organization_id || header organization_id`, `material_id` = `item_selection`, `quantity` =
  `idaQ8(total_quantity)` in `quantity_uom`, `inventory_category` `Unrestricted`, `location_id` = the line's target bin, dates = the
  line's (DATE_FORMAT) or null, `remark` / `remark2` / `remark3` = `item_remark` / `_2` / `_3` or `""`, `doc_date` as ENGINE_I.
  COMMIT fills exactly two values: `batch_id` (D1 re-PLAN, D3: the line's Batch row, §9) and `unit_price` (D3). Never a
  `batch_number` (the engine refuses `UNSUPPORTED_NEW_BATCH` without a `batch_id`).
- `alloc` [plan]: EVERY recovery line in line order, non-stock lines included: `share_qty` = `idaQ8(total_quantity)` (number),
  `base_qty` = `idaUomOf(item, share_qty, quantity_uom).baseQty` (= the engine's `uomOf` [WP0 8]), `movement_key` (`""` for a
  non-stock line), `batch_key` (the BATCH row key, `""` for NONE / non-stock). The engine call passes only `operation_key`, `mode`,
  `organization_id`, `movements` (workflow-node body params), so op 2's request is byte-identical on every retry [IA dev 9].

### Batch kinds and the BATCH part [WP0 5, 7; plan]

`idaBatchKind(line, item)` [ruling]: **AUTO** when `item_batch_management = 1`, `batch_number_genaration = 'According To System
Settings'` and the raw `batch_number` is `''` or `'Auto-generated batch number'` (the classic `code_batch_plan` rule, exactly); else
**TYPED** when the trimmed text is not `''`, `'-'` or `'Auto-generated batch number'`; else **NONE**.

```json
{ "mode": "insert",
  "items": [ { "id": "2107721718380298242", "item_category": "21...", "item_group_id": null } ],
  "rows": [
    { "key": "B1", "kind": "TYPED", "insert": true, "batch_number": "LOT-7", "line_ids": ["2112...", "2112..."], "material_id": "2107724107950784513",
      "plant_id": "1123598813738675202", "organization_id": "1123598813738675201", "initial_quantity": "12.00000000", "transaction_no": "IDA-2610-0042",
      "remark": "", "remark2": "", "remark3": "", "manufacturing_date": null, "expired_date": null, "request": null },
    { "key": "B2", "kind": "AUTO", "insert": true, "batch_number": "", "line_ids": ["2112..."], "material_id": "2107721718380298242",
      "plant_id": "1123598813738675202", "organization_id": "1123598813738675201", "initial_quantity": "5.00000000", "transaction_no": "IDA-2610-0042",
      "remark": "", "remark2": "", "remark3": "", "manufacturing_date": null, "expired_date": null,
      "request": { "item_id": "2107721718380298242", "document_date": "2026-10-21 00:00:00", "manufacturing_date": null, "expired_date": null,
                   "organization_id": "1123598813738675201" } } ] }
```

| Kind | Rows | Values |
|---|---|---|
| TYPED (stock lines) | ONE row per (item, `idaBatchKey(number)`) in first-line order [WP0 7] | `batch_number` = the first line's stored text (untrimmed, as the classic ADD writes) [ruling]; `initial_quantity` = `idaQtyStr(sum of its lines' base_qty)`; remarks / dates from the first such line |
| AUTO | ONE row per AUTO line in line order (= the classic's GENERATE_BATCH call order) | `batch_number` `""` (numbered in D1); `request` = `idaBatchRequest(header, line, organizationId)`; a non-stock AUTO line has `insert: false` (it consumes a number, D4 writes it into the line, no Batch row - GR C1's rule, classic parity) [ruling] |
| NONE | none (the classic mints a blank Batch row per such line - deliberate difference [plan]) | - |

Common values = ADD_INVENTORY v65 `add_node_F9KqZLfd`'s 11 columns (`BATCH_COLS` = batch_number, material_id, initial_quantity,
transaction_no, plant_id, organization_id, remark, remark2, remark3, manufacturing_date, expired_date): `transaction_no` = the stored
IDA number, plant / organization as the line's movement, remarks = `item_remark` / `_2` / `_3` or `""`, dates or null; no
`parent_transaction_no`. `items` = `{ id, item_category, item_group_id }` of every AUTO row's item (bnNumber's `itemRows`). TYPED on a
non-stock line: no row (the classic ADD answers 401 before its batch insert). A NONE line of a non-batch item with the literal
placeholder gets no batch (the classic made a batch named `Auto-generated batch number`) [ruling].

### Receipt price [plan, user decision 3; WP0 6, 8]

`issuedValue` = `parseFloat(OUT_TOTALS.total)` (§6 sql.py: this completion's `IDA` OUT rows, `id > <jobId>`, `operation_effect_key LIKE
'IDC|<job>|I|%'`). `idaAllocate(issuedValue, alloc)` = the classic `code_cost_alloc` arithmetic line for line, with the v7 divisor:
`totalQty = sum(share_qty)`; `remaining = issuedValue`; for each line in order `value_i = (last ? remaining : (totalQty > 0 ?
issuedValue * share_qty_i / totalQty : 0))`, `remaining -= value_i`, `unit_price_i = base_qty_i > 0 ? q8(value_i / base_qty_i) : 0`.
D3 sends `unit_price_i` on the line's `R` movement; non-stock lines keep their share and receive nothing (classic: ADD answers 401).
Fixed Cost items are received at `purchase_unit_price` by the engine (and ADD) whatever is sent. The classic v7 computes the same
(§11); E proves `idaAllocate` == v7's lifted `code_cost_alloc` unit prices on fixtures (incl. a non-base UOM line, a non-stock last
line, the remainder). Evidence for the per-base-unit divisor: dev, every classic non-base-UOM IN row converts (55 / 55) and prices per
base unit (35 / 35 priced rows: `total_price = unit_price x base_qty`).

### LABELS and ITEMS

LABELS = `{ "M1": { "pick": "1", "line_index": "", "line_id": "", "item_code", "item_name", "bin", "bin_id", "category", "side": "out" },
"R1": { "pick": "", "line_index": "4", "line_id", "item_code", "item_name", "bin", "bin_id", "category": "Unrestricted", "side": "in" } }`;
`bin` = `bin_location.bin_location_combine` (the id when not found); read only after a refusal. `idaMapEngineMessage` turns
`"Insufficient quantity (movement M1)"` into `"Insufficient quantity - source pick 1 (FG-0001), bin A1-B2 (Unrestricted)"` and an R key
into `"... - line 4 (RM-0042), into bin A1-B2 (Unrestricted)"`.

ITEMS = `{ "itemDates": [ { "id": "<source item>" }, { "id": "<recovery item>" }, ... ] }` - unique ids, the source first, then every
line's `item_selection` in line order, non-stock included (`code_item_txn`). D4 stamps `new Date().toISOString()` once per pass [IA dev 8].

---------------------------------------------------------------------------------------------------------------------------
## 6. lineFingerprint and the shared helpers (`code/shared/`, owned by WP0 / controller, §13)

Every top-level name is `ida` / `IDA_`-prefixed so files concatenate with a step's own `s` / `q8` / `list` / `parseJ`; include with
`lib/v2build.include_js(<idav2>, "code/shared/x.js")` (drops the `if (typeof module` export line). Unit tests `test/shared/`.

| File | Names (signatures) |
|---|---|
| `ida_common.js` | `idaS`, `idaQ8`, `idaQtyStr(v)` (= max(0, q8).toFixed(8)), `idaDigits`, `idaIdStr`, `idaIdAfter(id, jobId)` (digit text, numerically greater), `idaParseJ` (16+ digit integers kept as strings), `idaList`, `idaJsonList`, `idaRows` (rows `{j}` parsed), `idaIdsSql(vals)` (`"0,<id>,..."`), `idaTuples(rows)` (one JSON text of digit arrays, each once), `idaCategory(c)` (blank = `Unrestricted`), `idaPicks(header)`, `idaPickCount(header)`, `idaRecoveryLines(lines)`, `idaMoveCount(header, lines)`, `idaHasHu(header)` (a pick with `handling_unit_id`, a non-empty `temp_hu_data`, or a non-empty `table_hu`), `idaPickHasSerial(header)` (a pick with `serial_number`), `IDA_AUTO_RULE` = `According To System Settings`, `IDA_BATCH_PLACEHOLDER` = `Auto-generated batch number`, `idaBatchKind(line, item)`, `idaBatchKey(n)` (trimmed, lower-case, trailing spaces cut = grv2 `batchKey`, whose `s()` trims), `idaHex(text)` (UTF-8 bytes, upper-case hex), `idaHexJson(numbers)` (JSON text of the distinct non-blank `idaHex` values, first-seen order; a blank would match every blank Batch row), `idaBatchRequest(header, line, organizationId)` -> `{ item_id, document_date, manufacturing_date, expired_date, organization_id }` (= `code_batch_plan`'s genLine + organization [ruling]), `idaLineLabel(i, line)` (code_validate's label `Line <i> (<item_name or item_selection or ->)`; added WP0b), `idaDbAddSeconds`, `idaDbSeconds`, `idaLeaseSeconds(n)`, `IDA_PREV_STATUSES` / `idaPrevStatusOk`, the sizes of §1, `IDA_LOCK_WAIT_TRIES` 8, `IDA_RECEIPT_WAIT_S` 1800, `IDA_RECEIPT_RETRY_S` 10, `IDA_OK_CATEGORIES` (Unrestricted, Blocked), `IDA_OPEN_JOB`, `IDA_RUNNING_JOB` (QUEUED, VALIDATING, READY_TO_COMMIT, COMMITTING_IDA), `IDA_TERMINAL_JOB` (COMPLETED, FAILED, REQUIRES_REVIEW, CANCELLED, NONE), `IDA_FINAL` (Completed, Fully Posted), `IDA_KEY_RE`, `idaLockJob(idaId)`, `idaCorrelation(idaId)`, `idaOpKey(jobId, side)`, `IDA_CHUNK` / `idaPartRows(jobId, organizationId, prefix, value, status)` / `idaJoinChunks(rows, prefix)` (null = no row, undefined = unreadable), `idaSameVal` / `idaSameStored`, `IDA_TEXT` (§10) |
| `fingerprint.js` | `idaLineFingerprint(lines, header)` -> `DF1:<line count>:<16 hex>`; `idaFpParse`, `idaFpRows`, `idaFpId`, `idaFpQ8`, `idaFpHash`, `idaFpEntries`, `idaFpCanonRows`, `idaFpCanonHeader` (self-contained) |
| `movekey.js` | `idaMovementKeyOf(message, keys)`, `idaMapEngineMessage(message, labels, keys)` (self-contained) |
| `price.js` | `idaPrIdEq(a, b)` (exact text), `idaUomConversions(item)` (`table_uom_conversion` array or `uom_conversion_json` text), `idaUomOf(item, quantity, uom)` -> `{ altQty, baseQty, altUOM, baseUOM }` (= INVENTORY_BULK_APPLY v10 `code_node_IBplan` verbatim: its item mapping - untrimmed `String` ids, `Number` base_qty, a NULL base UOM as `""` - then its `uomOf`, so a blank UOM falls back to the base UOM and ids compare by exact `===`; only a NULL conversion row, which would throw in the engine, is skipped), `idaItemOf(items, id)`, `idaAllocate(issuedValue, alloc)` -> `[{ value, unit_price }]` (§5; self-contained) |
| `batchnum.js` | = `tpl/grv2/shared/batchnum.js` verbatim (`bnNumber(configRows, itemRows, requests, opts)`; its header comment is its API; tests with `TZ=Asia/Kuala_Lumpur`) |
| `batchnum_adapter.js` | `idaBatchnum(configRows, itemRows, requests, now)` -> `{ error, failedAt }` (`error` = GENERATE_BATCH's own text, e.g. `No default batch found.`; `failedAt` = the request index) or `{ numbers: [..], configs: [{ id, before, after }] }` = GR `_batchnum_adapter.js` with `ida` names (no `existing`: duplicates are D1's). A config's `running_number` is the NEXT number GENERATE_BATCH issues (631 issues `Batch-00631`, after = 632) |
| `sql.py` | the shared SQL below + `job_obj(alias)`, `facts(sub, T, IDA, KEY, ORG)`, `op_state(sub, T, JOB, SIDE)` (filled with `lib/v2build.sub`); `FACTS_COLS`, `OWNER_COLS`, `OP_STATE_COLS`, `CLASSIC_GUARD_COLS`, and `STATEMENTS` = { name: (text, tokens, columns) } for the checks |

**idaLineFingerprint** [ruling] - over STORED rows only (`FP_LINES` + `FP_HEADER`: SUBMIT's read-back, PREPARE, D0) [IA dev 3]:
per line `[id, line_index, item_selection, quantity_uom, total_quantity (8-dp text), location_id, batch_number (as stored),
manufacturing_date, expired_date]`; header `[item_id, item_qty (8-dp text), item_uom, issuing_operation_faci, item_disassembly_date,
picks]`, picks = every `temp_qty_data` entry in array order (`sm_quantity <= 0` kept) as `[balance_id, location_id, batch_id, category
(blank = Unrestricted), sm_quantity (8-dp text), handling_unit_id]`, a text that does not parse fingerprinted as `RAW:<text>`. Lines
sorted by id (length, then text; id-less first by `line_index`); ids through `idaFpId` (a JS number past 2^53 is marked `?`); hash =
`idaFpHash(JSON.stringify([headerCanon, rowsCanon]))` (FNV-1a 32 + djb2 32, 16 hex). Ids compare as exact text everywhere [IA dev 4].

**sql.py** (§14 conventions; every statement tenant-scoped, `is_deleted = 0`):

| Name | Returns | Filter / notes |
|---|---|---|
| `FP_LINES` | `j` = JSON_OBJECT(id, line_index, item_selection, quantity_uom, total_quantity, location_id, batch_number, manufacturing_date, expired_date (DATE_FORMAT), item_remark, item_remark_2, item_remark_3, issuing_plant, organization_id, item_name) | `sm_item_disassembly_tlm8ve69_sub l`, `l.sm_item_disassembly_id = @IDA`, ORDER BY l.id; bigint ids `CAST AS CHAR` |
| `FP_HEADER` | `j` = JSON_OBJECT(id, item_id, item_code, item_name, item_qty, item_uom, issuing_operation_faci, organization_id, stock_movement_no, stock_movement_no_type, item_disassembly_status, posted_status, item_disassembly_date (DATE_FORMAT), temp_qty_data, temp_hu_data, table_hu, remarks, remarks_2, remarks_3, ida_v2_job_id) | `sm_item_disassembly h`, `h.id = @IDA` |
| `OWNER` | db_now, ida_id, item_disassembly_status, ida_v2_job_id, stock_movement_no, lock_ref, lock_step | as IA `OWNER` with `IDC|@IDA` |
| `LOCKOBJ`, `job_obj(alias)` | as IA (job objects carry `command`, `action`, `ida_no` = request `$.idaNo`) | |
| `FACTS` / `FACTS_COLS` | db_now, key_job, ida_id, stock_movement_no, item_disassembly_status, posted_status, organization_id, plant_id, no_type, ida_v2_job_id, ida_lock, open_jobs, last_job, link_job, issued_by_job, completed_under | as IA `FACTS` with one command `COMPLETE_IDA`, `IDA|@IDA`, `$.issuedNo` / `$.idaNo`; no batch summary (`BNC` is read whole) |
| `ITEMS` (@ITEMS digit list) / `ITEMS_STORED` (@IDA: the header's `item_id` + every line's `item_selection` by subquery) | `j` = JSON_OBJECT(id, material_code, material_name, stock_control, serial_number_management, item_batch_management, batch_number_genaration, material_costing_method, purchase_unit_price (CHAR), based_uom (CHAR), item_category, item_group_id, table_uom_conversion = COALESCE(JSON_ARRAYAGG(alt_uom_id CHAR, base_qty), JSON_ARRAY()) of `item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0` - the engine's rows) | SUBMIT uses `ITEMS`, PREPARE `ITEMS_STORED` |
| `BINS_STORED` | `j` = (id, bin = `bin_location_combine`) | the header picks' `location_id` (JSON_TABLE over `h.temp_qty_data` in FROM) + every line's `location_id` |
| `BNC` (@ORG) | `j` = GR C1's `bnc` columns (id, batch_level_selection, item_id, item_category_id, item_group_id, batch_format, running_number, reset_frequency, initial_value, last_reset_date, date_format, format_preview, organization_id) | `batch_number_config c`, `c.organization_id = '@ORG'`, ORDER BY c.id |
| `BATCH_HOLDERS` (@ORG, @HEX) | `j` = (id, batch_number, material_id, plant_id, organization_id, transaction_no) | live org Batch rows, ANY item, `b.batch_number IN (SELECT (CONVERT(UNHEX(t.h) USING utf8mb4) COLLATE utf8mb4_general_ci) FROM JSON_TABLE('@HEX', '$[*]' COLUMNS (h VARCHAR(2040) PATH '$')) t)`, ORDER BY b.id (verified on dev: case-insensitive, trailing spaces ignored) [ruling] |
| `BATCH_TYPED_STORED` (@IDA) | as `BATCH_HOLDERS` | live org Batch rows (the header's organization) with `b.batch_number IN (SELECT l.batch_number ... UNION SELECT TRIM(l.batch_number) ...)` over the IDA's live lines with `TRIM(COALESCE(l.batch_number, '')) NOT IN ('', '-', 'Auto-generated batch number')`: the stored text (D1's hex form) and the trimmed text (SUBMIT's form) both [review fix 1]; no text substituted; JS keeps the TYPED lines' matches - PREPARE |
| `BATCH_OURS` (@IDA, @JOB, @ORG) | as `BATCH_HOLDERS` | live org Batch rows with `b.id > @JOB` and `b.transaction_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.tenant_id = '@T' AND h.id = @IDA)` |
| `LINES_BATCH` (@IDA) | `j` = (id, batch_number) | the IDA's live lines (D4) |
| `OUT_TOTALS` (@IDA, @JOB, @ORG) | n, total (CHAR of SUM(total_price)) | `inventory_movement m`, `m.id > @JOB`, organization [ruling], `movement = 'OUT'`, `transaction_type = 'IDA'`, `trx_no` from the header row (subquery), `operation_effect_key LIKE 'IDC|@JOB|I|%'` [IA review 7, dev 5] |
| `OP_STATE` / `op_state(sub, T, JOB, SIDE)` | intents (`IBA|I|%` count), review (`IBA|REVIEW` count), done_summary (`JSON_EXTRACT(result_ref, '$.summary')` of `IBA|DONE`) | job_id `IDC|@JOB|@SIDE`, SIDE in I / R |
| `CLASSIC_GUARD` (@IDA) | ida_id, item_disassembly_status | `sm_item_disassembly` only (§11) |

---------------------------------------------------------------------------------------------------------------------------
## 7. IDA_V2_SUBMIT (B) - synchronous; operations SUBMIT and STATUS

**Request** (`request_json`; strings except `form`): `operation` (`SUBMIT` default / `STATUS`), `saveAs` (`Completed`; `Draft` answers
NOT_ELIGIBLE), `pageStatus` (`Add` / `Edit` / `Clone`, `Copy` = Clone - the form's `page_status`), `ida_id` (digits for Edit and STATUS;
`''` or `"0"` for Add / Clone), `idempotency_key` (§3; optional for STATUS), `source` (`FORM` default / `MOBILE`), `form` (`any`: the
record; `{}` for STATUS).

**Answer** (`response_json`, every field a string): `route, code, message, reason, action, job_id, job_status, terminal, ida_id, ida_no,
line_count, progress_percent, progress_message, error_code, error_message, evidence`.

| route | code | When | Client (§12) |
|---|---|---|---|
| QUEUED | 200 | a job was queued and read back | follow (STATUS every 2.5 s <= 420 s, worker kick every 15 s; an Add answered without a digit `ida_id` waits for its link with the SAME key) |
| STATUS | 200 | operation STATUS, or this key already has a job | non-terminal = as QUEUED; COMPLETED = success (+ post for Complete & Post, never twice); FAILED = error, gen + 1; REQUIRES_REVIEW = warning |
| NOT_ELIGIBLE | 300 | Draft; another stored status; an eligibility reason with moves <= 250 | the classic handler (`triggerEvent`; byte-identical but for its BOM-dialog escape) |
| BUSY | 409 | §2 | warning (the open job's fields filled) |
| STALE | 409 | §2 | warning: reopen the IDA |
| STOP | 400 | a gate, an eligibility reason above 250 moves (`IDA_TOO_BIG`), a limit, the WA screen, the dry run, not found | error message, nothing written |
| STOP | 500 | the queue writes did not read back (`IDA_QUEUE_FAILED`) | error; the next click re-uses the key |
| INVALID | 400 | the request itself | the classic handler (nothing written) |

`terminal` = `YES` for COMPLETED, FAILED, REQUIRES_REVIEW, CANCELLED, NONE. `evidence` = `{ v, workflow, operation, route, code, reason }`
JSON. SUBMIT never answers 401 and never unlocks. STATUS answers the job of `idempotency_key` when given and found, else the IDA's
latest COMPLETE_IDA job (`IDA|<ida_id>`, max id), else the job its `ida_v2_job_id` names; no job: `job_status NONE`, `terminal YES`,
message `IDA_TEXT.noJob`. Every refusal is decided before the first write (no workflow-node call can end the run with an envelope).

**Reads**: (1) guard (code: operation, saveAs, pageStatus, ida_id, key, source, session tenant / uid / uuid nonce, `form.organization_id`
digits); (2) `FACTS`; (3) keys (code, the lifted `code_fillback` + `code_item_ids` over the record: item ids, pick tuples,
`idaHexJson(code_item_ids.batchNumbers)`);
(4) ONE fork-join: `ITEMS`, the costing screen, the WA screen, the duplicate-balance screen, `BNC`, `BATCH_HOLDERS` of the typed numbers
(= the classic `search_batches` rows `code_validate` reads [ruling]). Tuples reach SQL as one JSON text of digit arrays (`idaTuples`).

**Gates, lifted and run in-process** [plan] (`lib/lift`; config `submit/lift.json`; source B's built v7 `Item Disassembly/AsyncV2/IDA_SAVE.json`,
whose bodies `code_fillback`, `code_required`, `code_item_ids`, `code_validate` are byte-identical to v6's - `classic/diff_v6.py`; plus
`base/CHECK_REQUIRED_FIELD.v8.json` `code_node_AeSdXE85`): `workflowparams = { allData: <record, Clone ids stripped>, saveAs: "Completed",
pageStatus: <Add | Edit> }`, `search_items.data.data` = the ITEMS rows, `search_batches.data.data` = the BATCH_HOLDERS rows. CHECK_REQUIRED_FIELD
failure -> STOP 400 `IDA_REQUIRED_FIELDS` with its `data.message`; `code_validate` `Failed` -> STOP 400 `IDA_INVALID` with its message
(the classic's 401 text) [plan]. `code_idem_guard` and the per-pick GLOBAL_INVENTORY_VALIDATION loop are replaced by STALE, the WA screen
and PREPARE's PLAN.

**Typed-number check** [controller ruling F4, 10-21], right after `code_validate` passes: the first line in line order whose
`idaBatchKind` is TYPED and whose item is stock-controlled, with a `BATCH_HOLDERS` row (the rows already read for `search_batches`)
where `idaBatchKey(row.batch_number) === idaBatchKey(line.batch_number)` -> STOP 400 `IDA_INVALID` with code_validate's wording
`IDA_TEXT.typedExists(idaLineLabel(i, line), <the line's trimmed number>)` = "Line <i> (<item_name or item_selection or '-'>): Batch No <n>
already exists." (i = the line's 1-based position). It refuses at the click what PREPARE / D1 would refuse later (case-insensitively, where
the classic gate compares exactly); PREPARE and D1 keep their checks for numbers taken after SUBMIT.

**Eligibility** [plan] -> NOT_ELIGIBLE 300 (moves <= `IDA_CLASSIC_MAX_MOVES`) or STOP 400 `IDA_TOO_BIG` (above), first reason wins:
`item <id> not found`; `handling units` (`idaHasHu`); `serial-numbered source item` (`serial_number_management = 1`); `source item not
stock controlled` (`stock_control = 0`); `item <code> has no stock control setting` (source or recovery `stock_control` NULL [IA ruling 7]);
`<category> stock` (a pick whose `idaCategory` is not Unrestricted / Blocked); `costing migration` (IA's FIFO+WA screen, template
`tpl/iav2/submit/submit_sql.py` `COST`, keyed on every pick's (source, batch or 0) and every stock recovery line's (item, 0), at the
header plant + organization); `duplicate balance rows` (template `DUP`: more than one `item_balance` row per (material, location, plant,
organization) for a pick or a receipt (line item, line `location_id`), or more than one `item_batch_balance` row per (material, location,
batch, plant, organization) for a batch pick); `no stock to receive` (no stock recovery line [ruling]). The WA screen's template is `WA`,
the read-back's `BACK` / `HDR_BY_JOB` / `*_by_job` (same file).

**Limits** [plan]: picks > 5,000 -> STOP 400 `IDA_SPLIT_REQUIRED` (`splitRequired(n, "source picks")`); recovery lines > 5,000 -> the same
(`"recovery lines"`). **WA screen**: a pick of a Weighted Average source without a `wa_costing_method` row (material + plant + organization,
+ batch for a batch pick; GLOBAL_INVENTORY_VALIDATION v11's read) -> STOP 400 `IDA_NO_WA_RECORD` with its text. **Batchnum dry run** [plan]:
when an AUTO line exists, `idaBatchnum(BNC rows, ITEMS rows, the AUTO lines' requests in line order, Date.now())`; `error` -> STOP 400
`IDA_BATCH_CONFIG` with batchnum's text (`No default batch found.`, `<X> Date is required.`, `Invalid date format configuration.`, the
item category / group texts). Nothing is reserved or written.

**Write order** [plan; IA dev 11]:
- **Add / Clone:** job insert -> ONE add of `add_ida`'s props minus `posted_status` (22: `item_disassembly_status 'Processing'`,
  `stock_movement` = the fill-back's lines with their placeholders, `stock_movement_no` / `_type` as the fill-back left them) +
  `ida_v2_job_id`, `ida_idem_key` (= the key) -> read back by `ida_v2_job_id` (FP_HEADER + FP_LINES of that IDA) -> `LOCK|1` -> link
  (correlation / causation / request + idaId, idaNo, issuedNo, lineFingerprint) -> due.
- **Stored Draft:** `LOCK|n+1` (unique; n from `FACTS.ida_lock`) -> job insert -> ONE update of `update_ida`'s props minus `posted_status`
  (23 incl. `id`; minus `stock_movement_no` / `_type` under the number rule) with Processing + the two fields -> read back (OWNER + FP_HEADER
  + FP_LINES) -> due (+ idaNo, issuedNo, lineFingerprint). The whole-subform `stock_movement` write keeps the classic's semantics (rows
  missing from the call are soft-deleted, rows without an id inserted).
- The answer comes from the read-back: QUEUED only when the IDA is Processing under this job (`ida_v2_job_id`), its latest lock is this
  key and the job is QUEUED and linked (`IDA|<id>`); else STOP 500 `IDA_QUEUE_FAILED`. A job whose SUBMIT stopped after its document
  write falls due by itself and PREPARE's entry releases the IDA.

---------------------------------------------------------------------------------------------------------------------------
## 8. IDA_V2_WORKER (C)

**Call** `{ job_id: "<digits>" | "" }` (a job id drives that job; empty drains up to 5 due COMPLETE_IDA jobs of the session tenant,
oldest first, within a 20 s tick budget). **Answer** (strings): `worker_route` (`REJECTED` / `IDLE` / `WORKED`), `processed`, `jobs`
(JSON text `[{ job_id, before, job_status, error_code, ida_id, attempt_count }]`), `job_id`, `job_status`, `result_code`, `result_message`,
`ida_id`, `evidence`. **Built by** `lib/v2build.build_worker(cfg)` [plan]:

```python
IDA_LOCK_JOIN = """LEFT JOIN sm_item_disassembly g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^IDA\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED)
   AND g.is_deleted = 0
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('IDC|', SUBSTRING(j.correlation_id, 5))
                   AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
IDA_ID_COL = "(CASE WHEN g.item_disassembly_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
IDA_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
cfg = V.worker_config(name="IDA_V2_WORKER", code_dir="<idav2>/code/worker", ids_base=<C's choice>, command="COMPLETE_IDA",
                      states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"], lock_join=IDA_LOCK_JOIN,
                      id_col=IDA_ID_COL, prev_col=IDA_PREV_COL, corr_offset=5, id_alias="gr_id",
                      prepare=("IDA_V2_PREPARE", ids["IDA_V2_PREPARE"]), commit=("IDA_V2_COMMIT", ids["IDA_V2_COMMIT"]),
                      unlock=V.status_unlock("Item Disassembly:Table:2106937624568991746", "item_disassembly_status",
                                             {"item_disassembly_status": "Item Disassembly Status"}),
                      cache_prefix="ida_wrk_", renames=[("gr_id", "ida_id"), <C: node-id prefix DW, GR / IA texts>])
```

C's `code/worker/` = IA's `tpl/iav2/code/worker/*` (or GR's `tpl/smv2/code/worker_src_grv2/*`) ending in this state: prevStatus set
`IDA_PREV_STATUSES` with NO default anywhere, the unlock column `item_disassembly_status`, prefix `IDA_`, state `COMMITTING_IDA`, the
`IDA|` regex / offset 5 / `IDC|` lock, IDA texts. **Hard codes** (fail at once, no retry): `IDA_INVALID_REQUEST, IDA_INVALID_DATA,
IDA_NOT_FOUND, IDA_NOT_LOCKED, IDA_NOT_ELIGIBLE, IDA_LINES_CHANGED, IDA_SPLIT_REQUIRED, IDA_PLAN_BROKEN, IDA_PLAN_SKIPPED,
IDA_BATCH_CONFIG, IDA_BATCH_DUPLICATE, JOB_ILLEGAL_TRANSITION` [ruling: + the two batch codes].

**Tick rule** [plan; WP0 2]: a tick runs PREPARE, then COMMIT A, then COMMIT B. D2's hand-over is SPLIT (`lease_owner SPLIT|<nonce>`,
`lease_expires_at` = the entry's lease_until, next_attempt_at null; split.js calls COMMIT again in the same tick) when
`counts.movementsI <= IDA_PARK` AND `counts.movementsR <= IDA_PARK`; else PARK (lease cleared, `next_attempt_at` = db_now; the next tick
resumes phase B). Both reset `attempt_count` to 0 and set progress 75 `P75`. **Chain budget** [controller ruling 10-21]: a tick is ONE
synchronous request chain (dev died at ~68 MB in one request); above 2,000 moves (`IDA_PREPARE_ALONE_MOVES`, C's constant) the WORKER ends
the tick right after a successful PREPARE (READY_TO_COMMIT, due now) and the next tick runs COMMIT A; <= 2,000 moves unchanged. COMMIT
writes `attempt_count` 0 when it claims a READY_TO_COMMIT job (PREPARE's retries never shrink D1's / D2's) [C review Minor 1], and again
at D1 DONE when it is above 0 (D1's renumber tries and retries never shrink D2's 8 lock waits) [renumber, 10-22]. A COMMITTING_IDA job is
resumed whatever its `error_code`: COMMIT's waits (`IDA_STEP_RETRY`, `IDA_LOCK_WAIT`, `IDA_WAIT`, `IDA_BATCH_RETRY`) need no worker code.

---------------------------------------------------------------------------------------------------------------------------
## 9. IDA_V2_PREPARE (A) and IDA_V2_COMMIT (C) - called by the worker only

| Workflow | Request | Answer (strings) |
|---|---|---|
| IDA_V2_PREPARE | `job_id` of a VALIDATING COMPLETE_IDA job the worker holds | `job_id, job_status, result_code, result_message, evidence` (the job row read back is the truth) |
| IDA_V2_COMMIT | `job_id` of a READY_TO_COMMIT job, or COMMITTING_IDA to resume | `RES_FIELDS` = `job_id, job_status, path, result_code, result_message, evidence`; path `REJECTED_INPUT` / `NO_WRITE` / `ENTRY_END` / `LOST` / `D<n>_END` / `SPLIT` / `PARK` / `DONE` |

Node-id prefixes [ruling]: SUBMIT `DS`, PREPARE `DP`, COMMIT `DC`, WORKER `DW`, v7 guard `IDAguard` (e.g. `code_node_DCentry`).

### PREPARE [plan]

- **Entry** (as IA §9): a VALIDATING COMPLETE_IDA job under a live lease; `IDA|<id>` -> the IDA. No correlation (SUBMIT died before
  "link") -> the IDA found by `ida_v2_job_id = <jobId>` and Processing -> FAILED + unlock `IDA_INVALID_REQUEST` (`IDA_TEXT.unlinked`) with
  the link written in the same job update (correlation, causation, request + idaId, idaNo, issuedNo) [IA R8]. An unreadable request ->
  REQUIRES_REVIEW `IDA_PREV_STATUS_UNKNOWN` (no unlock) [IA ruling 4]; prevStatus not Draft -> the same.
- **Reads**: the job first (its correlation gives `@IDA`, and a stale call stops before the big reads [A deviation, accepted]), then ONE
  fork-join, every read keyed by `@IDA` / `@JOB` / tenant, the stored rows joined inside SQL - no dependent read: `OWNER`; `FP_HEADER`;
  `FP_LINES`; `ITEMS_STORED`; `BINS_STORED`; `BATCH_TYPED_STORED`; PREPARE's own `LINE_STORAGE` (line id + `storage_location_id`, which the
  shared FP_LINES does not select and the lifted code_validate requires; merged into the stored lines by id) [A fix round 1, accepted].
- **Checks** (in order; unlock only after the lock check passed): the IDA exists (`IDA_NOT_FOUND`); the job owns it (else FAILED
  `IDA_NOT_LOCKED`, no unlock); request DIRECT / Completed / prevStatus Draft (`IDA_INVALID_REQUEST`); a real number (not `issued` /
  `draft` / blank) equal to the request's `idaNo` (`IDA_PLAN_BROKEN`); `idaLineFingerprint(FP_LINES, FP_HEADER)` = `request.lineFingerprint`
  (`IDA_LINES_CHANGED`); fresh item facts still eligible (every §7 eligibility reason except the SQL screens; `IDA_PLAN_FAILED` with the
  reason); the LIFTED classic `code_validate` on the stored document with the fresh ITEMS_STORED / BATCH_TYPED_STORED rows (storedStatus =
  prevStatus) -> `IDA_INVALID` with its message + ": nothing was moved." [controller ruling 10-21: closes the SUBMIT -> PREPARE window for
  item-master changes, e.g. a recovery item turned serial-managed or Manual-batch]; a TYPED number held by a live org Batch row (`BATCH_TYPED_STORED`, compared with `idaBatchKey`) -> `IDA_BATCH_DUPLICATE`
  `IDA_TEXT.typedTaken(label, n)` [ruling]; 1..5,000 movements per leg (`IDA_PLAN_FAILED` / `IDA_SPLIT_REQUIRED`). Each refusal: FAILED +
  unlock (except where said).
- **Builds** ENGINE_I, ENGINE_R (+ alloc), BATCH (+ items), LABELS, ITEMS exactly as §5, the manifest, `batchMode`; every movement is
  checked (digit material / plant / bin, digit or `""` UOM, quantity > 0, the header's organization, plant (op 1) and number) else
  `IDA_PLAN_BROKEN`; job `line_count` = moves. A may lift
  `code_fillback`, `code_issue_prep`, `code_issue_pick`, `code_batch_plan`, `code_cost_alloc` (its receipt params; the price is D3's),
  `code_item_txn`, and (fix round 1) `code_validate` (the gate above) from `base/IDA_SAVE.v6.json` (config `lift/lift.json`) [ruling]; the result must equal the §5 field list.
- **Engine PLAN** of ENGINE_I (`mode PLAN`, key `IDC|<jobId>|I`) and of ENGINE_R (`mode PLAN`, `IDC|<jobId>|R`, `unit_price 0`, `batch_id
  null`) in ONE fork-join: PLAN takes no lock, writes nothing and ignores the key's DONE / REVIEW rows [IA dev 14]. `results` read as an
  array or its JSON text (unreadable -> `IDA_PLAN_FAILED`) [IA R7]. 200 with every per-movement code `"200"` -> go on; any other
  per-movement code (incl. `"401"`) -> FAILED + unlock `IDA_PLAN_SKIPPED` (`idaMapEngineMessage(message + " (movement <key>)", LABELS, keys)
  + ": nothing was moved."`); 400 with a result_code -> FAILED + unlock `IDA_INVENTORY_<result_code>` (LABELS-mapped); anything else
  (incl. 400 without a result_code) -> FAILED + unlock `IDA_PLAN_FAILED` [IA ruling 4]. A crashed engine run fails the PREPARE run (the
  worker's dead-lease rule retries).
- **Ready** -> READY_TO_COMMIT (progress 60) with the manifest; a throw -> `IDA_PLAN_BROKEN`, unlocking only when it came after the lock
  check.

### COMMIT [plan; IA's step framework `tpl/iav2/code/commit`; D1 = GR C1]

Each step reads its part and fresh rows; at the after-value = done, at the before-value = write, otherwise per its table; writes; reads
back; writes `<STEP> DONE`. `jobRow`'s default progress = this pass's (A 70, B 75 / 85) [IA dev 7]. Primitives (IA `_common.js`, renamed):
`stepOk`, `stepEnd` (2 s x 2^n, max 30 s; after `MAX_RETRIES` 3 -> REQUIRES_REVIEW `IDA_RECONCILIATION_MISMATCH`), `stepWait`
(not counted), `lockWait` (15 s x 2^n, cap 300 s, attempt + 1, `IDA_LOCK_WAIT`), `reviewEnd`, `failNoWrite` (below), D1's `d1Renumber`
(`_d1.js`, below). In phase A a step that must give up after its retries calls `failNoWrite` itself (never `stepEnd`'s review).

**"Ours"** [ruling]: the `BATCH_OURS` rows whose (`idaBatchKey(batch_number)`, material_id, plant_id) equals a planned BATCH row's (TYPED:
its number; AUTO: the D1 intent's number) - re-derived from the table each time it is needed (a 2,000-row map does not fit a step
ref). `oursByKey` = row key -> that row's id (exactly one per inserted planned row).

**failNoWrite** (phase A only) = job FAILED (`progress_message` "Not completed: <reason>") + the unlock (§2) when the job still owns the IDA
+ `{ id, is_deleted: 1 }` for ours (slices of 250; ids filtered in code) + the job row last (exit order unlock -> Batch soft-delete -> job
[IA ruling 5]). Ours are read (BATCH part + D1 intent + `BATCH_OURS`) only on this path and only when a D1 intent exists; an unreadable
part / intent -> no soft-delete (runbook). Counters stay advanced (as the classic). **Once EITHER op has an engine row** (`OP_STATE` I or R:
intents > 0, review > 0, or a DONE summary - the entry's read), every phase-A `failNoWrite` writes REQUIRES_REVIEW
`IDA_RECONCILIATION_MISMATCH` instead (`error_details.wouldFail` = the code): no unlock, no soft-delete [IA R2, extended to op 2: ruling].
**Phase B** never unlocks and never fails: its failures are REQUIRES_REVIEW.

**d1Renumber** [user decision 10-22: two overlapping auto-batch completions renumber instead of both failing] (D1 rows 4 / 6 / 10) = when
EVERY planned number a foreign holder holds is a generated (AUTO) number of this job only (no TYPED row plans it), `entry.attempts <
IDA_BATCH_RENUMBER_TRIES` (5, COMMIT-own in `_d1.js`), no engine row (R2), and - rows 6 / 10 - the `D1|I|` intent rows read back with
their ids, or - row 4, no intent and nothing of ours yet [controller ruling 10-22] - every holder's id is greater than the job's (digit
text, `idaIdAfter`: a concurrent writer; an older holder is a configuration behind, F5, and fails at once; nothing to delete or retire): ours
`{ id, is_deleted: 1 }` (slices of 250) -> the intent rows `{ id, step_name: "D1|X|<id>", is_deleted: 1 }` (slices of 250, ids from the
`INTENT` read, filtered in code to `D1|I|`) -> the job row LAST: COMMITTING_IDA, `attempt_count + 1`, `next_attempt_at = db now + wait`, an
ASYMMETRIC wait [review M1, 10-22: a WORKER kick every 15-18 s would wake two symmetric 5-25 s waits together]: 5 s (`short`) when
this job's own colliding Batch row (rows 6 / 10: ours holding a taken number) has a lower id than EVERY foreign holder of the taken
numbers (digit text, `idaIdAfter`; both racing jobs read the same rows, so exactly one goes first), else `20 + floor(random x 11)` s
(`long`, 20-30 s: row 4, no colliding row of ours, a tie or an unknown id) (`_d1.js` `d1Wait`); `error_code` `IDA_BATCH_RETRY`,
`error_message` "D1_BATCH: batch number <n> was taken by another document at the same moment - renumbering (try <k> of 5)",
`error_details` `{ step: "D1_BATCH", why, numbers, wait: <seconds>, waitReason: "short" | "long" }`, progress unchanged, the lease
released (as `stepEnd`); no unlock (the IDA stays Processing). The next pass has no intent and numbers afresh from a fresh `BNC` read,
already past the collided numbers (they stay consumed, as the classic leaves a failure's). Crash points: ours deleted, intent present ->
the next pass plans the OLD numbers again: still held -> row 6 renumbers again, free -> re-inserted and re-checked; intent retired ->
numbered afresh. A TYPED number taken, or the tries spent: failNoWrite `IDA_BATCH_DUPLICATE` as before.
D1 DONE then writes `{ id, attempt_count: 0 }` when the count is above 0 and D2 counts from 0 in that pass (§8).

| Step | Ph | Reads | Writes | Decisions (-> outcome) |
|---|---|---|---|---|
| entry | - | ONE fork-join: job (+ db_now, lease_until, due, error_details, prev_status, key, correlation), its `D` step rows, the `D1|I|` intent rows, the manifest, `OWNER`, `OP_STATE(I)`, `OP_STATE(R)` | lease `PUB|<nonce>`, `lease_expires_at = idaDbAddSeconds(db_now, idaLeaseSeconds(movementsI + movementsR))`, or 5,400 s for a phase-B pass with `movementsR > IDA_PARK` (SQL's 10 min when the manifest is unreadable), COMMITTING_IDA, progress 70 / 75 / 85 | phase B = D2_ISSUE DONE. Not this job / not READY_TO_COMMIT-COMMITTING_IDA -> answer only (`IDA_INVALID_DATA` / `JOB_ILLEGAL_TRANSITION`); a live foreign lease (not `SPLIT|`) -> `JOB_ROW_VERSION_CONFLICT`; not due -> answer only. Phase A: manifest invalid -> failNoWrite `IDA_INVALID_DATA`; IDA not owned -> failNoWrite `IDA_NOT_LOCKED`. Phase B: manifest invalid, or the IDA not Processing / Completed under this job's `ida_v2_job_id` and lock key -> REVIEW `IDA_RECONCILIATION_MISMATCH`; batchMode insert without a D1 DONE row -> REVIEW |
| D0_REVALIDATE | A | OWNER (entry), FP_HEADER, FP_LINES | - | Processing under this job and lock key, number = manifest `ida_no`, `idaLineFingerprint` = manifest `lineFingerprint` -> DONE (ref = the fingerprint); not owned -> failNoWrite `IDA_NOT_LOCKED`; number or fingerprint differs -> failNoWrite `IDA_LINES_CHANGED` |
| D1_BATCH | A | (batchMode insert only) fork-join: BATCH part, `D1|I|` intent, `BNC` (fresh); then `BATCH_HOLDERS(idaHexJson(every planned number))`; read-back fork-join: intent, `BNC`, `BATCH_HOLDERS`, `BATCH_OURS` | intent `D1|I|<nnn>` (BEFORE anything else), `batch_number_config` `{id, running_number, last_reset_date}` (after-state, forward only), Batch rows (add-node, `BATCH_COLS`, slices of 250 [WP0 4]), then the re-PLAN of op 2 | see the D1 table below |
| D2_ISSUE | A | ENGINE_I part; `OP_STATE(I)`; LABELS only after a 400 | INVENTORY_BULK_APPLY APPLY `IDC|<jobId>|I` | 200 (incl. REPLAYED; `"401"` skips inside a 200 tolerated here, refused by D3 plan [final review M3]) -> DONE (ref = the summary) + SPLIT / PARK (§8), progress 75; 400 WITH a result_code -> failNoWrite `IDA_INVENTORY_<result_code>` (LABELS-mapped); 409 whose message contains "the same operation is still running" (engine v12: a resumed pass over a live earlier run) -> attempts >= 8 ? REVIEW : lockWait, even with intents [engine owner's rule, 10-21]; other 409, no answer, or 400 WITHOUT a result_code -> op-1 intents > 0 ? stepEnd (retry -> REVIEW) : attempts >= 8 ? failNoWrite `IDA_INVENTORY_LOCK_BUSY` : lockWait; 500 or anything else -> REVIEW `IDA_RECONCILIATION_MISMATCH` |
| D3_RECEIPT | B | ENGINE_R part, BATCH part + D1 intent + `BATCH_OURS` (when insert), `OUT_TOTALS`, `OP_STATE(I)` (entry), `OP_STATE(R)` intents, the job's `error_details.waitFrom` | APPLY `IDC|<jobId>|R` (movements with `unit_price` = `idaAllocate` and `batch_id` = `oursByKey[batch_key]`: the same request on every retry); job progress 80 | op 1 DONE, no op-1 `IBA|REVIEW` and `OUT_TOTALS.n` = op 1's `done_summary.movements`, else REVIEW `IDA_RECEIPT_COUNT_MISMATCH` (op 2 not started); a batch line without exactly one ours -> REVIEW `IDA_RECONCILIATION_MISMATCH`; 200 (incl. REPLAYED) with every R result `"200"` or `"401"` -> DONE + progress 80 `P80` (a `"401"` = the item turned non-stock after both PLANs: tolerated like D2, classic parity - ADD answers 401 and that line's share is not received; the skipped R keys are listed in the D3 DONE ref and the progress message) [controller ruling 10-21]; any other R result -> REVIEW `IDA_RECEIPT_REFUSED`; 409, no answer, 400 WITHOUT a result_code -> stepWait 10 s until 1,800 s after D3's FIRST transient answer (`waitFrom` in `error_details`) [IA R4], then REVIEW `IDA_RECEIPT_TIMEOUT`; 400 WITH a result_code or 500 -> REVIEW `IDA_RECEIPT_REFUSED`. Never unlocks |
| D4_FINISH | B | BATCH part + D1 intent (insert), `LINES_BATCH`, ITEMS part, OWNER | (1) every AUTO row's number into its lines' `batch_number` where the stored value differs (line collection `Stock movement(Item Disassembly):Table:2107013922280640514`, `{id, batch_number}`, slices of 250 - GR C1B) [WP0 5]; (2) Item `last_transaction_date` (slices of 250, one `new Date().toISOString()` per pass); (3) the header `{ id, item_disassembly_status: "Completed", posted_status: "Unposted" }` LAST (the unlock) | header Completed under this job and every AUTO line holds its number -> DONE (nothing written again); Processing under this job -> write, read back: Completed + numbered -> DONE, else stepEnd (retries -> REVIEW); anything else (not this job's, missing) -> REVIEW `IDA_RECONCILIATION_MISMATCH` |
| finish | B | - | job COMPLETED, progress 100, `finished_at = endNow(entry)`, lease released | the header write was the unlock |

**D1_BATCH decisions** (GR C1 + [plan] + the controller's post-insert re-check; "planned numbers" = every TYPED row's number + every AUTO
row's generated number, `insert: false` rows included):

| # | Condition | Outcome |
|---|---|---|
| 1 | the BATCH part unreadable / a row without kind, key or (TYPED) number | failNoWrite `IDA_INVALID_DATA` |
| 2 | an intent exists but does not parse | REVIEW `IDA_RECONCILIATION_MISMATCH` |
| 3 | no intent: AUTO numbers = `idaBatchnum(fresh BNC, BATCH.items, AUTO requests in row order, Date.now())` returns `error`; or (intent) a config the intent names is gone from BNC | failNoWrite `IDA_BATCH_CONFIG` with batchnum's text (or "batch number configuration <id> no longer exists") + ": nothing was moved" (+ ours) |
| 4 | no intent: a live org Batch row (any item, `BATCH_HOLDERS`) holds a generated number | every holder newer than the job (id > jobId as digit text: a writer that numbered from the same config value), every held number only a generated one and tries left: d1Renumber with nothing to delete or retire (the next pass reads `BNC` fresh) [controller ruling 10-22]; else (an older holder = a configuration behind, F5; a TYPED one; the tries spent) failNoWrite `IDA_BATCH_DUPLICATE` `IDA_TEXT.batchDuplicate(n)` (GENERATE_BATCH's refusal; config not advanced) |
| 5 | no intent: a live org Batch row holds a TYPED number (taken since SUBMIT) | failNoWrite `IDA_BATCH_DUPLICATE` `IDA_TEXT.typedTaken(label, n)` |
| 6 | intent exists: a holder that is not ours holds a planned number | every such number only a generated one of this job and tries left: d1Renumber (ours + the intent retired, due in 5 s or 20-30 s); else failNoWrite `IDA_BATCH_DUPLICATE` `batchDuplicate(n)` (+ ours soft-deleted) |
| 7 | a planned row with two or more ours | failNoWrite `IDA_BATCH_FAILED` `batchFailed("inserted twice")` (all of them soft-deleted) |
| 8 | else write: intent (when none) -> each config to its after-state unless it already holds it or has moved past it (a running number never goes back; GR `c1_decide`) -> the planned rows with `insert: true` and no ours (add-node, slices of 250) | - |
| 9 | read-back: an intent missing, an inserted planned row without its ours, or a config behind its after-state | retry (`stepEnd`); after 3 retries failNoWrite `IDA_BATCH_FAILED` (+ ours soft-deleted) |
| 10 | **post-insert re-check** [controller ruling 10-21]: any OTHER live org Batch row (not ours; compared as `utf8mb4_general_ci` = `idaBatchKey`) holds one of our numbers | every such number only a generated one of this job and tries left (the live race of 10-21, Batch-00641): d1Renumber; else (a TYPED number, or 5 tries spent) failNoWrite `IDA_BATCH_DUPLICATE` `batchDuplicate(n)` (+ ours soft-deleted; nothing moved; the next click gets new numbers) |
| 11 | re-PLAN op 2 (`mode PLAN`, `IDC|<jobId>|R`, every R with `batch_id` = `oursByKey[batch_key]`, `unit_price 0`) - skipped when no planned row inserts [ruling]: 200 with every R `"200"` | D1 DONE `{"rows","inserted","adopted"}` |
| 12 | re-PLAN: an R result not `"200"` | failNoWrite `IDA_PLAN_SKIPPED` (LABELS-mapped + ": nothing was moved.") (+ ours) |
| 13 | re-PLAN: 400 with a result_code | failNoWrite `IDA_INVENTORY_<result_code>` (+ ours) |
| 14 | re-PLAN: no answer / 409 / 400 without a result_code | retry; after 3 retries failNoWrite `IDA_PLAN_FAILED` (+ ours); anything else -> failNoWrite `IDA_PLAN_FAILED` (+ ours) |

"Ours" (rows 6-14) is decided only with an intent; with none every holder is foreign (the intent precedes every write). Two planned rows
sharing one number (a typed number equal to a generated one) are both ours (classic parity).

**REQUIRES_REVIEW runbook** (C writes it into `Item Disassembly/AsyncV2/README.md`): the IDA stays Processing and the engine keeps its
locks (they block GD / GR / SA / Putaway / IA V2 on those items) until resolved. (1) Read the job (`error_code`, `error_details.step`) and
both ops' rows (`gd_publish_step` where `job_id IN ('IDC|<jobId>|I', 'IDC|<jobId>|R')`), the job's `D*` rows and `D1|I|`. (2) Op 1 under
review: fix the cause, soft-delete that `IBA|REVIEW`, reset the job (`COMMITTING_IDA`, attempt_count 0, lease cleared, next_attempt_at
now, error cleared), re-kick: COMMIT resumes at D2 (op 2 never starts first). (3) Op 1 DONE, op 2 under review or D3 stopped: check op 1's
OUT rows (`OUT_TOTALS`), fix, soft-delete op 2's `IBA|REVIEW` if any, reset the same way, re-kick: COMMIT resumes at D3 (same prices, same
request; the cleared `error_details` opens a fresh 30-minute window). (4) Dev: the user runs the writes (`.dbtools/dbw`, one yes each).

---------------------------------------------------------------------------------------------------------------------------
## 10. Error codes - `job.error_code` / SUBMIT `error_code`; the message is what the user reads (`IDA_TEXT.<key>` in `ida_common.js`; wording not fixed by the plan or a lifted body is [ruling])

| Code | Where | Route / job | Message |
|---|---|---|---|
| IDA_INVALID_REQUEST | SUBMIT guard; PREPARE / COMMIT entry | INVALID 400; FAILED | SUBMIT: what is wrong; PREPARE unlinked: `unlinked` "The completion stopped before the Item Disassembly was linked to its job: please complete it again." |
| IDA_NOT_FOUND | SUBMIT; PREPARE | STOP 400; FAILED | `notFound` "Item Disassembly not found - it may have been deleted." |
| IDA_BUSY | SUBMIT; classic v7 | BUSY 409; classic 400 | `busy` "This Item Disassembly is being processed in the background - please wait for it to finish." [plan] |
| IDA_UNDER_REVIEW | SUBMIT | BUSY 409 | `underReview` "Its last completion stopped half-way and is under review: please contact support." |
| IDA_STALE | SUBMIT | STALE 409 | `stale(status)` "This Item Disassembly was changed by someone else (it is now <status or 'without a status'>). Please close it and open it again." |
| IDA_ALREADY_FINAL | SUBMIT | STALE 409 | `alreadyFinal(status)` "This Item Disassembly is already <status>." |
| IDA_CLASSIC_FINAL | classic v7 (Edit + saveAs Draft) | classic 409 | `classicFinal(status)` "This Item Disassembly is already <status> and cannot be saved again." (= `code_idem_guard`'s text) |
| IDA_NOT_ELIGIBLE | SUBMIT | NOT_ELIGIBLE 300 | the reason (§7; to the classic save) |
| IDA_TOO_BIG | SUBMIT | STOP 400 | `tooBig(n, reason, 250)` "This Item Disassembly has <n> source picks and recovery lines and cannot be completed in the background (<reason>); the classic save handles at most 250." |
| IDA_CLASSIC_TOO_BIG | classic v7 | classic 400 | `classicTooBig(n, 250)` "This Item Disassembly has <n> source picks and recovery lines - too big for the classic save, which handles at most 250 at once. Complete it from the web form with background completion switched on, or split it into smaller disassemblies." |
| IDA_SPLIT_REQUIRED | SUBMIT; PREPARE | STOP 400; FAILED | `splitRequired(n, what)` "This Item Disassembly has <n> <source picks / recovery lines>. At most 5,000 can be moved at once - please split the disassembly." |
| IDA_REQUIRED_FIELDS | SUBMIT | STOP 400 | CHECK_REQUIRED_FIELD's `data.message` (classic `return_required_400`) |
| IDA_INVALID | SUBMIT; PREPARE | STOP 400; FAILED | `code_validate`'s message (the classic answers it with 401), or the typed-number check's `typedExists(label, n)` "<label>: Batch No <n> already exists." [F4]; PREPARE: + ": nothing was moved." |
| IDA_NO_WA_RECORD | SUBMIT | STOP 400 | GLOBAL_INVENTORY_VALIDATION v11: "No Weighted Average costing record for item <code> at this plant[ (batch <id>)]. The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock." |
| IDA_BATCH_CONFIG | SUBMIT dry run; COMMIT D1 | STOP 400; FAILED | batchnum's (= GENERATE_BATCH v20's) text; D1 + ": nothing was moved" |
| IDA_QUEUE_FAILED | SUBMIT | STOP 500 | `queueFailed` "The completion could not be queued: please try again." |
| IDA_NOT_LOCKED | PREPARE; COMMIT | FAILED | `notLocked` "The Item Disassembly is no longer locked by this completion: nothing was moved." |
| IDA_LINES_CHANGED | PREPARE; COMMIT D0 | FAILED | `linesChanged` "The Item Disassembly's lines changed while it was waiting: nothing was moved, please complete it again." |
| IDA_PLAN_SKIPPED | PREPARE; COMMIT D1 | FAILED | the LABELS-mapped engine message + ": nothing was moved." |
| IDA_PLAN_FAILED / IDA_PLAN_BROKEN | PREPARE; COMMIT D1 (FAILED) | FAILED | `planFailed(why)` "The completion could not be prepared: <why>" (BROKEN = an internal invariant broke) |
| IDA_INVENTORY_<engine code> | PREPARE PLAN 400; COMMIT D1 re-PLAN / D2 400 | FAILED | the LABELS-mapped engine message, e.g. "Insufficient quantity - source pick 1 (FG-0001), bin A1-B2 (Unrestricted)" |
| IDA_INVENTORY_LOCK_BUSY | COMMIT D2 | FAILED | `lockBusy` "The stock of the item being disassembled stayed locked by another operation: nothing was moved, please try again later." |
| IDA_BATCH_DUPLICATE | PREPARE; COMMIT D1 | FAILED | generated / race: `batchDuplicate(n)` "Duplicate Batch Format found. (batch number <n>) Nothing was moved." (D1 row 4: a holder older than the job; rows 4 / 6 / 10: a typed number taken, or after 5 renumber tries; else a generated one renumbers, `IDA_BATCH_RETRY`); typed: `typedTaken(label, n)` "<label>: Batch No <n> already exists. Nothing was moved." with `code_validate`'s label `'Line ' + i + ' (' + (item_name or item_selection or '-') + ')'`, i = the line's 1-based position in line order |
| IDA_BATCH_FAILED | COMMIT D1 | FAILED | `batchFailed(why)` "The Batch rows of the recovered items could not be created (<why>): nothing was moved, please complete it again." [ruling] |
| IDA_RECEIPT_COUNT_MISMATCH / IDA_RECEIPT_REFUSED / IDA_RECEIPT_TIMEOUT | COMMIT D3 | REQUIRES_REVIEW | `review` (details: stored rows vs op 1's code-200 results, or op 1 skipped a source pick ('401', nothing issued) [final review M3] / the engine answer / waited 1,800 s) |
| IDA_BATCH_RETRY | COMMIT D1 (rows 4 / 6 / 10) | transient (job COMMITTING_IDA, due in 5 s when its own colliding row is the oldest, else 20-30 s) | "D1_BATCH: batch number <n> was taken by another document at the same moment - renumbering (try <k> of 5)" (error_message; the progress message unchanged) |
| IDA_LOCK_WAIT, IDA_STEP_RETRY, IDA_WAIT, IDA_TRANSIENT | COMMIT / WORKER | transient (job open) | progress_message only |
| IDA_TRANSIENT_RETRIES_EXHAUSTED | WORKER | FAILED | `notCompleted` "Temporary failures persisted; not completed." |
| IDA_RECONCILIATION_MISMATCH | COMMIT / WORKER | REQUIRES_REVIEW | `review` "Under review: the completion stopped half-way. Please contact support." |
| IDA_PREV_STATUS_UNKNOWN | any unlock | REQUIRES_REVIEW | `prevUnknown` "Under review: the status to restore is unknown. Please contact support." |
| IDA_INVALID_DATA | guards / entries / D1 | answer only / FAILED | internal (job not found, bad id, an unusable part) |
| JOB_ILLEGAL_TRANSITION, JOB_ROW_VERSION_CONFLICT | shared | answer only | internal |

Client-only texts: `postLater` "Still completing in the background; post it from the list once it shows Completed."; `noJob` "no background save".

---------------------------------------------------------------------------------------------------------------------------
## 11. The classic IDA_SAVE v7 (B) - ships whatever the switches [plan, user decision 3]

`Item Disassembly/AsyncV2/IDA_SAVE.json` = `base/IDA_SAVE.v6.json` (md5 above; B re-checks it against live before the publish) + exactly
two changes; every other node byte-identical, proven node by node by `classic/diff_v6.py` (as `tpl/iav2/classic/diff_v11.py`). Answers
keep the return-node shape `{ code, message }` (status 200); never 401 from a new node.

1. **New first nodes, between `start` and `code_fillback`** (IA v12 pattern, `tpl/iav2/classic/patch_v12.py`; ids `code_node_IDAguardIn`
   -> `if_IDAguardRead` [true: `sql_node_IDAguard` -> `code_node_IDAguardStored` -> `if_IDAguard400` [true: `return_node_IDAguard400`],
   `if_IDAguard409` [true: `return_node_IDAguard409`]] -> `if_IDAguardBig` [true: `return_node_IDAguardBig`]; return nodes copied from
   `return_required_400` / `return_idem_409`; if nodes copied from `if_idem_blocked`, Expression `'<flag>' == 'YES'`; a fresh filter-id
   range and a seeded key RNG, no collision with v6):
   - stored-status checks ONLY when `pageStatus === 'Edit'` and `allData.id` is digits [IA review 5; ruling: the IDA Clone sends
     `page_status` `Clone` and may carry the source id]: ONE SQL `CLASSIC_GUARD`; stored `Processing` -> 400 `IDA_TEXT.busy` (any saveAs);
     stored `Completed` / `Fully Posted` with saveAs `Draft` -> 409 `IDA_TEXT.classicFinal(status)` (the stale-tab bug);
   - saveAs not Draft (any page) with `idaMoveCount(allData header, allData.stock_movement) > IDA_CLASSIC_MAX_MOVES` -> 400
     `IDA_TEXT.classicTooBig(n, 250)` [IA ruling 7];
   - it reads neither `gd_async_job` nor any V2 table, and no stored pick count [IA dev 2].
2. **`code_cost_alloc`** (one contiguous replacement): `unit_price: qty > 0 ? q8(lineValue / qty) : 0` becomes
   `unit_price: baseQty > 0 ? q8(lineValue / baseQty) : 0` with `baseQty` = ADD_INVENTORY v65's own conversion from the item's
   `search_items` row: `alt = line.quantity_uom || item.based_uom`; the `table_uom_conversion` row whose `alt_uom_id` equals `alt`
   (compared as text); `baseQty = row ? q8(qty * Number(row.base_qty)) : qty` (= `idaUomOf`). The quantity share, the last-line
   remainder, `issuedValue` (its trx_no read), the receipt fields and the HU / Item stamp nodes are unchanged [plan].

Not changed: the GENERATE_BATCH loop and its Redis array, the blank Batch row per non-batch line, `code_idem_guard`, the 401 / 402 answers.

---------------------------------------------------------------------------------------------------------------------------
## 12. Client (D) - form base `base/ida_form_v35.json`, list base `base/ida_list_v17d.json` (the list's designing v17 = v16 + two designer defaults; ruling 10-21), builder `client/build_client.py` (own anchors)

- **Handlers:** one source `client/src/idaV2_onClick_completed.js` (template `tpl/iav2/client/src/iaV2_onClick_completed.js`) built into
  `idaV2_onClick_completed` (POST false, classic `onClick_saveAsCompleted`, key `iasvcomp`) bound to `button_completed` (`dxpzlyqp`) and
  `idaV2_onClick_completed_post` (POST true, classic `onClick_saveAsCompletedPost`, `aymq6q8z`) bound to `comp_post_button` (`lnfr8gna`).
  New event keys: 8 of `[a-z0-9]`, unique in the form. The classic handlers stay byte-identical but for the BOM-dialog escape
  (10-22; rollback = rebind).
- **Route:** V2 when `ASYNC_IDA_ENABLED`, the action is ON (`COMPLETE` for Completed; `COMPLETE_POST` or, when it is OFF, `COMPLETE`
  for the post button), both workflow ids set (SUBMIT, WORKER), the page is Add / Clone or an Edit of a stored Draft, moves >
  `IDA_V2_MIN_MOVES` (§1, no item read), no HU (`idaHasHu`) and no serial pick (`idaPickHasSerial`). Anything else, an exception before
  SUBMIT, a NOT_ELIGIBLE or INVALID answer -> `this.triggerEvent(<classic>)`, once. The V2 path first runs IDA's own `validateForSave`
  (a bare `this.validate()` would send every dialog-picked IDA to the classic) and `confirmBomVariance`, both copied from `iasvcomp`:
  `validateForSave` verbatim, `confirmBomVariance` verbatim except its three names HTML-escaped (`idaEscHtml`: the line's item name,
  the removed component's name / code, the BOM version - the dialog renders HTML) [security review 10-21; since 10-22 the classic
  handlers carry the same three escapes (user decision), otherwise byte-identical] (Cancel ends the click; a NOT_ELIGIBLE fallback shows the classic's confirm again - accepted).
- **NOT_RECORD** (real payloads: dev runs 2110921351171846145, 2108127883327025153): `ida_v2_job_id`, `ida_idem_key`, `_data`, `$_v`,
  `_vts`, `isTrusted`, `sm_item_balance`, `button_draft`, `button_completed`, `comp_post_button`, `button_post`, `button_kdsxzl2q`,
  `draft_status`, `issued_status`, `completed_status`, `fullyposted_status`, `processing_status`, `flex_2det1nd2`, `flex_t6y2yh5r`,
  `ida_source_stock_mode`, `item_display_table`, every `dialog_*` key. Columns (`page_status`, `table_item_balance`, `table_hu`, ...) stay.
- **Constants:** `IDA_POLL_MS` 2500, `IDA_KICK_MS` 15000, `IDA_WAIT_MS` 420000, `IDA_LINK_POLL_MS` 3000, `IDA_LINK_WAIT_MS` 90000,
  `IDA_KICK_MAX` 10; `_data` slots `ida_submitting`, `ida_page_token`, `ida_gen`, `ida_pinned_new`, `ida_pinned_edit`; `localStorage`
  `ida_v2_failed_seen_<jobId>`, `ida_v2_posted_<jobId>` (the per-job post mark, set before the post's first await, then the stored status / posted_status re-read), list `ida_v2_worker_kick_at`. A click claims `ida_submitting` right after its `=== 1` check, before the first await, and every exit releases it [D review, Important 1]; two browsers that both see COMPLETED within the same round trips can still both post (no server-side dedupe in ACC_PRODUCER) - README.
- **Requests:** every SUBMIT / STATUS call sends every key of §7 (STATUS: `pageStatus` `Edit`, `form` `{}`, `ida_id` `"0"` while an Add is
  unlinked); the WORKER kick sends `{ job_id }`.
- **Answers** (IA template): QUEUED / running STATUS -> follow; STOP 500 or no answer -> keep the key, message; a SUBMIT answer without a
  `route` -> show its `msg` (inner text of `执行工作流节点[<node>]报错[<text>]`), keep the key; FAILED -> error, `gen + 1`; a new IDA that
  failed is a saved Draft: close the form.
- **Verdict:** Completed -> terminal, or COMMITTING_IDA at >= 80 ("the stock has moved; it is being finished in the background") then the
  kick loop (<= 10 calls). Complete & Post -> post ONLY on a COMPLETED verdict by the classic `postToAccounting(idaId, organizationId)` body
  from `aymq6q8z`, unchanged; never when SUBMIT's STATUS says the job was already COMPLETED (no double post) [IA ruling 6]; when the wait
  ends first: `IDA_TEXT.postLater`. With `COMPLETE_POST` OFF a big IDA's post button completes via V2 and says `postLater`.
- **Posting limits** [user decision 2]: the fetch refuses more than 1,000 distinct item / UOM / bin ids (an IDA above ~1,000 recovery items
  cannot be posted; README) and a recovery `batch_number` of `-` or the placeholder (flag F1).
- **mounted:** the status map gains `Processing: "processing_status"`; an Edit Processing branch disables `EDIT_DISABLED_FIELDS`, hides
  `button_draft`, `button_completed`, `comp_post_button`, `button_post` and runs `lockComponentsTable()` (today any non-Draft,
  non-Completed status shows the two complete buttons); the background view follows the job when the switch is ON (STATUS every 3 s,
  worker kick every 15 s, 420 s; a FAILED job shown once per browser). Inert while OFF.
- **Form fields:** hidden inputs `ida_v2_job_id`, `ida_idem_key` (varchar 255, dataBind; clones of `page_status` `n8hu0kme`);
  `processing_status` html badge (display-only, in flex `2det1nd2`); the leaf `{ prop: "dict_key", operator: "equal", value: "Processing" }`
  (a new unique 13-digit id) in the `any` branch (`1747862390323`) of select `4cjp73ay`'s datasource.
- **2,000-line fixes, whatever the switch** [plan]: the explode (`ida_src_item`, onChange_idaSourceItem) reads Items with `.field(<every
  column it reads>)` + an explicit `.limit()` + 500-id chunks, re-read when the 5,000 clamp hits; the per-row option / disable loop and the
  batch-add Item reads are measured at 2,000 and fixed only if they block.
- **List:** a first `mounted` script (worker kick throttled 2 min per browser, chained while `processed > 0`, <= 40 rounds, gated by
  `ASYNC_IDA_ENABLED` + the id); the Edit action's `hidden` becomes `arguments[0].row.item_disassembly_status.dict_key == 'Processing' || <the base expression>` (Processing FIRST, so a NULL posted_status dict cannot throw before it) [D review, Minor 2]
  (list rows carry dict fields as `{ dict_key }`); Delete (`q82pv0wg`) refuses Processing like Completed / Fully Posted and re-reads the
  stored status before deleting; Post (`ee9v0c1h`) and the form's `onClick_post` (`e9ib2r8i`) re-read the STORED status / posted_status
  and post only Completed + Unposted / Failed Post / blank [IA R3]; the Status badge already has Processing.
- **Builds:** OFF (default) = live v35 / v16 + the fields, the Processing UI, the explode fixes, the guards; every save handler
  byte-identical but the classic Completed / Complete & Post BOM-dialog escape (10-22). `--on[=COMPLETE,COMPLETE_POST]` flips the switches and refuses while `ids.json` holds "0" for SUBMIT / WORKER. Rollback:
  bind the two buttons back to `iasvcomp` / `aymq6q8z`. Publish order: form + list (OFF) + IDA_SAVE v7, then PREPARE -> COMMIT -> WORKER ->
  SUBMIT, then the ON client. The form publish (it creates `ida_v2_job_id` / `ida_idem_key` and labels `Processing`) precedes any V2 write.

---------------------------------------------------------------------------------------------------------------------------
## 13. File ownership and the build

| Owner | Files (`scratchpad/idav2/` unless a repo path is given) |
|---|---|
| WP0 / controller | `CONTRACT.md`, `FACTS.md`, `ids.json`, `build_ida.py`, `lib/**`, `base/**`, `tpl/**` (read-only), `code/shared/**` (§6), `test/shared/**`, `deploy/**` (own `wf_upload.ida.batch<n>.plan.json`); integration: `Item Disassembly/AsyncV2/ids.json`, merging the README sections |
| A - PREPARE | `build_prepare.py`, `code/prepare/**`, `prepare/**` (its SQL), `lift/**` (its lift config + lifted bodies), `test/prepare/**`; built `Item Disassembly/AsyncV2/IDA_V2_PREPARE.json` |
| B - SUBMIT + classic v7 | `build_submit.py`, `build_classic.py`, `code/submit/**`, `submit/**` (its SQL, lift config, lifted gates), `classic/**` (v7 patch, guard sources, `diff_v6.py`, tests, `README_CLASSIC.md`), `test/submit/**`; built `AsyncV2/IDA_V2_SUBMIT.json`, `AsyncV2/IDA_SAVE.json` |
| C - COMMIT + WORKER | `build_commit.py`, `build_worker.py`, `code/commit/**`, `code/worker/**`, `commit/**` (its SQL), `test/commit/**`; built `AsyncV2/IDA_V2_COMMIT.json`, `AsyncV2/IDA_V2_WORKER.json`; `Item Disassembly/AsyncV2/README.md` (runbook §9, error codes §10, limits, deliberate differences) |
| D - client | `client/**` (src, tests, `README_CLIENT.md`); built `AsyncV2/IDAform.json`, `AsyncV2/IDAlistPage.json` and the script mirrors `AsyncV2/idaV2_*.js`, `idaForm_*.js`, `idaList_*.js` |
| E - checks | `test/integration/**` (the built A / B / C workflows on `lib/sim/engine.js` with the deployed engine planner: a crash after every write then the resume, every FAILED / REVIEW path, PARK, node data at 2,000 / 5,000; `idaAllocate` vs lifted v7 `code_cost_alloc`; SUBMIT dry run = D1 numbers), `test/twins/**` (classic v6 runs replayed through the engine core), `live/**` (payload builder, runs / rows fetch, reconcile) |

One writer per file; B's and D's README sections are merged by the controller. Never touched: anything of IA (`scratchpad/iav2`, `Item
Assembly & BOM/**`), `scratchpad/gdc, smv2, sav2, grv2, pwv2, grrv, gde`.

**Build:** `python3 scratchpad/idav2/build_ida.py [--write] [NAME ...]` (the controller's dispatcher, a copy of `tpl/iav2/build_ia.py`)
imports `build_prepare` (A), `build_commit`, `build_worker` (C), `build_submit`, `build_classic` (B) in that order (the publish order);
each exposes `BUILDERS = [("<NAME>", fn)]` with NAME = IDA_V2_PREPARE / IDA_V2_COMMIT / IDA_V2_WORKER / IDA_V2_SUBMIT / IDA_SAVE; `fn()`
returns the FlowGram dict (NotImplementedError or a missing module = skipped); `lib/v2build.build` wraps SQL, checks ids and writes
`Item Disassembly/AsyncV2/<NAME>.json` (indent 1). The client builds with `client/build_client.py`. Before a publish:
`python3 scratchpad/validate.py <file>`, `lib/sqlcheck.py` on dev (until the form publish, `missing_cols` `{"h.ida_v2_job_id": "NULL",
"g.ida_v2_job_id": "NULL", "h.ida_idem_key": "NULL"}` + any alias a package uses - never the bare name), the switch-OFF regression; publish
with `.dbtools/wf_upload.mjs` and our own plan files (`wf --dev backup` first, `base` guards, one user yes per batch).

**Test data:** 000000 (org 1123598813738675201, plant 1123598813738675202; 8 batch-managed items, 6 auto-batch; config Organization Level /
Document Created Date / `Batch-%5d`) for batches; 711077 (BOM 2783-000000-00, 830 components, 100,000 in stock) only after asking (shared
with the engine owner; never pick "blade, loose" 2105492637718319110 at bin 2106278340907413505, never touch SO/20261016-034 / -035).
**E's method** [IA review 14]: twins = the classic run's recorded child calls replayed through the engine core + one live V2 run reconciled
by formula; deliberate differences: `operation_effect_key`, no blank Batch rows, one Batch row per shared typed number (so ONE FIFO chain where the classic
makes two), case-insensitive typed-number refusal (an EXACT number taken after SUBMIT fails as IDA_INVALID from PREPARE's lifted
code_validate), the issued value covers only this completion's OUT rows.

---------------------------------------------------------------------------------------------------------------------------
## 14. SQL conventions and the node-data budget (IA §14, adapted)

1. Every table read tenant-scoped (`'<guard>.data.tenantId'`, digits checked), `is_deleted = 0` on every document / line / ledger / step /
   batch row; ledger and Batch reads also scope `organization_id`.
2. Ids out of SQL: `CAST(x.id AS CHAR)` for every bigint id / FK; rows as `JSON_OBJECT(...) AS j` parsed with `idaRows` / `idaParseJ`.
3. Ids into SQL: bare digit lists (`idaIdsSql`), tuples as ONE JSON text of digit arrays unpacked by `JSON_TABLE` (`idaTuples`); varchar ids
   (`job_id`, `correlation_id`, `ida_v2_job_id`, `item_selection`) compared with quoted digit strings.
4. `COLLATE utf8mb4_general_ci` on every CAST / CONCAT / JSON-made string compared with a column.
5. A statement starts with SELECT or WITH and never holds the word SET (`CHARACTER SET` included; `scratchpad/validate.py` checks).
6. Placeholders hand-quoted in SQL, never in code nodes. No free text (names, remarks, document numbers, JSON with text) is substituted
   into SQL: the IDA number is read from the header row (`OUT_TOTALS`, `BATCH_OURS`); batch numbers enter ONLY as `idaHexJson` (hex of
   their UTF-8 bytes) decoded in SQL (`BATCH_HOLDERS`) or by a subquery over the stored lines (`BATCH_TYPED_STORED`) [ruling].
7. Lines <= 160 characters (`lib/v2build.wrap_doc_sql`, applied by `build_ida.py`).
8. No row caps on business reads; `LIMIT 1` only for "the latest X" with `ORDER BY id DESC`; never `lines` as an alias.
9. Times from the DB clock (`NOW(3)` -> `db_now`, `DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s')`); business timestamps read verbatim by DATE_FORMAT;
   JS time only for the Item stamp and batchnum's `now`.
10. Decimals written by us: computed values q8; decimal columns as fixed-scale strings (`idaQtyStr`: Batch `initial_quantity`); read-backs
    with `idaSameStored` / `idaSameVal`; remainders clamped at 0.
11. A JSON_TABLE over a stored column (`h.temp_qty_data`) sits in FROM, never inside a correlated EXISTS (it matches nothing on MySQL 8.4:
    use `(SELECT COUNT(*) ...) > 0`); every such read is tested on a must-match case.

**Node-data budget** (estimates; E measures 830 and 2,000 lines; target <= ~35 MB per run [plan]): SUBMIT 15-25 MB at 2,000 lines (the form
in, the lifted gates, one document write, the read-back); PREPARE 20-30 MB (two PLANs; op 2's reads 2,000 items' balances / costing rows);
COMMIT A <= 30 MB (D1: 2,000 numbers, inserts in 8 slices, the read-back, the re-PLAN of op 2; D2 is small); COMMIT B <= 25 MB (op 2's
APPLY request / answer, OUT_TOTALS one row, line numbers and Item stamps in slices). Rules: a part is read only by the step that needs it
(LABELS only after a refusal), op results never read back whole (summary via JSON_EXTRACT), OUT rows summed in SQL, writes in slices of
<= 250 rows, code nodes reference a big input once, PARK splits A from B above 1,000 movements per leg.

---------------------------------------------------------------------------------------------------------------------------
## IA rulings kept (they bind a completion; renamed)

IA deviations 2 (no stored pick count in the classic guard), 3 (fingerprint over stored rows), 4 (ids as exact text), 5 (numbers read from
the header row in SQL), 7 (progress / `jobRow`), 8 (ITEMS = ids, stamp at D4), 9 (`alloc` in ENGINE_R, never sent), 10 (`parent_trx_no ""`,
re-verified on IDA rows), 11 (a stored Draft takes `LOCK|n+1` first), 12 (classic cap 250, now in moves), 14 (PLANs on the real op keys),
15 (Clone strips ids; the v7 status checks Edit-only); reviews 1 (op-2 deadline window), 2 (non-"200" PLAN results refused), 3 (re-PLAN with
the real batch ids), 6 (number rule), 7 (OUT_TOTALS), 13 (runbook), 14 (E's method); rulings 4 (unreadable request -> REVIEW; PLAN 400
without a code -> FAILED), 5 (`AND g.is_deleted = 0` in the lock join; the phase-A exit order; batch / plan codes in COMMIT), 6 (badge
display-only; no double post), 7 (cap on every non-Draft saveAs; -9999 always written; stock_control NULL -> NOT_ELIGIBLE; form before
SUBMIT), 10 R2 (extended to op 2), R3, R4, R7, R8; 11 (client follows 420 s). Not kept: deviation 1 (no GENERATE_BATCH call in SUBMIT: an
in-memory dry run), 6 (replaced by the org-wide hex read), 13 / 16 and every Revert / labour ruling (IDA has neither); ruling 11's flat
30-minute COMMIT lease (replaced by the job-sized lease [WP0 3]).

## Contract rulings (WP0)

1. **`DF1:` fingerprint** with the line target bin, batch number and dates and the header picks + document date (§6) - everything PREPARE
   turns into a movement or a Batch row; remarks excluded as in IA. Cost if wrong: a changed remark between SUBMIT and D0 goes unnoticed.
2. **Batch numbers enter SQL only hex-encoded** (`BATCH_HOLDERS`), so D1's dup read is org-wide like GR C1 (the plan) while keeping IA
   §14.6 (no free text into SQL); verified on dev (case-insensitive, trailing spaces ignored). Cost: ~66 KB of hex SQL at 2,000 numbers.
3. **Batch kinds** (§5): AUTO = the classic `code_batch_plan` rule verbatim; TYPED = any other real text; NONE else (a non-batch item's
   literal placeholder gets no batch - the classic created a batch named "Auto-generated batch number"). Form-impossible cases only.
4. **A non-stock AUTO line consumes a number** (`insert: false`, D4 writes it into the line, no Batch row) - classic parity (GENERATE_BATCH
   ran for it, ADD answered 401), GR C1's own rule; otherwise the line keeps the placeholder the posting fetch refuses.
5. **`no stock to receive`** is an eligibility reason (every recovery line non-stock): the engine refuses an empty op 2; the classic takes it.
6. **Phase-A failures become REVIEW when EITHER op has engine rows** (IA R2 named op 1 only; op 2 should never have rows in phase A, and if
   it does nothing may claim "nothing moved").
7. **ENGINE_I and ENGINE_R must each hold >= 1 movement** (no IA `needCall` path): SUBMIT / PREPARE refuse both empty cases.
8. **"Ours" Batch rows** = `BATCH_OURS` (`id > jobId`, the IDA's number) filtered by a planned identity, re-derived from the table each time:
   the plan's "transaction_no + id > job" alone could adopt a row of another document with the same manual number; a 2,000-row map does not
   fit a DONE row.
9. **`IDA_BATCH_FAILED`** for D1's own write failures (inserted twice, missing, configs behind after retries) - IA used `IA_BATCH_FAILED`
   in COMMIT too; `IDA_BATCH_CONFIG` also covers D1's fresh batchnum refusal.
10. **PREPARE refuses a TYPED number already held** (`BATCH_TYPED_STORED`, `IDA_BATCH_DUPLICATE`, the classic wording) - the plan lists
    the read; refusing before the PLANs saves a COMMIT pass. D1 stays the authoritative check.
11. **IDA_TEXT wording** for tooBig / classicTooBig / splitRequired / lockBusy / batchDuplicate / typedTaken / batchFailed / unlinked (§10).
12. **job `line_count` = moves** (the unit of every cap).
13. **v7 status checks Edit-only**: the plan says "when allData.id is digits"; the IA pattern it names is Edit-only, and the IDA Clone
    (`page_status` Clone) may carry the source id, which would 409 a Clone of a Completed IDA.
14. **Worker hard codes + `IDA_BATCH_CONFIG`, `IDA_BATCH_DUPLICATE`**: neither heals by retrying.
15. **SUBMIT feeds `code_validate`'s `search_batches` from `BATCH_HOLDERS`** of the typed numbers (the classic search-node by number +
    organization; same rows).
16. **Lift sources**: B's four gates from its built v7 (byte-equal to v6), A's bodies from base v6 (no wait on B).
17. **Line order = numeric `line_index`, then id** (the allocation's remainder line and the AUTO numbering order follow the classic array).
18. **batchnum requests carry the stored DATE_FORMAT dates and the IDA's `organization_id`** (the classic passes none and relies on the
    session global, empty in nested runs; GR / IA SUBMIT pass it).
19. **TYPED Batch row text = the first line's stored text, untrimmed** (as the classic ADD writes it); grouping by `idaBatchKey` + item.
20. **`OUT_TOTALS` / `BATCH_OURS` scope organization** too (§14.1), the IDA number read from the header row.
21. **D1's re-PLAN is skipped when no planned row inserts** (only non-stock AUTO rows): nothing to check.
22. **Node-id prefixes** DS / DP / DC / DW / IDAguard.

## Flags for the controller (ruled 10-21, progress.md "Contract (WP0)")

- **F1 - out of scope (ruled).** SQL_FETCH_POST_DATA v225's IDA branch refuses a recovery `batch_number` of `-` as well as the
  placeholder, so an IDA with a non-batch recovery line cannot be posted on either path (a pre-existing fetch bug, outside V2): flagged to
  the user / zhenxiang; verification 8 uses an IDA whose recovery lines are all batch-numbered; README states it.
- **F2 - resolved (WP0b).** `code/shared/**`, `test/shared/**` and `build_ida.py` are written by the contract writer exactly per §6 / §13
  (unit tests `node test/shared/test_shared.js`, `python3 test/shared/sql_smoke.py`, dev `python3 test/shared/sql_live.py`).
- **F3 - accepted (ruled).** The v7 stored-status checks stay Edit-only (ruling 13).
- **F4 - resolved (ruled).** SUBMIT also refuses a TYPED number already held (case-insensitive, `idaBatchKey`) with code_validate's
  wording, from the `BATCH_HOLDERS` rows it already reads (§7 "Typed-number check"); PREPARE and D1 keep their checks for races.
- **F5 - accepted (ruled).** A generated number already taken fails every attempt until the batch configuration is fixed (D1 rule 4, as
  GENERATE_BATCH itself); README / runbook.
- **F6 - accepted (ruled).** The eligibility list is the plan's plus `item <id> not found`, `item <code> has no stock control setting` and
  `no stock to receive` (§7); none moves stock.
