# SUDU defect register

This register consolidates confirmed defects and workflow gaps found across the recent Goods Delivery, Picking, Packing, Sales Invoice, Handling Unit, and Inventory investigations. It records the observed evidence and required permanent correction; one-off data repairs do not mean the underlying workflow defect is fixed.

Last consolidated: 2026-10-07.

## BUG-20261002-001 — Concurrent zone Picking saves overwrite GD picking quantities

- Status: Confirmed; production data repair prepared; workflow fix outstanding.
- Reported: 2026-10-02.
- Scope: Production, tenant `128671`, Goods Delivery / Picking / Packing.
- Example: `GD-20260930-280`, item `4024-001`, Picking `PI-20260930-0459`, Packing `PACK-20260930-0158`.
- Expected: The confirmed 2-Paket picking remains reflected in the GD and becomes available for Packing.
- Actual: The Picking record contains 2 Paket, but the GD line contains zero picked quantity, status Created, and no picked allocation. Packing rejects the item as not picked upstream.
- Evidence: Production execution `2105186691416461313` submitted the correct GD line as 2 picked / Completed at 2026-09-30 14:43:14.368. Execution `2105186694377639938` submitted a stale snapshot as 0 picked / Created at 14:43:15.074. Both GD saves reported success. Several zone Picking executions overlapped. The confirmed Picking record and GD line IDs match.
- Additional confirmed case: `GD-20261001-294`, item `1067-002` (Extra Fine Salt), GD line `2105475451119079426`, Picking `PI-20261001-0533`, and Packing `PACK-20261001-0172`. Execution `2105479503777239041` submitted 5 picked / Completed at 2026-10-01 10:06:46.275; execution `2105479530696282114` submitted a stale 0 picked / Created state at 10:06:52.693. Both executions completed.
- Cause: A stale GD snapshot overwrote newer picking quantities during overlapping zone Picking processing.
- Impact: Already-picked goods cannot be packed; retries or new Pickings can cause duplicate physical processing.
- Data repair: Restore the affected GD line from its existing confirmed Picking record, then recompute the GD picking header. Do not repost stock, create a new Picking, or mark goods packed.
- Permanent fix: Serialize reconciliation per GD, derive cumulative quantities from confirmed active Picking records using fresh data, and prevent stale full-document saves from replacing newer picking summaries. Verify with two concurrent sibling Pickings against different lines of the same GD.
- Separate unresolved symptom: Convert-to-Picking refusal with a blank/zero picked quantity. Current production line data would pass the inspected DEV eligibility logic; production conversion source has not been inspected. Do not claim that refusal has a confirmed cause.
- Verification: Production read-only account `rds_support_potlink1999@%`; rechecked unchanged affected line and its single 2-Paket confirmed record on 2026-10-02.
- Scope check: On 2026-10-02, all confirmed positive Picking quantities were compared with current GD-line picked quantities across 122 active, non-cancelled LSH GDs. Exactly two discrepant lines were found: `GD-20260930-280` and `GD-20261001-294`. Both record UOMs match their GD-line UOMs. This check detects current quantity discrepancies, not every historical stale save or every status and inventory discrepancy.
- Repair query: `runbooks/fix-gd-20260930-280-item-4024-001.mysql.sql`.

### Production workflow inspection — 2026-10-06

Read-only inspection confirmed that the current definitions match their enabled history snapshots. No production workflow was executed or changed, and no production data was changed.

| Workflow | ID | Enabled version | Finding / change scope |
|---|---|---|---|
| `PICKING` | `2020683258347081730` | 72 | Already recomputes cumulative picked quantities across sibling Pickings, but later passes a full GD snapshot into `GOODS_DELIVERY`. Protect reconciliation and the subsequent save per GD. |
| `GOODS_DELIVERY` | `2017151544868491265` | 172 | Formats the incoming GD lines and writes the full `table_gd`, allowing older Picking summaries to replace newer ones. Add protection at the write boundary. |
| `PICKING_LOOP` | `2021065804251615233` | 84 | Reads and sets `transfer_order.is_processing` for the individual Picking ID. This does not serialize sibling Pickings against the same GD. Its separate read/set steps are not evidence of an atomic lock. |
| `PACKING_SAVE` | `1994279909883895810` | 28 | `Validate Fully Picked` correctly rejects incomplete GD lines. Retain the validation. |

Relevant nodes in `PICKING`:

- `code_node_iES7iMKA` — **GD Lines Preparation**: prepares line updates using previously fetched GD lines; its Allow Full Picking path still accumulates the session against an existing line summary.
- `update_node_JXfFIqqv` — **Update GD Lines**: writes those prepared line fields, including picking quantities, allocations and status.
- `search_node_SiblingPickings` → `code_node_MNRecompute` → `update_node_MNPicked` — **Get Sibling Pickings / Recompute M:N Picked Qty / Update M:N Picked Qty**: existing cumulative recomputation. This is not a complete concurrency fix without protecting the read-to-write interval and later GD save.
- `search_node_c7BtNx91` → `code_node_B3E0xodz` → `code_node_9rK80jNQ` — **Get GD Datas / GD Data Update / GD Data Preparation**: reads the GD, calculates the picking header and prepares a full snapshot.
- `workflow_node_4c98bf8x` / `workflow_node_Cd96wivg` — **Run Created GD workflow / Run Complete GD workflow**: passes that snapshot as `allData` to `GOODS_DELIVERY`, with `isPicking = Yes`.

