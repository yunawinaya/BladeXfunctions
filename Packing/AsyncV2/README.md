# Packing completion, background save (V2)

Built 2026-10-13; live on dev (workflows, form, PACKING_SAVE guards) and tested 2026-10-14..16: small Packings, a 2,000-line
Packing (about 3.5 min in the background), batch items, the classic fallback, a stuck job restarted from the form, Packings
whose Picking moved the stock (classic and Picking V2), and the mobile app on an iPhone. Ships to prod switched ON with the
full dev→prod deployment of the week of 2026-10-19 (ids carry over). It replaces the desktop Packing form's synchronous Save as Completed. Before this, a
completion re-saved the whole Goods Delivery through `GOODS_DELIVERY`. On prod (LSH) a 74-line Packing took 96 s, 71 s
of it in `GD_UNUSED_FN_NEW` moving reservations into the HU one line at a time. At 2,000 lines that is about 40 min,
the same re-save that took dev down on 2026-10-09.

The four workflows are generated from tested code. **From now on, edit the JSON in this folder directly**, as for
`Picking/AsyncV2/`.

## The flow

```
Packing form "Completed" ──► pending HUs completed ONE AT A TIME (TableHUCompleted, bulk mode), the Packing written once
  (NOT_ELIGIBLE → the old  ──► PACKING_ASYNC_SUBMIT ──► gd_async_job (command COMPLETE_PACKING, QUEUED)    dialog closes
   onSave_Completed)              Packing lock = PKGJOB-<job> (the mobile app cannot enter it while the job runs)
      └─ kick ──► PACKING_ASYNC_WORKER (no Quartz row: the clients kick it) ── claim W0_CLAIM_<row_version> + 10-min lease
                    ├─► PACKING_BULK_PREPARE   VALIDATING → READY_TO_COMMIT (prepared_payload) or FAILED (+ lock given back)
                    └─► PACKING_BULK_COMMIT    run A: P0 revalidate → P1 inventory → P2 reservations → SPLIT
                        PACKING_BULK_COMMIT    run B: P3 GD lines → P4 sales order → P5 Packing → COMPLETED
mobile app ──► PACKING_SAVE (classic, plus guards that refuse a Completed save before any write: above 500 GD lines, or
               while the delivery is Processing or has an open EDIT_GD / COMPLETE_GD / COMPLETE_PACKING job)
```

GOODS_DELIVERY (v243, owned by the GD Completed session) refuses an Edit save on the same conditions, so a mobile GD save
cannot land in the middle of a Packing job.

**It never re-saves the Goods Delivery.** Of that re-save, a Packing completion needs only what `detectBinHuMigrations`
(`GD_UNUSED_FN_NEW` `code_node_b71wypDJ`) does: each packed line's reservations move from the loose bin into the HU. The
old path moved the matching Reserved stock with a SUBTRACT/ADD_INVENTORY_NEW pair per chunk. Here it is ONE call to
GD V2's `INVENTORY_APPLY_OPERATION` (unchanged).

## What goes to the background and what does not

The form or SUBMIT sends these to the **old save** (`NOT_ELIGIBLE`):

- a new Packing (Add) or a Draft;
- a Packing with no Goods Delivery (Sales-Order based);
- a Packing with an item the inventory operation cannot move: no base unit (27 LSH items on prod), serial-managed,
  no batch-management flag, a costing method other than Fixed Cost / FIFO / Weighted Average, Fixed Cost with no price;
- a Packing with an item that has `item_batch_balance` rows (a non-batch item) or `item_serial_balance` rows at the bins
  of its reservations or of the Packing's HUs: `INVENTORY_APPLY_OPERATION` refuses those effects (its effect matrix).
  Dev and prod both have such stray rows (prod: 70 non-batch items in one tenant, 2026-10-13);
- a Packing whose last job failed `PK_NOT_SUPPORTED` (found by PREPARE, or an `EFFECT_NOT_SUPPORTED` refusal of the
  inventory operation at P1): the next click runs the old save.

SUBMIT **refuses** (a message, nothing written):

