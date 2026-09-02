# Picking Concurrency — Parallel Picking

> How more than one picker can work a single Picking document, what was changed
> to make that safe, and the one defect that turned out not to be fixable on
> this platform.
>
> **Mobile: start at "For the mobile app" below.** One behavioural change needs an
> adjustment on your side; the API contract itself is unchanged. Everything from
> "Overview" onward is backend detail you can skim.
>
> **Backend: these workflows live in the BladeXfunctions repository** —
> `Picking/PickingLoopWorkflow.json` and `Picking/PickingProcessWorkflow.json` are
> byte-identical to the enabled dev versions, so a fix applied only in the platform
> gets reverted by the next sync. Edit there, then paste and enable.

---

## Status

| Change | State |
|---|---|
| Lock released on both graceful early returns (3 workflows) | **Deployed to dev** |
| Putaway + Stock Picking: acquire moved inside the guard, 900s stale recovery added | **Deployed to dev** |
| Server-side clamp of picked qty against fresh pending | **Deployed to dev** |
| Atomic lock acquisition (the original Part 1a) | **Not possible on this platform** — see below |
| Mobile pull-to-refresh | Shipped (app repo) |

Live on dev as of 2026-09-02: `PICKING_LOOP` **v80**, `PICKING` **v120**,
`PUTAWAY_LOOP` **v14**, `STOCK_PICKING_LOOP` **v4** — all byte-identical to the repo
files. **Nothing is in prod yet.**

**None of it has been exercised by a real pick.** No run of any of the four has been
recorded since deployment, so every claim below is verified by code reading, unit
tests and `EXPLAIN` — not by a live confirm. The behaviour to watch on the first
real runs:

- a normal confirm still completes, and `is_processing` returns to `0`
- a validation failure releases the lock instead of stranding it for 900s
- a second confirm against an already-picked line records the clamped quantity

Stock Picking cannot be exercised at all yet — `stock_picking` has 0 rows on dev.

---

## For the mobile app — what changed, and what to adjust

**The API contract has not changed.** Same workflow id, same params
(`arrayData`, `saveAs`, `pageStatus`, `confirmed_by`), same response shape.
Nothing in `PickingAdd` will break. The changes below are behavioural.

### 1. The server now silently clamps picked quantity — this is the one to act on

Quantities submitted above what the document actually has pending are trimmed
server-side before they are recorded (Part 2 below). **The response does not say
this happened** — `PickingLoopWorkflow` returns a fixed
`{ code: "200", message: "Picking processed successfully" }` either way.

So after a successful confirm the app's local state can disagree with the server:
the picker entered 10, the server recorded 4, and the app still shows 10 as picked.

**Suggested adjustment: refetch the document after a successful confirm** — the
existing `TransferOrderPickingUtils.getPickingDocumentsByIds` +
`[pickingData]` rebuild path already does exactly this for pull-to-refresh. That
also picks up the recomputed `pending_process_qty` and `line_status`.

Keep the client-side clamp (`clampToFreshPendingRef`). The two are complementary,
not redundant — the client one stops the picker entering an impossible number at
all, the server one is the authority when the client's view was stale.

If you would rather have an explicit signal than refetch, say so: the clamp already
computes a `clampedLines` list (`picking_item_id`, `requested`, `allowed`). Getting
it into the response means plumbing it out of the Process sub-workflow, through the
loop's workflow-node, into the return — doable, but it changes the response
contract, so it is not done.

### 2. Parallel picking is unsafe on Sales-Order pickings

Where `picking_setup.picking_after == "Sales Order"`, the first picker to confirm
closes **every line in the payload** and completes the document, wiping the other
picker's pending quantities. This is by design on that branch and is not fixed by
anything here.

**Question for mobile:** can the app read `picking_after` from Picking Setup? If so,
parallel picking should be gated on it — or at minimum the app should not encourage
two pickers onto one document there. If the app cannot see that setting, this has to
stay an operational convention.

### 3. "Under processing" should become rare, and now means what it says

Previously a failed confirm stranded the document for the full 900s stale timeout,
so pickers saw *"The current picking is under processing"* for 15 minutes on a
document nobody was touching. Both graceful failure paths now release the lock
immediately. Keep the existing 400 handling as-is.

One case survives: if a workflow node **throws**, the instance dies and the lock is
still only cleared by the 900s timeout. Rarer, but a 15-minute wait is still
possible after a hard backend failure.

### 4. Two things still to design around

