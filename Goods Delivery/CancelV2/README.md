# GD Cancel V2: cancelling a Created Goods Delivery in the background (dev, 2026-10-20)

Built by the GD Completed & Created V2 session (bladexfunctions-af) from the brief `../AsyncV2/GD_CANCEL_V2_HANDOFF.md`.
Builder: `scratchpad/gdcan/build_gdcan.py` (code in `scratchpad/gdcan/code/`, tests in `scratchpad/gdcan/test/`). It reuses GD
Completed V2's kit read live from `scratchpad/gdc/`: the lifted GOODS_DELIVERY v245 / GD_UNUSED_FN_NEW v55 bodies (pinned:
`scratchpad/gde/lift/check_fresh.sh`), the adapter, the job / lock protocol and the worker.

## What a cancel does

The same end state as the classic cancel (GOODS_DELIVERY saveAs "Cancelled" + the GD list's client-side follow-ups), in one
background job per delivery, set-based (no per-line child runs):

- **Stock:** Reserved -> Unrestricted through INVENTORY_BULK_APPLY (`GDX|<job>`). A Production reservation keeps its stock
  Reserved, as classic.
- **Reservations:** GD / Picking Plan origin Cancelled; SO / Production origin back to Pending, or merged into a Pending row.
  Classic loses quantity when two releases merge into one Pending row; V2 adds them up.
- **Sales orders:** planned quantities and statuses as classic, the header from the written lines.
- **Pickings that name it** (header `gd_no`): its rows Cancelled with nothing pending; the Picking Cancelled (+ "-Cancelled")
  when every row is, Completed when nothing is left to pick. Completed / Cancelled Pickings are left as they are.
- **Packings:** every open Packing of the GD Cancelled, with its lines. The boxes it generated are unpacked (one
  REPACKING_PROCESS Unload per box, as the Packing form's Unpack). A Completed Packing is left as it is; its boxes keep the
  released stock and are named in the result.
- **The number:** "-Cancelled" on the GD, and on every Picking, Packing and stock movement that copies the old number.
- **After:** Item last_transaction_date, REORDER_SET_REDIS GD_CANCELLED.

Not handled (answered NOT_ELIGIBLE: the caller cancels the classic way): serial-numbered items, a GD made from a Picking
(`is_select_picking`), a GD linked to Picking records (found by PREPARE: the job ends FAILED with `GDX_NOT_ELIGIBLE`).

## Workflows

| Workflow | Role |
|---|---|
| GD_CANCEL_SUBMIT | per delivery: checks, the `GDC|<gd>` lock, the CANCEL_GD job, the GD Processing |
| GD_CANCEL_WORKER | runs due CANCEL_GD jobs: PREPARE once, then COMMIT (phase A, then phase B) |
| GD_CANCEL_PREPARE | reads, the lifted classic cancel, the plan (one part per COMMIT step), INVENTORY_BULK_APPLY PLAN |
| GD_CANCEL_COMMIT | X0 revalidate, X2 stock (SPLIT), X3 reservations, X4 sales orders, X4P Pickings, X4K Packings, X4H unpack, X5 numbers + movements, X6 the GD (Cancelled), X7 item dates + reorder |

Every COMMIT step writes a row only while it still holds what the plan read; a row someone else changed sends the job to
REQUIRES_REVIEW. Before the stock moves, any failure puts the GD back to Created with nothing written.

## Contract for a caller (GD list, mobile)

1. `GD_CANCEL_SUBMIT { operation: "SUBMIT", gd_id, source: "LIST" | "MOBILE" }` for each selected Created delivery.
   `route` answers:
   - `QUEUED`: `job_id` set; the delivery is Processing.
   - `NOT_ELIGIBLE`: cancel it the classic way (GOODS_DELIVERY saveAs "Cancelled" + the client follow-ups).
   - `BUSY`: something holds it (an open job, a Picking on a device, a Packing open on a phone); `message` says what. Try later.
   - `STOP`: classic's own refusals (already Cancelled, not Created, a missing required field, too many boxes); `message`.
   - `REJECT`: invalid input.
2. Start `GD_CANCEL_WORKER { job_id }` once per queued job (fire and forget).
3. Follow with `GD_SO_CONVERT_CHECK { job_ids: [...] }` (v5): `jobs_json` = `[{ job_id, job_status, gd_no, error_code,
   error_message, command, progress_message }]`. `COMPLETED` = cancelled (`progress_message` names what was left in place);
   `FAILED` with `error_code` `GDX_NOT_ELIGIBLE` = cancel it the classic way (the delivery is back to Created); other
   `FAILED` / `CANCELLED` = not cancelled (`error_message`); `REQUIRES_REVIEW` = held for an administrator, do not retry.
   Re-start the worker every few checks while a job runs.
4. With V2 on, **do not** write the Picking rows or rename the movements yourself: the job does both.

`GD_CANCEL_SUBMIT { operation: "STATUS", gd_id }` answers the delivery's latest cancel job.