Relevant nodes in `GOODS_DELIVERY`:

- `code_node_GKc0ALEe` — **Table GD**: preserves incoming `picked_qty`, `picked_temp_qty_data`, `picked_view_stock` and line `picking_status` unless a line-status override is supplied.
- `update_node_elLmtlLm` — **Update GD Data**: writes `table_gd` from that prepared snapshot and the calculated header picking status.
- `code_pick_reconcile` — **Plan Picking Reconcile**: exits without reconciliation for Picking-originated calls. This existing GD-edit reconciliation does not protect the `isPicking = Yes` path.

The four confirmed LSH overwrite executions above were rechecked by primary key: all ran `GOODS_DELIVERY`, completed, and submitted `isPicking = Yes`, `saveAs = Created`. A local replay of the current **Table GD** and **Validate Fully Picked** scripts with GD-294's captured requests preserved 5 / Completed from the first request and 0 / Created from the later stale request; Packing accepted the former line and rejected the latter. This verifies the node-level stale-payload path, not a new live concurrency reproduction or a completed fix.

### Proposed permanent fix

1. Add atomic concurrency control keyed by **tenant + GD ID**, acquired before reading/reconciling GD lines and held through the final GD save. Use a supported server-side lock with ownership and failure cleanup, or an atomic version check with a fresh-data retry. A separate Get/Set processing flag or an extra Get GD node is insufficient. If a Picking references multiple GDs, use deterministic lock ordering.
2. Within that protected operation, read current GD lines and all applicable confirmed, non-cancelled Picking records; derive cumulative quantities and picked allocations in the GD line's UOM. Preserve batch, bin, HU and bundle identity. Avoid adding the current session twice or replacing authoritative records with an old running total.
3. Rework **GD Lines Preparation / Update GD Lines** and the existing **Recompute M:N Picked Qty** path into one consistent reconciliation. Emit only intended changes; avoid writing unchanged line snapshots back into the GD.
4. Change the Picking-originated `GOODS_DELIVERY` save contract so an older full `allData.table_gd` cannot overwrite newer picking summaries. Prefer GD ID plus the intended operation, with fresh server-side reconciliation; otherwise require a version check and retry before writing. Preserve required reservation, inventory and loading-bay processing rather than simply removing the GD workflow call.
5. Derive line statuses from confirmed cumulative quantities and roll up the GD picking header from the final active lines. Refresh Packing only after the protected GD update succeeds, and propagate failures so retries are safe.
6. Ensure other GD writers cannot bypass this protection and overwrite picking-owned fields. Manual GD and Packing saves must preserve current picking summaries or participate in the same concurrency/version protocol.

**Size / forms:** Medium-sized change, primarily in `PICKING` and `GOODS_DELIVERY`; concurrency support may also require backend work. The inspected Picking form's `onSave_Completed` and Picking page's `AutoPickingComplete` call `PICKING_LOOP`, which calls `PICKING`. No form or button change is required to address this confirmed overwrite path. Retain `PACKING_SAVE` → `code_node_PkPickChk` (**Validate Fully Picked**).

**Required verification before release:** Two sibling zone Pickings completing simultaneously against different lines of one GD; two siblings contributing to the same GD line; partial Picking remaining incomplete; repeated confirmation/retry without duplicated quantity or stock movements; failure cleanup and safe retry; loading-bay reservation movement; alternative UOMs, batch/HU allocation and bundles; and overlapping manual GD/Packing saves preserving picking summaries. Both zones' confirmed quantities and allocations must survive, the final header must match the lines, and Packing must recognize the correct upstream result.

### Candidate review and remaining concurrency gap — 2026-10-06

A production-v172-based `GOODS_DELIVERY` candidate was prepared outside the repository. For normal LSH Picking-originated Edit saves, it keeps the stored GD lines and writes only the GD and picking header statuses after a fresh read. Force Complete stays on the original path because it changes delivery quantity, total, packing quantity and weight. The candidate's local checks cover the captured stale-payload regression and its routing; they do not establish an importable, complete production fix. This candidate must not be treated as the complete solution or deployed by itself.

An additional local replay executed the unchanged production-v72 **Recompute M:N Picked Qty** script with synthetic records for two Pickings contributing to one GD line. Picking A saved 3 and calculated 3 before Picking B saved. B then saw A's confirmed record, calculated 5 and wrote 5 / Completed. A's delayed write replaced it with 3 / In Progress although the confirmed records totalled 5. A subsequent fresh reconciliation returned 5 / Completed. This demonstrates a permitted stale-calculation schedule at `update_node_MNPicked`; it is a local node-level replay, not a new production incident or live-engine concurrency test. Preventing the later full-GD overwrite alone does not address this race.

The downstream production `GD_UNUSED_FN_NEW` workflow (ID `2032273338771128322`, version 52) also updates reserved stock and Picking delivery/reservation records. Preserve and verify that behavior inside the protected operation; simply deleting the `GOODS_DELIVERY` call is not a complete correction.

The available production metadata has no registered `lock-node` component or workflow using it, and no GD mutex table was found. The local engine reference describes an internal distributed-lock handler but supplies no verified production authoring contract. This does **not** establish that the production backend lacks such a handler. The available CLI profile targets DEV, so it cannot verify production capabilities. Before generating a coordinated release package, inspect the production backend source or live workflow metadata and verify the lock/version contract, ownership, expiry, failure release, retry behavior and nested-workflow behavior. Do not substitute a separate Get/Set cache flag, or attach filters to a primary-key update and assume it performs an atomic compare-and-set.