- **Two simultaneous taps are still not serialised.** A ~50 ms window remains where
  both confirms can acquire the lock (see 1a). Do not rely on the backend to order
  them.
- **Force complete still double-counts a line two pickers both picked**, for records
  written *before* this change. Disjoint lines remains the safer convention.

---

## Overview

A Picking document can carry a hundred-plus lines, and a single picker walking
them serialises work that could be split. The backend supports two pickers on one
document **in the Goods Delivery configuration only** — see the branch split below.

### Why it works (GD-sourced pickings)

`PickingProcessWorkflow` forks at `if_os041JOX` on
`picking_setup.picking_after == "Sales Order"`. The **false** branch — GD-sourced,
`code_node_Z5JH4g2u` — is the one the original analysis described, and it is accurate:

- `originalPickingData` is read from the **`Get Original Picking` DB node**
  (`get_node_jEllcWiJ`), not from the client payload.
- Quantities: `newPendingQty = Math.max(0, originalItem.pending_process_qty - pickedQty)`.
- Records: `combinedRecords = [...originalRecords, ...newRecords]`.
- Status is partial-aware — `'Completed'` only when every non-cancelled line is
  complete, otherwise `'In Progress'`.

And the client's `saveAs: "Completed"` does **not** force the document complete:
`IF !Completed` is `saveAs != "Completed"`, so the Loop's own `Update Picking`
(which would stamp `to_status = saveAs` blindly) is skipped and the Process
workflow writes the *computed* status instead. `isForceComplete` comes from a
workflow param the mobile client never sends.

So the normal parallel sequence is:

