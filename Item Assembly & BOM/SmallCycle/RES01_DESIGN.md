# RES-01 Raw-material reservation for Item Assembly: proposed design

For approval before any build. 21 October 2026. It answers the BA handoff (20 October), sections 11 and 12, including the five
"developer-confirm contract gates". The facts behind it are in `scratchpad/iasc/research/RES01_reservation_facts.md` (read-only
research on DEV and PROD, 21 October).

## 1. What is asked

On the first successful save of an Item Assembly (IA), hold the raw materials that are available for that IA, show any shortage,
and never refuse a Draft because of a shortage. The hold belongs to the IA and its component line, follows the IA through edits,
completion, delete and revert, and is never copied by a clone. Required, picked, held, short and consumed quantities stay
distinct. No backend change.

## 2. How a reservation works today (what the design reuses)

- **A hold is a stock move, plus a bookkeeping row.**
  - The quantity moves from Unrestricted (or Blocked) to the Reserved bucket at the exact bin and batch, without costing.
  - The row in `on_reserved_gd` records who holds what.
  - Every picker reads only Unrestricted, so the move is what hides the stock from other documents. A row alone protects
    nothing.
- **The row must be "Allocated".** A "Pending" row is claimed by any Goods Delivery of the same SO line. The `doc_type` list
  has no "Item Assembly" value today; it has to be added to the table on DEV and PROD.
- **Only the V2 inventory engine (INVENTORY_BULK_APPLY) locks.** It locks the balance rows, re-reads them under the lock,
  refuses an insufficient move, and replays a repeated request safely. The classic stock workflows read, check and write with
  no lock.
- **Item Assembly today:**
  - A Draft stores its picks but holds nothing.
  - Completion issues from Unrestricted.
  - Revert puts components back into the bucket they were issued from.
  - Delete is a client-side soft delete (Draft only).

## 3. Proposed design

### 3.1 The hold

| Part | Value |
|---|---|
| Owner | the IA id + the component line id (kept across saves) + material + bin + batch: one row per picked fragment |
| Row | `on_reserved_gd`: doc_type **Item Assembly** (new value), status Allocated, doc_id = IA id, doc_no = IA number, doc_line_id = line id, item_uom = the line's unit, reserved = open, `from_category` = the bucket it came from. No SO line and no GD id on the row, so no Goods Delivery or picking reader ever claims it. |
| Stock | from_category -> Reserved at the same bin and batch, through INVENTORY_BULK_APPLY (locked, all or nothing, safe to repeat) |
| Not held (proposed, decision B) | non-stock lines (as today), lines picked from a handling unit, serial-numbered items: shown "not reserved" with the reason |

### 3.2 One reconcile operation: new workflow IA_HOLD

After a successful Draft save, IA_SAVE marks the IA "Reserving" and the desktop form starts the reconcile, so a save never
fails because of a reservation (decision of 21 October, 14:05: on this platform a failure inside the save would fail it after
the Draft was written). Opening an IA that is still "Reserving" starts it again. A re-save is also how the planner claims stock
that arrived later; no automatic top-up (backlog).

1. **Lock.** Take the IA's document lock (the `IAC|<ia>` family IA V2 already uses), so a hold, a completion and a background
   job never run at the same time on one IA.
2. **Read.** Read the saved IA (its lines and picks) and its own open rows. Never the latest BOM: the saved lines are the
   basis.
3. **Work out the change.**
   - **Release** what a removed or reduced pick no longer needs: Reserved back to `from_category`, its row Cancelled, or split
     when only part is released.
   - **Hold** what a new or increased pick needs, but only what is free at that bin and batch.
4. **Apply.** One engine operation. If another document took the stock between the read and the apply, the engine refuses;
   the operation then reads again and retries (at most 3 times), and after that the IA is marked **Needs review**.
5. **Rows.** Rows are written the way GD Created V2 writes them:
   - inserted as Processing first, which every reader ignores;
   - turned to Allocated once the stock has moved;
   - soft-deleted on a clean failure.
   So rows and stock cannot drift apart.
6. **Result on the IA header:** `material_hold_status` = Fully reserved / Partially reserved / Shortage / Needs review (these
   are material-coverage labels, not new IA statuses), and when it was last checked.

**Big IAs (decision C):** above 50 picks, the Draft is saved at once and the reconcile runs in the background, with the IA V2
job pattern (it shows "Reserving..."). Reason: the locked engine costs about 0.3 s per distinct pick on today's slowed DEV
(about 0.03 s before DEV slowed down; PROD not measured), so an 830-pick BOM would make the save wait minutes.

### 3.3 Required versus picked (decision A)

Today a line's quantity is lowered to what auto-allocation could pick (required 10, 6 found: the line says 6). So the existing
fields cannot tell "short of stock" from "the planner chose to use less".

**Proposal:** a new hidden line field `required_qty`, the requirement:
- it is set from the BOM reference when the BOM is prepared, and follows changes to Output to Receive;
- it changes when the planner edits the line's quantity by hand;
- auto-allocation never lowers it.

The display then reads, for example, "Required 10 / Reserved 6 / Short 4". Manual lines take their own quantity. The server
keeps the stored value when an older app (mobile) does not send it, as it already does for `sc_ref_key`.

### 3.4 Completion (classic save up to 50 picks, IA V2 above)

