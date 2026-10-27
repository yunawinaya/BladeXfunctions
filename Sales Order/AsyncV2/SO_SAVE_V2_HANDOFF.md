# SO Save V2 (with the SO → GD cascade): hand-off

> **Since 2026-10-27 the live SO_SAVE_SUBMIT / WORKER / PREPARE / COMMIT / RUN and CREDIT_LIMIT_CHECK are built by
> `scratchpad/sosave_perf/build.py`** from their live JSON, not by the original `scripts/build-so-save-v2.mjs`. Their code
> nodes are trimmed: each holds only the shared helpers it used when built. Change them there and rebuild; a call added in
> the designer to a helper a node does not hold fails on that path alone. What changed and why:
> `prod-hotfix/2026-10-27-so-save-speed/` and `prod-hotfix/2026-10-27-so-save-v2-speed/`.

Prepared 2026-10-21 by bladexfunctions-af (the GD Completed / Created / Cancel V2 session) for the developer who builds it.

**Decision (user):**
- **2026-10-16, after the dev crash below:** 2,000-line Sales Order saves need an asynchronous ("V2") SO save.
- **2026-10-21:** the SO → GD cascade moves into it. A "cascade V2" cannot be built alone, because today the cascade runs
  inside SO_SAVE's single request (§2.4).

**Size target: 2,000 lines per SO**, and per linked delivery. Prod is far smaller today: the largest SO ever has 500
lines, and the last 30 days had 13,213 SOs of ≤ 50 lines, 29 of 51–200 and 3 of 201–500. The target is the high-volume
client that is not live yet, so prod's sizes do not set the bar.

All ids, versions and node ids below were read on dev on 2026-10-21: SO_SAVE v170, SO_CASCADE v27, SO form v1241.
**Check them against the deployed dev versions before building on them; the repo is often behind dev.** Use
`.dbtools/wf --dev deployed "<repo file>"` and `.dbtools/form --dev status sales_order "<repo file>"`.

"V2" here means a background job built the way the GD V2 flows are. A small synchronous SUBMIT checks and queues the job.
A WORKER, started by the client, claims it. A PREPARE plans everything with set-based reads. A COMMIT writes in
resumable steps, and each step writes only rows still holding what PREPARE read.

