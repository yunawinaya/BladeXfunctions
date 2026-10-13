# Picking confirmation, background save (V2) — dev only, stages 1a + 1b

Stage 1a (normal Goods Delivery pickings) built 2026-10-12, deployed on dev 2026-10-12. Stage 1b
(**Full Picking**) built 2026-10-13. It replaces the synchronous Save as Completed of the Picking
form, and the list's **Auto Pick & Complete**. Before this, a 2,000-line Picking re-saved the whole
GD through `GOODS_DELIVERY` on every confirmation and took the dev server down on 2026-10-09.

The four workflows here are generated from tested code. **From now on, edit the JSON in this
folder directly**, the same way `Goods Delivery/AsyncV2/` is maintained.

## The flow

```
Picking form "Completed" ──► PICKING_ASYNC_SUBMIT ──► gd_async_job (command CONFIRM_PICKING, QUEUED)
list "Auto Pick & Complete"     (NOT_ELIGIBLE → the old       Picking is_processing = 1    dialog closes
                                 onSave_Completed / old
                                 fill-and-save path)
      └─ kick ──► PICKING_ASYNC_WORKER (also a Quartz row) ── claim W0_CLAIM_<row_version> + 10-min lease
                    ├─► PICKING_BULK_PREPARE   VALIDATING → READY_TO_COMMIT (prepared_payload) or FAILED (+ unlock)
                    └─► PICKING_BULK_COMMIT    run A: P0 revalidate → P1 Picking → P3 GD lines → P4 GD headers → SPLIT
                        PICKING_BULK_COMMIT    run B: P5 Packing, 25 GDs per chunk (if Completed + auto packing) → P6 unlock, COMPLETED
mobile app ──► PICKING_LOOP ──► PICKING (unchanged, with the size guard from 2026-10-12)
```

**It never re-saves the Goods Delivery.**

- A normal pick changes only:
  - the GD lines' `picking_status` and `prev_temp_qty_data`;
  - the GD header's `picking_status`.
- These are written directly, using the old rules:
  - lines: `code_node_iES7iMKA`;
  - header: B3E0 plus `rollUpPicking`.
- A Full Picking pick also writes the GD lines' `picked_qty`, `picked_temp_qty_data` and
  `picked_view_stock`, recounted from every Picking's records as `code_node_MNRecompute` does.

## What goes to the background and what does not

The form and SUBMIT send a case to the **old save** (`NOT_ELIGIBLE`) when it is:

| Case | Old save, because | Stage that adds it |
|---|---|---|
| A new Picking (Add), a Draft, mobile / split data | not a stored confirmation | — |
| A line with a target bin or batch other than its source | the reservation must follow the stock | 1c |
| Picking Setup: picks after **Sales Order** (Picking Plan) | not ported yet | 1f |
| **Loading Bay** (setup or document) | bin moves | 1c |
| **Auto Complete GD** | the GD completion must be async too | 1e |
| List **Force Complete** | — (still the old path) | 1d |

Switches:

- `STAGE` and `ASYNC_PICKING_ENABLED` at the top of `code_node_PSdecide` (SUBMIT).
  `STAGE.FULL_PICKING` is on since stage 1b.
- `ASYNC_PICKING_ENABLED` in both client handlers.

Picking Setup and Packing Setup are read exactly as PICKING reads them: **the organization's first
row** (lowest id), not the Picking's plant. Some organizations have one row per plant.

## Job model (shared `gd_async_job` / `gd_publish_step`; the GD worker polls only `CREATE_GD_FROM_FORM`)

**Job states:**

- Normal path: QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_PICKING → COMPLETED.
- Terminal: FAILED or REQUIRES_REVIEW.

**SUBMIT:**

- Creates the job, or returns the existing one, by `(tenant, organization, idempotency_key)`. The
  key is one per click; a retry of the same click reuses it.
- Refuses while another job of the Picking is open or under review.
- Refuses while the old path holds `is_processing` (unless the lock is older than 900 s).

**PREPARE:**

- Reads everything set-based from the stored Picking: lines, GD lines and item units.
- Ports PICKING's rules:
  - records and the UOM funnel: `oHIIKfiw`;
  - the pending clamp and its report: `ClampMsg`;
  - line status: `Z5JH4g2u`;
  - GD line status and the all-or-nothing bundle rule: `iES7iMKA`.