- the Packing Completed or Cancelled; the Goods Delivery not Created;
- a GD line not fully picked (`code_node_PkPickChk`'s message);
- an open job on the same delivery: another Packing's completion, or another command's job with
  `correlation_id = GD|<gd>` (GD Completed, built in session bladexfunctions-ce, follows the same convention);
- a live mobile Packing session of another user (`packing_lock_*`).

Switch: `ASYNC_PACKING_ENABLED` at the top of `code_node_KSdecide` (SUBMIT) and in the client handler.

## Job model (shared `gd_async_job` / `gd_publish_step`)

- `command = COMPLETE_PACKING`, `causation_id` = the Packing, `correlation_id = GD|<gd_id>`.
- **`gd_id` / `gd_no` stay empty on purpose.** `GD_JOB_RECONCILE`'s GAP scan reads any job with a `gd_id` whose delivery
  is Created as a publication gap, whatever its command.
- States: QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_PACKING → COMPLETED; terminal FAILED / REQUIRES_REVIEW.
- The Packing lock (`packing_lock_session_id = PKGJOB-<job>`, 30 min, user "Background save") is given back on
  COMPLETED and on every clean failure, only while it is still the job's.

**PREPARE** reads everything set-based and freezes the whole completion in `prepared_payload`. It ports:

- the gates `code_node_PkPickChk`, `code_node_PkFullChk` and the form's HU checks;
- the HU re-tag of the GD lines `code_node_nB1MhwgG`;
- the reservation move `detectBinHuMigrations` (packed lines only, with `_restateReserved`);
- the SO flip `code_node_LifGKghL` (per SO);
- the totals `code_node_CYy1gmHf` and the HU row stamps `code_node_7u6VSG8X`.

The stock effects: per reservation move, Reserved OUT at the old bin and IN at the HU's bin.

- A batch item gets BATCH effects; the engine also moves the item aggregate row.
- `quantity_base` = qty × the reservation unit's `base_qty`. A unit with no conversion row counts 1:1, as
  ADD/SUBTRACT_INVENTORY_NEW count it.
- Costing as GD V2 states it: trx_no = the delivery number, parent_trx_no = the SO number, the Fixed Cost price.
- Each HU's effects carry their own time of day in `doc_date`. The movement keeps only the date, and this keeps one IN
  movement, with its HU stamped, per HU instead of a merged one.
- A move inside the HU's own bin has no stock effect: only its reservation row moves.

A packed quantity with no reservation to move, or a source bin that does not hold the reserved quantity, stops the job
(FAILED, nothing written). The old path silently allocated fresh stock instead.

**COMMIT steps:** each writes absolute values, then a `<STEP> DONE` row after its read-back passes. A rerun skips DONE
steps.

| Step | Writes | Check |
|---|---|---|
| P0_REVALIDATE | — | packed lines' `temp_qty_data` (CRC), the reservations to move, the HU rows (count + CRC), the delivery Created, the Packing open and not entered on mobile; else FAILED + lock given back |
| P1_INVENTORY | missing destination balance rows at 0 (as ADD_INVENTORY_NEW creates them; batch dates copied from the source batch row); the STARTED row naming `PKG\|<job>\|<attempt>`; ONE `INVENTORY_APPLY_OPERATION` call; `handling_unit_id` on the IN movement rows | the stored operation row decides: DONE → on; LOCK_CONFLICT / STALE_BEFORE_MUTATION → retry with the next operation id (3); a refusal → FAILED clean (nothing moved; the created balance rows stay at 0; `EFFECT_NOT_SUPPORTED` → `PK_NOT_SUPPORTED`, so the next click runs the old save); review codes → REQUIRES_REVIEW |
| P2_RESERVATIONS | old `on_reserved_gd` rows cancelled (doc fields blanked, as the old update writes them) or reduced; new rows at the HU's bin with `job_line_key = <job>\|<old id>\|<n>`; slices ≤ 250 | every new key once, every old row as planned; then **SPLIT** |
| P3_GD_LINES | `packing_status` Completed, `packing_no`, `temp_qty_data` / `prev_temp_qty_data` / `temp_hu_data` / `view_stock` (as `update_node_kY058uhm`, except `prev_temp_qty_data` = the re-tagged value, as the classic GD re-save leaves it); the delivery's `packing_status` | read back |
| P4_SALES_ORDER | SO `packing_status` Completed + its lines (+ `packing_no`) when every delivery of the SO is packed | read back |
| P5_PACKING | `packing_status` Completed, totals, the header fields the form sent (remarks, Delivery Info; freight 2 dp), HU row stamps, selection flags cleared, the lock given back | read back |

Retries, resume and REQUIRES_REVIEW work as in Picking V2 (backoff 2–16 s, 3 retries; a run that dies leaves its
10-minute lease and the next worker tick resumes it). Manual resume of a REQUIRES_REVIEW job, after fixing the cause:

```sql
UPDATE gd_async_job SET job_status = 'COMMITTING_PACKING', attempt_count = 0, next_attempt_at = NULL,
       lease_owner = NULL, lease_expires_at = NULL WHERE id = <job>;
```

## Differences from the old save (deliberate)

- The GD, its lines and the SO are not re-saved: only the packing fields and the re-tag are written.
- A packed quantity with no reservation stops the job instead of allocating fresh stock.
- Movements are in the base unit, one per (balance key, HU), priced by the engine (the old Reserved shuttle wrote 0).
  A move inside the same bin writes no movement.
- The SO flip is decided per SO (the old node decided once for all of the Packing's SOs).

## Desktop form (`Packing/PackingFullJSON.json`, built on dev v202)

- `pkgV2_onSave_Completed` on the Completed button (key `3mu4g0dp`). The old `onSave_Completed` stays for NOT_ELIGIBLE.
- `TableHUCompleted` bulk mode: no loading overlay or Packing write of its own; it reports to `_data.pkgv2_hu_<row>`.
  The new handler completes pending HUs one at a time and writes the Packing once (also when an HU fails), instead of
  the old parallel completion (packaging-stock races, whole-Packing writes overwriting each other).
- `mounted` `pkgV2ShowJobState`: the latest job through SUBMIT `STATUS`; save buttons hidden while a job is open, and
  the worker kicked again for it (no scheduled worker; a run in progress holds the job's lease, so a second kick does
  nothing); FAILED / under review reported once.
- `PackingRecomputeSource` and `onPackingModeChange` write only the cells that change. Opening a 2,000-line Packing
  wrote 8,000 cells and fired the qty_to_pick handler 2,000 times; a re-open now writes nothing.
- `PackingPickItemToHU` / `PackingBulkPickItems` read the GD once per open (kept in `_data.pkgv2_picked`); a tap the
  kept map would refuse reads it again first.
- `table_item_source` uses the GD / Picking table settings (auto paging, no virtual table).

Mobile: the app's V2 (`sudu-mobile-expo`, branch `feature/v2_background`) is built to `MOBILE_PACKING_V2_GUIDE.md` and
passed an iPhone run on dev 2026-10-16; it is switched on by the dev backend URL only. On prod the app keeps calling the
classic PACKING_SAVE until the user releases its V2.

## Workflows (dev ids)

| Workflow | id | Called by |
|---|---|---|
| PACKING_ASYNC_SUBMIT | 2109924558618333185 | Packing form (save, mounted STATUS) |
| PACKING_ASYNC_WORKER | 2109924593737240578 | form (after SUBMIT, and on opening a Packing with an open job); mobile on dev |
| PACKING_BULK_PREPARE | 2109924633813815298 | WORKER |
| PACKING_BULK_COMMIT | 2109924671239589890 | WORKER (twice per tick on a SPLIT); calls INVENTORY_APPLY_OPERATION 2105133980371554305 |

## Deploy (dev)

1. Create the four empty workflows with the names above (done 2026-10-13, in the designer: compile-created SQL nodes
   bind `?` and would break these inline SQL texts).
2. Regenerate with their ids (scratchpad `pkg/build.py`, `client_patch.py`; done).
3. Paste and enable PREPARE, COMMIT, WORKER, SUBMIT (done 2026-10-13, v3); then the Packing form (it calls SUBMIT, so
   not before); then the guarded PACKING_SAVE (one code node: CLI publish).
4. No Quartz row (decision 2026-10-14: too expensive). A job that needs a retry waits for the next kick, which comes
   from anyone opening that Packing.