**Read first:**
- `Goods Delivery/EditV2/README.md`: GD Edit V2, the closest model (an edit of a stored document, lifted classic code,
  the cascade's held edits).
- `Goods Delivery/CancelV2/README.md`: GD Cancel V2, a smaller build of the same kit.
- The project skills `authoring-lowcode-workflows` and `avoiding-bladex-data-traps` (in `.claude/skills/`).

---

## 1. Why

- **A 2,000-line SO edit took dev down (2026-10-16 ~11:37 MYT).** It was one synchronous request of about 68 MB of node data:
  - SO_SAVE: 43.7 s, 38.9 MB;
  - SO_CASCADE, nested inside it: 11.7 MB;
  - GD_EDIT_WORKER → GD_EDIT_PREPARE, nested inside that: 17.6 MB.

  That is the same signature as the 10-09 crash (59 MB in one run). Most of SO_SAVE's 38.9 MB is the 2,000-line
  `allData` being recorded again by each of its ~20 nodes.
- **Issuing a new 2,000-line SO** runs the same SO_SAVE, which has no size cap, so it hits the same wall.
- **Stopgap live on dev:** SO_CASCADE refuses to update a delivery over 500 lines. It commits each GD edit inside the SO
  save's own request, and at 1,000 lines that request would pass the 55 s gateway limit.
- **Fan-out:**
  - CHECK_REQUIRED_FIELD, VALIDATE_QUANTITY, CHECK_APPROVAL and REORDER_SET_REDIS each receive the whole SO.
  - The cascade calls GLOBAL_ALLOCATION once per changed line.
  - It also re-saves each Picking Plan with the classic save.

## 2. How the save works today (classic)

### 2.1 Callers

| Caller | How it calls SO_SAVE | Notes |
|---|---|---|
| SO form **Save as Draft**: `button_save_as_draft` → event script `draft` | `{allData}`, with `so_status: "Draft"` | `Sales Order/SOsaveWorkflow_Draft.js` is an unwired legacy handler: it sends `entry` / `saveAs`, which SO_SAVE ignores. The live one is the form's `draft` script. |
| SO form **Issue**: `button_save_as_issue` → `Issued` (= `Sales Order/SOsaveWorkflow_Issued.js`) | `{allData}` | Handles the codes, gates and notes in §2.3. |
| SO form **Issue and Post**: `button_issue_and_post` → `onClick_a2lq37fj` | Same as Issue | Then posts through ACC_PRODUCER (`2013511169625042946`, `task_type: "post_cs"`). |
| Mobile app (not in this repo) | SO_SAVE | SOs carry `created_source: "Mobile"`. Mobile SO edits rely on SO_SAVE committing the GD edits itself, with no kick. |
| SQT_CASCADE (`2100512392867549185`) | workflow-node | Quotation edit → SO edit → SO_CASCADE. Relies on SO_SAVE's 400–405 codes. |
| SQT_Convert_SO (`2094630468129980417`) | workflow-node | Quotation → new SO. |
| PO_SAVE (`2069257894280118274`), node "Create Sales Order" | workflow-node | Internal trading: an Issued PO creates the seller org's Issued SO, or updates it when the PO is already linked. Passes `need_cl: "not required"`, then writes `document_linkage` and the SO's `source_po_*` itself. Above 500 lines it refuses the issue before writing ("Please split it into smaller purchase orders"). |

**Other writers of the SO.** They don't call SO_SAVE, but they matter for the lock (§4):
- **SO list actions:**
  - SO_CANCEL (bulk Cancel and Delete);
  - Force Complete (`Bulk Actions/Sales & Distribution/Sales Order/ForceCompleted.js`, which writes `so_status` Completed client-side);
  - Convert to GD (SO_AUTO_GD).
- **Every GD save,** classic GOODS_DELIVERY and the four GD V2 flows: the SO lines' planned and delivered quantities and
  the SO header's `gd_status`.
- **Picking Plan saves.**
- **Sales Invoice / AR:** invoice quantities and `si_status`.
- **Sales returns:** `return_qty`, `sr_status`, `srr_status`.
- **MES:** `production_planned_qty`, `production_status`.

### 2.2 SO_SAVE (`1988908545345945602`, `Sales Order/SOsaveWorkflow.json`)

**Input:** one param, `allData`. It is the whole form: the header plus `table_so`, with bundle children nested under
`children`. It also carries the client's answers: `raiseGdQty`, `confirmPickReversal`, `need_cl`, `create_si`.

**Steps, in order** (node ids in brackets):

1. **Cascade reference** `SO|<so_id>|<uuid>` [`code_node_CascadeRef`], and "does any GD or Picking Plan name this SO"
   [`sql_node_CascadeDocs`].
2. **Draft** [`if_BA0MN7OZ`]:
   - number placeholder `'draft'` [`code_node_hVnUCBf3`];
   - required fields via CHECK_REQUIRED_FIELD → **400**.
3. **Issue:**
   - Number placeholder `'issued'` and the `need_cl` default [`code_node_X4j8BSXd`]. `need_cl` is `required` unless
     `acc_integration_type` is `No Accounting`.
   - Required fields → **400**. VALIDATE_QUANTITY → **401**.
   - Blank and zero-quantity lines are dropped [`code_node_rPqQy5CD`]. No lines left → **401** "Line Item cannot be empty".
   - `auto_si == 1 && so_total <= 0 && create_si == 'No'` → **405**.
   - Edit, with a Draft GD or Draft SI on this SO → **404**.
   - `need_cl == 'required'` → CREDIT_LIMIT_CHECK: block **402**, override **403**.
   - CHECK_APPROVAL: price below min or above max → **402**; otherwise `needApproval: Yes` leads to step 9.
   - Edit → **cascade pass A** (§2.4). A gate answer (414, 413 or 406) comes back as HTTP 200 with `gateCode` in the body.
4. **Packing and weight** for lines whose `created_source` is not Web, Mobile or Internal Trading [`code_node_PkItemIDs`,
   `sql_node_PkItems`].
5. **Line computation** [`code_node_BtxYhPym`, "Fillback Header Fields"]: the persistence contract, see §6.2.
6. **Issued** → REORDER_SET_REDIS (`SO_ISSUED`), passing the previous and latest `table_so` as full arrays.
7. **Write:**
   - Edit: custom fields the payload left out are restored from the stored record [`code_node_CfNeed1` …
     `code_node_CfOut1`], then `update_node_Bw4VsiNH` writes the header and `table_so` as **one array**.
   - Add / Clone: `add_node_ji9E0C1S`, a fixed column list.
   - Then UPDATE_ITEM_TRANSACTION_DATE.
8. **Cascade pass B** (new lines; they need their row ids first), then the **GD Edit V2 release loop**:
   - each held GD edit is released (GD_EDIT_SUBMIT `RELEASE`) and committed **in the same request**
     (GD_EDIT_WORKER `{job_id}`);
   - edits that did not complete become `gdEditNotes`.
9. **needApproval → the approval slot** `slot_node_ehX7sDpE`:
   - a platform approval instance on the SO; the workflow run stays open in status `SlotPending` until someone decides;
   - approved → `so_status` Issued, plus the number;
   - the form tells the user "requires approval … saved as draft";
   - prod, last 30 days: 8 runs still SlotPending, and 55 completed after more than 10 minutes (most likely approval
     waits).
10. **Quotation status** [`update_node_eBw6Xx2h`].
11. **Issued:**
    - `auto_si` set: Cash Sales → AR_SAVE (`2072601187701137409`), otherwise SI_SAVE (`2029040374929154050`, with the
      SI number rule);
    - `auto_si` not set: accounting auto-post (SQL_ACC_POST_SALES_ORDER, ACC_PRODUCER or AC_V2_POST_SALES_ORDER, by
      integration type).
12. **Answer** (`data`): `{so_id, so_no, si_id, si_no, pickingReversalNote, gdEditJobs, gdEditNotes}`.

**Prod, last 30 days:**
- 10,953 runs;
- 10,081 completed in under 5 s;
- 556 failed, 409 of them in under 5 s (validation codes).

### 2.3 The form's conversation (the `Issued` handler)

| SO_SAVE answers | The form | Then resubmits with |
|---|---|---|
| 400 / 401 | an error message | — |
| 402 | an alert (credit block, or a price outside min / max) | — |
| 403 | a confirm (credit override) | `need_cl: "not required"` |
| 404 | a confirm, then DELETE_GD_SI (`2000407100609073154`) | the same payload |
| 405 | a confirm (zero-total invoice) | `create_si: "Yes"` |
| 200 with `gateCode` 414 | "Add to delivery" / "Leave outstanding" | `raiseGdQty: "Yes"` / `"No"` |
| 200 with `gateCode` 413 | a confirm (reverse picked quantities) | `confirmPickReversal: "Yes"` |
| 200 with `gateCode` 406 | an alert, "Linked documents" | — |
| 200 | Starts GD_EDIT_WORKER for each `gdEditJobs`. Shows `pickingReversalNote`, `gdEditNotes`, `enteredSlotApproval`. | — |

### 2.4 SO_CASCADE (`2092097819929858050`, `Sales Order/SOcascadeDownstreamWorkflow.json`)

**When it runs:** SO_SAVE calls it only when a GD or Picking Plan names the SO and a line's item, UOM, quantity, price
or amount changed [`code_node_CascadeGate`], or, in pass B, when lines were added.

**Params:**
- `passNo`: 1 runs before the SO write, 2 after it. It is an int on purpose: a literal string param is evaluated by MVEL.
- `so_id`, `prev_table_so`, `next_table_so`.
- `confirmPickReversal`, `raiseGdQty`.
- `organization_id`, `cascade_ref`.

**Steps:**

1. **Diff** [`code_cd_diff`]: each SO line, keyed by its child-row `id`, gets a kind: `qty`, `swap` (item), `uom`,
   `price`, removal (pass 1) or append (pass 2).
2. **Reads in parallel:** the linked GDs and Picking Plans (whole documents, through search nodes), the items (SQL) and
   the picking setup.
3. **Plan** [`code_cd_plan`, 27 KB]: which delivery each line belongs to, and how far its quantity may move.
   - **Outcomes:** **406** blocked, **413** confirm a reversal of picked quantity, **414** a raise ("add to delivery" or
     "leave outstanding").
   - **Settled rules:**
     - the change lands on the line's single Created GD, and two Created GDs claiming one line is refused;
     - a partly delivered line can't be item-swapped, or reduced to exactly its delivered quantity;
     - new lines are appended to the Created GD.
4. **Allocation:** GLOBAL_ALLOCATION (`2032298961937842178`) once per request, in a loop.
   - Parameters: `isPending 1`, `allocationType GD`, and `existingAllocationData` set to the row's current entries.
   - The result is *appended*, so picked entries never move.
   - It bypasses the Auto-only gate, so Manual picking mode cascades too.
   - It writes nothing. A shortage → 406.
5. **Payloads** [`code_cd_payloads`]: the GD and Picking Plan documents to save.
   - `gd_order_quantity` is re-stamped as the delta anchor;
   - `base_qty` and `view_stock` are restated;
   - a UOM change restates every stored number in the new unit.
6. **Each GD goes through GD Edit V2:**
   - `GD_EDIT_SUBMIT {operation: SUBMIT, gd_id, source: CASCADE, form: <the whole GD>, cascade_ref, answers: {needCL:
     auto, continueZero: Yes, confirmPickReversal}}` → QUEUED;
   - then `GD_EDIT_WORKER {job_id}` prepares it and the job waits **HELD**. A hold expires after 15 minutes.
   - **Refused here:** a GD over 500 lines.
   - **Classic GOODS_DELIVERY save instead** (saveAs Created, pageStatus Edit): a NOT_ELIGIBLE answer, no cascade_ref,
     or a data refusal from the inventory engine.
   - The switch is `GDE_CASCADE_ENABLED` [`code_cd_gde_args`].
7. **Each Picking Plan:** classic PICKING_PLAN (saveAs Created, pageStatus Edit). This path has never run on real data.
8. **Summary** [`code_cd_summary`]:
   - code and message, plus `pickingReversalNote`;
   - `soLineCounters`: planned and delivered quantity per SO line as the downstream documents left them, which SO_SAVE
     lays over its line write;
   - `heldJobs`.

   On a refusal it cancels the holds: GD_EDIT_SUBMIT `CANCEL_HELD`, then GD_EDIT_WORKER to unlock.

GD Edit V2's side of the hold / release / cancel contract, its statuses and its review runbook are in
`Goods Delivery/EditV2/README.md`.

## 3. What to build

### 3.1 Shape

Build four new dev workflows from a Python builder modelled on `scratchpad/gde/build_gde.py`:

| Workflow | Role |
|---|---|
| `SO_SAVE_SUBMIT` (synchronous, small) | Checks what is cheap, decides eligibility, stores the request, takes the lock, queues a job. Also answers `STATUS` and `CONFIRM`. |
| `SO_SAVE_WORKER` | Started by clients; there is no Quartz. Claims due jobs and runs the next stage per call. |
| `SO_SAVE_PREPARE` | Set-based reads. Runs SO_SAVE's computation and the cascade plan, lifted, in-process. Writes the plan as payload parts. |
| `SO_SAVE_COMMIT` | Resumable steps with before-images. Writes the SO, releases the GD holds, runs the after-steps. |

**Reuse the V2 foundation already on dev** (it reaches prod with the full deployment):
- `gd_async_job` with a new `command: "SAVE_SO"`, the way Picking V2 reused it with `CONFIRM_PICKING`.
- `gd_publish_step` for lock rows, step rows and payload parts. Its `step_name` is varchar(32).

**The job:**
- `correlation_id = "SO|<so_id>"`.
- `source_so_ids = ["<so_id>"]`: that is the column the existing same-SO guards read (§4).
- `idempotency_key`: a hash of the canonical request, like GD Created V2's `GDF:` key, so a double click returns the same
  job.
- `line_count`.
- `request_payload` holds only small pointers; the payload itself is stored in parts.
- **A new SO** has no id until COMMIT: correlate on the idempotency key, and set `source_so_ids` once the row exists.

**Statuses (proposal):**

```
QUEUED → PREPARING → CASCADE_PREPARING → (AWAITING_CONFIRMATION) → READY_TO_COMMIT → COMMITTING_SO
       → RELEASING → AFTER → COMPLETED | FAILED | CANCELLED | REQUIRES_REVIEW
```

- Before COMMITTING_SO nothing is written to the SO. A failure there cancels the holds, unlocks the SO, and ends FAILED.
- After the first SO write, a failure retries, then ends REQUIRES_REVIEW.

**The lock.** `so_status` cannot carry it: "Processing" is already a business status of the SO (693 prod SOs; GD's
`gd_status` Processing was introduced by V2, the SO's was not). Use both of these:
- lock rows: `gd_publish_step` with job `SOS|<so_id>` and step `LOCK|<n>`, where the latest row is the owner (the same
  protocol as GD's `GDC|<gd>`);
- a new column `sales_order.is_processing` (int, 0 / 1), which other writers and the SO form read. The Picking uses
  `transfer_order.is_processing` this way. Adding it is a form-designer change on `sales_order`.

### 3.2 SO_SAVE_SUBMIT (synchronous, keep it small)

**Input:** `{operation: SUBMIT | STATUS | CONFIRM, so_id, save_as: Draft | Issued, page_status: Add | Clone | Edit,
request, answers}`.
- **Edit sends a delta** against the stored SO, not the whole form:
  - header fields that changed;
  - lines changed, added or removed, by line `id`;
  - bundle children under their parent.

  GD_EDIT_SUBMIT takes a `delta` for the same reason.
- **Add and Clone send the full payload,** since nothing is stored to diff against.
- **Touch the payload in as few nodes as possible:** guard it, store it in parts, and have every later node work on ids
  and counts. Each node that takes the payload as input records it again in node data, which is how SO_SAVE reached
  38.9 MB.

**Checks.** Keep classic's codes and their order, so the form's existing dialogs keep working:
1. **Guard the input.** Ids must be digits only: SQL nodes are raw text.
2. **BUSY** (answer, write nothing):
   - the SO's `is_processing = 1`, or an open SAVE_SO job on `SO|<so_id>` with a different key (the same key returns
     the existing job);
   - GD V2 work in flight on the SO: a GD of the SO in `Processing`, or an open `CREATE_GD_FROM_FORM` job whose
     `source_so_ids` holds the SO. This is the rule SO_CANCEL v8 and GD_SO_CONVERT_CHECK use; the SQL is in
     `scratchpad/socancel/patch_so_cancel_v8.py`.
3. **Required fields → 400; quantities → 401.** Lift CHECK_REQUIRED_FIELD's and VALIDATE_QUANTITY's rules into code
   rather than passing 2,000 lines to them.
4. **405, 404 and credit limit 402 / 403:** header-level and cheap; answer exactly as classic does.
5. **Price min / max** (CHECK_APPROVAL's rules) → 402. `needApproval: Yes` → **NOT_ELIGIBLE** (§5).
6. **Eligibility** (§5) → NOT_ELIGIBLE: the caller runs classic SO_SAVE.
7. **Queue:**
   - store the parts;
   - lock: `LOCK|n+1` plus `is_processing = 1`;
   - job QUEUED;
   - read back: a racer that slipped in → put everything back and answer BUSY.

   Answer QUEUED with the `job_id`.

**Other operations:**
- `STATUS {so_id}`: the SO's latest SAVE_SO job, for the form's Processing view.
- `CONFIRM {job_id, answers}`: answers an AWAITING_CONFIRMATION job (§3.3 step 5), records the answers and makes the job
  due.

### 3.3 SO_SAVE_PREPARE (once per job)

1. **Reads.** Use set-based SQL and select only the columns needed. Don't use search nodes that return whole documents
   with their subforms. Read:
   - the stored SO header and lines, with children;
   - the items (the packing and UOM data for §6.2);
   - the linked GDs and Picking Plans with their lines;
   - the picking setup;
   - the customer and credit facts needed.
2. **Apply the request** to the stored SO to get the next SO, then run SO_SAVE's line computation. Lift
   `code_node_BtxYhPym` rather than rewriting it (§6.2).
3. **The SO write plan:**
   - the header cells that change;
   - per line: update (changed cells only, each with its before-value), insert, or delete (`is_deleted = 1`).

   Never write a column another document owns (§6.1).
4. **The cascade plan.** Only when a GD or Picking Plan names the SO and the diff touches item, UOM, quantity, price or
   amount, or lines were added.
   - Lift SO_CASCADE's `code_cd_diff`, `code_cd_plan`, `code_cd_allocreq` and `code_cd_payloads`. Don't fork their
     rules: the quotation cascade relies on them too.
   - **Allocate in-process and set-based.** Replace the per-request GLOBAL_ALLOCATION loop with the lifted
     GLOBAL_ALLOCATION, and read balances once for every material. GD Edit V2 already runs v34 in-process; its lift is
     in `scratchpad/gde/lift/`.
5. **Answers from the plan:**
   - **406 (blocked)** → FAILED with the plan's message. Nothing is written and there are no holds.
   - **413 / 414** → **AWAITING_CONFIRMATION.**
     - The question goes in the job's `progress_message` / `error_details`, with a `confirmation_token`. `gd_async_job`
       already has `confirmation_token` and `confirmation_hash`, and GD Created V2 uses the same status.
     - The form shows the classic dialog and calls `CONFIRM`; PREPARE then runs again with the answers.
     - The simpler alternative is to fail the job and let the form resubmit the whole save, as today; but that re-reads
       everything.
6. **Payload parts** `P|<nonce>|<PART>|<nnn>`:
   - `SOH` (header);
   - `SOL` (line slices of 250–500);
   - `GDE` (GD edit requests);
   - `AFTER` (reorder deltas, item ids, the SI / AR plan).

   The job then goes to READY_TO_COMMIT, or to CASCADE_PREPARING when there are GD edits.

### 3.4 Preparing the cascade's GD edits (CASCADE_PREPARING)

**Keep classic's guarantee:** a GD refusal, such as not enough stock for a raise, stops the SO save **before** anything is
written. So every GD edit is prepared and HELD before the SO commit:
- **Per GD edit request:**
  - `GD_EDIT_SUBMIT {operation: SUBMIT, gd_id, source: CASCADE, cascade_ref: "SOV2|<job_id>", answers, delta | form}` →
    QUEUED, held;
  - then `GD_EDIT_WORKER {job_id}` → HELD (prepared) or FAILED.
- **One GD per worker call.** Never nest several GD prepares in one request: a nested chain counts as one request for
  node data, and a 2,000-line GD's PREPARE is 17.6 MB alone. The form starts SO_SAVE_WORKER again while it follows the
  job.
- **Any GD edit refused** → cancel every hold of the job (`CANCEL_HELD`, then GD_EDIT_WORKER). The job ends FAILED with
  the GD's reason (the classic 406 text), the SO is unlocked, and nothing is written.
- **Holds expire after 15 minutes.** The SO commit must start before then, or agree a longer hold for `SOV2|`
  references with the GD Edit V2 owner.
- **GD size cap.** SO_CASCADE refuses GDs over 500 lines today because it sends the whole GD as `form` and commits it
  inside the SO's request. V2 commits outside that request, so the cap can rise. The best way is to send a **delta**
  (GD_EDIT_SUBMIT has a `delta` param); agree it with the GD Edit V2 owner.
- **A GD that GD Edit V2 won't take** (serial items, a Picking Plan GD, loading bay, a shared Picking or more than one,
  internal trading) would go to the classic GOODS_DELIVERY save, and from a background job that save has no size limit.
  - In v1, make the whole SO save NOT_ELIGIBLE when any affected GD would go classic: decide it in PREPARE, end FAILED
    with `SOV2_NOT_ELIGIBLE`, and the form falls back to classic SO_SAVE, whose 500-line caps apply.
  - GD Cancel V2's list does the same with `GDX_NOT_ELIGIBLE`.

### 3.5 SO_SAVE_COMMIT (resumable steps)

**Each step:**
- writes only rows still at the plan's before-image;
- reads them back;
- records a DONE step row.

A rerun skips DONE steps. A row someone else changed:
- before S1 → FAILED, with the SO unlocked and the holds cancelled;
- after S1 → retry, then REQUIRES_REVIEW.

| Step | What |
|---|---|
| S0 revalidate | The stored SO's before-images, the holds still HELD, no new GD work on the SO. A failure here writes nothing. |
| S0N number | Draft → Issued, or a new SO: write the number placeholder once and read back the generated number (§6.3). Decide it from the **stored** status, never the client's `previous_status`; that also fixes the double-submit number burn. |
| S1 header | The changed header cells. For a new SO, one insert of the whole document, header and lines (the platform's natural path; measure it at 2,000 lines). |
| S2 lines | Updates, inserts and deletes in slices of 250–500 rows per call. Probe a direct insert into `sales_order_axszx8cj_sub` on a test SO first, as GD Edit V2 probed the GD line subform. Bundle children carry `parent_id`, `item_bundle_id` and `bundle_ratio`. Record the new line ids in the DONE row. |
| S3 release (pass A) | RELEASE each hold: `GD_EDIT_SUBMIT {operation: RELEASE, gd_id, cascade_ref}`. GD_EDIT_WORKER commits each one in its own run: the form and the SO list start them from `gdEditJobs`, or run one per worker call. |
| S3B append (pass B) | Lines added in this save, now that they have ids. If pass A holds an edit on the same GD, wait until that job is COMPLETED (classic commits pass A before pass B for the same reason). Then submit, prepare and release the append. A failed append is reported, not rolled back: classic also reports it for manual repair. |
| S4 unlock | `is_processing = 0`, at this job's lock. |
| S5 after | REORDER_SET_REDIS with deltas only (lift its `code_node_f8qELJUF` and pass only the changed lines, as GD Cancel V2 does), UPDATE_ITEM_TRANSACTION_DATE, the quotation status, then auto SI / AR or the accounting post. Each sits behind a marker row, so a rerun never creates a second invoice. |

**Answer on COMPLETED** (in the job, e.g. `error_details` as JSON): `so_id, so_no, si_id, si_no, pickingReversalNote,
gdEditJobs, gdEditNotes`. These are the fields the form reads today.

**The SO job does not wait for the GD commits.** Until they finish, those GDs are `Processing`, so a second SO save sees
them and answers BUSY.

**SI / AR at 2,000 lines is unmeasured.** SI_SAVE and AR_SAVE are classic synchronous saves that receive the whole
invoice. Measure them first. If they're too big, auto SI above a threshold becomes a follow-up (an SI V2), and the job
reports "create the invoice from the SO".

### 3.6 SO_SAVE_WORKER

Copy GD Edit V2's worker (`scratchpad/gde/code/worker/`) and GD Completed V2's (`scratchpad/gdc/`):
- the claim gate `W0_CLAIM_<row_version>`, a lease, retry with backoff, and REQUIRES_REVIEW after the retries;
- an optional `{job_id}`;
- a worker started without a job (from the SO list) skips a job started in the last 10 s, so it never races the form's
  own call.

The SO job moves no stock, so the 30-minute COMMIT lease the GD kit needs for the inventory engine is not required. The
kit's 10-minute claim is enough unless a step is measured slower.

### 3.7 Clients

**SO form.** The scripts are `Issued`, `draft` and `onClick_a2lq37fj`.
- **Mirror every change** into `Sales Order/SOfullJSON.json`. But that repo file carries committed work that is **not
  deployed** (44 `roundPrice()` calls, and the `sqt_line_id` column). Build on the DEPLOYED form (dev v1241), and never
  sync dev → repo blindly.
- **Switch** `SO_SAVE_V2_ENABLED`: false keeps today's handlers, unchanged.
- **How each SUBMIT answer is handled:**

  | Answer | The form does |
  |---|---|
  | 400–405 | Handled as today. |
  | NOT_ELIGIBLE | Runs today's handler. |
  | BUSY | Shows the message. |
  | QUEUED | Starts the worker and follows `STATUS`: polls every 2–3 s, starts the worker again every few polls, for up to ~120 s, then "being saved in the background". |
  | AWAITING_CONFIRMATION | Shows the classic 413 / 414 dialog, then calls `CONFIRM`. |
  | COMPLETED | Starts GD_EDIT_WORKER for `gdEditJobs`, shows the notes, closes. |
  | FAILED `SOV2_NOT_ELIGIBLE` | Runs today's handler. |
  | Any other FAILED | Shows the reason; the edits stay on screen. |

- **Issue and Post** posts only after COMPLETED.
- **Opening an SO with `is_processing = 1`:** read-only, and it follows the job. The GD form does the same in
  `followBackgroundSave` (`Goods Delivery/GDonMounted.js`).

**SO list:**
- show a "Saving" state;
- its `mounted` starts SO_SAVE_WORKER (there is no Quartz), like `Goods Delivery/CompleteV2/gdc_list_mounted.js`.

**Mobile:** send the app a contract note (SUBMIT, worker, follow, codes). Until it adopts it, it stays on classic SO_SAVE
with a 500-line guard.

## 4. Guards other workflows need

While a SAVE_SO job holds an SO, nothing else may write the SO or start GD work on it. Most of these checks already
exist for GD V2 jobs; they only need the new command or the flag added.

| Workflow | Refuses today | Add |
|---|---|---|
| GOODS_DELIVERY (classic), GD_ASYNC_SUBMIT, GD_EDIT_SUBMIT (its `so_job` fact), GD_SO_CONVERT_CHECK (`sql_node_SCbusy`); SO_AUTO_GD saves through these | an open `CREATE_GD_FROM_FORM` job naming the SO | `SAVE_SO` in the same command filter, or the SO's `is_processing` |
| GD_COMPLETE_SUBMIT, GD_CANCEL_SUBMIT | GD-level busy facts | the `is_processing` of the GD's SOs: their commits write SO lines |
| SO_CANCEL (v8, `sql_node_SXjobs`) | a Processing GD, an open create job | `SAVE_SO` jobs, or `is_processing` |
| SO list Force Complete (`ForceCompleted.js`, client-side writes) | — | refuse `is_processing` |
| Classic SO_SAVE (SQT_CASCADE, SQT_Convert_SO, PO_SAVE and old clients) | — | one check at its top: refuse an SO with `is_processing = 1` |
| PICKING_PLAN, SI from SO, SR / SRR (they write SO line counters) | — | review; at least refuse while `is_processing` |

**The safety net** is COMMIT's before-image check: a writer that slips through sends the job to review instead of being
silently overwritten.

## 5. What stays classic in v1

SUBMIT answers NOT_ELIGIBLE and the caller runs classic SO_SAVE for:
- **A save that needs approval** (CHECK_APPROVAL `needApproval: Yes`). The approval slot holds the workflow run open
  (`SlotPending`), and that can't happen inside a worker run. See §10.
- **An SO with a live Picking Plan.** The cascade re-saves Picking Plans with the classic save, that path has never run,
  and Picking Plan has no V2.
- **A cascade that would send any GD to the classic save** (GD Edit V2's not-eligible list, §3.4).
- **Server callers:** SQT_CASCADE, SQT_Convert_SO and PO_SAVE need the SO id and number back synchronously. PO_SAVE
  already refuses internal-trading POs over 500 lines before writing.
- **Mobile,** until it adopts the contract.

**Classic SO_SAVE needs a line-count guard:** refuse above 500 lines with the reason. Otherwise a NOT_ELIGIBLE fallback of
a 2,000-line SO brings the crash back.

## 6. Data rules and traps

### 6.1 Columns the SO save must never overwrite

**Header:** `gd_status` (GD), `si_status` (SI), `production_status` (MES), `sr_status` / `srr_status` (returns), and the
posting statuses.

**Lines** (`sales_order_axszx8cj_sub`):
- `planned_qty`, `delivered_qty` (GD / Picking Plan);
- `invoice_qty`, `posted_qty`, line `si_status` (invoicing);
- `return_qty` (returns);
- `production_planned_qty`, `production_qty`, `production_status` (MES);
- `packing_status`, `packing_no`, `hu_no`.

**Why it matters:** classic writes `table_so` as one whole array, so it has to put these back from the stored row (an
old bug: a stale browser tab reverted a GD cancel's `gd_status`). V2 writes only the cells it changes, so it never needs
to restore them.

**Derived:** `outstanding_quantity = max(0, q8(so_quantity − delivered_qty))`. Recompute it whenever `so_quantity`
changes.

### 6.2 SO_SAVE's line computation (`code_node_BtxYhPym`: lift it, don't rewrite it)

1. **Money is written as 8-decimal strings:** `so_item_price`, `so_gross`, `so_discount`, `so_discount_amount`,
   `so_tax_amount`, `min_price`, `max_price`, `so_amount`, and the header totals (`so_total_gross`,
   `so_total_discount`, `so_total_tax`, `so_total`, `myr_total_amount`).
2. **Computed quantities are rounded with `q8`:** `packing_qty`, `net_weight`, `outstanding_quantity`.
3. **`production_planned_qty`:** the stored value; `so_quantity` only for a new line or one never planned.
   `production_status` defaults to "Not Created".
4. **Header fields are copied onto every line:** `plant_id`, `customer_id`, `payment_term_id`, `sales_person_id`,
   billing and shipping state and country ids, `area_id`, `organization_id`, `access_group`, `agent_user_id`.
5. **Numbering and status:** `line_index` is "i", and "i/j" for bundle children. `line_status` comes from `so_status`
   (Processing counts as Issued) unless the line already has one.
6. **`so_shipping_date`:** the line's own value, else the header's.
7. **Packing and weight** (`packing_uom`, `packing_conversion`, `packing_qty`, `weight_conversion`, `net_weight`) are
   computed only when `created_source` is not Web, Mobile or Internal Trading. Those sources compute them before the save.
8. **Header resets and defaults:** `need_cl` is reset to `''`; `si_status` and `production_status` get their defaults;
   `sr_status` and `srr_status` are taken from the stored SO.
9. **On Issue,** blank and zero-quantity lines are dropped.
10. **Custom fields:** a key-less edit must not blank them. Writing only changed cells covers this.

### 6.3 Document numbers

- The platform generates `so_no` when the save writes a placeholder (`'draft'` or `'issued'`) and `so_no_type` holds a
  numbering rule id.
- `so_no_type = -9999` means the user typed the number by hand: keep it.
- **Classic decides from the client's `previous_status`, which goes stale:** a double submit burned a number on prod
  (two runs 95 ms apart, the first number lost for good).
- **V2:** decide once per job, from the stored record, in S0N.

### 6.4 Platform traps (each has bitten before)

**Workflow nodes:**
- A literal string param of a workflow-node is evaluated by MVEL: `"append"` arrived as a function. Branch on ints.
- A code-node's output keys must be declared in `response_json`, or they vanish.
- A child workflow's crash fails its parent; only a returned error code is non-fatal.

**Reads:**
- A search-node's `limit` is not applied.
- A get-node returns an object, not a list, when the count is 1.

**Writes:**
- An update-node's WHERE is not enforced: filter ids in code.
- Batch updates can apply partially: write the DONE marker last.
- Decimal columns: format them (`toFixed`) and clamp remainders at ≥ 0.

**SQL nodes:**
- They are raw text substitution: ids must be digits only.
- Quote 19-digit ids compared with VARCHAR columns. Unquoted, they compare as DOUBLE and match neighbouring ids.
- MySQL 8.4:
  - rejects a derived-table column list `b (i)`;
  - a correlated JSON_TABLE inside EXISTS matches nothing, so use `(SELECT COUNT(*) …) > 0`;
  - JSON_TABLE output and table columns can differ in collation, so add `COLLATE`.
- Dev datetimes are MYT: compare with `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`.

**Data:**
- 14,175 of 35,199 dev SO lines have a `parent_id`, so bundles are common. Test with them.

## 7. Size and time budgets

- **One synchronous chain** (a run plus every workflow it calls) must stay well under ~60 MB of node data: dev crashed
  at 59 MB and at 68 MB. Aim for ≤ 30 MB per call. GD Edit V2's largest 2,000-line run was 32.1 MB.
- **Client-facing calls** stay well under the 55 s gateway limit: SUBMIT should take seconds. Worker calls are started
  without waiting and can run longer (GD Cancel V2's 2,000-line worker ran 255 s in one call), but keep each call bounded.
- **No per-line child workflows.** A 500-line classic SO→GD conversion made about 1,500 child calls on 10-20, and dev's
  API went down a minute after the last of them.
- **Measuring:** `LENGTH(nodes_data)` of `su_code_workflow_inst`, found by `workflow_id` and an id window. Never filter
  that table by `create_time`.
- **Dev is 2–7× slower than prod since 10-16,** so dev timings overstate prod.

## 8. Tests

**Offline:**
- Build with wfkit (`scratchpad/gdc/pkv2tools/wfkit.py`).
- Run the built JSON on the workflow simulator (`scratchpad/gdc/pkv2tools/sim/engine.js`), mocking the SQL, reads and
  writes. Examples: `scratchpad/gdcan/test/workflow_sim.js`, `scratchpad/socancel/test_so_cancel.js`.
- Lint every workflow: `python3 scratchpad/validate.py "<workflow.json>"`.

**Parity on recorded runs** (GD Edit V2 does this on 23 recorded runs):
- Pull real dev SO_SAVE and SO_CASCADE runs (`nodes_data`).
- Feed the lifted `code_node_BtxYhPym`, `code_cd_diff`, `code_cd_plan` and `code_cd_payloads` the recorded inputs, and
  assert the recorded outputs.
- Pin the lifted versions and add a freshness check, like `scratchpad/gde/lift/check_fresh.sh`.

**Scenarios, each needing a test that fails first:**
- create, edit, Draft → Issued;
- the 413 and 414 confirm round-trips;
- 406, NOT_ELIGIBLE and BUSY;
- a double submit (one job, one number);
- a crash and resume at every step;
- a row changed between PREPARE and COMMIT;
- a hold expiring;
- pass B appending to a GD that pass A edited;
- bundles, a UOM change, a price-only change.

**Twins on dev:** two identical SOs, with GDs, edited the same way, one through classic SO_SAVE and one through V2. Then
diff the end state. Tools: `scratchpad/gdcan/test/snap.py`, `diff_twins.py`, `inspect_single.py`.

**2,000-line runs on dev**, recording the time and node data of each call:
- issue a new SO;
- edit one with no cascade;
- edit one whose cascade reaches a 2,000-line GD (raise, reduce, swap, UOM, price, append).

Tenants 711077 and 496474 hold 2,000-line test data.

**Clients:** handlers on a mock form, with mutation checks. Examples: `scratchpad/gdcan/test/test_list_cancel.js`,
`scratchpad/gde/test/test_mounted.js`.

**Running as another tenant:** `scratchpad/gdc/tools/runas.mjs`; see `.claude/skills/running-dev-workflows-as-tenant/`.

## 9. Build, deploy, switch

**Building and publishing (dev only):**
1. **Workflow shells:** the user creates the four empty workflows in the dev designer (the CLI cannot create them). Put
   their ids in a repo `ids.json`, then build.
2. **The `sales_order.is_processing` column:** add it through the SO form designer; it publishes with the form.
3. **Publish** with `.dbtools/wf_upload.mjs --dry-run`, then `--publish`, using your own `--plan` file:
   - it backs up the live version first;
   - forms and pages use `kind: form | page` with a `base` file, so nothing is published if dev moved on;
   - then check `.dbtools/wf --dev deployed` says IDENTICAL.

**Approval and prod:**
- **One explicit yes from the user** for each publish, each dev DB write and each live-test batch. Show the dry run first.
- **Prod is never pasted piece by piece.** Dev is promoted wholesale in the full deployment, which also brings the V2 job
  tables. Keep dev shippable; switches ship as they are set. Don't leave work for "after the cut": build it now, and the
  user checks what is done before the deployment.

**Operating it:**
- **A REQUIRES_REVIEW runbook:** copy GD Edit V2's (README, "A job under review"), with a listing tool like
  `scratchpad/gde/tools/review_jobs.py`.
- **Switching off:** `SO_SAVE_V2_ENABLED = false` in the form. Open jobs finish through the worker.

## 10. Open decisions (for the product owner)

1. **Approval-required saves.**
   - Recommended: classic in v1.
   - Alternative: V2 saves the SO as Draft, then starts the approval from a separate classic call.
2. **SOs with a live Picking Plan.** Recommended: classic in v1.
3. **Server callers** (quotation cascade and convert, PO internal trading). Keep them on classic SO_SAVE with the
   500-line guard, or move them to SUBMIT + worker later.
4. **Auto SI / AR at 2,000 lines.** Measure first; if too big, an SI V2 or a threshold.
5. **Which saves use V2.**
   - Recommended: every eligible save, so there's one tested path.
   - Alternative: only saves above a line threshold.
6. **Cascade GD edits as a delta** instead of the whole GD form, which lifts the 500-line GD cap. Needs the GD Edit V2
   owner.
7. **Confirmations.**
   - Recommended: AWAITING_CONFIRMATION in the job.
   - Alternative: fail the job and resubmit.
8. **How 2,000-line SOs get entered.**
   - Batch Add exists (`Sales Order/SObatchAddLineItem.js`); a line import like PO's (PO_LINE_IMPORT) does not.
   - The SO form's own open and edit speed at 2,000 lines is untested (the Picking form needed a fix for the same).

## 11. Reference

**Workflows (dev ids):**

| Workflow | Id |
|---|---|
| SO_SAVE | `1988908545345945602` |
| SO_CASCADE | `2092097819929858050` |
| SO_CANCEL | `2074777638166659074` |
| SO_AUTO_GD | `2076557490389835777` |
| SQT_CASCADE | `2100512392867549185` |
| SQT_Convert_SO | `2094630468129980417` |
| PO_SAVE | `2069257894280118274` |
| GD_EDIT_SUBMIT | `2110618741159940097` |
| GD_EDIT_WORKER | `2110618789356687361` |
| GD_ASYNC_SUBMIT | `2105133540498116609` |
| GD_SO_CONVERT_CHECK | `2112084100104495105` |
| GOODS_DELIVERY | `2017151544868491265` |
| PICKING_PLAN | `2021431201147527170` |
| GLOBAL_ALLOCATION | `2032298961937842178` |
| CHECK_REQUIRED_FIELD | `1988831880511062018` |
| VALIDATE_QUANTITY | `1998298424254201857` |
| CREDIT_LIMIT_CHECK | `1990247316342333442` |
| CHECK_APPROVAL | `2082344813454499841` |
| REORDER_SET_REDIS | `2065256261729759233` |
| UPDATE_ITEM_TRANSACTION_DATE | `1989229727911870466` |
| SI_SAVE | `2029040374929154050` |
| AR_SAVE | `2072601187701137409` |
| DELETE_GD_SI | `2000407100609073154` |
| ACC_PRODUCER | `2013511169625042946` |

**Tables:**
- `sales_order`, and its lines `sales_order_axszx8cj_sub` (85 columns).
- `gd_async_job`, `gd_publish_step`.
- `on_reserved_gd` (reservations; written by GD Edit V2, not by the SO save).

**Repo files:**
- **Classic:** `Sales Order/SOsaveWorkflow.json`, `Sales Order/SOcascadeDownstreamWorkflow.json`,
  `Sales Order/SOsaveWorkflow_Issued.js`, `Sales Order/SOfullJSON.json` (see §3.7).
- **Model to copy:** `Goods Delivery/EditV2/` (README and workflows), with its builder `scratchpad/gde/` (`build_gde.py`,
  `code/`, `lift/`, `cascade/`, `test/`).
- **Kit:**
  - `scratchpad/gdc/pkv2tools/` (wfkit, the simulator, dbq);
  - `scratchpad/gdc/lift/` (the lift runtime);
  - `scratchpad/validate.py`, `.dbtools/wf_upload.mjs`, `.dbtools/db`, `.dbtools/dbw` (dev writes, previewed);
  - `scratchpad/gdc/tools/runas.mjs`.
- **Same-SO busy SQL:** `scratchpad/socancel/patch_so_cancel_v8.py`.
- **Quotation cascade notes:** the SQT → SO → GD chain is in `Quotation/SQTcascadeDownstreamWorkflow.json` and
  `Quotation/SQTconvertSOWorkflow.json`.

## 12. GD Edit V2: notes from its owner (2026-10-21)

GD Edit V2 changed on 2026-10-20 for Picking V2's Force Complete (a new source, `PICKING_FC`). Build on that version.

- **Live on dev (read 2026-10-21):** GD_EDIT_SUBMIT v11, GD_EDIT_PREPARE v8, GD_EDIT_WORKER v7, GD_EDIT_COMMIT v9. Check
  them again with `.dbtools/wf --dev deployed "Goods Delivery/EditV2/<name>.json"` right before you change anything.
- **The four JSONs are generated.** `python3 scratchpad/gde/build_gde.py` builds them from `scratchpad/gde/code/**` and
  the lift. Change the code and rebuild: a hand edit of a JSON is lost at the next rebuild. Keep these green:
  - `bash scratchpad/gde/test/run_all.sh`;
  - `bash scratchpad/pk1d/test/gde_gate.sh $PWD/.superpowers/sdd/picking-v2-1d/gde-fx` (the fixtures are git-ignored in
    that folder; ask the owner for a copy if yours is empty);
  - the force complete suites `scratchpad/pk1d/test/test_gde_fc_*.js` (prepare and submit take the fixtures as
    arguments: `$FX/*.json`).
- **A per-source pattern to copy for `SOV2|` references.** All of it exists for `PICKING_FC`:
  - the source's own guard and allowed delta: `code/submit/guard.js`, `gate.js`;
  - the causing job exempted from the busy checks: `code/submit/entry.js`;
  - the hold length per source: `code/prepare/ready.js` (PICKING_FC 1800 s, CASCADE 900 s). Give `SOV2|` its own length
    here instead of changing CASCADE's;
  - orphan holds: a hold whose causing job has ended counts as expired, and the worker cancels it (`code/submit/held.js`
    and the worker's poll / tick SQL, keyed on `causation_id`). `SOV2|` holds want the same rule, keyed on the SAVE_SO
    job.
- **Send a `delta`, not the whole `form`.** Force Complete goes further: SUBMIT reads the delta's parts from
  `gd_publish_step` by a reference (`fcd_ref`), so the request that submits stays small.
- **Sizes measured on 2026-10-21 for one 2,000-line delivery edit:**

  | Request | Node data |
  |---|---|
  | GD_EDIT_SUBMIT (nested inside another workflow's request) | 22.6 MB |
  | GD_EDIT_PREPARE (its own request) | 29.9 MB |
  | GD_EDIT_COMMIT phases (their own requests) | 10–18 MB each |

  Keep each edit's PREPARE and COMMIT out of the SO job's request. Force Complete does this: its job answers a `kick`
  list of edit job ids, and the screen runs GD_EDIT_WORKER `{job_id}` for each.
- **Coordination.** The owner is the Picking V2 / GD Edit V2 session. You may make these changes yourself on the live
  versions, keeping the `PICKING_FC` rules and tests intact, or send them to the owner:
  - the `so_job` fact learning `SAVE_SO`;
  - an `SOV2|` hold length;
  - an `SOV2|` orphan rule.