| Step | Behaviour |
|---|---|
| Issue | Each picked fragment that has an own open row is issued from **Reserved**, up to the row's open quantity. Anything beyond is issued from Unrestricted, with today's stock check. Another document's holds are never touched. |
| Close | The used part of each row becomes Delivered (the row is split if only part is used). An unused own hold is released (Reserved -> `from_category`) and Cancelled, only after the issue succeeded. |
| Background (Processing) | The holds stay in place while the job is queued and are issued from Reserved by the job itself, so a queued IA never exposes its stock. |
| Failure | Nothing is released on a failure. A completion whose effect is uncertain leaves the IA in Needs review, and completion is refused until a reconcile succeeds. |
| Drift check | Before issuing from Reserved, both the own row and the Reserved bucket are checked. A mismatch stops with Needs review: PROD already has reserved stock with no row behind it. |
| IAs without holds | Every IA saved before activation, and any IA with no own rows, takes exactly today's path. |

### 3.5 Revert, delete, clone, old Drafts, mobile

- **Revert (classic and V2).** Components that were issued from Reserved come back to **the bucket their hold came from**
  (Unrestricted or Blocked, as the completion's Delivered rows record; corrected 21 October after the review: Blocked stock never
  becomes free through a revert): the holds were closed at completion. The reverted Draft is then reconciled once, so it holds again what is available, and never the original full plan
  by assumption.
- **Delete (Draft, IA list).** The IA's holds are released first. If the release fails, the delete is refused.
- **Clone.** Holds belong to the IA id, so nothing is copied. The clone reserves on its own first save.
- **Old Drafts (enrolment policy for the BA).** Only an IA first saved as new (Add or Clone) after activation is enrolled. Drafts
  that exist at activation hold nothing and complete as today. Nothing is backfilled when an old IA is reopened.
- **The switch (rollback).** The switch decides whether new holds are made (a new IA is enrolled, a Draft is reserved after a
  save and on open). Whatever an IA already holds is always finished: its completion uses the holds, its close delivers and releases
  them, a delete releases them and a revert returns them. Turning the switch off therefore never strands held stock; stopping every
  hold at once means a release (Drafts) or close (completed IAs) for each IA that still holds stock.
- **Mobile.** A mobile save marks the IA "Reserving"; the reservation is made when the IA is next opened on desktop, until a
  mobile release starts it right after the save (and closes the holds after a completion). The mobile picker must also add
  the IA's own holds back when it reopens; until then an enrolled Draft edited on mobile shows its own held stock as taken,
  and the next reconcile puts it right.

### 3.6 Display (UI-01's reservation summary)

- **Materials section:** a row such as "Raw material reservation: Partially reserved · 3 of 5 lines · checked 21 Oct 11:40 ·
  Reservations update when this IA is saved."
- **Each component line:** Required, Reserved and Short columns in the line's unit, read from the IA's own rows when it
  opens. An unsaved change shows as "pending save".
- **The IA's own picker** adds its own holds back, so they stay selectable for this IA.
- **Needs review** says what to do: "the last reservation did not finish: save again to retry".

## 4. What LOWCODE cannot guarantee (to know before activation)

1. **Classic writers do not lock.** The classic Goods Delivery save, Misc Issue, Plant Transfer, Stock Adjustment and the classic
   IA save do not take the engine's locks. A hold racing one of them on the same bin can still lose an update. Every existing
   reservation has the same gap today.
2. **Two documents can consume Reserved stock without an owner check:** Disposal/Scrap and Goods Issue (no use on PROD today).
3. **Existing drift.** PROD has 55 balance rows holding 7,188.95 reserved units with no reservation row. The design detects a
   mismatch and stops; it cannot repair old data.
4. **Not held in this cycle (if decision B stands):** handling-unit picks and serial-numbered items.
5. **A hold is a later movement of the stock it holds.** A Goods Receiving revert of stock that is now held is refused, as for
   any later movement of received stock; Putaway V2 of held stock fails safely as a shortage (it reads Unrestricted only).

## 5. Answers to the BA's contract gates (section 12)

| Gate | Answer |
|---|---|
| 1. Native writer, owner, mappings | `on_reserved_gd` with the new doc_type "Item Assembly"; INVENTORY_BULK_APPLY for the stock move; owner = IA id + line id + material + bin + batch (3.1) |
| 2. Units, buckets, eligibility | Rows in the line's unit, quantities q8; the stock moves into `reserved_qty` (pickers read `unrestricted_qty`, so nothing is subtracted twice); batch kept, HU and serial not held (3.1) |
| 3. Concurrency | Engine locks per balance row + the IA's document lock + a re-read and retry on a refused move. Classic writers stay outside the locks (4.1) |
| 4. Failure and repeat | One engine operation per reconcile, safe to repeat; rows Processing -> Allocated; Needs review stored on the IA and completion refused until reconciled (3.2, 3.4) |
| 5. Old Drafts, direct Complete, cancel / delete / revert | 3.5. A direct Complete without a Draft issues from Unrestricted as today and leaves no hold behind. |

## 6. What changes (touch list) and size

| Part | Change |
|---|---|
| `on_reserved_gd` form, DEV and PROD | doc_type value "Item Assembly" (shared table: tell the GD sessions; IA rows carry no SO line and no GD id, so their readers skip them) |
| New workflow IA_HOLD (+ its background job for more than 50 picks) | the reconcile of 3.2 |
| IA_SAVE | Draft: reconcile after the write. Completed: issue from own holds, close and release rows (3.4) |
| IA_V2_SUBMIT / PREPARE / COMMIT | Reserved accepted for own holds; COMMIT closes the rows |
| IA_REVERT / IA_REVERT_V2 | back to the bucket each hold came from, then one reconcile |
| IA form | `required_qty`, `material_hold_status` / checked at, the summary row, the line columns, the picker add-back |
| IA list page | delete releases first |
| Mobile | guide for the picker add-back (its own release) |

Size: about 4 to 5 working days with tests and the live DEV checks (U09-U16, U18). Everything ships behind a switch that stays
OFF until you activate it.
