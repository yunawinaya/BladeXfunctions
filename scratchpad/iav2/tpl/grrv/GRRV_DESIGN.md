# GR Revert Completed V2 — build design (dev)

Plan: `~/.claude/plans/we-have-done-v2-sleepy-iverson.md` (Phase 5). Same job / step / lease / SPLIT machinery as GR
Completion V2 (`scratchpad/grv2/GRV2_DESIGN.md`) and Putaway V2 (`scratchpad/pwv2/`, whose builder is the template:
`build_grrv.py` imports `build_grv2` as G). Oracle: GR_REVERT_COMPLETED (`Goods Receiving/RevertCompletedGR/
GRrevertCompletedWorkflow.json`, dev v8, IDENTICAL), its two code nodes lifted verbatim: `code_node_grRvPrep` (header
refusals + ledger replay) and `code_node_grRvBuild` (conflicts + the reversal lists).

## Collections

| Key | Source |
|---|---|
| JOB / STEP | gd_async_job / gd_publish_step (as GR V2) |
| GR / GRL | `Goods Receiving:Table:1901845517592285186` / `goods_receiving_eg6l4ywi_sub` |
| PO / POL / OO | as GR V2 |
| TO | `Transfer Order Putaway:Table:1937714890958053378` |
| IT | `In Transit Detail:Table:2080477944160923650` |
| QI | `Basic Inspection Lot:Table:1930547663980482561` |
| BATCH | `Batch:Table:1902719754154655746` |
| FIFO | `FIFO Costing History:Table:1902947165008400386` (fifo_costing_history) |
| WA | `Weighted Average Costing History:Table:1902948453171433474` (wa_costing_method) |
| ENGINE | INVENTORY_BULK_APPLY 2109916822821744641 (unchanged) |

## Job model

- `command = REVERT_GR`; `correlation_id = GR|<gr_id>` (the same as COMPLETE_GR: one open job per GR, whatever it does);
  `causation_id = <gr_id>`.
