# Finished-goods reservation for SO-linked Item Assemblies: proposed design

For approval before any build. 29 October 2026.

- **The request.** The BA asked on 28 October ("if link to SO no reserved"). The user clarified the same day that the finished
  good should be reserved for its SO line, "like Production Order reserved".
- **Checked with the GD session.** Sized with GD Completed & Created V2 on 29 October, read-only.
- **Decided by the user on 29 October:**
  - a separate reserve step after completion;
  - the GD sessions build the GD fix of section 7;
  - the BA confirms the defaults of section 4, and decides D4 (what happens when the SO is edited; options in 4.1).
- **Marking.** Everything marked *(my call)* is the designer's choice and open to change.
- **For the BA.** Every decision is in section 4 (D1–D11); D4 has no default. Section 11 lists two open questions from related
  features.

## 1. What is asked

When an Item Assembly (IA) linked to a Sales Order line completes, its finished good (FG) is kept for that line, the way a
production receipt keeps its output today:
- the FG sits in Reserved stock under a Pending reservation for the line;
- only a delivery of that line can take it;
- other orders' deliveries, pickers and auto-allocation stop seeing it as free stock.

IAs that are not linked to an SO line behave exactly as today.

## 2. How reservations work today (what the design reuses)

- **What a reservation is.** Stock in the Reserved bucket, plus a row in `on_reserved_gd` saying whose it is. Every picker reads
  Unrestricted only, so the stock move is what hides it; a row alone protects nothing.
- **Who reserves for an SO line today.** Only MES does, through the classic `GLOBAL_RESERVED` (2016050452018102274). The SO
  save itself reserves nothing.

  | Writer | What it reserves |
  |---|---|
  | Work Order save (`WO_SAVE`) | For each SO line, the planner splits the order into stock to reserve and quantity to produce (reserved + production must cover the order). The stock part moves Unrestricted → Reserved at the chosen bins and batches, with a Pending **"Sales Order"** row (transaction SO, quantity in the order's unit). |
  | Production Receipt (`SM_PROD_RECEIPT`) | The produced FG is received straight into Reserved, with a Pending **"Production"** row for the SO line (document = the receipt number). Every receipt inserts a new row; rows are never merged. |

- **What a delivery (GD) does with them.**

  | GD action | Effect on a Pending row |
  |---|---|
  | Order of use | Production first, then Sales Order, then free stock |
  | Takes the row | No stock moves. The row becomes Allocated to the GD, and its document ids become the GD's. |
  | GD cancelled | The row goes back to Pending and the stock stays Reserved. Its document ids are cleared, or it is merged into another Pending row with the same type, line, item, bin and batch. |
  | GD completed | Delivers from Reserved |

- **Only two types are ever consumed:** "Sales Order" and "Production". Every GD flow ignores any other type.
- **GD Created V2 never consumes a Pending reservation today** (D11 changes this; see section 7).
  - A delivery whose SO line has one at the delivery's plant is handed to the classic save (`gdV2Fit` in `GD_ASYNC_SUBMIT` and
    `SO_AUTO_GD`).
  - Completed, Cancel, Edit, Picking replan and Revert V2 handle the rows after that.
- **Use so far.**
  - Prod has no Pending reservation of any kind (checked 29 October).
  - Dev has 8 old MES Production rows.
  - Cancel V2 has handled one, once, on dev. Completed, Edit, Replan and Revert V2 never have.

## 3. Proposed design

### 3.1 The reservation

