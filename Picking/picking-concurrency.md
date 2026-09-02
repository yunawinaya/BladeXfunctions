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

| Change                                                                             | State                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Lock released on both graceful early returns (3 workflows)                         | **Deployed to dev**                           |
| Putaway + Stock Picking: acquire moved inside the guard, 900s stale recovery added | **Deployed to dev**                           |
| Server-side clamp of picked qty against fresh pending                              | **Deployed to dev**                           |
| Over-pick guard on the GD branch (M:N)                                             | **Deployed to dev**                           |
| M:N cumulative recomputed instead of accumulated                                   | **Deployed to dev**                           |
| Atomic lock acquisition (the original Part 1a)                                     | **Not possible on this platform** — see below |
| Mobile pull-to-refresh                                                             | Shipped (app repo)                            |

Live on dev as of 2026-09-02: `PICKING_LOOP` **v80**, `PICKING` **v121**,
`PUTAWAY_LOOP` **v14**, `STOCK_PICKING_LOOP` **v4** — all byte-identical to the repo
files. **Nothing is in prod yet.**

**Exercised so far: one happy-path confirm.** PI-20260828-0299 on 2026-09-02 —
`PICKING_LOOP` and `PICKING` both Complete, `is_processing` back to `0`, document
correctly left `In Progress` rather than forced Completed, line 1 went 10 → 9, one
record written at qty 1. That covers the gate, the acquire and the release on the
happy path. Everything else below is verified by code reading, unit tests and
`EXPLAIN` only.

Still unexercised, in rough order of how much it matters:

- **the lock release on a failure path** — the defect this work exists to fix, and the
  one thing a happy-path confirm cannot demonstrate
- **the clamp** — needs two stale sessions on one line
- **all of Part 3** — no live `allow_full_picking` data on dev
- **Stock Picking entirely** — `stock_picking` has 0 rows on dev

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