- Lock: `gd_publish_step` job_id `GRC|<gr_id>`, step `LOCK|<n+1>` (the GR's one lock sequence), result_ref = the
  job's idempotency key; `goods_receiving.gr_status = 'Processing'`, `gr_v2_job_id = <job id>`. A Processing GR is
  already refused by every classic writer (GOODS_RECEIVING, GR_CREATED, GR_CANCEL_CREATED, GR_REVERT_COMPLETED,
  PUTAWAY_LOOP's lock gate) and by the list actions.
- `request_payload`: `{ v:1, source, uid, previousStatus ('Completed'|'Received'), grId, grNo }`.
- States: QUEUED (+120 s, made due after the read-back) → VALIDATING → READY_TO_COMMIT → COMMITTING_REVERT →
  COMPLETED; FAILED / REQUIRES_REVIEW.
- Unlock (clean failure before R1): `gr_status` back to `previousStatus` (gr_v2_job_id kept); PO locks freed.

## SUBMIT (sync; client = the GR list's Revert, one call per selected GR)

Request: `operation` (SUBMIT | STATUS), `gr_id`, `idempotency_key` (`GRV:<org>:<gr_id>:<click token>`), `source`.
1. Guard → facts (one SQL): job of the key, the GR header, its latest LOCK, open jobs `correlation_id = GR|<id>` (any
   command), its latest REVERT_GR job.
2. Entry: STATUS → the latest REVERT_GR job's answer; the key's job → its answer; BUSY (open job); not Completed /
   Received → STOP 400 (grRvPrep's text).
3. Reads: lines (every column grRvPrep reads), movements (`sql_node_grRvMovs` as is).
4. Gate: grRvPrep lifted → `refuse` → STOP 400 with `refuseMessage` (same texts; its "> 500 lines" refusal is the
   classic's own guard and is not applied; V2 caps at 2,500 lines). NOT_ELIGIBLE (→ classic GR_REVERT_COMPLETED,
   ≤ 500 lines; above → STOP with the reason): a handling unit in the receipt's chain (`liveRows` with
   `handling_unit_id`, or `huOutRows`), or a serial-managed item on any line (the engine has no serial handling).
5. Post: LOCK row → job QUEUED (+120 s) → GR `Processing` + `gr_v2_job_id` → read back → job due. Answer QUEUED.

## PREPARE

SQL reads, uncapped (the classic's search-node filters, no limits): `hdr` (+ `table_gr` tree as the get-node gives
it), `movs` (as `sql_node_grRvMovs`), `putaway` (TOs `gr_no = GR id`, with items + records), `qi`, `transit`
(`doc_id = GR id`), `batches`, then — needing grRvPrep's ids — `later`, `fifo`, `wa`, `costcounts` (as the classic's
sql-nodes), `pi`, `bbal`, `ibal`, `hu`, `po` (headers + `table_po` tree), `oo`, `items`, `lock`.
The plan node runs grRvPrep → grRvBuild (lifted, the classic's inputs rebuilt from the SQL rows by the adapter) →
`refuse` or `hasConflicts` → FAILED (message = the classic's, `error_details` = the conflicts list) + unlock; else the
manifest → parts → READY_TO_COMMIT.

### Manifest

```
{ v:1, grId, grNo, organizationId, plantId, previousStatus, lineCount,
  movements: [ { movement_key:"R<n>" (the engine allows A-Z a-z 0-9 . _ - only), direction:"SUBTRACT", plant_id, organization_id, material_id, quantity,
                 material_uom, unit_price, transaction_type:"GRN-R", trx_no:grNo, parent_trx_no, inventory_category,
                 location_id, batch_id|null, handling_unit_id:null, doc_date, isMovingInv:1 } ],   // one per subtracts[i]
  costing: { fifo:[{ id, initial, available }],                    // soft-delete; R2 requires available == initial
             waDelete:[{ id, wa_quantity, wa_cost_price }],        // batch WA rows: soft-delete
             waRestate:[{ id, material_id, B, C }] },              // non-batch WA: R2 restates the FRESH row (classic formula)
  docs: { putaway:[id], transit:[{ id, status:"Cancelled", open_qty:"0.00000000" }], qi:[id], batches:[id] },
  po: { lines:[{ id, po_id, recv, res }], onOrder:[{ po_line_id, base }], poIds:[...] },   // R4 applies to fresh rows
  anchors: { "<item>|<batch>": "<newest live GRN id>" }, minLiveId, itemIds }
```

WA restate: computed from EVERY live row of the tuple at once (`B` = Σ base_qty, `C` = Σ base_qty × unit_price), so a
retry cannot under-reverse (the classic's loop restated after each row).

## COMMIT

| Step | Writes | Rerun / check |
|---|---|---|
| R0_REVALIDATE | PO locks `GRPO|<po>` HOLD (as GR V2 C0; busy → wait) | GR Processing under this job; fresh: no movement past an anchor (`sql_node_grRvLater`), FIFO rows still available == initial, WA delete rows unchanged, TOs still not started and not processing, no live PI → else FAILED + unlock |
| R1_INVENTORY | ENGINE APPLY `GRV|<job>` (SUBTRACT GRN-R, isMovingInv 1) | **point of no return** → SPLIT; 409 wait; 400 FAILED + unlock |
| R2_COSTING | FIFO `is_deleted 1` by id; WA batch rows `is_deleted 1`; WA restate (fresh row: q0 = q1 − B, p0 = (p1·q1 − C)/q0, the classic's guards) | intent `R2|I|<wa id>` (before / after); a mismatch → REQUIRES_REVIEW |
| R3_DOCS | TO `is_deleted 1`; in_transit `Cancelled` / 0; QI `is_deleted 1`; split batches `is_deleted 1` (slices ≤ 250) | absolute, idempotent |
| R4_PO | POL by id on fresh rows: received −recv (≥ 0), outstanding, line_status (grRvBuild §9 rule), created_received_qty + res; OO: received −base (≥ 0), open = scheduled − received (≥ 0); PO headers (§9 rule on the fresh lines); PO locks FREE | intent `R4|I|…` (as GR V2 C3) |
| R5_FINISH | GR `gr_status 'Created'`, `previous_status 'Created'`, `putaway_status ''`; job COMPLETED | — |

Deliberate differences vs the classic (README): all-or-nothing stock (no "Revert stopped part way through"); WA restate
from every row at once; PO rows recomputed on fresh reads under PO locks; no fetch caps (`fetch_truncated` gone); HU
receipts stay classic.

## Node-data budget

2,000 lines: SUBMIT ≤ ~10 MB (lines + movements read); PREPARE ≤ 20 MB; each COMMIT run ≤ 20 MB.