- **Full Picking** (stage 1b), as `Z5JH4g2u` / `iES7iMKA` do with `allow_full_picking`:
  - any picked quantity closes the line (Completed, pending 0); the rest goes to a new Picking
    through Convert to Picking;
  - under a bundle, anything picked must be picked in full;
  - a GD line's picked quantity is counted over the records of **every** Picking
    (`sql_node_PPpicked`); above the GD quantity the pick is refused before anything is written
    (`PK_OVER_PICK`, PICKING's message).

**COMMIT steps:** each step writes absolute values, then a `gd_publish_step` row `<STEP> DONE` after
its read-back passes. A rerun skips DONE steps and redoes an unfinished one.

| Step | Writes | Check |
|---|---|---|
| P0_REVALIDATE | — | picked lines' pending/status and the GDs unchanged since PREPARE, else FAILED + unlock |
| P1_PICKING | one Picking update: `to_status`, all lines, all records, the header fields from the form | this job's records counted by `job_line_key = <job>\|<row>\|<seq>` |
| P3_GD_LINES | `picking_status`, `prev_temp_qty_data`, slices ≤ 250 | statuses read back |
| P3_GD_LINES, Full Picking | each touched GD line recounted from the records of every Picking (`MNRecompute`): `picked_qty`, `picked_temp_qty_data`, `picked_view_stock`, `picking_status`, + `prev_temp_qty_data`; only lines whose stored values differ, slices ≤ 250 | up to 4 passes in the run: a pass that reads the lines and records (one statement) and finds nothing to write settles the step |
| P4_GD_HEADERS | GD `picking_status` of every GD on the Picking (cancelled skipped) | read back; then **SPLIT** (lease `SPLIT\|…`) |
| P5_PACKING | per GD, in chunks of ≤ 25 GDs (reads, build, ≤ 25 creates per add-node): refresh the existing Packing, or create one (`packing_no` issued + the org's Packing rule, `idempotency_key PKG\|<gd>`) | one live Packing per GD, over all chunks |
| (finish) | Picking `is_processing = 0`, job COMPLETED, message in `progress_message` (`error_code PK_CLAMPED` when a line was reduced) | — |

**Retries:**

- A failed check retries with backoff (2 s, 4 s, 8 s, 16 s; 3 retries).
- Then the job goes to REQUIRES_REVIEW:
  - from P1 to P4, **the Picking stays locked**;
  - at P5, the Picking is unlocked (it is fully saved).
- A run that dies leaves its 10-minute lease; the next worker tick resumes it.
- The worker gives up (FAILED, unlocked) only before anything was written.

**Manual resume of a REQUIRES_REVIEW job** (after fixing the cause; dev, with a yes first):

```sql
UPDATE gd_async_job SET job_status = 'COMMITTING_PICKING', attempt_count = 0, next_attempt_at = NULL,
       lease_owner = NULL, lease_expires_at = NULL WHERE id = <job>;
```

**Two sibling Pickings of the same GD line** (Full Picking zone or remainder Pickings) confirmed at
the same time: a P3 pass can write a value that misses the other Picking's records. The next pass
reads again and corrects it. The step is DONE only after a pass finds nothing to write, and the
Picking whose records came last always recounts after them. The old path (mobile → PICKING) writes
once, without that read-back.

## Differences from the old save (deliberate fixes)

- **Attributes come from the stored Picking line**, not the browser: item, unit, bin, batch, HU,
  GD/SO ids. The pick-UOM factor is computed from the Item's `based_uom` / `table_uom_conversion`.
- **Untouched lines keep their status.** The old save wrote every In Progress line it did not pick
  back as Open.
- **Confirmed lines get `picked_qty` 0.** A value left over from a Draft save is no longer resent.
- **`temp_qty_data` is not rewritten.** The old save only tidied it: it merged duplicate bin
  entries, found on 9 prod lines. The GD's allocation is left as the GD saved it.
- **The Packing counts all of this Picking's records.** The old save counted only the last
  confirmation's records unless Full Picking was on.
- **A cancelled Packing is ignored** when looking for the GD's Packing. A Packing numbering rule is
  picked as non-draft, then default.
- **Full Picking: a GD line already Completed is checked for over-picking too.** The old save
  skipped that check for it.
- **P5 works in chunks of ≤ 25 GDs.** Stage 1a read all the Picking's GDs in one search, and a
  search returns at most 100 records: a Picking of 130 GDs got 100 Packings and the step still
  read as DONE.

## Known limits

- **P1 reads the Picking with one get-node**, which joins every line with every record (as PICKING's
  `get_node_jEllcWiJ` does). A first confirmation of 2,000 lines is fine (no records yet). A second
  confirmation of a Picking that already holds ~1,000 records reads lines × records rows and gets slow.
- **A step retry (`PK_STEP_RETRY`) waits for the next worker tick.** Without the Quartz row below,
  that is the next kick from the form or the list.

## Workflows (dev ids)

| Workflow | id | Called by |
|---|---|---|
| PICKING_ASYNC_SUBMIT | 2109531449614647297 | Picking form, Picking list |
| PICKING_ASYNC_WORKER | 2109531412499251201 | form / list (one kick per job) + Quartz |
| PICKING_BULK_PREPARE | 2109531157594619905 | WORKER |
| PICKING_BULK_COMMIT | 2109531367339180034 | WORKER (twice per tick on a SPLIT) |

Client files:

- `pkV2_onSave_Completed.js`: form event `pkV2_onSave_Completed`, on the Completed button.
- `pkV2_listAutoPick.js`: the list's `AutoPickingComplete`.
- `PickingonMounted.js`, `pkV2ShowJobState`: reads the Picking's latest job through SUBMIT with
  `operation: "STATUS"` (read only). The browser cannot read `gd_async_job` itself: "GD Async
  Job数据表尚未发布", the table has no published form.
  - While a job is open, it hides the save buttons.
  - It reports a FAILED, under-review or reduced result once.

## Deploy (dev)

1. Create the four empty workflows with the names above.
2. Regenerate with their ids.
3. Paste and enable:
   - PREPARE, COMMIT, WORKER, SUBMIT;
   - then the Picking form (`Picking/PickingFullJSON.json`);
   - then the Picking list page (`Picking/PickingListPageFullJSON.json`, built on dev v216).
4. Optional: a Quartz `WorkflowJob` row per tenant for PICKING_ASYNC_WORKER (group "Picking V2",
   class `org.springblade.modules.sucode.job.WorkflowJob`, no params, every 1–5 min). This is the
   only retry path when a kicked run dies.

**Stage 1b on dev** (WORKER and the client handlers are unchanged):

1. PICKING_BULK_PREPARE and PICKING_BULK_COMMIT, in either order. They still run stage 1a jobs the
   same way; a payload without `full_picking` takes the normal P3.
2. Then PICKING_ASYNC_SUBMIT: its `STAGE.FULL_PICKING = true` is what sends Full Picking here.