**Outstanding:** The complete fix is not implemented or deployed. Both `PICKING` reconciliation and the `GOODS_DELIVERY` write boundary require coordinated protection; whether this can be delivered as workflow JSON alone depends on verified production concurrency support. Production backend source or live node metadata is needed to resolve that dependency. Existing affected records still require a separately verified repair; this inspection did not re-audit their current live quantities.

## BUG-20261002-002 — GD and SO conversion can create SI without credit validation

- Status: Confirmed financial-control gap; permanent workflow decision and fix outstanding.
- First confirmed: 2026-10-01.
- Scope: Goods Delivery to Sales Invoice and Sales Order to Sales Invoice automatic conversion.
- Examples: Kenhin `SI/20261001/0037`, `SI/20261001/0042`, and `SI/20261001/0051`.
- Expected: Credit-limit and overdue validation runs before an SI is accepted as completed or sent for posting.
- Actual: All three SIs reached `SI_SAVE` with `page_status = Convert`, requested `si_status = Completed`, and `need_cl = NULL`. The historical workflow calls `CREDIT_LIMIT_CHECK` only when `need_cl = "required"`, so SUDU created the SIs without validating credit exposure.
- Impact: Invalid invoices are created and discovered only later when accounting posting fails. This creates operational rework and leaves completed but unposted SIs.
- Posting evidence: SQL Accounting rejected `0037` for overdue `896.00 > 0.00`, `0042` for overdue `1,240.00 > 0.00`, and `0051` for credit `12,319.20 > 5,000.00`.
- Permanent fix: Decide and enforce one policy before conversion: block GD or SI completion, or deliberately create a Draft or exception SI. Converted documents must not silently bypass validation because `need_cl` is missing.

## BUG-20261002-003 — GD credit check can omit the current delivery amount

- Status: Historical defect confirmed; enabled workflow reportedly recalculates the amount, but regression verification and legacy-data handling remain required.
- First confirmed: 2026-09-23.
- Scope: Goods Delivery credit-limit calculation.
- Example: GUB `GD-26/09/0544`.
- Expected: Exposure includes the customer outstanding balance plus the full value of the current GD.
- Actual: The workflow received `gd_total = 0.00` and checked only the existing outstanding amount. The GD passed even though its lines totalled `10,820.00`; `28,900.00 + 10,820.00 = 39,720.00` exceeded the `30,000.00` limit.
- Cause: The current GD amount was omitted from the credit calculation.
- Impact: A GD can pass credit control even though the resulting exposure exceeds the customer's limit.
- Permanent fix: Recalculate and validate the GD total from active lines at the credit-check boundary, reject missing or inconsistent totals, and identify legacy GDs saved with zero totals or blank credit status.

## BUG-20261002-004 — Cancelling a GD does not set the GD header to Cancelled

- Status: Confirmed; workflow fix outstanding.
- First confirmed: 2026-10-01.
- Scope: Goods Delivery cancellation and downstream status consistency.
- Example: LSH `GD-20260930-287-Cancelled`.
- Expected: A successful cancellation moves the GD header and all eligible downstream records into a consistent cancelled state, or blocks cancellation when completed downstream work cannot be safely reversed.
- Actual: The workflow appended `-Cancelled` to the document number and changed Picking status to `Cancelled`, but left `gd_status = Created`. Packing remained `Completed`.
- Evidence: Cancellation was triggered by `vivian` at 2026-10-01 09:44. The resulting state was GD `Created`, Picking `Cancelled`, Packing `Completed`.
- Impact: Screens, reports, and downstream workflows disagree on whether the document is active, cancelled, or completed.
- Permanent fix: Explicitly update `gd_status = Cancelled`, reconcile all line and downstream statuses, and block or implement reversal when Packing is already completed.

## BUG-20261002-005 — Completed Picking is not reliably rolled up to the GD header

- Status: Confirmed recurring synchronization defect; data repairs were prepared, workflow fix outstanding.
- First confirmed: 2026-09-25.
- Scope: Picking completion to Goods Delivery header synchronization.
- Examples: GUB `GD-26/09/0544`, `GD-26/09/0586`, and `GD-26/09/0655`.
- Additional production check on 2026-10-02: LSH `GD-20261002-330`, `331`, `333`, `338`, `339`, and `340` have all active GD lines marked Picking Completed and Packing Completed (37, 14, 30, 7, 1, and 1 lines respectively), but their picking headers remain Created/In Progress and GD status remains Created. LSH has `auto_completed_gd = 1` and `allow_full_picking = 1` on all three active Picking setups; HQ requires Packing. This establishes stale headers with auto completion enabled, but does not independently establish the automatic trigger's implementation cause.
- Expected: When all active GD lines and all linked active Picking documents are completed, the GD header `picking_status` becomes `Completed`.
- Actual: GD lines and linked Pickings were `Completed`, while the GD header remained `Created`.
- Impact: GD completion is blocked and the system incorrectly sends the document into Force Complete Picking.
- Data repair: Tenant-scoped guarded updates can synchronize affected headers after confirming all active lines and Pickings are completed. This is only a record repair.
- Permanent fix: Make the roll-up idempotent and transactional, recompute from current linked records after Picking completion, and add a reconciliation check for stale GD headers.