| Step | Result |
|------|--------|
| A picks lines 1–50, confirms | Doc → **In Progress**, A's records appended |
| Lock releases (seconds, not A's 20 minutes in the aisles) | Document free |
| B picks lines 51–104, confirms | Workflow reads A's work, subtracts B's, appends B's records → **Completed** |

### Why it does NOT work on Sales-Order pickings

The **true** branch — `code_node_hojzwwoL`, used when
`picking_setup.picking_after == "Sales Order"` — behaves completely differently and
is **intentionally one-shot**:

```js
return {
  ...originalItem,
  pending_process_qty: 0,          // not a subtraction
  line_status: lineStatus,         // always 'Completed'
  ...
};
...
const toStatus = 'Completed';      // hardcoded, not computed
```

`workflowItemMap` is built from `allData.table_picking_items`, and
`code_node_owIpFo5i` passes the **raw unfiltered client payload** through on the
Edit path. So every line the client sent is closed, whether or not anything was
picked against it.

> **Do not enable parallel picking on `picking_after = "Sales Order"` tenants.**
> The first picker to confirm completes the whole document and zeroes everyone
> else's pending quantities. This is not a race — it happens every time, and none
> of the fixes below change it.

---

## Part 1 — Lock handling

`PickingLoopWorkflow` holds a mutex on `transfer_order.is_processing`, with a
900-second stale-lock recovery, and rejects a second concurrent run with
`code: "400"` / *"The current picking is under processing"*. Mobile already
surfaces that message.

### 1a. Atomic acquisition — NOT POSSIBLE, do not retry

**The defect is real.** `sql_node_LockGate` runs a `SELECT`, `code_node_LockDecide`
decides, and the `Valid` branch runs `update_node_QvZ8RAFW` — an
`UPDATE … SET is_processing = 1` whose filter is **only `id in (...)`**, with
nothing conditioning it on the lock still being free. Two runs can both read
`is_processing = 0` and both acquire, and the second write then clobbers the
first picker's deduction and records.

**The proposed fix does not work.** It called for replacing the gate's `SELECT`
with a compare-and-set `UPDATE` in the same sql-node. Tested on dev 2026-09-02:

```
java.lang.Exception: Only SELECT/WITH statements are allowed
```

**sql-nodes are read-only.** There is no write path through them at all; DB writes
go only through add/update-nodes.

> Do not be misled by `SU: WIP_CLONE_WORKFLOW` (dev id 1915599629667860481). It is
> `status='enabled'` and its `sql_node_8wys62ip` contains an `UPDATE
> su_code_workflow_history …`, but it has **0 runs, ever** — it would fail if
> anyone triggered it. An enabled definition is not evidence a capability works;
> check `su_code_workflow_inst` for real runs first.

**What remains open.** The only atomic write primitive here is an **update-node
with a conditional filter** — its `rules.list` supports `all`/`any` branches plus
`equal`, `numberEqual`, `isNull`, `lessThan`, `greaterThan`, so
`id = X AND to_status <> 'Completed' AND (is_processing = 0 OR update_time < cutoff)`
is expressible, and that acquire *would* be atomic. But an update-node reports
**nothing** — `{{node:update_node_*}}` has zero references anywhere in the repo,
and update-nodes are not recorded in `nodes_data` — so a run cannot tell whether
it won the race.

Closing it therefore needs a **`processing_token varchar(64)` column** on
`transfer_order`, `transfer_order_putaway` and `stock_picking`: the conditional
update writes a run-unique token (the loop already generates one in
`code_node_uPSc7Syb`), and the existing `SELECT` reads it back to confirm
ownership. That is a schema + form change on three tables and has not been done.

Until then the ~50 ms SELECT→UPDATE window stays open. Part 2 below is what
actually protects the data in practice.

### 1b. Release the lock on early-return paths — DONE

**Defect.** Acquire is `if_DPhDsPkx` (loop body position 4); release is
`if_nUE0BNtz` (position 11). Both gate on the identical
`pageStatus == "Edit"` condition, so they pair correctly — but two early
returns sit between them and skipped the release entirely:

| Node | Return |
|------|--------|
| `if_4E6dJynF` (IF Validation Failed) | `return_node_cIY3Ta84` |
| `condition_or_F7anGZ6o` → Completed → `if_4Ixau7QB` (IF Error) | `return_node_yurHh8d6` |

**Consequence.** A failed confirm stranded the document until the 900s stale
timeout — the picker saw "under processing" for 15 minutes on a document nobody
was processing.

**Fix applied.** An `is_processing = 0` update immediately before each return —
`if_ReleaseLockVF` and `if_ReleaseLockErr`, each an **`IF Edit` wrapper** around a
copy of `update_node_y9ZhwG0a` (same table, same
`id in {{node:code_node_hjAwTKzF.data.data.id}}` filter).

> The `pageStatus == "Edit"` gate is not optional. Both returns are also reachable
> in Add mode, where no lock was ever taken.

`if_tNNSBWyU` (IF Invalid) sits *before* the acquire and needs nothing.

**A throw still leaks, and always will.** The claim that sub-workflow failures are
already covered holds only when the sub-workflow *returns* an error code. When a
node throws, the instance dies and no return node runs — all 6 failed
`PICKING_LOOP` runs on dev died this way at `add_node_j6HU6pFP`
(`数据转换BigInt类型失败`). **Keep the 900s stale recovery as a primary release
mechanism, not a backstop** — it is the only thing that clears a lock after a throw.

### 1c. Putaway and Stock Picking had it worse — DONE

Both were pre-fix clones of Picking's original shape:

| Workflow | Acquire placement | Stale recovery | Early-return leaks |
|---|---|---|---|
| `PICKING_LOOP` | inside `Valid` ✅ | 900s ✅ | 2 (now fixed) |
| `PUTAWAY_LOOP` | **before the guard** ❌ | **none** ❌ | 2 (now fixed) |
| `STOCK_PICKING_LOOP` | **before the guard** ❌ | **none** ❌ | 2 (now fixed) |

They stamped `is_processing = 1` *before* the condition-or decided, so a run that
immediately bailed with "under processing" or "already Completed" still took the
lock — the shape that produced the 71 leaked prod locks on Completed pickings. And
with no stale recovery, **a leak there was permanent**.

Fixes applied to both: acquire moved inside the `Valid` branch
(`condition_or_node_item_35KzEyNn` / `condition_or_node_item_xpw2hikK`), the
get-node gate (`get_node_i5bqpnz2` / `get_node_eYiGyTjB`) replaced with Picking's
`sql_node_LockGate` + `code_node_LockDecide` pair, and the two gated releases added.
Stock Picking's gate aliases `sp_status AS to_status` so one `LockDecide` body
serves all three.

Note `StockPickingLoopWorkflow.json` **reuses Picking's node ids**, so edits must be
file-scoped and `wf deployed` reads AMBIGUOUS for it.

---

## Part 2 — Server-side quantity clamp — DONE

This is what actually protects parallel picking now that 1a is off the table.

`PickingQuantityValidation.js` validates `picked_qty` against the **form's**
`pending_process_qty` — client-side, and stale by however long the picker has been
in the aisles. There was no server-side re-check: the workflow clamped the *line*
(`Math.max(0, pending - picked)`) but appended the record unconditionally at its
full `store_out_qty`.

`code_node_oHIIKfiw` ("Create Table Picking Records", GD branch) now reads
`{{node:get_node_jEllcWiJ.data.data}}` and trims each record against the freshly
read pending, cumulatively across a line's locations, preserving UOM scaling.
A row the stored document has never seen is left alone rather than zeroed.

Clamped at the **source**, not in the merge: `code_node_Z5JH4g2u`,
`code_node_iES7iMKA` and `code_node_pMVdQBEQ` each read `records` independently,
so clamping downstream would leave two consumers unclamped.

The PP mirror `code_node_Q3hWck9R` is deliberately untouched — that branch is
one-shot by design, and `code_node_AGoxWP7x` already rejects over-picking with
*"Picked quantity cannot exceed plan quantity"*.

---

## Part 3 — Mobile (already implemented)

`PickingAdd` loaded its documents once and never refreshed them, so a second
picker saw pending quantities from whenever the screen was opened and would
walk to bins another picker had already emptied.

Pull-to-refresh on both tabs (`refreshPickingData` in
[PickingAdd.tsx](../../src/features/wm/picking/screens/PickingAdd.tsx), fetching via
`TransferOrderPickingUtils.getPickingDocumentsByIds`) re-reads the documents and
feeds them through the existing `[pickingData]` rebuild, which already preserves
`instance_id`, target location, target batch, splits and entered allocations.

Three details worth knowing when maintaining it:

- **Merged, not replaced** (`{...doc, ...next}`) — a deep-linked session fetches
  with no field param and holds fields the refresh query does not return.
- **Allocations are clamped** against the freshly-read pending quantity,
  cumulatively across a line's plain *and* split locations. Gated behind
  `clampToFreshPendingRef` so ordinary rebuilds (location or batch change) keep
  their previous behaviour exactly.
- **Manual only.** No refresh on focus or polling — quantities must never move
  under a picker mid-scan. The picker is told what changed via a Toast.

---

## Known gaps

- **Same-line double-picking: resolved, and it did NOT double-deduct — but force
  complete does.** Picking never writes inventory itself; it re-saves the parent GD
  through `GOODS_DELIVERY:Workflow:2017151544868491265` →
  `GDinventoryProcessWorkflow`, which is where stock moves. On a normal confirm
  `code_node_iES7iMKA` *relocates* quantity inside the GD line's `temp_qty_data`
  (total conserved), so two pickers cannot inflate the reservation.
  **At `isForceComplete === 1` it instead rebuilds `gd_qty`, `base_qty`,
  `gd_delivered_qty` and `temp_qty_data` from the whole `combinedRecords` array**,
  and `ForceCompleteWorkflow.js` feeds it the entire stored document — so two
  pickers × 10 on one 10-qty line became `gd_qty = 20`. Part 2's clamp stops the
  over-quantity record ever entering the array, which is what force complete
  trusts. Keeping pickers on disjoint lines is still the safer convention.
- **`allow_full_picking`** (Picking Setup): when on, any picked quantity closes
  the whole line and the remainder spins off via Convert to Picking. Parallel
  picking across different lines is unaffected; two pickers on the same line
  will behave surprisingly.
- **Putaway is now covered** for lock handling (1c). Its record merge is still
  client-side, so its merge exposure differs from picking's and has not been audited.
- **The ~50 ms acquire race is still open.** See 1a.

---

## Platform notes learned along the way

Verified on dev 2026-09-02; all of these cost real debugging time.

- **sql-nodes are read-only** — `Only SELECT/WITH statements are allowed`.
- **Loop bodies are not traced.** `su_code_workflow_inst.nodes_data` records only
  top-level code / search / get / sql / return nodes. A `PICKING_LOOP` run stores
  **2** entries even though its loop body runs ~20 nodes, so you cannot read a debug
  value out of a loop-body code-node — surface it through the return payload or
  reproduce the node in a throwaway top-level workflow. `current_node_id` and
  `error_msg` on a `Fail` row still name the dying node, even inside a loop.
- **update-nodes and add-nodes are never traced at all** — no input, output, or row count.
- **`transfer_order.table_picking_items` is NULL on every row.** The lines live in
  the subform child table `transfer_order_jz8m9w3h_sub`, and the records in
  `transfer_order_vrqs3cmr_sub`; the get-node assembles them on read. Raw SQL against
  the JSON column tells you nothing — query the `_sub` tables.
- Physical tables: `transfer_order` (Picking), `transfer_order_putaway` (Putaway),
  `stock_picking` (Stock Picking, status column `sp_status` not `to_status`).