| Part | Value |
|---|---|
| Row | One `on_reserved_gd` row per receipt bin and batch (an output split gives several), in the same shape as a production receipt's. |
| Row type and status | doc_type **Production**, status Pending |
| SO link | parent_id, parent_no and parent_line_id = the SO line |
| Document | doc_id = IA id, doc_no = IA number, doc_line_id = IA id *(my call)* |
| Where | plant_id = the IA's plant; organization_id; bin_location and batch_id = the receipt's; handling_unit_id NULL |
| Quantities | item_uom = **the SO line's unit**; reserved_qty = open_qty (q8, in that unit); delivered_qty 0 |
| Other fields | item_code / item_name / item_desc from the item; line_no = the SO line's index; reserved_date = the completion date |
| Stock | Unrestricted → Reserved at the same bin and batch. It goes through INVENTORY_BULK_APPLY: locked, all or nothing, safe to repeat. Transaction type **IA-F** *(my call)*, document = the IA number. |
| Why "Production" | GD consumes only "Sales Order" and "Production". "Item Assembly" is RES-01's component-hold type: IA_HOLD finds holds by that type plus the IA id. With "Production", no GD reader changes, and a delivery treats the IA's FG exactly like a production receipt's. On the On Reserved list it shows as type Production, with the IA number as its document. |
| Insert-only | Rows are inserted, never merged into an existing Pending row. A classic GD save writes a Pending row back from its own earlier read, so a merge that lands in between is lost silently. Nothing here can prevent that: sql-nodes are SELECT-only and an update-node's WHERE is not enforced. Insert-only needs the GD fix of section 7. |

### 3.2 How much is reserved (defaults D1, D2, D5, D6)

The reservation is the smaller of two quantities, both in the SO line's unit:
- **What this completion received.** The quantity received as **Unrestricted** at each bin and batch (this cycle's 'IA' IN
  movements of the FG, after the last revert), as long as it is still free there now.
- **What the SO line still needs.** Ordered − delivered − every open reservation already on the line. Open reservations are
  Pending and Allocated rows of any type: a Work Order's Sales Order rows, earlier receipts' and IAs' Production rows, and
  deliveries' allocations.

Split rows are covered in row order. Over-production stays free (D1).

**Not reserved** (the status says why):
- the SO or the line is Cancelled, Completed, Closed or deleted;
- the output was received as Blocked (D2);
- the FG is serial-numbered (D6);
- the SO is plant-level and belongs to another plant (D5);
- the FG has no conversion to the SO line's unit;
- the line needs nothing more.

**Example (SO line of 20):**

| Case | What is open | IA makes | Reserved | Left free |
|---|---|---|---|---|
| A Work Order already reserved 10 from stock (Sales Order row) | 20 − 10 = 10 | 12 | 10 | 2 |
| No Work Order | 20 | 12 | 12 | the 10 already in stock stay free (D8) |

### 3.3 The reserve step: a new workflow

**Slot.** The spare "Workflow 6" (1985966558966730753), renamed IA_FG_RESERVE *(my call)*.
- It is an empty placeholder with the same id on dev and prod, so prod is an ordinary paste.
- On 29 October it had no repo references and no runs on dev. Re-check before use.

**Shape.** Operations RESERVE, RELEASE and CHECK. Built like IA_HOLD: the iav2 lib, simulations, mutants.

**Who starts it: the IA form and the IA list, never IA_SAVE or IA V2.** A crashed child workflow would fail the completion. It
is started:
- after a completion, on both paths: the classic save (up to 50 picks), and IA V2 once its job is COMPLETED. This is the place
  where RES-01's CLOSE already runs (`sc_close_after.js`).
- when a Completed or Fully Posted SO-linked IA is opened and its reservation is not finished;
- by a sweep when the IA list opens, for owed and Needs-review reservations (at most a few IAs per run), as RES-01's list does
  *(my call)*;
- from the IA list's Retry Reservation.

**Which IAs are owed a reservation.** IA_SAVE and IA V2 record nothing, so a completed IA can't say whether it is owed one.
- Switching the step on records that moment in the workflow, as an id bound *(my call)*.
- An SO-linked IA is owed a reservation when its completion's 'IA' receipt is newer than that bound and its reservation is not
  finished.
- Older IAs are never reserved (D7).
- The IA list shows a "FG Reservation" column, added as the last column, so an owed or failed reservation is visible without
  opening the IA *(my call, following RES-01, where the BA required a recorded obligation and a list sweep)*.

**RESERVE**
1. **Guard.** The ids are digits; the caller is a member of the organisation (`MEMBER_EXPR > 0`); the switch is on; the IA is
   Completed or Fully Posted (not Processing) and linked to an SO line.
2. **One at a time per SO line.** A ticket in `gd_publish_step` (job `IAF|<soLineId>`, step `TICKET|<n>`): the lowest live HELD
   ticket wins, with a 10-minute lease. Two IAs of one line therefore never over-reserve.