## BUG-20261002-006 — GD Force Complete Picking fails with an array-to-object error

- Status: Confirmed in the enabled workflow as of 2026-09-28; permanent fix outstanding.
- Scope: Goods Delivery completion when the workflow enters the Force Complete Picking branch.
- Examples: Completion attempts for GUB `GD-26/09/0544` and `GD-26/09/0586`.
- Additional production evidence: LSH `GD-20261002-338` execution `2105861787189645313` at 2026-10-02 11:25:49.743 returned code 406 requesting Force Complete Picking; execution `2105861797067231233` at 11:25:52.098 failed at `update_node_UhYTWDx8` with the array/object exception. The same node also failed for LSH GD-330 and GD-331. These observations were obtained through the production read-only support account; no production changes were made.
- Expected: The branch safely processes every selected Picking record or returns a controlled validation message.
- Actual: The code returns `pickingData` as an array, but the `Update Picking` node expects a single object, causing `JSONArray cannot be cast to JSONObject`.
- Impact: Retrying the same action fails repeatedly and the GD remains incomplete.
- Relationship: BUG-20261002-005 commonly triggers this branch by leaving the GD header stale.
- Permanent fix: Define one stable request contract. Iterate over arrays or pass one object per workflow call, validate the payload type, and add regression coverage for single and multiple linked Pickings.

## BUG-20261002-007 — Allow Full Picking prevents legitimate short delivery completion

- Status: Confirmed workflow and UX gap; enhancement required.
- First confirmed: 2026-09-30.
- Scope: Zone-split Picking, Packing, and short delivery.
- Example scenario: GD quantity `120`, cumulative physically picked quantity `29`, remaining quantity `91`.
- Expected: Users can close the GD as a genuine 29-unit delivery while preserving 91 units as undelivered Sales Order demand.
- Actual: With Allow Full Picking, the 29-unit zone Picking becomes `Completed`, while the GD remains `In Progress` against 120. The existing Picking-list Force Complete action reduces `gd_qty` correctly but only accepts Pickings with status `In Progress`, so it is unavailable after the zone Picking is completed. Packing cannot be completed while the GD still expects 120.
- Impact: LSH must choose between zone splitting and a valid short-delivery close; users can become stuck with a completed zone Picking and incomplete GD/Packing.
- Permanent fix: Add a GD-level Short Complete Delivery workflow that uses cumulative confirmed picked quantity, preserves the original planned quantity in audit history, releases the unpicked reservation, cancels open Picking demand, refreshes Packing quantity, and leaves the remainder available for a future GD.
- Detailed problem statement: [LSH Allow Full Picking and Short Delivery Problem](2026-09-30-lsh-allow-full-picking-short-delivery-problem.md).

## BUG-20261002-008 — Picking can create or update Packing with an empty item list

- Status: Confirmed production defect; the active workflow still contained the affected logic when investigated.
- First confirmed: 2026-09-24.
- Scope: Automatic Picking to Packing creation and refresh.
- Examples: LSH `PACK-20260924-0101`, `PACK-20260924-0109`, `PACK-20260924-0111`, `PACK-20260924-0112`, and `PACK-20260924-0113`.
- Expected: Packing is created or refreshed only with valid source items from the current Picking operation. Existing source rows are preserved unless a verified replacement set is available.
- Actual: The Picking workflow sometimes sent an empty item array. New Packing documents were created without item rows, and updates with an empty list soft-deleted existing Packing source rows. At 15:27 on 2026-09-24, this removed eight rows from `0109` and three from `0112`.
- Impact: Packing tasks appear missing or empty, and already available packing work disappears.
- Permanent fix: Reject empty generated item lists, restrict updates to GDs touched by the current Picking session, use merge semantics instead of full replacement, and restore affected Packing rows from authoritative GD and Picking records.

## BUG-20261002-009 — Re-converting an already invoiced GD can throw a null-pointer error

- Status: Confirmed error-handling and caller-contract defect; no duplicate SI was created in the observed case.
- First confirmed: 2026-10-01.
- Scope: Manual Convert to Sales Invoice after automatic conversion.
- Example: Kenhin GDs `GD/20261001/1257` through `GD/20261001/1262` after automatic creation of `SI/20261001/0031` through `0036`.
- Expected: The system detects that the GD is fully invoiced and returns a clear, controlled message without executing conversion logic.
- Actual: The manual request omitted `source`. The `IF auto?` condition evaluated `workflowparams:source` using `.toString()` on null and raised a `NullPointerException`.
- Impact: Users receive a technical workflow error instead of an actionable explanation. In the confirmed event, no duplicate SI, posting, or extra GD change occurred.
- Permanent fix: Make `source` mandatory at the caller boundary, handle null safely in the workflow, and perform the already-invoiced validation before branching on source.

## BUG-20261002-010 — Unloading the last HU item can leave an empty HU locked

- Status: Confirmed Packing and Handling Unit defect; permanent fix outstanding.
- Scope: Packing unload and reuse of an existing Handling Unit.
- Example: `HU/0118`.
- Expected: Unloading the last active quantity leaves an empty reusable HU with no active item rows and an agreed empty status such as `Created`.
- Actual: Quantity became zero, but the HU item row remained and the unload request preserved `hu_status = Packed`. Select Existing HU treated the mere presence of the zero-quantity row as contents and loaded the HU as `locked / Packed`.
- Impact: An operationally empty HU cannot receive new items.
- Permanent fix: Remove zero-quantity HU item rows, reset the empty HU status, and classify an HU as occupied only when it has active quantity greater than zero.