> **Mobile reply — the refetch is a no-op; verified 2026-09-02.** On a 200,
> ConfirmPicking runs
> `navigation.reset({ index: 0, routes: [{ name: "PickingList" }] })`
> ([ConfirmPicking.tsx:105](../../src/features/wm/picking/screens/ConfirmPicking.tsx#L105)).
> Both picking screens are destroyed and PickingList reloads on mount, so there is
> no surviving view to refresh. In the item-4 scenario it would actively mislead:
> B lands on a list showing the document **Completed**, which reads as success.
> That B's 10 became 0 exists only in the response — so **`clampedLines` (or the
> count folded into `message`) is not the alternative to a refetch, it is the only
> thing that can work.** Putting it in `message` costs mobile nothing: the app
> already renders `data.message`, and the root error toast wraps it without
> clamping.

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

> **Mobile reply — yes, answered.** The app already derives it and fetches Picking
> Setup keyed on it ([PickingAdd.tsx](../../src/features/wm/picking/screens/PickingAdd.tsx)):
> `refDocType === "Picking Plan" ? "Sales Order" : "Goods Delivery"`. **But it is not
> a safe gate yet, because the two lookups disagree:** the app filters
> `plant_id AND picking_after`
> ([picking_setup.utils.ts:38](../../src/shared/utils/master/picking_setup.utils.ts#L38)),
> while `get_node_Uj1uV9PU` filters `organization_id` **OR** `plant_id` with no
> `picking_after` condition at all. In a tenant holding both setup rows the workflow
> can resolve a different one than the app did — and that row selects the one-shot
> branch. Mobile is holding the gate until that lookup is narrowed; shipping it
> sooner would buy false confidence.

### 3. "Under processing" should become rare, and now means what it says

Previously a failed confirm stranded the document for the full 900s stale timeout,
so pickers saw _"The current picking is under processing"_ for 15 minutes on a
document nobody was touching. Both graceful failure paths now release the lock
immediately. Keep the existing 400 handling as-is.

One case survives: if a workflow node **throws**, the instance dies and the lock is
still only cleared by the 900s timeout. Rarer, but a 15-minute wait is still
possible after a hard backend failure.

### 4. A new 400 to handle (only where Full Picking is on)

`PICKING` now refuses with:

```
400  Picked quantity cannot exceed plan quantity: <item> (Picked: 12, Plan: 10)
```

It fires only where `allow_full_picking` is on, when the cumulative picked quantity
across sibling Pickings would exceed the delivery line's planned quantity. The
existing 400 handling will surface it, but the message is new — worth checking it
reads sensibly on the device.

> **Mobile reply — checked, it reads fine.** The app's root error toast
> ([App.tsx:121](../../src/App.tsx#L121)) is a custom renderer that puts `text2` in a
> flex column with **no `numberOfLines`**, full width minus gutters, 5s — so the
> message wraps in full rather than ellipsising. (The library's own `BaseToast`
> default _is_ `text2NumberOfLines = 1`, but that renderer is never used here.)

Two more things about that setting, since it changes what a picker can expect:

- **A partial pick closes the line for good.** Picking 3 of 10 finishes the line at
  3; the picker cannot come back to it on this document. **Handled in the app:**
  ConfirmPicking shows a banner above the carousel and requires an explicit
  "Close Short" confirmation before submitting, since the action is final.
- **A follow-up Picking usually appears on its own — refresh the list.** Where
  `auto_trigger_to` is also on, confirming re-saves the parent GD, which runs
  `GDheadWorkflow`'s **IF Auto Create Picking** and mints a Picking for the
  remainder. So a new document can show up straight after a confirm and the app
  should re-read the picking list, not just the current document. Where
  `auto_trigger_to` is **off** (28 of the 31 Full Picking plants on dev) nothing is
  created and someone has to run Convert to Picking on the desktop GD list page.
  **Handled in the app:** `auto_trigger_to` is forwarded to ConfirmPicking and the
  warning wording switches on it — it promises an automatic follow-up only where
  the flag is on, and points at desktop Convert to Picking where it is off.
- **This makes the silent clamp (item 1) routine rather than rare** — because any
  pick closes the line, a second picker on that line hits `pending = 0` and their
  whole submission is dropped with a "success" message. This is the case where
  surfacing `clampedLines` would earn its keep.

### 5. Two things still to design around

- **Two simultaneous taps are still not serialised.** A ~50 ms window remains where
  both confirms can acquire the lock (see 1a). Do not rely on the backend to order
  them.
- **Force complete still double-counts a line two pickers both picked**, for records
  written _before_ this change. Disjoint lines remains the safer convention.

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
workflow writes the _computed_ status instead. `isForceComplete` comes from a
workflow param the mobile client never sends.

So the normal parallel sequence is:

| Step                                                      | Result                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| A picks lines 1–50, confirms                              | Doc → **In Progress**, A's records appended                                 |
| Lock releases (seconds, not A's 20 minutes in the aisles) | Document free                                                               |
| B picks lines 51–104, confirms                            | Workflow reads A's work, subtracts B's, appends B's records → **Completed** |

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
`code: "400"` / _"The current picking is under processing"_. Mobile already
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
su_code_workflow_history …`, but it has **0 runs, ever** — it would fail if
> anyone triggered it. An enabled definition is not evidence a capability works;
> check `su_code_workflow_inst` for real runs first.

**What remains open.** The only atomic write primitive here is an **update-node
with a conditional filter** — its `rules.list` supports `all`/`any` branches plus
`equal`, `numberEqual`, `isNull`, `lessThan`, `greaterThan`, so
`id = X AND to_status <> 'Completed' AND (is_processing = 0 OR update_time < cutoff)`
is expressible, and that acquire _would_ be atomic. But an update-node reports
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

| Node                                                           | Return                 |
| -------------------------------------------------------------- | ---------------------- |
| `if_4E6dJynF` (IF Validation Failed)                           | `return_node_cIY3Ta84` |
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

`if_tNNSBWyU` (IF Invalid) sits _before_ the acquire and needs nothing.

**A throw still leaks, and always will.** The claim that sub-workflow failures are
already covered holds only when the sub-workflow _returns_ an error code. When a
node throws, the instance dies and no return node runs — all 6 failed
`PICKING_LOOP` runs on dev died this way at `add_node_j6HU6pFP`
(`数据转换BigInt类型失败`). **Keep the 900s stale recovery as a primary release
mechanism, not a backstop** — it is the only thing that clears a lock after a throw.

### 1c. Putaway and Stock Picking had it worse — DONE

Both were pre-fix clones of Picking's original shape:

| Workflow             | Acquire placement       | Stale recovery | Early-return leaks |
| -------------------- | ----------------------- | -------------- | ------------------ |
| `PICKING_LOOP`       | inside `Valid` ✅       | 900s ✅        | 2 (now fixed)      |
| `PUTAWAY_LOOP`       | **before the guard** ❌ | **none** ❌    | 2 (now fixed)      |
| `STOCK_PICKING_LOOP` | **before the guard** ❌ | **none** ❌    | 2 (now fixed)      |

They stamped `is_processing = 1` _before_ the condition-or decided, so a run that
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
in the aisles. There was no server-side re-check: the workflow clamped the _line_
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
_"Picked quantity cannot exceed plan quantity"_.

---

## Part 3 — M:N cumulative recomputed — DEPLOYED, UNEXERCISED

Only relevant where `allow_full_picking` is on.

`code_node_iES7iMKA` accumulated the GD line's cumulative picked quantity: read
`picked_temp_qty_data`, merge this session, write back. Two sibling Pickings
confirmed at the same moment both read the same value and the second write wins, so
one picker's contribution is lost — and the picking mutex cannot help, because it is
held per Picking document.

Two changes:

- **An over-pick guard** in `code_node_iES7iMKA`, mirroring the PP branch's
  `code_node_AGoxWP7x`: refuses with `400 "Picked quantity cannot exceed plan
quantity: …"` rather than over-picking silently. Compared at 3dp — a bare `>` fires
  on `10.000000000000002` from summing 3dp floats and would block a picker who picked
  exactly the plan quantity.
- **`code_node_MNRecompute`**, gated behind `if_MNGate` (`allow_full_picking == 1`):
  counts every picking record for the line across all sibling Pickings plus this
  session's `combinedRecords`, and writes that total. Counting is idempotent, so a
  concurrent run can no longer erase an addition. Revert-safe, because
  `RevertCompleted.js` clears a reverted Picking's `table_picking_records`.

Two placement constraints, both load-bearing:

- It sits **after `update_node_JXfFIqqv` but before `search_node_c7BtNx91`**. Later
  than that and the GD rollup reads a line transiently marked Completed, and with
  `auto_completed_gd` on that can complete the whole delivery for a line that is not
  fully picked.
- The sibling fetch is **gated**, because `transfer_order_goods_delivery` has only a
  primary key — no index on either foreign key — so the fetch is a table scan however
  it is written, and 160 of 171 GDs have exactly one Picking.

The old accumulate is deliberately left in place: it writes first, the recompute
overwrites it, and it keeps the over-pick guard fed.

**Deployed but never exercised.** Dev has no live `allow_full_picking` data (the 13
GD lines with `picked_qty > 0` are ~4 months old) and no run has hit this path since
deployment, so it is still verified by unit tests and code reading only. The first
real Full Picking confirm is the test.

---

## Part 4 — Mobile (already implemented)

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
  cumulatively across a line's plain _and_ split locations. Gated behind
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
  `code_node_iES7iMKA` _relocates_ quantity inside the GD line's `temp_qty_data`
  (total conserved), so two pickers cannot inflate the reservation.
  **At `isForceComplete === 1` it instead rebuilds `gd_qty`, `base_qty`,
  `gd_delivered_qty` and `temp_qty_data` from the whole `combinedRecords` array**,
  and `ForceCompleteWorkflow.js` feeds it the entire stored document — so two
  pickers × 10 on one 10-qty line became `gd_qty = 20`. Part 2's clamp stops the
  over-quantity record ever entering the array, which is what force complete
  trusts. Keeping pickers on disjoint lines is still the safer convention.
- **`allow_full_picking`** (Picking Setup, ON for 31 of 127 plants). Audited
  2026-09-02. The design is coherent — the setup form hides _and_ zeroes the flag on
  `picking_after = "Sales Order"`, bundles still cannot be short-picked, Packing has
  an M:N gate blocking completion until every GD line is fully picked, and Convert to
  Picking's split arithmetic is sound (it subtracts `picked_temp_qty_data` from
  `temp_qty_data` per bin/batch/HU, so the sibling Pickings sum to `gd_qty`). Three
  things are worth knowing:
  - **Any picked quantity closes the line permanently.** Picking 3 of 10 is not
    "3 done, 7 later on this document" — the line is finished at 3.
  - **The remainder spins off automatically only when `auto_trigger_to` is also on.**
    `PickingProcessWorkflow` itself never creates a follow-up Picking — but every
    confirm re-saves the parent GD (`workflow_node_4c98bf8x`, `saveAs = "Created"`),
    and `GDheadWorkflow`'s `if_9xhwui06` **IF Auto Create Picking**
    (`pickingRequired == 1` AND `saveAs == "Created"` AND `autoTriggerTo == 1`) then
    runs `code_node_6L2Ozea8` → `add_node_rk182M1q`. So the chain closes itself.
    **The two settings are not interlocked**, and on dev 31 setups have
    `allow_full_picking` on while only 3 have `auto_trigger_to` on — the same 3. On
    the other 28, a partial pick closes the line and the remainder waits for a manual
    Convert to Picking on the desktop GD list page. That is a configuration hazard,
    not a code defect; see `PickingSetupOnChangeAllowFullPicking.js`.
  - **The cumulative was not concurrency-safe.** `picked_qty` /
    `picked_temp_qty_data` were read-modify-written on the GD line, and the mutex is
    per Picking _document_ — it cannot serialise two siblings, which is exactly what
    this feature creates. A lost accumulation then made Convert to Picking mint a
    follow-up for more than really remained. Fixed by Part 3 below.
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
