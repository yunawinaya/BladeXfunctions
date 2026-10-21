# GD Revert V2: reverting a Completed Goods Delivery in the background (dev, 2026-10-21)

Built by the GD Completed & Created V2 session (bladexfunctions-c8). Builder: `scratchpad/gdrev/build_gdrev.py` (code in
`scratchpad/gdrev/code/`, tests in `scratchpad/gdrev/test/`). It reuses GD Completed V2's kit read live from `scratchpad/gdc/`:
the runtime and adapter, the job / lock protocol and the worker. The classic revert's code nodes run lifted, unchanged:
`scratchpad/gdrev/lift/lifted_revert.js` = GD_REVERT_COMPLETED v17 + GD_PROCESS_REVERT v14 (pinned in `lift/nodes.json`;
parity on 76 recorded v13 classic runs; v14 only adds the direct-delivery return).

## What a revert does

The same end state as the classic revert (GD_REVERT_COMPLETED → GD_PROCESS_REVERT), in one background job per delivery,
set-based (no per-movement child runs):

- **Stock:** back to Reserved at the delivery cost, through INVENTORY_BULK_APPLY (`GDR|<job>`), merged per item, unit, bin,
  batch, price and SO number.
- **Reservations:** Delivered → Allocated (Picking Plan linkage restored from the snapshot); the completion's fragments
  soft-deleted; pending rows restored.
- **Sales orders:** this delivery's quantities taken off what the lines hold **at the time of writing** (another delivery of
  the same SO written meanwhile stays counted), statuses and header counts as classic.
- **The GD:** Created, its lines' and header's picking status as classic; the completion snapshot marked Reverted.

Not handled (answered NOT_ELIGIBLE: the caller reverts the classic way; classic refuses above 500 lines): a delivery made from
a Picking Plan (`is_select_picking`; its snapshot holds Picking records), serial-numbered items, stock delivered from a
handling unit. PREPARE checks again (FAILED `GDR_NOT_ELIGIBLE`: the delivery is back to Completed).

**Stock delivered with no reservation** (completion's "straight from Unrestricted" branch): since classic GD_PROCESS_REVERT
v14 (10-21) both paths put it back. Per balance, what left in the completion (the GD's movements in the day after its active
snapshot) less what the reservations put back returns to Unrestricted at the cost it left at. Before v14 classic reverted such a
delivery's statuses only (prod 836238 JO-01054 / JO-01069, 10-14 / 10-15). V2 still refuses (`GDR_STOCK_NOT_RETURNABLE`) a stock
item that would get nothing back, e.g. delivered from a handling unit with no reservation.

## Workflows

| Workflow | Role |
|---|---|
| GD_REVERT_SUBMIT | per delivery: checks, the `GDC|<gd>` lock, the REVERT_GD job, the GD Processing |
| GD_REVERT_WORKER | runs due REVERT_GD jobs: PREPARE once, then COMMIT (phase A, then phase B) |
| GD_REVERT_PREPARE | reads (two rounds: the snapshot names the second), the lifted classic revert (refusals, conflicts), the plan, INVENTORY_BULK_APPLY PLAN |
| GD_REVERT_COMMIT | R0 revalidate, R1 stock (SPLIT), R2 reservations, R3 sales orders, R4 the GD (Created last: the unlock) |

Every COMMIT step writes a row only while it still holds what the plan read; R3 records an intent (each row's before and
after) before writing. A row someone else changed sends the job to REQUIRES_REVIEW. Before the stock moves, any failure puts the
GD back to Completed with nothing written.

## Contract for a caller (the GD list)

1. `GD_REVERT_SUBMIT { operation: "SUBMIT", gd_id, source: "LIST" }` for each selected Completed delivery that is not invoiced.
   `route` answers:
   - `QUEUED`: `job_id` set; the delivery is Processing.
   - `NOT_ELIGIBLE`: revert it the classic way (GD_REVERT_COMPLETED).
   - `BUSY`: something holds it (an open job, a Picking on a device, a Packing open on a phone); `message` says what.
   - `STOP`: classic's refusals (not Completed, no active snapshot) and invoiced (`si_status` set, not Cancelled); `message`.
   - `REJECT`: invalid input.
2. Start `GD_REVERT_WORKER { job_id }` once per queued job (fire and forget).
3. Follow with `GD_SO_CONVERT_CHECK { job_ids: [...] }` (v6): `jobs_json` = `[{ job_id, job_status, gd_no, error_code,
   error_message, command, progress_message }]`. `COMPLETED` = reverted; `FAILED` with `GDR_NOT_ELIGIBLE` = revert it the
   classic way; other `FAILED` / `CANCELLED` = not reverted (`error_message`, e.g. classic's 409 conflict text);
   `REQUIRES_REVIEW` = held for an administrator, do not retry. Re-start the worker every few checks while a job runs.

`GD_REVERT_SUBMIT { operation: "STATUS", gd_id }` answers the delivery's latest revert job. The GD form follows it through
GD_EDIT_SUBMIT's STATUS (the job holding the GD's lock) and `GD_BG_WF.REVERT_GD`.

Clients: `Bulk Actions/Sales & Distribution/Goods Delivery/RevertCompletedWorkflow.js` (`REVERT_V2_ENABLED`; false = classic
only) and the list's mount nudge `Goods Delivery/CompleteV2/gdc_list_mounted.js`, filled and put into the page by
`scratchpad/gdrev/patch_list_page.py`; the GD form by `scratchpad/gdrev/patch_form.py`.

## Tests (offline)

- `test/revert_parity.js`: the lift against recorded classic runs (76 same, 0 differ).
- `test/workflow_sim.js`: PREPARE (8) and SUBMIT (21) on the interpreter, on a 1-line and a 2,000-line dev GD.
- `test/commit_sim.js`: COMMIT, 8 scenarios (clean, stale, invoiced, a concurrent SO delivery, two crash-and-resume, review,
  nothing to move), on both.
- `test/test_list_revert.js` (10, 2 mutants), `test/test_form_revert_follow.js` (4, 2 mutants), `scratchpad/gdc/gdcreate/
  test/test_convert_check.js` (5).
- `test/sql_check.py`: every SQL statement of the four workflows runs on dev; `test/r0_live.js`: R0 on real dev rows.
- Live (with a yes per batch): twins classic vs V2 (`test/snap.py`, `test/diff_twins.py`) and a 2,000-line revert.