## BUG-20261002-011 — HU ownership and availability can remain stale across Packing documents

- Status: Confirmed implementation gaps; permanent fix outstanding.
- Scope: Un-completing locked HUs and selecting existing HUs for Packing.
- Expected: Releasing an HU clears the current Packing claim, and the selector offers only HUs that are available for the current Packing.
- Actual: The completed locked-HU un-complete branch does not clear `packing_id`. The Select Existing HU dialog also does not filter sufficiently by `handling_unit.hu_status` or `packing_id`, so an HU claimed by another Packing can still be offered.
- Impact: HUs can remain associated with old work or be selected concurrently by another Packing.
- Permanent fix: Centralize HU claim and release logic, clear ownership on every valid release path, and enforce availability atomically in both selector queries and the server-side load workflow.

## BUG-20261002-012 — Packing completion can require the user to save twice

- Status: Confirmed workflow and UX gap from implementation inspection.
- Scope: Packing Save as Completed with non-empty HU rows that are Packed but not yet Completed.
- Expected: One completion action finishes eligible HU rows and completes the Packing, or presents a clear resumable progress state.
- Actual: HU completion is triggered asynchronously and the user is instructed to click Save as Completed again after row-level completion finishes.
- Impact: Users can assume the first save completed the document, repeat actions prematurely, or leave Packing in an intermediate state.
- Permanent fix: Orchestrate and await HU completion server-side, then finalize the Packing in one idempotent operation with visible progress and retry-safe behavior.

## BUG-20261002-013 — Historical partial MSI posting repaired through replacement documents

- Status: Historical missing quantities repaired on 2026-09-18; quantity reconciliation verified on 2026-10-02. The enabled costing workflow now contains a missing-record guard. Full failure rollback, status finalization, and retry behavior remain unverified.
- First confirmed: 2026-09-10; replacement repair and current balances verified on 2026-10-02.
- Client: Union Profit, tenant `237197`, verified against the production tenant directory on 2026-10-02.
- Scope: Miscellaneous Issue (MSI), Inventory Movement, inventory balances, and Weighted Average costing. All four affected documents belong to organization `1993271402400464897`.
- Expected: Every positive-quantity MSI line produces the required stock movement and associated balance/costing updates before the document is marked Fully Posted / Posted. A failure leaves no partial posting or misleading completed status.
- Historical document evidence: The following four original documents still show `stock_movement_status = Fully Posted` and `posted_status = Posted`, with the original movement gaps below. These gaps were compensated under replacement documents `MSI-2609-139` and `MSI-2609-140`; they must not be treated as proof that stock is still uncorrected.

| Document | Active source item lines | Lines with any matching movement | Positive-quantity lines without movement |
|---|---:|---:|---:|
| `MSI-2609-018` | 2 | 1 | 1 |
| `MSI-2609-021` | 6 | 1 | 5 |
| `MSI-2609-022` | 14 | 2 | 12 |
| `MSI-2609-026` | 12 | 9 | 3 |
| **Total** | **34** | **13** | **21** |

- Historical cause: The September investigation traced an empty destination-plant Weighted Average costing lookup to an unguarded `waDoc.id` access in `SUBTRACT_INVENTORY` / `process WA Data`. Earlier line writes remained committed, later lines were skipped, and the MSI header still reported fully posted.
- Historical impact: Stock deductions were missing and inventory was overstated. Original-document movement presence alone does not establish current stock correctness when a replacement repair has subsequently been posted.
- Completed data repair: `MSI-2609-139`, created at 2026-09-18 14:29, replaced the missing quantities for 12 item/UOM groups. `MSI-2609-140`, created at 14:34, replaced the remaining 2 units of `P5/06-47`. Both document remarks state `Replace for missing item record in system SUDU AI`.
- Quantity verification: Across the four original documents, 13 item/UOM groups had a combined missing quantity of 1,529. The replacement documents posted exactly 1,529 in the same UOM, with zero group-level discrepancies and zero remaining missing quantity. All 13 repaired item/batch/plant/location combinations also have current batch balances equal to their movement-ledger balances.
- `P5/06-41` verification: The replacement `MSI-2609-139` deducted the missing 305 units. Its current repaired-location item and batch balances are 103, matching the movement ledger: the repaired 100 plus `ADJ-2609-017` adding 1 and `ADJ-2609-021` adding 2. Active Weighted Average quantities for the same plant and batch total 103. The old 405-versus-100 discrepancy is historical, not the current balance.
- Current workflow evidence: Enabled history records show `SUBTRACT_INVENTORY` version 58 at 2026-09-18 15:50, `SM_MISC_ISSUE` version 38 at 17:00, and `SM_PLANT_TRANSFER` version 102 at 17:01. The current WA-processing code has a different hash from the original failed run. On-server Boolean checks confirm that the current script contains `if (!waDoc)` with a throw in its guard block; the original failed-run snapshot has neither. A follow-up structural check excluded comments and string literals and confirmed that the guard and throw occur before the ID access. These checks exported no workflow code. They confirm the null guard was added, not that all rollback and caller behavior has been tested.
- Recent execution evidence: The 100,000-run sample covering 2026-09-30 13:42 to 2026-10-02 11:51 Malaysia time contained 11 completed `SM_MISC_ISSUE` runs, 490 completed `SUBTRACT_INVENTORY` runs, and no matching failures in those workflows.
- Remaining verification: Test a multi-line MSI containing a transferred Weighted Average batch. Force a missing costing record and confirm that no partial movement, balance, costing, or posted-status changes remain. Verify destination-plant costing creation, idempotent retries, and costing valuation separately; quantity reconciliation does not certify those behaviors.
- Repair caution: Do not repost the original four documents or add their previously missing deductions again; those quantities have already been compensated by the replacement MSIs.
- Register correction: The initial 2026-10-02 entry incorrectly described the records as unreconciled because it checked only movements under the original document numbers. The replacement-ledger and balance checks above supersede that conclusion.
- Detailed evidence: [Partial MSI inventory posting incident](../incidents/incident-2026-09-10-partial-msi-inventory-posting.md).

