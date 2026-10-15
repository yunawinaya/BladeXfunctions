# Putaway Completion V2 — build design (dev)

Plan: `~/.claude/plans/we-have-done-v2-sleepy-iverson.md` (Phase 4). Ships with GR Completion V2
(`scratchpad/grv2/GRV2_DESIGN.md`, same job / step / lease / SPLIT machinery). Oracle: PUTAWAY_LOOP
(`Putaway/PutawayLoopWorkflow.json`, dev v16) → PUTAWAY (`Putaway/PutawayProcessWorkflow.json`, dev v34), both IDENTICAL
repo ↔ dev after Phase 0.

## Collections

| Key | Source |
|---|---|
| JOB / STEP | gd_async_job 2104845286495150081 / gd_publish_step 2105131615547461634 |
| TO | `Transfer Order Putaway:Table:1937714890958053378` (transfer_order_putaway) |
| TOL | its `table_putaway_item` sub-table (transfer_order_putaway_jz8m9w3h_sub, fk transfer_order_putaway_id) |
| TOR | its `table_putaway_records` sub-table |
| GR | `Goods Receiving:Table:1901845517592285186` |
| IT | `In Transit Detail:Table:2080477944160923650` |
| ENGINE | INVENTORY_BULK_APPLY 2109916822821744641 (8a's; unchanged) |

## Job model

- `command = COMPLETE_PUTAWAY`; `correlation_id = TO|<to_id>`; `causation_id = <to_id>` (PUTAWAY_LOOP's Phase 0 lock gate
  already counts open COMPLETE_PUTAWAY jobs by `causation_id = TO id` and answers "under processing").
- Lock: `transfer_order_putaway.is_processing = 1`, `gd_publish_step` job_id `PWC|<to_id>` step `LOCK|<n>` (result_ref =
  idempotency key), and the TO header's `update_time` recorded in the request (P0 compares it).
- `request_payload`: `{ v:1, source, uid, toId, toNo, grId, recordedUpdateTime, lines: [...] }`. `lines` = the
  confirmation: per stored TO line id, the rows to put away (quantity, target bin, target storage location, target
  category, remark, …); a split child names its parent by the parent's line **id** (the classic `parent_index + 1` vs
  `line_index` mismatch goes away). The exact per-row field list is the plan core's to define (the minimum the lifted
  code reads), with the desktop Putaway form (dev v364) able to build it.
- States as GR V2; unlock on a clean failure = `is_processing 0` (and nothing else: no TO line / record was written).

## SUBMIT (sync, client = desktop Putaway form; mobile keeps PUTAWAY_LOOP behind the Phase 0 guard)

Guard → facts (stored TO header + lines + latest LOCK + open jobs, by SQL) → entry: refuses Completed / Cancelled, a live
classic `is_processing` (< 900 s, as LockDecide), another open job; NOT_ELIGIBLE (classic, ≤ 500): Add-mode putaway, serial
/ HU / bundle rows, a costing-migration item (until 8a's change), more than 2,500 rows in one confirmation →
`code_node_S8GL6e4o`'s gates (lifted) against the STORED `pending_process_qty` → writes: LOCK row → job QUEUED (+120 s) →
TO `is_processing 1` → read back → job due. Answer QUEUED.

## PREPARE

SQL reads (no caps): TO header + lines + records, the GR header, items (as `sql_node_PwItems`), in-transit rows of the GR
in ALL statuses (as `sql_node_PwTransit`), other TOs of the GR + QI lots (as `search_node_SVMdNd3K` / `search_node_T5BGLPpK`),
putaway_setup (as `get_node_ca2032Ub`). The plan node rebuilds the classic `allData` (stored TO + the request's lines) and
runs, lifted verbatim in the classic order: `code_node_M7IX2sBi`, `S8GL6e4o`, `qfSZO0bi`, `KbJLkjP8`, `M7XzDZ48`, `ITmatch`
(an In Transit shortage = FAILED, its message), `ds7jurnq`, and per movement `dofqVRSn` + `4Baken82` (the ADD's dates =
the SUBTRACT's source batch dates). Manifest:

```
{ v:1, job_id, to_id, to_no, gr_id, nonce, counts:{ rows, movements, records, lines, itUpdates, itCreates },
  parts: { ENGINE:[..], TO:[..], IT:[..], GR:[..] } }
ENGINE: { operation_key:"PWC|<job>", movements:[ per row: SUBTRACT source bin then ADD target bin (transaction_type
          "TO - PA", trx_no = to_id, parent_trx_no = receiving_no, isMovingInv 1, the line's unit_price on BOTH, the
          source batch's manufacturing / expired date on the ADD, no doc_date, no remarks on the ADD) ] }
TO:     { to_status, lines:[{ id, <every column KbJLkjP8 changes> }], records:[ new table_putaway_records rows, each
          with job_line_key "<job>|<n>" ] }
IT:     { updates:[ITmatch.transitUpdates], creates:[ITmatch.transitCreates + job_line_key "<job>|<n>"] }
GR:     { id, putaway_status, gr_status }  (ds7jurnq)
```

Engine facts (Phase 0a parity, `scratchpad/grv2/parity/`): putaway pairs replay identical through INVENTORY_BULK_APPLY
(452 + 308 prod pairs) when the caller passes the line price on both movements and the SUBTRACT's dates on the ADD, and
no doc_date / remarks; costing-migration items are refused (UNSUPPORTED_COSTING) until 8a's change → NOT_ELIGIBLE.

## COMMIT

| Step | Writes | Rerun / check |
|---|---|---|
| P0_REVALIDATE | — | TO still `is_processing 1` under this job's lock; stored `pending_process_qty` + header `update_time` as recorded; the in-transit rows ITmatch consumed still open as read → else FAILED + unlock |
| P1_INVENTORY | ENGINE APPLY `PWC|<job>` | point of no return → SPLIT; 409 wait; 400 FAILED + unlock |
| P2_TO | records: add to the records sub-table directly (job_line_key; tried first on dev) — fallback: the classic whole-subform update; changed lines by id; `to_status` | rerun: records by job_line_key; lines at after |
| P3_TRANSIT | IT updates by id (intent before / after); IT creates (job_line_key on in_transit_detail, new hidden column) | rerun by job_line_key |
| P4_FINISH | GR putaway_status / gr_status; TO `is_processing 0`; job COMPLETED | — |

New hidden columns (form changes, user's yes): `job_line_key` on the Putaway records sub-table and on in_transit_detail.