3. **Read**, in one fork-join:
   - the IA header and its reservation status;
   - this cycle's FG receipt movements;
   - the SO line and its header;
   - the line's open reservations;
   - the FG item and its unit conversions;
   - the free stock at the receipt's bins and batches;
   - this IA's own Processing rows;
   - the engine's record of earlier attempts.
4. **Decide.** Section 3.2's rule, in a new shared rule file: pure, with unit tests and mutants.
5. **Write**, in this order:
   1. Insert the rows as Processing (every GD reader ignores Processing), with job_line_key `IAF|<ia>|<n>|<k>`.
   2. Run one engine operation, `IAF|<ia>|<n>`.
   3. Turn the rows Pending by exact id, and read them back.
   4. Write the header.
6. **Failures.**
   - The engine refuses because the stock was taken in the seconds since completion: re-read and retry with what is free, at
     most 3 times. The result is then Partially reserved.
   - The run dies part-way: the next run resolves it from the engine's own record (IBA|DONE and its intents), as IA_HOLD does.

**RELEASE** (before a revert or a re-link, or by hand)
1. Guard, and take the same per-line ticket.
2. Read this IA's reserved quantity per bin and batch, and the line's Pending Production rows there.
   - The check is by quantity. Once a GD has touched a row it no longer names the IA, and it may have been merged. The GD
     session agreed with this rule.
   - Rows are used in this order *(my call)*:
     1. rows that still carry this IA's number;
     2. rows with no document, which is what a GD release leaves;
     3. never a row that names another document, such as an MES receipt or another IA.
3. If the Pending quantity at a bin and batch is less than what the IA reserved there:
   - **A delivery holds the difference** (Allocated rows at that bin and batch): refuse, and name the delivery (D3).
   - **Nothing holds it:** it was released by hand on the On Reserved list (`CANCEL_PENDING` moves it back to Unrestricted), or
     lost by the classic merge bug. RELEASE records the difference as already released and releases the rest. The revert's own
     stock check then decides: it refuses if the stock isn't free *(my call)*.
     - Cost if wrong: on a line shared with an MES receipt whose rows lost their document ids, a release could take part of
       that receipt's reservation.
4. Otherwise, write in this order:
   1. Re-read the rows right before writing.
   2. Cancel or reduce them by exact id, using CANCEL_PENDING's pattern: the row becomes Cancelled and a Pending remainder row
      is inserted.
   3. Read them back.
   4. Run one engine operation, Reserved → Unrestricted.
   5. Write the header: Released.

   Rows go before stock, so a delivery can never take a row whose stock has already gone.

**CHECK.** The read-only status for the form and the list.

**Header fields** (new; only this workflow writes them, and IA_SAVE / IA V2 never do):
- `fg_reserve_status`, varchar: Reserving / Reserved / Partially reserved / Not reserved / Released / Needs review.
- `fg_reserve_json`, longtext: the cycle, the SO line, the unit, the quantities per bin and batch (as text), the reason, the row
  ids, the operation keys and the time.

Both are text, not decimal columns, so nothing needs adding to IA_SAVE's number format map *(my call)*.

### 3.4 Revert, re-link, SO changes