## BUG-20261003-014 — Cross-bin Picking can leave Reserved stock in the source bin and falsely complete Picking

- Status: Confirmed production defect; one-off repair prepared; workflow fix outstanding.
- First confirmed: 2026-10-03.
- Scope: FOOGA, tenant `073522`, Goods Delivery / Picking / inventory reservation migration.
- Example: `DO-FG2610-012`, item `RMKF - 0003`, visible Picking `PICK-FG2610-012`.
- Expected: Completing Picking moves the DO's Reserved quantity from `FG-C-FROM-PROD` to `FG-SHIP-STG`, updates the allocation ledger and item balance atomically, records the Reserved OUT/IN movements, and marks the DO Picking summary Completed. Subsequent DO completion consumes Reserved stock from staging.
- Actual: The Picking payload moved `1,019.33 JOB` to `FG-SHIP-STG` but retained a floating-point ghost quantity of `4.091171845743702e-14 JOB` at `FG-C-FROM-PROD`. The active reservation and full Reserved item balance remained at `FG-C-FROM-PROD`; no Reserved cross-bin movement was posted. The GD line was stamped Picking Completed with `base_qty = 0`, while the DO header remained Picking Created.
- Failure evidence: Picking executions `2106280151313682433` and `2106280182749990913` returned an outer success response containing inner business code `400`. The delivery preflight reported `Insufficient unrestricted stock to commit this delivery: RMKF - 0003: need 1019.33, available 0`. The UI nevertheless displayed Picking Completed.
- Cause: Reservation matching uses document line, item, batch, bin, handling unit, and target GD. The existing reservation was keyed to `FG-C-FROM-PROD`, while the completed Picking allocation was keyed to `FG-SHIP-STG`. The migration detector treats the old tuple as still present when any tiny positive residual remains, so it does not migrate the Reserved record. The staging allocation then falls through as a fresh delivery from Unrestricted and fails because staging has zero Unrestricted stock.
- Impact: Picking appears completed but the DO cannot complete, shipment is blocked, and inventory remains stranded in Reserved at the source bin. Repeated Picking attempts can further distort the allocation payload.
- Data repair: Relocate the exact active Reserved balance and `on_reserved_gd` record to `FG-SHIP-STG`, record the normal Reserved OUT/IN cross-bin movement pair, normalize the GD line allocation and `base_qty`, and roll up the DO Picking header. Complete the DO through the application afterward.
- Permanent fix: Normalize quantities within a defined tolerance before tuple comparison; compare migrated quantities rather than tuple presence alone; make cross-bin reservation migration and Picking-status updates atomic; consume the matched Reserved allocation during DO completion; and propagate inner business failures so code `400` cannot mark Picking Completed.
- Repair query: `runbooks/fix-fooga-do-fg2610-012-picking.mysql.sql`.

## BUG-20261005-015 — Completing an edited Draft Location Transfer can post stock under a temporary number and partially complete

