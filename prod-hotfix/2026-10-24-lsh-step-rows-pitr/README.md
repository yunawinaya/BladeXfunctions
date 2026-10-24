# LSH gd_publish_step overwrite: restore from a point-in-time copy (2026-10-24)

## Status 12:20 MYT: the point-in-time copy is NOT needed

Every job still open when the overwrite hit was repaired directly:
- `resume_4_completed.sql`: 4 COMPLETE_GD jobs.
- `resume_19_created.sql`: 19 CREATE_GD_FROM_FORM jobs.
- `finish_5_handpicked.sql`: 5 of those 19, which had been packed by hand.

All three were run and checked.

The 11,009 rows that still carry the overwrite belong to finished work: completed or failed jobs, operation keys, locks.

Every workflow deployed on prod that reads a step status was checked (67 workflows):
- Most read their own running job's rows only.
- Lock rows are read by result_ref; stock engine rows by step name.
- Item Assembly tickets and claims are counted only while HELD, but the 11 IAs whose rows were overwritten are all Completed or Fully Posted.

So copy_back.sql would only correct history. The DBA request below is kept for reference.

Also closed: GD-2610-1250 by `finish_1250.sql` (12:35). Its manual recovery "GD1250_20261024" had nobody claiming it. GD-2610-1254 and 1256 were closed once bladexfunctions-42 released their hand-placed BLOCKED holds.

At 12:40 no job was open at LSH, and `scratchpad/prod_health.py` was clean apart from the incident's own rows ageing out.

## What happened

- **The cause.** Prod PACKING_SAVE v31 (pasted 11:06:00 MYT by "admin") added a Packing guard. One of its update nodes writes
  `step_status = 'PACKING_DONE'` and `error_code = 'ABORTED_BEFORE_BUSINESS'`. On this platform an update node does not enforce its
  WHERE, so it rewrote **every** `gd_publish_step` row of tenant 128671.
- **When.** Each Packing save on its busy path did it again. The ones seen were 11:24:44 and 11:28:11, the latest in user "joseph"'s save,
  and probably more since 11:06.
- **What it changed.** Only `step_status`, `error_code`, `update_user` and `update_time`. `result_ref`, `attempt_count`,
  `started_at`, `finished_at`, `inventory_operation_id` and `error_message` are untouched.
- **What it broke.** These rows are the progress records of every V2 background job: GD Created / Completed / Cancel / Edit / Revert,
  and Picking V2. At 11:28: 11,267 rows. Only tenant 128671 is affected.
- **Step 1 (stop):** restore PACKING_SAVE to its pre-guard version,
  `../2026-10-24-lsh-packing-guard-revert/RESTORE_PACKING_SAVE.v58_2026-10-21.json`.

## Request to the DBA / platform team

1. **Point-in-time restore** of the prod RDS instance (`asc-bladex-prod`) to a temporary instance at **2026-10-24 03:05:59 UTC**
   (= 11:05:59 MYT, one second before the guard went live, so no overwrite is in it).
2. From it, copy table `bladex_boot.gd_publish_step`, rows `tenant_id = '128671'` (about 11,000 rows), into the prod schema as
   **`gd_publish_step_pitr_1105`**, with the same columns. Only `id`, `tenant_id`, `step_status` and `error_code` are needed, if
   that is easier.
3. Drop the temporary instance afterwards. The copy table can be dropped once `copy_back.sql` has run and been checked.

## Then

1. **`copy_back.sql`.** For every row that still carries the overwrite (current status PACKING_DONE /
   ABORTED_BEFORE_BUSINESS), it puts back `step_status` and `error_code` from the 11:05:59 copy. A row updated legitimately since
   no longer carries the signature and is left alone.
2. **Rows created after 11:05:59** (366 at 11:28) are not in the copy. They are rebuilt separately from their jobs' state;
   bladexfunctions-22 writes that SQL after looking at them.
3. **The 22 GD Created V2 jobs** in REQUIRES_REVIEW (P7B_SO_PROJECTION, blank SO planned_qty; fixed going forward by
   GD_BULK_COMMIT v22) get their resume SQL once their rows are back.
