# RES-01 build plan (approved design: Item Assembly & BOM/SmallCycle/RES01_DESIGN.md)

User decisions 2026-10-21: required_qty field; HU picks + serial items NOT held; background reconcile above 50 picks;
"Approve and build" behind a switch that stays OFF. Each DEV batch: backup + base guard + the user's yes. TDD, mutants,
ledger lines in .superpowers/sdd/cheeky-shimmying-puffin/progress.md.

## Mechanism (refined from the design, same behaviour)

- Hold row: on_reserved_gd, doc_type "Item Assembly", status Allocated, doc_id = IA id, doc_no = IA number, doc_line_id =
  line id, material_id, plant_id, organization_id, bin_location, batch_id, item_uom = the line UOM, reserved = open,
  delivered 0, from_category (Unrestricted | Blocked), job_line_key = "IAH|<ticketId>|<n>" (create once). No parent_* and no
  target_gd_id. Fragment key = line id | material | bin | batch | from_category.
- Stock: INVENTORY_BULK_APPLY APPLY, operation_key "IAH|<ticketId>": hold = SUBTRACT from_category isMovingInv 1 +
  ADD Reserved isMovingInv 1 unit_price_from; release = SUBTRACT Reserved isMovingInv 1 + ADD from_category isMovingInv 1.
  (scratchpad/gdc/engine/core.js models the engine for tests.)
- Mutex: gd_publish_step job_id "IAH|<iaId>", step_name "TICKET|<n>" (unique), step_status HELD -> FREE, started_at
  lease 10 min; the lowest HELD ticket within its lease wins; a loser answers BUSY.
- Recovery: a dead run's Processing rows are resolved by the next reconcile from the engine's stored answer for
  "IAH|<deadTicketId>" (DONE -> Allocated; nothing applied -> soft-delete).
- Header: material_hold_status '' (not enrolled) | RESERVING | FULL | PARTIAL | SHORT | REVIEW; material_hold_at.
- Enrolment: switch RES_ENABLED (server constant in IA_SAVE + client) and the IA is new (Add / Clone) at that save.
- Triggers: IA_SAVE Draft of an enrolled IA -> RESERVING, then IA_HOLD inline (<= 50 hold picks) or the client kicks it
  (> 50, polls); a desktop open of a Draft with a stale RESERVING re-kicks.
- Completion: classic IA_SAVE Completed and IA V2 refuse while a live hold ticket exists or an own row is Processing;
  otherwise issue each fragment from Reserved up to its own open row, the rest from Unrestricted (native check), rows
  Delivered (split), unused own rows released + Cancelled after the issue.
- Revert (classic + V2): Reserved-sourced OUT comes back IN to Unrestricted, then one reconcile of the reverted Draft.
- Delete (IA list, Draft): IA_HOLD RELEASE_ALL first; refuse the delete if it fails.

## Batches

| Batch | Content | Tests |
|---|---|---|
| R1 | on_reserved_gd form +"Item Assembly"; IA form hidden fields material_hold_status / material_hold_at (header), required_qty (line); IA_SAVE + IA_V2_SUBMIT keep required_qty for omitting apps (like sc_ref_key) | json, v13 / v4 sims |
| R2 | IA_HOLD (new shell: the user creates it): RECONCILE / RELEASE_ALL, ticket mutex, recovery, header result | sims with core.js; live on dev with a yes |
| R3 | IA_SAVE Draft -> enrol + RESERVING + inline IA_HOLD; client: required_qty upkeep, kick + poll, summary row, line columns, picker add-back | client harness, sims |
| R4 | completion: IA_SAVE Completed, IA_V2_SUBMIT / PREPARE / COMMIT | v13 / v4 / iav2 sims |
| R5 | IA_REVERT / IA_REVERT_V2, IA list delete | sims, client |
| R6 | live acceptance U09-U16, U18 on dev (711077 stock: tell -41) | live |

## Status 2026-10-21 14:05

R1 + R2 published (IA form v46, On Reserved form v20, IA_HOLD v4) and live-tested (DRAFT-IA-2610-001). Batch 15 (14:00):
IA_HOLD v5 = CLOSE + the RELEASE_ALL wording ("Released: ..." + NONE); live check: CLOSE on a Draft -> "Nothing to close". IA
form v47 = the IA V2 Complete & Post double-click fix (not RES-01; src/v2_double_patch.json). Next: R3 + R4 (one activation).

## Status 2026-10-21 16:00

R3, R4 and R5 built offline, switch off everywhere (`RES_ENABLED`: iasc client builder, IA_SAVE sc_in.js, IA_V2_PREPARE plan.js,
iav2 client builder for the list Delete). Not published. Mutation suites (each must stay all-killed): res01/test/mutants_hold.py,
iasc test/mutants_v13.py, iasc client/test/mutants_client.py, iav2 test/prepare/mutants_res.py, iav2
test/revert/mutants_res.py, iav2 client/test/mutants_res_delete.py. Next: a fresh review, then batch 16 OFF to dev, then R6.