- Status: Confirmed recurring production defect; guarded one-off repairs are prepared for the Ascent and PTS occurrences but have not been executed. Permanent workflow correction and current-version regression verification remain outstanding.
- Reported: Ascent occurrence reported 2026-10-05 after completion on 2026-09-28; PTS recurrence reported and completed on 2026-10-07.
- Scope: Ascent tenant `881544`, organization `2029132217130754049`, AAM WHS; PTS tenant `035843`, organization `1993950065513086977`, HQ/JB. Location Transfer / Inventory Movement / item and batch balances.
- Example: `LOT-09/2026-441`, document ID `2104428441947475969`, lines `P8600-0A009` and `PC600-0K055-S1`, each 1 UNIT, destination NG REPLACE. The customer highlighted the second item's two rows showing `issued` instead of the LOT number.
- Expected: Completing the Draft posts one Unrestricted OUT from each source and one Unrestricted IN to NG REPLACE, all under the final LOT number, with no residual In Transit quantity.
- Actual: A single save ran edit reconciliation first, posting Unrestricted OUT / In Transit IN under `issued`, then ran normal DIRECT completion, posting another Unrestricted OUT / Unrestricted IN under `LOT-09/2026-441`. Both item lines were affected.
- Additional confirmed recurrence — PTS `LOT/2610/036` on 2026-10-07: The document was edited from Draft and saved directly as Completed with six lines. Four newly added lines (`TYDR1855516HG918` 12 PCS, `TYDR1757013HG918` 17 PCS, `TYDR2256018RH01` 11 PCS, and `TYGMT2454018PS` 23 PCS) were posted once under temporary `trx_no = issued` as Unrestricted OUT / In Transit IN. The two older Draft lines then posted correctly under `LOT/2610/036` as Unrestricted OUT / Unrestricted IN. When normal completion reached the already-deducted new lines, it returned `Insufficient quantity` and stopped, leaving 63 PCS in target-bin In Transit.
- PTS execution evidence: `SM_LOCATION_TRANSFER` run `2107744220113670146` submitted `page_status = Edit`, persisted prior status `Draft`, prior number `DRAFT-LOT0004`, and `saveAs = Completed`. Its workflow row is `Complete` and the outer response is code `200`, while the nested business response is code `400` with `Insufficient quantity`. The header nevertheless became `Completed`. Eight active `issued` movements at 16:05:58–16:06:00 contain the four affected OUT/IN pairs; four active `LOT/2610/036` movements at 16:06:01–16:06:02 contain only the two correctly posted older lines.
- Execution evidence: `SM_LOCATION_TRANSFER` run `2104456249562238978` at 2026-09-28 14:20:43.459 completed successfully. The request was Edit mode, original status Draft, number `DRAFT-LOT0011`, and requested saveAs Completed. Nested duplicate calls `2104456252015906818`, `2104456253253226498`, `2104456254058532866`, and `2104456255157440514` all completed; normal completion posted the legitimate pairs immediately afterward.
- Cause: The saved execution's `fillbackHeaderFields` (`code_node_yPlLXIZW`) replaced the Draft number with literal `issued` before final numbering. The Edit path ran `Reconcile Compute` (`code_node_uht83Wzh`) and wrote its allocation delta with that placeholder. `Compute Main Movements` (`code_node_LOTmainCompute`) then treated Draft-to-Completed as DIRECT and deducted the same source allocation again under the generated LOT number. Reconciliation was not isolated from the initial Draft issuance path.
- Exact duplicate movements: `2104456252707966977` / `2104456253483913218` for P8600-0A009 at 14:20:44.197 / .392; `2104456254641541122` / `2104456255371350018` for PC600-0K055-S1 at 14:20:44.668 / .843. Each pair is -1 Unrestricted at the source and +1 In Transit at NG REPLACE, with trx_no `issued`.
- Legitimate movements to preserve: `2104456258617741314` / `2104456259360133121` and `2104456260517761026` / `2104456261239181314`, under `LOT-09/2026-441` at 14:20:45–46.
- Current-state verification on 2026-10-05: Both NG REPLACE item balances still contain exactly 1 extra In Transit UNIT. Ledger quantities match the stored balances, and each item's sole active In Transit movement in that bin is the duplicate `issued` IN. Source Unrestricted quantities are 510 and 7 respectively before repair. No active `in_transit_detail` record exists for this transfer. Historical nested execution-node checks show only Inventory Movement creation and Item Balance updates: no FIFO/WA costing or batch-balance write nodes ran for these four calls (`isMovingInv = 1`, no batch).
- Impact: Each source was deducted twice, an extra unit was stranded in In Transit for each item, and the export displays an internal placeholder instead of an identifiable document number. Renaming `issued` alone would not repair the quantity error.
- PTS recurrence impact: The four affected source quantities were deducted once as intended, but their destination quantities were classified as In Transit rather than Unrestricted. Item and batch balances both hold the same 63 PCS in In Transit, so the Item Batch Balance by Location report is reflecting the corrupted posting rather than a display or refresh problem. The misleading Completed status hides the partial failure.
- Data repair: One tenant-scoped, guarded InnoDB multi-table UPDATE restores 1 UNIT to each source's Unrestricted and total balance, removes 1 UNIT from each destination's In Transit and total balance, and soft-deletes only the four duplicate movements. It preserves the legitimate LOT pairs and retains the duplicate rows for audit. Read-only eligibility check matched both pairs. A read-only projection of the correction returned zero ledger-versus-balance differences for all four affected balances: source quantities 511 / 8 and destination quantities 10 / 3, with destination In Transit zero. These are projected results, not an executed repair; no production mutation was executed. Enable Bytebase's built-in backup option and pause affected inventory saves before execution; the script contains no backup or BEGIN/COMMIT statements.
- PTS recurrence data repair: Preserve the four source deductions and all total quantities. Reclassify the four exact destination `item_balance` and `item_batch_balance` rows from In Transit to Unrestricted, change the four destination IN movement categories to Unrestricted, and replace `trx_no = issued` with `LOT/2610/036` on all eight affected movements. A guarded one-statement repair has been prepared but not executed. It must refuse to run if any affected target balance or movement has changed.
- Permanent fix: Skip stock reconciliation for Draft documents; generate/read the final LOT number before any posting; make initial issuance and completion paths mutually exclusive; atomically post movements and balances with a document/line/phase idempotency key. Reject placeholder document numbers at the inventory-write boundary.
- Regression coverage required: Edit an existing Draft with new allocations and save directly as Completed; assert exactly one OUT/IN pair per line under the final number, correct balances, and no residual In Transit. Also test Add-to-Completed, Draft-to-In Progress-to-Completed, allocation edits to In Progress, and retries after partial failures. The current workflow version has not been certified by this historical diagnosis or data-repair preparation.
- Repair query: [Ascent LOT-09/2026-441 duplicate posting correction](../runbooks/fix-ascent-lot-09-2026-441-duplicate-issued.mysql.sql).
- PTS repair query: [PTS LOT/2610/036 In Transit reclassification](../runbooks/fix-pts-lot-2610-036-in-transit.mysql.sql).

