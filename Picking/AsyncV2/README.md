# Picking confirmation, background save (V2) — dev only, stage 1a

Built 2026-10-12. **Not deployed yet.** It replaces the synchronous Save as Completed of the
Picking form, and the list's **Auto Pick & Complete**, for normal Goods Delivery pickings. Before
this, a 2,000-line Picking re-saved the whole GD through `GOODS_DELIVERY` on every confirmation and
took the dev server down on 2026-10-09.

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
                        PICKING_BULK_COMMIT    run B: P5 Packing (if Completed + auto packing) → P6 unlock, COMPLETED
mobile app ──► PICKING_LOOP ──► PICKING (unchanged, with the size guard from 2026-10-12)
```

**It never re-saves the Goods Delivery.**

- A normal pick changes only:
  - the GD lines' `picking_status` and `prev_temp_qty_data`;
  - the GD header's `picking_status`.
- These are written directly, using the old rules:
  - lines: `code_node_iES7iMKA`;
  - header: B3E0 plus `rollUpPicking`.

## What goes to the background (stage 1a) and what does not

The form and SUBMIT send a case to the **old save** (`NOT_ELIGIBLE`) when it is:

| Case | Old save, because | Stage that adds it |
|---|---|---|
| A new Picking (Add), a Draft, mobile / split data | not a stored confirmation | — |
| A line with a target bin or batch other than its source | the reservation must follow the stock | 1c |
| Picking Setup: picks after **Sales Order** (Picking Plan) | not ported yet | 1f |
| **Full Picking** (`allow_full_picking`) | sibling Pickings, M:N recount | 1b |
| **Loading Bay** (setup or document) | bin moves | 1c |
| **Auto Complete GD** | the GD completion must be async too | 1e |
| List **Force Complete** | — (still the old path) | 1d |

Switches:

- `STAGE` and `ASYNC_PICKING_ENABLED` at the top of `code_node_PSdecide` (SUBMIT).
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

**COMMIT steps:** each step writes absolute values, then a `gd_publish_step` row `<STEP> DONE` after
its read-back passes. A rerun skips DONE steps and redoes an unfinished one.

| Step | Writes | Check |
|---|---|---|
| P0_REVALIDATE | — | picked lines' pending/status and the GDs unchanged since PREPARE, else FAILED + unlock |
| P1_PICKING | one Picking update: `to_status`, all lines, all records, the header fields from the form | this job's records counted by `job_line_key = <job>\|<row>\|<seq>` |
| P3_GD_LINES | `picking_status`, `prev_temp_qty_data`, slices ≤ 250 | statuses read back |
| P4_GD_HEADERS | GD `picking_status` of every GD on the Picking (cancelled skipped) | read back; then **SPLIT** (lease `SPLIT\|…`) |
| P5_PACKING | per GD: refresh the existing Packing, or create one (`packing_no` issued + the org's Packing rule, `idempotency_key PKG\|<gd>`) | one live Packing per GD |
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
- `PickingonMounted.js`, `pkV2ShowJobState`:
  - while a job is open, it hides the save buttons;
  - it reports a FAILED, under-review or reduced result once.

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
