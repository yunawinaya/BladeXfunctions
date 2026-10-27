# MIN-01 inventory and proposal: shared stock protection for IA holds

22 October 2026, 15:15 (UTC+8). Read-only. Basis: the DEV app mirror pulled at 12:37 today (`dev-main`), the 21 October
reservation research (`scratchpad/iasc/research/RES01_reservation_facts.md`), `BA_TECH_MAP_2026-10-22.md` and one DEV query
(IA hold rows: 76 Cancelled, 195 Delivered, none live). Nothing was changed. Answers `MIN01_BRIEF_2026-10-22.md`.

## 0. Status at 16:30, after the 16:28 publish (all on DEV, each publish with the user's yes; ships with the 21:00 promotion)

| Item | DEV | Switch | Tests |
|---|---|---|---|
| T1 CANCEL_PENDING releases only Pending rows | v5 live 15:27 | none (always on) | refusal test passed, nothing written |
| T2 SM_DISPOSAL_SCRAP refuses Reserved picks | v18 live 15:27 | none (always on) | refusal test passed, nothing written |
| Classic lock (RF-01) in SUBTRACT_INVENTORY / ADD_INVENTORY | v60 / v66 16:00 -> v62 / v67 16:28 (claim queues behind a classic holder) -> **v63 / v68** 16:52 (pair entry) | `CL_LOCK_ENABLED` OFF (user: ship OFF tonight) | locked path, seed, bursts (no lost update), crash (key stranded), queue test (late callers wait, read fresh) |
| Classic lock in SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW (classic GD) | v26 / v19 16:09 -> **v28 / v20** 16:28 | OFF | locked path; mixed burst: 2 applied + 2 busy with the first claim, 4 applied with the refined claim |
| A1 / A2 IA floor (RF-03) in SUBTRACT_INVENTORY / _NEW | in v61+ / v27+ (live 16:15) | `IA_FLOOR_ENABLED` OFF | A1: refuse, OFF, IA exempt, pass-through; A2: refuse, pass-through |
| Owners' OFF-path smoke tests | | | SA twin (05), IDA (97), GR / Putaway / GR revert (cf), LOT (83): all PASS |
| Stale CL\| key finder + guarded repair | `scratchpad/min01/stale_cl_keys.py` | | read-only run: 0 stranded |
| IA side: IA_SAVE refuses Reserved picks | IA_SAVE v23 (fb) | | fb live check passed |
| Classic STOCK_ADJUSTMENT refuses Reserved entries before any write | v26 16:24 (SA owner, their user's yes) | none | owner's guard tests 271/271; live probe on 496474 refused, 0 written |
| V2 writers taking the line's category (A3) | **covered, no change**: LOT V2 by the LOT_V2_SUBMIT v5 allow-list (`scratchpad/smv2/code/submit/_common.js:55`, stored lines re-checked on EDIT / COMPLETE / CANCEL); SA V2 by the SA_V2_SUBMIT allow-list (`code_node_SSkeys`, `scratchpad/sav2/code/submit/keys.js` saFormReasons; Stock Count review builds only Unrestricted) | none | owners 83 / 05 (22 Oct); source spot-checked |

**What remains for Reserved on these modules:** a refused V2 document (NOT_ELIGIBLE) falls back to the classic save, which subtracts
through the classic children. For SA that is now closed by classic STOCK_ADJUSTMENT v26 (refuses Reserved before any write; with the
V2 allow-list, no SA path moves Reserved). For LOT the A1 floor applies once ON, but it refuses mid-loop, after the classic has
written its header. Production data: 0 of 2,433 SA lines ever moved Reserved.

Test log: `scratchpad/min01/b1/TESTS.md`. Builders: `scratchpad/min01/b1/` (bases in `scratchpad/min01/base/`).

**Before either switch goes ON** (not at a restart):
- A failure inside the locked section strands the key. Clearing it means running `stale_cl_keys.py` plus its guarded repair; there is no
  automatic steal (the engine owner declined it for v1).
- A classic call that queues behind an engine take crashes instead of answering 400.
- Classic callers stop mid-document on a 400 busy when an ENGINE run holds a key (section 0b). Classic against classic now queues (v62 / v67 / v28 / v20).

## 0b. The remaining ON blocker: a classic document meeting an engine-held key

With the switch ON, a child call answers 400 busy when an engine run already holds its ITEM key. It crashes (status Fail, nothing
written, nothing held) when it queued behind the engine's own take step. Every classic caller stops at that call; nothing rolls back.
From the owners (22 Oct) and the code:

| Caller | Written before the stock loop | On a child failure mid-loop |
|---|---|---|
| STOCK_ADJUSTMENT v26 (SA owner) | header Completed + lines | returns {code 400, message = the child's errorMessage}; later entries not moved; production already has 13 such partly moved SAs |
| SM_LOCATION_TRANSFER v85 (83) | header (TxDhhT03 / xxQX3uMU) with its status | stops on the code; partly moved LOT |
| GOODS_RECEIVING v104 (cf) | receipt Completed | stops on non-200 |
| PUTAWAY v35 / PUTAWAY_LOOP (cf) | | stops on non-200 |
| GR_REVERT_COMPLETED v8 (cf) | | stops on non-200 |
| IDA_SAVE v7 (97) | header Completed | stops; partly moved IDA |
| GD_UNUSED_FN_NEW (classic GD, also via classic Picking / Picking Plan / Packing save) | GOODS_DELIVERY's own writes; a CHECK-ONLY sufficiency pre-flight runs before the loop | loop `loop_88bcQyIz` returns {code 400, message = the child's errorMessage} at the first failed call; earlier movements stay |
| GD_PROCESS_REVERT v14 (3f) | HU quantity updates (`loop_inHuUpdates`) | returns {code 409, message = `workflow_node_inAddInv.message`}. NB: ADD_INVENTORY_NEW answers `errorMessage`, so this message is empty |

**The worst case is a paired move.** LOT, Putaway, Category Transfer, Plant Transfer and GD's reservation moves call SUBTRACT then ADD.
A busy (or crash) on the ADD after the SUBTRACT applied leaves the quantity subtracted at the source and never added at the target. A
same-bin category move takes and releases the key twice, so an engine run can take it in between.

**Proposal (each owner decides for their caller):**
1. Pre-check in the caller before its first write: read the lock rows of all its ITEM keys and refuse the whole document cleanly if
   any is held by a non-CL| owner. It narrows the window to the time between that check and each call; it does not close it. GD has a
   natural place: the existing CHECK-ONLY pre-flight.
2. For paired moves, a pair entry in the children (take both keys in key order, both writes, release both) would remove the half
   move. That is a new child contract: not built.
3. Optional: a bounded wait in the child for short engine holders (IA holds take seconds). The user did not choose it today.
4. GD_PROCESS_REVERT should read `errorMessage` (3f's workflow).
Until then the lock stays OFF; with it OFF, behaviour is today's (silent lost updates, no refusals).

**27 Oct: the per-child lock must NOT be switched ON as built (new top blocker).** Production on 26 Oct showed that the
atomic-count lock is held until the TOP-LEVEL run ends, child runs included, with no wait timeout (memory
`project_lowcode_atomiccount_semantics`). The 22 Oct "classic calls queue safely" result came from test runs where each child call
was its own top-level run. Real classic callers call the children in per-line loops inside ONE run. With `CL_LOCK_ENABLED` ON:
- every key a document touches would stay locked until the whole document ends, not for the ~200 ms critical section;
- the keys would be taken in line order, not key order, so two classic documents (or a document and an engine operation) with
  overlapping keys can deadlock until the platform's 20-min run limit;
- the queue rule (take behind a CL| holder, v62+) waits instead of refusing, which makes that worse.
A safe ON needs the engine's rule: all of a document's keys taken once, in key order, in one call, with one stock call per top-level
run. That is document-level locking in each classic caller (in effect the engine model), not the per-child lock. State on 27 Oct:
switches OFF in all five workflows on DEV and PROD (checked in the enabled script_json); nothing takes a lock while OFF.

**BLOCKERS for switching the classic lock ON** (owners' answers, 22 Oct; the engine owner recommends OFF until 1-3 exist and 4 passes):

| # | Blocker | Who | State |
|---|---|---|---|
| 1 | **Pair entry** in the children: one call takes both ITEM keys in key order, does the SUBTRACT and the ADD, releases both. It is the only way to close the half move | 9d (children), with the user's yes | **built, tested, live OFF** in SUBTRACT_INVENTORY v63 + ADD_INVENTORY v68 (16:52). Contract: SUBTRACT_INVENTORY takes an optional `pair_add` {location_id, inventory_category, batch_id, plant_id, handling_unit_id, batch_number, manufacturing_date, expired_date, transaction_type, remark, remark2, remark3}; it does the ADD half nested (ADD_INVENTORY `cl_hold_op` = its operation, route HELD). OFF: subtract, then ADD unlocked. Callers (LOT, Putaway, Category / Plant Transfer) still call SUBTRACT then ADD: they adopt `pair_add` when they build their pre-checks. **Not in GD's _NEW copies** (GD reservation moves) |
| 2a | Classic LOT pre-check: one read of the LOT's ITEM keys (source + target bins, tenant + org) next to the guard node, before the header write; 400 "stock of <item> at <bin> is being updated by another document - try again" if any is token 0 under a non-CL\| owner | 83 (2e) | planned, built before ON |
| 2b | Classic GD pre-check in GD_UNUSED_FN_NEW, before `IF Check Only` (so in GOODS_DELIVERY's pre-flight and the real run; classic GOODS_DELIVERY has no owner) | 9d, with the user's yes | **built, tested, live OFF** (GD_UNUSED_FN_NEW v56, 16:42; same CL_LOCK_ENABLED switch: flip with the children) |
| 2c | GD_PROCESS_REVERT pre-check before its HU updates | 3f | after the lock-row read is settled (SQL sent 16:45) |
| 2d | Classic IDA_SAVE pre-check before its first write | 97 (8c), or IDA's owner then | at switch-ON planning (untestable dead code while OFF) |
| 2e | Classic STOCK_ADJUSTMENT pre-write lock check | SA owner (05) | **built** (STOCK_ADJUSTMENT v27, passed live in the 16:38 twin) |
| 2f | GR / Putaway (source + target keys) / GR revert pre-checks, mirroring GD_UNUSED_FN_NEW v56 (same keys, switch, MIN01-TEST gate, 400 text) | cf (56) | planned, built before ON (their user's decision) |
| 3 | GD_PROCESS_REVERT reads `errorMessage` | 3f | confirmed, fix with their user's yes |
| 4 | "Busy mid-save" case passes on DEV (a multi-line classic document meeting an engine-held key) | 9d + owners | not run |
| 5 | Stranded-key procedure agreed (stale_cl_keys.py + guarded repair; no automatic steal in v1) | 9d / 3f | tool built |

Every pre-check is **check-then-act**: an engine run can take a key between the read and the child call, so a pre-check narrows the
window but does not close it. Fully closing it needs the pair entry (1), or an engine-side ordering rule (B2, engine owner).

## 1. Verdict

- **RF-03 (owner checks): two holes in modules nobody owns, each fixable with a refusal before the first write:**
  CANCEL_PENDING (direct call) and Disposal / Scrap (its picker). A guard in the shared subtract child (A1 / A2) then covers
  every classic writer, crafted requests included. A third hole (Misc Issue and Plant Transfer completing from Created) belongs
  to Stock Picking, which is not in use: parked.
- **RF-01 (lost updates): half of it is buildable today; the other half needs the engine owner.** Every classic workflow
  writer goes through four children that write all six balance columns as absolute values. Writing atomic deltas instead (B1)
  stops a classic write erasing an IA hold, and closes classic-versus-classic lost updates. Those children carry every classic
  stock movement on production, so B1 sits behind a switch that stays OFF until a DEV concurrency test passes. The engine
  overwriting a classic write (B2) stays open: it needs bladexfunctions-c8 and a busy policy for classic saves.

## 2. How the lost update happens (RF-01)

- **Classic children** (SUBTRACT_INVENTORY 2012096660219564034, ADD_INVENTORY 2012005532688723970, and the GD-only
  SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW): read the balance row (get node), check the requested bucket, compute all six
  quantities in code (`code_node_mQnskse9`), write them back as absolute values (`update_node_q6uzhWpP`, batch
  `update_node_1ggwRzMs`). No lock, no version check.
- **Engine** (INVENTORY_BULK_APPLY): takes `ITEM|mat|bin`, `BATCH|mat|bin|batch` and (except category moves) `COST|mat|plant`
  tokens, re-reads under them, then also writes all six columns as absolute values (`update_node_IBwIb`).
- So the engine's locks exclude only other lock-takers. Two cases on the same balance row:
  1. A classic write that read before an IA hold landed writes the old `reserved_qty` back: **the hold row says Allocated,
     the Reserved bucket no longer has it** (the IA's stock is back in Unrestricted, free for anyone).
  2. A classic write that lands between the engine's read and its write is overwritten: **the classic movement row exists,
     its balance effect is lost** (phantom stock).
- The same gap exists between any two classic writers, on production today.
- Lock rows never expire (`inventory_balance_lock`; only the same operation key can clean up). This is why "make the
  classic children take the tokens" is not a small change: a classic run that dies between TAKE and GIVE would block that
  stock key for every writer until someone frees it by hand.

## 3. Writer inventory (server side)

Path: **C** = classic children, **E** = engine (INVENTORY_BULK_APPLY / INVENTORY_APPLY_OPERATION). "Subtract category" is
what the workflow passes to the subtract child, and where it comes from.

| Writer (workflow) | Path | Subtract category | Can it take Reserved? | Owner check on Reserved | Owner session |
|---|---|---|---|---|---|
| IA_HOLD, IA V2 COMMIT, IA revert V2 | E | own hold moves | own rows only | yes (by IA id) | fb |
| IA_SAVE (classic completion) | C | the pick's, Reserved up to own holds | own rows only | yes (split) | fb |
| IA_REVERT (classic) | C | assembled item: recorded; components returned | no | n/a | fb |
| GD classic: GOODS_DELIVERY → GD_UNUSED_FN_NEW (+ classic Picking, Picking Plan, Packing save) | C (`_NEW`) | `movement.source`; fixed Unrestricted ↔ Reserved moves | yes, sized by own GD / SO-line rows | yes (own rows) | GD |
| GD_PROCESS_REVERT | C (`_NEW`) | adds only | no | n/a | GD |
| GD V2, Picking V2, Packing V2 | E | own rows | yes, own rows | yes | GD |
| GLOBAL_RESERVED (SO Pending, Production; from WO_SAVE, SM_PROD_RECEIPT) | C | fixed: Unrestricted → Reserved, Reserved → Unrestricted | yes | rows: Pending of its SO line only (IA rows are never Pending). Bucket: not checked | none |
| GLOBAL_RESERVED_NEW | C | same | same | same | none (no callers: dead) |
| **CANCEL_PENDING** (Reserve list → Release Stock) | C | fixed Reserved → Unrestricted | **yes: any row id it is given** | **none on the server**: no status, doc_type or organisation check (`Released Data` code node). The page shows the action only for Pending rows | none |
| SM_MISC_ISSUE: Created hold (Stock Picking, not in use), completion | C | normal: the pick's; hold: pick → Reserved; completion from Created: Reserved for every current pick | only from Created: beyond its own holds when the picks changed after Created | rows: own (doc_id + doc_type). Bucket: not capped by own rows | none |
| SM_PLANT_TRANSFER: Created hold (Stock Picking, not in use), Issued from Created | C | same pattern (`code_node_PTissCompute`) | same | same | none |
| **SM_DISPOSAL_SCRAP** | C | the pick's `category` (`code_node_oUhC2z2V`), any of the five | **yes**: its picker offers Reserved | none | none (DEV use only; PROD 0 rows on 21 Oct) |
| SM_GOODS_ISSUE | C | fixed **Unrestricted** (its only subtract) | **no** (verified: one SUBTRACT call, literal Unrestricted). Its picker offering Reserved is a display mismatch only | n/a | none |
| SM_CATEGORY_TRANSFER | C | `category_from` of the line | only through a crafted request (picker: Unrestricted / Blocked) | none | none |
| SM_LOCATION_TRANSFER (≤ 50 lines, mobile) / LOT_V2_COMMIT | C / E | the pick's | only through a crafted request (picker: Unrestricted / Blocked) | none | LOT |
| STOCK_ADJUSTMENT (≤ 50) / SA_V2_PREPARE; Stock Count review | C / E | the line's | only through a crafted request (picker excludes Reserved) | none | SA |
| PURCHASE_RETURN | C | the line's | only through a crafted request (picker excludes Reserved) | none | none |
| PUTAWAY (classic) / PUTAWAY_BULK_COMMIT | C / E | the task's | only through a crafted request | none | none |
| SM_OPENING_BALANCE | C | the line's | only through a crafted request | none | none |
| IDA_SAVE / IDA V2 | C / E | the pick's | only through a crafted request | none | 8c (IDA V2) |
| GR_REVERT_COMPLETED / GR_REVERT_COMMIT | C / E | the receipt's recorded category | no (returns what the GR received) | n/a | none |
| HANDLING_UNIT, REPACKING_PROCESS | C | fixed Unrestricted | no | n/a | none |
| GOODS_RECEIVING, SM_MISC_RECEIPT, SRR_SAVE (adds only); GR_COMPLETE_COMMIT (E) | C / E | adds only | no | n/a | none |
| STOCK_PICKING_PROCESS | via MSI / PT / LOT | as those | as those | as those | none |

"A crafted request" means a stale tab, mobile or a direct workflow call: the platform has no per-workflow permission, and
these servers take the category from the line without checking it.

## 4. Client scripts writing stock through the data API

From a read-only sweep of the mirror's forms, pages and rule-handler sidecars (`.su-code/meta/**.meta.json`, where some
handlers keep their only copy of the JS). Not yet spot-checked one by one. "Writes balances" = `item_balance` /
`item_batch_balance` quantity columns written as absolute values, plus `inventory_movement` rows and costing columns
(`fifo_available_quantity`, `wa_costing_method`).

**Bound to a live button on a form that a menu-attached list page opens:**

| Form · handler | Writes | Module |
|---|---|---|
| Stock Movement page form (WM Form) and the Stock Movement table form (via the list's "Detailed Misc Issue / Receipt" tabs, row Edit): `onClick_completed`, `onClick_completed_posted`, `onClick_complete_receive`, `onClick_issueIFT` | balances; the table form also adds `on_reserved_gd` rows and serial balances | Stock Movement |
| Stock Adjustment page form: `onClick_completed`, `onClick_completed_post` | balances | Stock Adjustment |
| Goods Delivery page form (S&D Form): `onClick_save_as_created` (Unrestricted → Reserved), `onClick_save_as_completed` | balances | Goods Delivery |
| Goods Receiving page form: `onClick_save_as_completed` | balances | Goods Receiving |
| Sales Return Receiving page form: `onClick_save_completed` | balances | Sales Return Receiving |
| Production Order page form: `onClick_complete` | balances | Production |
| QM Basic Inspection Lot table form: `onClick_completed` | balances, serial balances | QM |

Bound but no page opens the form (unclear): Purchase Return page form `onClick_save_as_issued`, Production Order table
form, Goods Receiving "JOJO" form. Dead (no binding, no caller): the Plant / Location / Category Transfer table-form
`onClick_completed(_posted)`, Goods Receiving / Packing / Transfer Order Picking / Picking Plan / Stock Count / Transfer Order
Putaway table-form handlers, the GD list `onClick_yes`, and the cloned `onClick_issue_ift` family. List actions that only rename
`inventory_movement.trx_no` (GD bulk cancel fallback, Picking list cancel) and Packing HU row actions (no quantities) are not stock writers.

**What this means:** a user who opens one of the live page forms writes balances with no workflow, no lock and no owner check;
no server-side guard in sections 5's batches can see those writes. Not determined: which roles can see these menus, and
whether anyone uses them (the mirror has neither the role grants nor usage). The 21 October study called the Stock Movement
table form dead; this sweep finds it reachable through the "Detailed" tabs.

## 5. Proposal, one module per batch

Everything below is built today; each publish is backed up first and gets its own yes. Changes to shared children sit behind
a switch: OFF behaves exactly as today, and you decide before 21:00 what is ON.

### Batch 1: narrow refusals (refuse before any write; no owner session)

| # | Module | Change | Risk |
|---|---|---|---|
| T1 | CANCEL_PENDING | The `Released Data` code node refuses (400) a row that is not `status = Pending`. Same rule the page already shows; IA, GD, MSI and PT rows are never Pending. | Very low: one condition in an existing code node; the page never sends anything else |
| T2 | SM_DISPOSAL_SCRAP | The pre-write validation (`code_node_SFwfSnsO`) refuses any Reserved pick on Completed: "Reserved stock belongs to a document; release it there first". Optional: the form's picker stops offering Reserved. | Low: DEV-only module (PROD 0 rows); refuses before the first write |
T1 and T2 can be built and tested in about an hour each.

**Parked (user, 22 Oct): T3, Misc Issue / Plant Transfer completing from Created.** The Created hold is the Stock Picking
feature, which is not in use: every `picking_setup` row has `msi_ / pt_ / lot_picking_required` = 0 (DEV 162, PROD 182),
PROD has no Stock Picking hold rows, DEV has one stranded September test row (MSI/202609080080). The form shows Created only
when the switch is on, so the gap is reachable only through a crafted request today. When Stock Picking is switched on: cap
the Reserved part of the issue at the document's own open holds per material + bin + batch + from_category (the split IA's
completion uses), the rest from the pick's category; the form leaves a Created MSI's lines editable, so this is reachable
from the UI then.

### Batch 2: owner floor in the shared subtract children (behind a switch)

| # | Change | Covers | Affects |
|---|---|---|---|
| A1 | **Floor guard in SUBTRACT_INVENTORY**, gated on category Reserved (the Unrestricted path is untouched): refuse a subtract that would take the row's `reserved_qty` below the open IA holds on it (base unit). Transaction type `IA` is exempt: IA_SAVE's completion already caps its Reserved part at its own holds, and its hold rows can carry the Draft number while `trx_no` is the final one, so the child cannot match them by number | every classic writer, crafted requests included | callers subtracting Reserved: GLOBAL_RESERVED, CANCEL_PENDING, SA / LOT classic (owner sessions) only when they would cut into IA holds |
| A2 | Same guard in SUBTRACT_INVENTORY_NEW | classic GD (incl. classic Picking, Picking Plan, Packing save) | GD owner |
| A3 | Engine-path writers taking the line's category (LOT V2, SA V2): refuse Reserved in their PREPARE | V2 writers | LOT, SA owners |

### Batch 3: RF-01 in the classic children (behind a switch)

| # | Change | Covers | Needs |
|---|---|---|---|
| ~~B1~~ | ~~Classic children write deltas through the platform's atomic-count node~~. **Withdrawn 22 Oct 15:50:** the platform's own documentation (`.su-code/docs/workflow/sdk/atomicCount.md`) says the node is not concurrency-safe: it reads, computes and writes back an absolute value, its distributed lock is taken inside a transaction whose snapshot predates the lock, and its `WHERE col = old` guard's affected-row count is never checked (4 concurrent deductions of 1 from 2: one applies, all four report success). The engine's lock tokens use the same node safely only because the engine re-reads the lock row after the take and checks it is the owner. | | |
| B2 | Close case 2 (the engine overwriting a classic delta): either the engine writes deltas too, or the classic children take the engine's tokens with a lease the engine honours | the rest of RF-01 | bladexfunctions-c8; a busy policy for synchronous classic saves (they cannot wait minutes, and failing mid-document leaves earlier lines written) |

B1 + B2 together are the "compatible server protocol" the BA asks for, without moving modules onto the engine.

## 6. Limits that stay after all of this

- Client scripts that write balances through the data API (section 4) bypass every workflow guard.
- Existing drift is not repaired: PROD had 55 balance rows holding 7,188.95 reserved units with no reservation row (21 Oct).
- Anyone logged in can call a stock child directly with any category (RF-04 class).