## BUG-20261006-016 — Editing a Created Goods Delivery consumes SO planned quantity before completion

- Status: Confirmed production defect; one-off data repair prepared, not executed; workflow fix outstanding.
- Reported: 2026-10-06. The corrupting edit and failed completion occurred on 2026-10-03.
- Scope: TAF, tenant `681409`, Goods Delivery edit/save and Sales Order planned-quantity lifecycle.
- Example: Goods Delivery `TA188810`, Picking `PK-03780`, Sales Order `SO-N12609-102`; four active lines with quantities `6`, `0.75`, `6`, and `0.75 M/T`.
- Expected: Editing an existing `Created` GD without changing its line quantities leaves the linked SO `planned_qty` reservations unchanged. The later `Created` to `Completed` transition consumes each reservation exactly once and completes the GD.
- Actual: An Edit-mode `saveAs = Created` request succeeded but changed all four linked SO-line `planned_qty` values to zero while the GD remained `Created`. The following `saveAs = Completed` request attempted to subtract the same quantities again and stopped on row 1 with `planned quantity would become negative (-6.000)`.
- Execution evidence: `GOODS_DELIVERY` run `2106249851464454145` at 2026-10-03 13:07:51 submitted `gd_status = Created`, `pageStatus = Edit`, and `saveAs = Created`; it returned `Good Delivery saved successfully`. The request did not contain `prev_temp_qty_data`, and its line snapshots carried `gd_initial_delivered_qty = 0` despite the persisted delivered quantities. Immediately afterward, run `2106249926253088770` at 13:08:09 submitted the same document with `saveAs = Completed` and returned business code `400` for the negative planned quantity.
- Current-state evidence: `TA188810` remains `Created`. All four GD lines retain positive `plan_qty` matching their intended delivery quantities, while the corresponding SO lines have `planned_qty = 0`, `delivered_qty = 0`, and their full quantities still outstanding. The linked Picking/transfer record is already completed. No Sales Invoice exists for this GD, and no `SUBTRACT_INVENTORY_NEW`, `ADD_INVENTORY_NEW`, `SI_SAVE`, `SI_POST`, or `AR_SAVE` workflow ran in the affected completion window.
- Cause: The edit path did not hydrate a reliable persisted previous-line snapshot. It treated unchanged quantities as a new/full adjustment and consumed the SO reservation during a `Created` save. The completion path then independently applied the same planned-quantity decrement. The workflow lacks an idempotent state-transition boundary tying the SO counter change to one successful GD status transition.
- Impact: The GD cannot be completed, the SO reservation no longer represents the still-created delivery, and repeated completion attempts deterministically fail. Similar existing Created GDs with missing previous-value snapshots may be vulnerable.
- Data repair: Restore each of the four SO-line `planned_qty` values from this GD's guarded `plan_qty`, correct the separately observed GD base-UOM mapping, refresh the application page, and complete the GD once through the application. The prepared repair must be run with Bytebase's built-in backup enabled. No production mutation was performed during diagnosis.
- Permanent fix: On Edit, load previous quantities from persisted GD lines rather than trusting optional client snapshot fields. For `saveAs = Created`, adjust SO reservations only by the verified difference between the new and persisted planned quantities; an unchanged edit must produce zero delta. Consume the reservation only on a guarded `Created` to `Completed` transition, and make the GD status update plus SO counter updates atomic and idempotent. A retry of the same transition must not reapply the decrement. Reject or safely reconstruct requests whose previous-value snapshot is absent.
- Regression coverage required: Create a GD, reopen it, save unchanged as Created, then complete it; edit line quantities up and down before completion; retry Created and Completed saves; omit previous-value fields; use multiple lines and repeated items; and simulate a failure between SO-counter and GD-status writes. Assert that planned quantity changes only by the intended delta, completion consumes it exactly once, delivered/outstanding quantities remain correct, and no inventory or invoice posting is duplicated.

## Investigated findings that are not separate defects

- LSH Extra Charges lines were not the cause of `GD-20260930-280` remaining in Picking In Progress. Lines configured with `stock_control = 0` and `show_delivery = 0` were correctly marked Picking and Packing `Completed`.
- The later 2026-10-02 investigation superseded the assumption that every incomplete stock line on `GD-20260930-280` represented genuine unpicked stock. Item `4024-001` had a confirmed 2-Paket Picking that was overwritten in the GD by a stale concurrent save; this is recorded as BUG-20261002-001.
- Packing correctly blocks final completion while a GD still expects unpicked quantity. The defect is the missing short-delivery close path recorded as BUG-20261002-007, not the safety check itself.
- The Kenhin repeat-conversion error did not create duplicate Sales Invoices or change the six GDs further. The defect is the null-unsafe workflow and poor validation message recorded as BUG-20261002-009.
- LSH had five active packaging-material choices during the missing-Packing investigation. Existing HU rows intentionally lock their material field. A report that a brand-new row cannot select material remains unconfirmed without an exact Packing number or recording.