## Review fix pass 2026-10-21 17:40 (fresh reviewer: publish OFF yes, switch on with fixes)

Fixed offline, every suite and every mutation suite green: the switch makes holds only, the stored hold status finishes them (I4);
a clone never counts its source's holds (I2); a save during a reconcile keeps its RESERVING mark (I1, header update_time re-read);
CLOSE delivers by the completion's own split and a revert returns stock to the bucket it was held from (I3, M1); the hold key
carries the unit (M2); NONE only when nothing is held (M3); line figures read with explicit limits (M5); RES clocks UTC+8 via
CONVERT_TZ (M7); stored Reserved picks refused before the V2 split (M8); review wording on a completed IA (M10); the PREPARE holds
reads gated by CASE on the stored hold status (M13: prod on_reserved_gd has only its primary key). Deferred minors: M4, M6, M9,
M11, M12, M14 (ledger).

## CLOSE (IA_HOLD operation, source COMPLETE; built 10-21, called by R4)

- After completion (Completed / Fully Posted, own rows left): this cycle's 'IA' OUT movements from Reserved (inventory_movement
  `bin_location_id` / `batch_number_id`, base_qty) less this cycle's own Delivered rows = what is left to attribute; the own
  Allocated rows take it in id order: used -> Delivered (reserved = delivered, open 0, doc_no = the completed number), partly used
  -> Delivered + a remainder row Releasing (Cancelled once moved, Allocated again if nothing moved), unused -> Releasing ->
  Cancelled; one engine operation releases (Reserved -> from_category); header CLOSED. Deliveries are written under the ticket.
- Cycle = id > max(IA id, the last 'IA-R' movement under this number): a reverted IA keeps its number (dev IA-2610-004 / -008).
- Needs review: more issued from Reserved than held (named by key), more delivered than issued, a refused / uncertain release
  (the rest stays held: an open of the Completed IA re-kicks CLOSE), a number outside [A-Za-z0-9 ._#()/-] (never put in SQL).
- R4 must issue the held parts as today's 'IA' OUT with trx_no = the IA number (category Reserved), then call CLOSE (classic:
  after the issue loop; V2: after COMMIT). R5 must not revert a cycle whose own rows are still Allocated (CLOSE first).

## R3 + R4 refined (they are switched ON together: once stock is held, completion must issue it from Reserved)

- Switch: `RES_ENABLED` constant (IA_SAVE's new code node + sc_main), false at first publish. OFF = nothing changes.
- Enrolment (IA_SAVE, server): ON + Add / Clone -> material_hold_status RESERVING on the Draft header write; an enrolled IA's
  Draft re-save -> RESERVING; a non-enrolled IA keeps its stored value. Server-computed, never from the payload (mobile safe).
- required_qty (decision A, made explicit): a visible editable "Required" column on the component lines (ON build). Filled from
  requested_qty when lines are prepared; follows the reference on an output change while it equals the old reference; the
  planner edits it directly; auto-allocation never touches it. Server default at save: null -> requested_qty if > 0 else
  total_quantity; a line sent without the property keeps its stored value (mobile, as sc_ref_key). In the formatNumber map.
- Trigger (user 14:05, "Form starts it"; replaces the inline call): IA_SAVE never calls IA_HOLD (a crashed child fails the
  save after the Draft write). IA_SAVE marks an enrolled Draft RESERVING (it answers only code / message / id); the desktop form (a new IA, or one with a stored
  hold status) then
  starts IA_HOLD RECONCILE (<= 50 hold picks: waits and shows the result; above: in the background), and again on open while
  RESERVING (IA_HOLD's own mutex answers BUSY to a twin). CLOSE likewise: the form after a completion, and on open of a Completed
  IA that still holds stock. Mobile: reserved / closed when next opened on desktop, until the mobile app makes the same calls.
- Display: Materials summary row (status, checked at, "Reservations update when this IA is saved."); line columns Required /
  Reserved / Short (Reserved + Short from the own rows read at open); the Transfer Stock picker adds the IA's own holds back.
- R4 completion: classic IA_SAVE Completed and IA_V2 refuse while a hold ticket is live or an own row is Processing /
  Releasing; picks split by own Allocated rows (held part issued from Reserved, the rest from the pick's category with the
  native check); unused own holds released (Reserved -> from_category) after the issue; rows: used -> Delivered (split so
  reserved = delivered), released -> Cancelled. V2: the held parts issued from Reserved in op 1; the form's CLOSE (after the job is COMPLETED) closes the rows.
- R5: reverts (IN to Unrestricted for Reserved-sourced OUT, then one reconcile), list delete (RELEASE_ALL first).