- **Revert (classic IA_REVERT and IA Revert V2).** Refused while the FG is reserved ("release the finished-goods reservation
  first"), in the same way today's holds-open refusal works.
  - The IA list's Revert runs RELEASE first, then the revert. RELEASE refuses if a delivery has taken the FG (D3).
  - Why it isn't inside the revert: the reverts only reverse 'IA' and 'IA-R' movements. The IA-F move has to be undone first,
    so the FG is back in Unrestricted where the completion put it.
- **Re-link or unlink of a completed IA (IA_SC_RELINK).** While reserved, the rows belong to the old line, so a plain re-link is
  refused. The user releases, re-links, then reserves again from the IA. With D4 option A, Re-link does those three steps in one
  action.
- **Delete and clone.** Completed IAs can't be deleted. A clone copies nothing: the fields are server-owned, and the clone's
  form clears them.
- **SO edits after a reservation: to be confirmed by the BA (D4, options in 4.1).** No SO path changes a reservation today, so
  the behaviour has to be decided. Whichever option is chosen, the IA's SO panel shows what is reserved and offers Release.

### 3.5 Display

- **IA form, Sales Order Link section.** One line of status, for example:
  - "Finished goods reserved for SO-… line n: 10 of 12 (2 over the line's need left free) · reserved 29 Oct 14:20"
  - "Not reserved: output received as Blocked"
  - "Needs review: …"

  Plus Release and Reserve buttons, with the same permission as Retry Reservation (`ia_edit`).
- **SO Linked IAs page and `SO_IA_PROJECTION`.** "Reserved" for each IA, and "Reserved for this line" for the line (its Pending
  and Allocated Production and Sales Order rows).
- **On Reserved list.** Unchanged.

### 3.6 Mobile

- Mobile completes through the classic IA_SAVE and never starts the reserve step.
- So the FG is reserved by the IA list's sweep, when the IA is next opened on desktop, or by Retry Reservation.
- That holds until the mobile app calls RESERVE after a completion. A guide like `MOBILE_RES01_GUIDE.md` covers it; the mobile
  session decides when to build it.

### 3.7 The switch

- One switch on the server (in the new workflow) and one on the form. Both stay OFF until the GD fix is live on dev and the
  live tests pass.
- OFF only stops new reservations. RELEASE and CHECK always work, so turning the switch off never strands reserved stock.
- Turning it on records the moment that decides which IAs are owed a reservation (3.3, D7).
- No reduced version ships before the GD fix *(my call)*. Such a version would have to refuse a second IA on the same line,
  bin and batch, which is logic to remove again later.

## 4. Decisions for the BA

These are defaults. Nothing is built until the BA confirms them or changes them.

| # | Question | Default | Why, and what it costs if wrong |
|---|---|---|---|
| D1 | The IA makes more than the line still needs | Reserve only what the line needs; the rest stays free | Reserving more leaves Reserved stock that no delivery will ever take |
| D2 | The output is received as Blocked (QC) | Never reserved, and a later release from QC doesn't reserve it either: by then it can't be told apart from other free stock, which D8 excludes. Alternative for the BA: batch-managed FG only, where Reserve on the IA reserves this IA's own batch once QC releases it. | Reserving at receipt would bypass QC. Note that LSH (128671) receives most IA outputs as Blocked (27 October), so with the default its SO-linked IAs would never reserve. |
| D3 | Revert after a delivery has taken the FG | Refused until that delivery is cancelled. A GD revert is not enough: it puts the delivery back to Created and its rows stay Allocated. Only a cancel returns them to Pending. | Otherwise the revert would take the delivery's stock |
| D4 | The SO is edited after the reservation: a line reduced, increased, cancelled, deleted or re-created | **To be confirmed by the BA.** Three options in 4.1; A is recommended. | Decides whether reserved stock can be left stranded, and whether SO code changes |
| D5 | Plant | Plant-level SO in another plant: not reserved. Organisation-level SO: reserved at the IA's plant. | The GD session asked to reserve only at the delivering plant. An organisation-level SO has no delivering plant until Convert to GD, which already warns when the plant differs. A delivery from another plant never takes the reservation, and it has to be released by hand. |
| D6 | Serial-numbered FG | Not reserved | A reservation row carries no serial numbers |
| D7 | Which IAs | Only IAs completed after the switch goes on (3.3). Nothing is backfilled, and Reserve on an older IA is refused. Alternative: allow Reserve by hand on an older IA, as a manual backfill. | Backfilling old IAs could reserve stock that is already promised elsewhere |
| D8 | The stock half (what a Work Order does): when an IA is planned, reserve the stock already on hand for the line | Not in this design, because the BA asked for the finished good | In the example of 3.2, the 10 already in stock stay free for any order |
| D9 | Should an SO-linked IA update the SO line's Production Qty and Production Status, as a Production Order does? | No. The SO Linked IAs page shows the IAs' figures instead, and the Small Cycle contract keeps the SO's own counters untouched. | Those SO line fields belong to the MES workflows; an IA writing them could clash with a Work Order on the same line |
| D10 | An IA completed on mobile | Accepted for now: it is reserved by the IA list's sweep, the next desktop open, or Retry Reservation, until the mobile app calls the reserve step (3.6) | Until then, another order's delivery can take the output of an IA completed on mobile |
| D11 | Deliveries of a reserved SO line | **Decided by the user (29 October): GD Created V2 must consume reservations itself**, instead of handing these deliveries to the classic save. The GD session confirmed it: about 6–8 h in its four GD Created V2 workflows (section 7). The On Reserved list shows the IA's rows as type "Production". | The classic save takes no engine lock, so next to the reserve step and the V2 flows it can clash on the same stock. Other classic writers remain (section 6, item 1). |

### 4.1 D4: what happens when the SO is edited (to be confirmed)

Today no SO path changes a reservation. The classic SO save, SO Save V2, SO_CANCEL and SO_CASCADE were all checked on 29
October. When an SO changes, Production Order reservations simply stay where they are; unless someone releases them by hand, they
stay stranded in Reserved.

| SO change | Today (Production Orders) | A. The IA side corrects it (recommended) | B. Like Production Orders | C. Release inside the SO save |
|---|---|---|---|---|
| Quantity reduced | Stays; the excess is stranded | The excess is released | Stays; warned; released by hand | Released at the save |
| Quantity increased | Nothing | Output this IA left free (over-production) is reserved, if still free | Nothing | Nothing |
| SO or line cancelled, closed, completed or deleted | Stays, stranded | Everything is released | Stays; warned; released by hand | Released at the save or the cancel |
| Line re-created with a new id (mobile edit, accounting sync) | Stranded on the old line id | Warned; Re-link moves the reservation to the new line | Warned; release, re-link, then Reserve | Only saves that go through the changed SO save are covered; the accounting sync (`SQL_SYNC_SO`, not ours) is not |
| Already taken by a delivery | Stays with the delivery | Never touched | Never touched | Never touched |

- **A. The IA side corrects it.**
  - A RECONCILE operation in the new workflow brings the IA's reservation back in line with the SO line as it is now.
  - It runs whenever someone looks: opening the IA, opening the SO's Linked IAs page, a sweep when the IA list opens (like
    RES-01's sweep of deleted IAs), and Retry Reservation.
  - It reuses the checks the SO link already makes (the warnings the IA shows today), so the SO side doesn't change.
  - About 1.5–2 h more.
  - The cost: the correction happens on the next look, not at the moment of the edit. Until then, the excess stays reserved.
- **B. Like Production Orders.** No extra work. But stranded Reserved stock is likely if people forget to release it, which is
  how stuck Reserved stock builds up today.
- **C. Release inside the SO save.** It acts at the moment of the edit. But it changes the shared SO save (classic and V2, which
  other sessions also change) and SO_CANCEL. It is the most work and the most risk.

## 5. Non-goals and anti-goals

**Not in this work:**
- The SO line's Production Qty and Status (D9).
- Automatic release when an SO is edited, unless the BA picks D4 option A or C.
- Reservations for IAs not linked to an SO line.
- Serial numbers and handling units.

**Would make this a failure even if it works:**
- Any change for an IA not linked to an SO line, or any edit to IA_SAVE or IA V2.
- Reserved stock without its row, or a Pending row without its stock, in any state the next run can't resolve.
- More reserved than the line needs (D1).
- Any change for ordinary deliveries, meaning lines with no Pending rows.

## 6. What LOWCODE cannot guarantee

1. **Classic writers take no lock, and D11 removes only one of them.**
   - A RELEASE racing a classic GD save that read the rows first can be undone. The window is small, and every reservation has
     the same gap today.
   - After D11, deliveries still go to the classic save when the V2 path can't take them:
     - serial-numbered FG;
     - a handling unit in the plant holding the material (Auto picking);
     - Manual picking mode;
     - costing-method cases, and Fixed Cost without a price;
     - stock picked from a handling unit.
   - Picking Plan deliveries, the phone app (1.1.34) and the other classic stock flows also stay classic.
   - Any of these can still clash with the reserve step on the same bin: lost updates in either direction, or a V2 job sent to
     review.
   - The general fix is MIN-01's document-level lock, which is not built.
2. **The gap after completion.** For the seconds between completion and the reserve step, another order's delivery can take the
   FG. The step then reserves what is left (Partially reserved).
3. **Mobile completions** are covered only as section 3.6 describes.
4. **Until the GD fix is in,** the classic save loses quantity when two releases merge into one row, so Pending can show less
   than Reserved.
   - RELEASE then counts the missing part as already released, and the IA's revert refuses because that stock is still in
     Reserved, not free. That is safe, but it needs a manual repair.
   - Section 7 fixes it, and the reserve step stays OFF until then (3.7).
5. **Rows nobody consumes.** Rows on a removed or re-created SO line, or meant for a delivery from another plant, are never
   taken. They need a release, either by hand or by D4's correction if the BA picks option A.

## 7. Dependency: the GD fix (for the GD sessions)

**The problem.** The shared allocation code takes only `pendingProdData[0]` and then `pendingSOData[0]`. These are the first
Pending Production row and the first Sales Order row at the exact item, batch, bin and HU; if the first is used up, it never
moves on to the next. Meanwhile GLOBAL_ALLOCATION counts every Pending row.

**What breaks.** Take two Pending Production rows for one line at one bin:
- dev already has this shape: SO/20260210/076 has two 20-unit rows from PDR/20260210/0013;
- one delivery for both takes the first row, then plans UNRESTRICTED_TO_RESERVED for the rest;
- if there is no other free stock there, the classic save refuses: "Insufficient unrestricted stock to commit this delivery"
  (prod v53, `code_node_ChkSuff01`);
- if there is, it reserves that stock, and the second row is stranded.

**The fix**, in all 8 workflows that carry the code:
- classic GD_UNUSED_FN_NEW (repo `Goods Delivery/GDinventoryProcessWorkflow.json`);
- GD_COMPLETE_PREPARE and GD_COMPLETE_SUBMIT;
- GD_CANCEL_PREPARE and GD_CANCEL_SUBMIT;
- GD_EDIT_PREPARE and GD_EDIT_SUBMIT;
- GD_REPLAN.

What changes:
- Consume every Pending Production row at the key, in id order, then every Pending Sales Order row. This applies in the
  allocation step, and in the completion path's "additional from pending" and "direct delivery from pending". The existing
  first-consumer, pendingConsumed and remainder logic already works per row.
- Bundle the merge fix with it: two releases into one Pending row in a single run must add up into one write. Use the
  `pendingMergeAccumulator` of classic's cleanupOrphanedAllocations wherever a release merges, and one write per row in Completed
  V2's C3 plan. Today:
  - classic's last write wins, and quantity is lost;
  - Completed V2 plans two writes of the same row, the read-back fails, and the job ends REQUIRES_REVIEW after the stock has
    moved.
  - Sales Order rows have the same exposure.

**Why it is safe to ship.** Prod has no Pending rows of any kind (29 October), so the changed branches can't run there until a
Pending row exists. Ordinary deliveries must stay identical; the GD twin simulations prove it.

**Tests on dev:**
- two Pending Production rows at one bin for one line, and one delivery for the whole quantity: both rows Allocated, no
  UNRESTRICTED_TO_RESERVED;
- an under-delivery completion: one remainder per row, no REQUIRES_REVIEW;
- cancel: the rows go back to Pending;
- an edit that lowers the quantity;
- a replan.

Completed V2 with a Production row can be tested on GD/20260213/078 (an Allocated Production row of 40), with the user's yes.

**Owners:**
- GD Completed & Created V2: Completed and Cancel V2.
- GD Edit & Picking V2: Edit V2 and GD_REPLAN.
- The classic GD_UNUSED_FN_NEW still needs the fix after D11. It keeps saving the deliveries the V2 path doesn't take, for
  example phones until mobile V2 ships, and Picking Plan deliveries. Who takes it is for the GD sessions to agree.
- Revert V2 needs no change, because its plan ignores doc_type.

**Also, D11 (decided by the user, 29 October): GD Created V2 and SO_AUTO_GD consume Pending reservations themselves.**

**Why.** They stop handing these deliveries to the classic save. The GD session confirmed the reason on 29 October:
- the classic stock children read a balance row, then write all the stock columns back as absolute values, with no lock;
- both engines (Created V2's INVENTORY_APPLY_OPERATION and INVENTORY_BULK_APPLY) lock the same balance keys;
- so classic and engine writes on one bin can erase each other in either direction, and can send a V2 job to REQUIRES_REVIEW
  (as at Kenhin on 27 October);
- consuming the reservation in V2 puts these deliveries under the same lock as the reserve step.

**The work**, all in the GD session's four GD Created V2 workflows:
- **The fit rule.** Drop the PEND hand-off from `gdV2Fit` (shared source `scratchpad/gdc/gdcreate/code/v2fit_lib.js`, copied into
  `GD_ASYNC_SUBMIT` and `SO_AUTO_GD`). The GD form needs no change.
- **`GD_BULK_PREPARE`:**
  - read the full Pending rows;
  - feed them to the auto-allocation, which today gets none, so V2 never steers a line to the reserved bin;
  - lift the refusal;
  - per key, consume every Production row, then every Sales Order row, in id order, converted into the GD line's unit. A part
    consumption splits the row, and the rest comes from Unrestricted;
  - stock effects and the stock check cover the Unrestricted part only;
  - carry each row's before and after image in the prepared payload.
- **`GD_BULK_COMMIT`:**
  - fingerprint the consumed rows first;
  - re-point each consumed row in place as Processing with the job's marker, and insert the remainder as a new Pending row;
  - read them back before any stock moves;
  - flip them to Allocated with the rest.
  - The hard part: every clean-failure branch must restore consumed rows to their before-images, instead of today's soft-delete.
  - Still to check: a GD fully covered by reservations has zero stock effects.
- **Size:** about 6–8 h, the GD session's estimate.
  - PREPARE and the fit, with tests: 1.5–2 h.
  - COMMIT, with crash and resume simulations: 2.5–3.5 h.
  - Dev publish and live tests: 2–3 h.

**Release.** It ships in the same release as the first-row and merge fix, built as two parts. The first-row fix is still
needed: the classic save and the Edit, Replan and Completed V2 copies still consume and release Pending rows.
- Both parts must be live on prod before the IA reserve step is switched on there.
- Prod has no Pending, Production or Sales Order rows in any status (re-checked 29 October). `GLOBAL_RESERVED` has never run on
  prod. So nothing changes on prod until rows exist.
- The GD session would prove the common path is unchanged by replaying recorded prod Created jobs through the old and new PREPARE.
- No other V2 flow hands Pending lines to the classic save; the GD session scanned every live workflow.

**The GD session's conditions, and where this design meets them:**

| Condition | Where it is met |
|---|---|
| IA is insert-only | 3.1 |
| open_qty is set | 3.1 |
| Reserve only at the delivering plant | 3.2; D5 for organisation-level SOs |
| RELEASE re-reads the rows, writes exact ids and reads them back | 3.3 |

## 8. What changes and size

| Part | Change | Size |
|---|---|---|
| New workflow (Workflow 6 → IA_FG_RESERVE) | RESERVE / RELEASE / CHECK (3.3) | 3–3.5 h |
| New shared rule file | how much is reserved and why not (3.2), with unit tests and mutants | 1 h |
| IA form | the 2 header fields (field publish first); the start points; the SO panel line with Release / Reserve | 1.5–2 h |
| IA list | Revert releases first; the FG Reservation column (added last); the sweep when the list opens; Retry Reservation also runs the FG step | 1–1.5 h |
| IA_REVERT and IA Revert V2 | refuse while reserved | 1 h |
| IA_SC_RELINK | refuse while reserved | 0.5 h |
| SO_IA_PROJECTION and SO Linked IAs page | the reserved figures | 1 h |
| Mobile guide | 3.6 | 0.25 h |
| Live tests on dev (section 9) | | 2.5–3 h |
| **IA side** | | **about 13–15 h** |
| If D4 = A | RECONCILE and Re-link carrying the reservation (the sweep is already counted) | 1–1.5 h more |
| If D4 = C | the SO save (classic and V2) and SO_CANCEL | larger; needs the owners of the SO save |
| GD fix (section 7) | the first-row and merge fixes in 8 workflows | about 3–4 h (my estimate; theirs to size) |
| GD Created V2 and SO_AUTO_GD consuming reservations (D11) | section 7 | about 6–8 h (GD session's estimate) |
| **All parts** | IA side + both GD parts | **about 22–27 h**, plus 1–1.5 h if D4 = A |

- Dev: 5–6 publish batches, each with a backup and the user's yes.
- Prod: about 8 IA-side paste targets, plus the GD sessions' own.

## 9. Live tests on dev

Standing rules apply:
- Tell bladexfunctions-3f before using 711077's stock.
- Never touch the "blade, loose" item at its bin, SO/20261016-034 or SO/20261016-035.
- Keep RES-01 tests off item 2783-000000-00.

| # | Test | Expected |
|---|---|---|
| T1 | Classic completion (up to 50 picks), one bin, non-batch FG | min(output, need) reserved: a Pending Production row in the SO line's unit, Reserved +N and Unrestricted −N at the bin |
| T2 | IA V2 completion (a Mosca BOM over 50 picks on 711077) | Reserved once the job is COMPLETED. If the user leaves first, the IA list's sweep reserves it, or the next open does. |
| T3 | Over-production; and a line that already has a Sales Order Pending row | Only the line's need is reserved |
| T4 | Output split over 2 bins; batch FG | One row per bin and batch |
| T5 | SO line unit differs from the IA's (CTN vs EA); no conversion | Row in the SO line's unit; with no conversion, Not reserved |
| T6 | Blocked output, also after QC later releases it; a plant-level SO in another plant | Not reserved, with the reason (D2 as decided) |
| T7 | Two IAs for one line into one bin (needs the GD fix) | One delivery takes both rows |
| T8 | Delivery of a reserved line: GD Created V2 and SO_AUTO_GD (D11), the classic create (phone, Picking Plan), Completed V2, Cancel V2, Edit V2 lowering the quantity, Picking replan, GD revert | Each consumes or returns the rows as section 2 describes; no Unrestricted → Reserved for the reserved part |
| T9 | RELEASE then revert, untouched; RELEASE after a delivery took the FG; RELEASE after the rows were released on the On Reserved list | Untouched: stock back to Unrestricted and the revert works. Taken: refused, naming the GD; after that GD is cancelled (a GD revert alone is not enough), RELEASE works. Released by hand: recorded as already released, and the revert's stock check decides. |
| T10 | Re-link while reserved | Refused; release → re-link → Reserve works |
| T11 | Two IAs of one line reserving at once; a run killed part-way | Never more than the line's need; the killed run is resolved on the next open |
| T12 | Regression: an IA not linked to an SO completes and reverts; deliveries of lines without Pending rows | Unchanged |
| T13 | SO edits after a reservation, per the D4 option chosen: line reduced, increased, cancelled, deleted, re-created | As 4.1 describes for that option |
| T14 | An IA completed before the switch went on; a mobile completion after it | The older IA is never reserved and Reserve is refused (D7). The mobile one is reserved by the IA list's sweep. |

## 10. Rollout

**Dev:**
1. The IA form with the 2 fields, switch OFF. This creates the columns; check their types.
2. The new workflow (switch OFF), both reverts and IA_SC_RELINK. Their refusals fire only when a reservation exists, so they do
   nothing while the switch is OFF.
3. SO_IA_PROJECTION, the SO Linked IAs page and the IA list.
4. The GD fix and D11's GD Created V2 change, live on dev, from the GD sessions.
5. Switch ON on dev, then the live tests.

**Prod:**
- Both GD parts go first. They can't run on prod until a Pending row exists.
- They must be live on prod before the IA reserve step is switched on there.
- Then the same order as on dev.
- The switch is set as the user decides.
- Nothing is pasted between 10 pm and 1 am.

## 11. Other open questions for the BA (related features, not part of this design)

1. **Top-up transfer request (IA → Location Transfer Request, ENH-20261027-001).**
   - Today an IA can have one transfer request, and once it has been received no second one can be made.
   - If the staging bin turns out short (stock moved away, or the IA's output raised after the receipt), production currently
     fills the gap with an ordinary Location Transfer into the staging bin, then reopens the IA, which re-picks by itself.
   - Question: should production be able to raise a top-up request for just the missing quantity, going through the same
     Requested → Dispatch → Receive steps as the first request?
2. **Attaching an existing IA from the SO line.**
   - Today the link is made from the IA side: Create IA from the SO line opens a new, already-linked IA, and an existing IA uses
     Select SO line or Re-link on the IA.
   - The SO line's Linked IAs only lists and creates.
   - Question: should an existing IA also be attachable from the SO line's Linked IAs?
