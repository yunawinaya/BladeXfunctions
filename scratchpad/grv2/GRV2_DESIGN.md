# GR Completion V2 — build design (dev)

Plan: `~/.claude/plans/we-have-done-v2-sleepy-iverson.md` (Phase 3). This file is the node-level contract between the
builder (`build_grv2.py`), the PREPARE plan core (`code/prepare/`), COMMIT (`code/commit/`), WORKER and SUBMIT.
Pattern source: GD Completed V2 (`scratchpad/gdc/`, `Goods Delivery/CompleteV2/`) — same job / step / lease / SPLIT
machinery; GOODS_RECEIVING (`Goods Receiving/GRsaveWorkflow.json`, dev v100 = classic + Phase 0 guards) is the oracle.

## Collections

| Key | Source |
|---|---|
| JOB | `GD Async Job:Table:2104845286495150081` (gd_async_job) |
| STEP | `GD Publish Step:Table:2105131615547461634` (gd_publish_step; job_id / step_name varchar(32)) |
| GR | `Goods Receiving:Table:1901845517592285186` |
| GRL | `Item Table(Goods Receiving):Table:1939901512083677186` (goods_receiving_eg6l4ywi_sub) |
| PO | `Purchase Order:Table:1902776039445217282` |
| POL | `Item Table(Purchase Order):Table:1939901372270747649` (purchase_order_2ukyuanr_sub) |
| OO | `On Order Purchase Order:Table:1902627276974047233` |
| BATCH | `Batch:Table:1902719754154655746` |
| BNC | `Batch Number Configuration:Table:2058765580973846530` (batch_number_config) |
| TO | `Transfer Order Putaway:Table:1937714890958053378` |
| IT | `In Transit Detail:Table:2080477944160923650` |
| ITEM | `Item:Table:1901546842240438273` |
| ENGINE | INVENTORY_BULK_APPLY 2109916822821744641 (bladexfunctions-8a; called unchanged) |
| TOKENS | INVENTORY_LOCK_TOKENS 2105936479113383937 (PO locks `PO|<po_id>`) |

## Job model

- `command = COMPLETE_GR`; `correlation_id = GR|<gr_id>`; `causation_id = <gr_id>`; `gd_id` / `gd_no` EMPTY.
- `idempotency_key`: the client's per-click key (page token + payload hash + generation, as
  `gdV2_onClick_save_as_created.js`), ≤ 128 chars; unique (tenant, org, key) makes a twin submit lose.
- Lock: `gd_publish_step` job_id `GRC|<gr_id>`, step `LOCK|<n>`, result_ref = the job's idempotency key; plus
  `goods_receiving.gr_status = 'Processing'` and the hidden header column `gr_v2_job_id = <job id>`.
- `request_payload` (small): `{ v:1, source, uid, previousStatus ('Draft'|'Created'), mode ('ADD'|'EDIT'), answers:
  { continueZero }, origReserved: { <po_line_item_id>: qty } (Created only), grId, grNo }`. The LINES live in the GR
  (stored at SUBMIT), never in the job.
- States: QUEUED (inserted with next_attempt_at = now + 120 s, made due after the read-back — bladexfunctions-8a's
  pattern) → VALIDATING → READY_TO_COMMIT → COMMITTING_GR → COMPLETED; terminal FAILED / REQUIRES_REVIEW.
- Unlock (clean failure before C2): `gr_status` back to `previousStatus`, `gr_v2_job_id` kept (audit), this job's batch
  rows soft-deleted. The reason is shown once on open (SUBMIT `operation: STATUS`).

## SUBMIT (sync)

Request: `operation` (SUBMIT | STATUS), `gr_id` (Edit; empty for Add), `idempotency_key`, `answers`, `form` (the GR
form's persisted header columns + `table_gr` rows, every persisted column — see the classic add node
`add_node_nGMSu41b` field list), `source` FORM.
1. Guard → facts (parallel SQL): job by key, stored GR + lines (Edit), open COMPLETE_GR jobs of the GR, items of the
   payload (flags, UOM conversions + `over_receive_tolerance`, `receiving_inspection`, serial / batch management),
   the payload's PO lines (+ headers), putaway_setup (org + plant, no movement_type filter — as `get_node_QBrFrLs9`).
2. Entry: STATUS; existing job for the key → its answer; BUSY (open job); stored status not Draft / Created; Created
   with line edits (fingerprint differs) → NOT_ELIGIBLE (> 500 → STOP "Save as Created first").
3. NOT_ELIGIBLE (classic, ≤ 500; > 500 → STOP 400 with the reason): serial items, `temp_hu_data` non-empty, QI
   category or `inspection_required`, hierarchy split Parent / Child (`parent_or_child` Parent with `is_split Yes`, or
   Child), bundles (`item_bundle_id` / children), `skip_putaway`, more than the line cap.
4. Gates lifted from GOODS_RECEIVING in its order (same codes, same texts): `code_node_mlTvKeIR` 401 zero qty;
   `code_node_4r2Fv9G5` 400 fill-back (it also formats decimals with q8, drops zero rows, normalizes
   base_received_qty on equal-UOM rows, stamps header fields on lines, sets line_index, derives saveAs Completed /
   Received); CHECK_REQUIRED_FIELD's check in-process (`code_node_wMQADp4i` field list: gr_no, gr_date, plant_id;
   per row item_batch_no, inv_category); `code_node_Ga3BZDyy` 400 location / category; `code_node_e9pINRwN` 400
   over-receive / UOM.
5. Writes. Add: job QUEUED (+120 s) → GR header + lines in ONE add (`gr_status 'Processing'`, `gr_no 'issued'` unless
   `gr_no_type = -9999`, `gr_v2_job_id`, `previous_status 'Draft'`) → read back by `gr_v2_job_id` → LOCK
   `GRC|<gr_id>`/`LOCK|1` → job: correlation / causation, due now → read back. Edit: LOCK `GRC|<id>`/`LOCK|n+1` → job
   QUEUED (+120 s) → GR update (Processing, gr_v2_job_id, previous_status; lines too for a Draft; gr_no 'issued' for
   a Draft unless the stored number was issued by this GR's last V2 job) → read back → job due now.
6. Answer QUEUED + gr_id + gr_no.

## PREPARE (one call per job)

Guard → job SQL → entry (VALIDATING under a live lease; the GR found by correlation, else by `gr_v2_job_id = job id`
— a SUBMIT that died before linking) → parallel SQL reads (no caps):

| key | rows |
|---|---|
| hdr | the GR header (every schema field the plan reads) |
| lines | its lines, id order (every persisted column) |
| pol | PO lines of its `po_line_item_id`s (+ `purchase_order_id`) and their PO headers' lines (for PO status) |
| poh | its PO headers (po_status, gr_status, partially_received, fully_received, exchange_rate, purchase_order_no, currency) |
| oo | on_order_purchase_order rows of its PO line ids (`po_line_id IN`) |
| items | Item flags + `table_uom_conversion` (alt_uom_id, base_qty, over_receive_tolerance) + costing method + batch generation mode + category / group ids |
| setup | putaway_setup (org + plant) + the plant's default Loading Bay storage location's default bin + Putaway numbering rule (business_type, department_id = firstLvDept) |
| bnc | batch_number_config rows of the organization (all levels) |
| batches | existing `batch` rows by (batch_number, material, plant, org) for the manual numbers |
| lock | the GR's latest LOCK row |

Plan node (lifted bodies run as functions; only SQL rows in, one compact manifest out) → manifest parts (≤ ~1 MB per
`gd_publish_step` part row `P|<nonce>|<PART>|<nnn>`, as GDC) → READY_TO_COMMIT or FAILED (+ unlock).
INVENTORY_BULK_APPLY PLAN is optional (GR ADDs only fail on DUPLICATE_BALANCE / VALIDATION).

### Manifest (the plan core's output contract)

```
{
  v: 1, grId, grNo, organizationId, plantId, saveAs: "Completed"|"Received", lineCount,
  gr: { header patch for C5: gr_status, putaway_status },
  batches: {                       // C1
    configs: [{ id, before: {running_number, last_reset_date}, count }],   // auto numbers per config (replayed in COMMIT)
    rows: [{ key, line_id, material_id, plant_id, organization_id, batch_number|null (null = auto, numbered in C1),
             config_id|null, initial_quantity, transaction_no: grNo, remark, remark2, remark3,
             manufacturing_date, expired_date, existing_batch_id|null }],
  },
  movements: [ { movement_key, direction:"ADD", plant_id, organization_id, material_id, quantity, material_uom,
                 unit_price, po_quantity, po_amount, exchange_rate, transaction_type:"GRN", trx_no: grNo,
                 parent_trx_no: <po no>, inventory_category, location_id, batch_ref (a batches.rows key) | batch_id,
                 manufacturing_date, expired_date, doc_date: gr_date, isMovingInv: 0, handling_unit_id: null,
                 remark, remark2, remark3 } ],         // ADD_INVENTORY's parameter set (GRsave code_node_ip8w2l8k)
  poLines: [{ id, po_id, delta_received, release_created }],   // C3 applies to a fresh read
  onOrder: [{ po_line_id, delta_base }],                       // C3: received += delta, open = max(0, open - delta)
  poIds: [ ... ],                                              // C3 recomputes PO headers (code_node_KAeXsqwm)
  putaway: null | { header: {to_status, plant_id, to_id:'issued', to_id_type, movement_type, ref_doc_type, gr_no: grId,
                    receiving_no: grNo, supplier_id, assigned_to, created_by, created_at, organization_id, project_id},
                    lines: [ ... table_putaway_item rows, price/total from the movement results ... ] },  // C4
  inTransit: [ { line_id, ...add_node_ITrows columns } ],      // C4 (target_doc_* = the TO)
  itemDates: [{ id, last_transaction_date }],                   // C5
}
```

## COMMIT

| Step | Writes | Rerun / check |
|---|---|---|
| C0_REVALIDATE | PO locks `PO|<po_id>` (INVENTORY_LOCK_TOKENS, sorted; busy → retry) | GR Processing under this job; `code_node_e9pINRwN` over-receive on FRESH PO rows; else FAILED + unlock |
| C1_BATCHES | fresh bnc read → replay the auto numbers (lifted GENERATE_BATCH) → duplicate pre-check → intent `C1|I|…` → bnc re-read (moved → recompute) → absolute bnc write → `batch` rows (ADD_INVENTORY's columns, no parent_transaction_no) → post-insert duplicate check | intent reused; rows found by (number, material, plant, transaction_no) |
| C1B_LINES | GR lines: generated `item_batch_no` by line id (≤ 250/slice) | read back |
| C2_INVENTORY | ENGINE APPLY `GRC|<job>` (batch_id from C1) | **point of no return** → SPLIT; LOCK_BUSY / 409 retry (not REVIEW) |
| C3_PO | POL by id (received_qty, outstanding_quantity clamped, line_status, created_received_qty) from a fresh read per slice; OO (open_qty clamped, received_qty); PO headers (fresh read after the lines); PO locks released | intent rows `C3|I|…` (before / after) |
| C4_PUTAWAY | one TO (lookup `gr_no = GR id` + `is_deleted = 0` first); IT rows (slices; lookup by `doc_line_id` + status ≠ Cancelled) | read back |
| C5_FINISH | GR `gr_status` Completed / Received + `putaway_status` Created / Not Created; Item last_transaction_date (slices); unlock; job COMPLETED | — |

Keys GR_REVERT_COMPLETED reads (must hold): movements trx_no / parent_trx_no = gr_no, batches `transaction_no = gr_no`,
putaway `gr_no = GR id`, in-transit `doc_id = GR id`, FIFO layer ids > GR id.

## Node-data budget

2,000 lines: SUBMIT ≤ ~25 MB (the form payload is inherent: request + guard + add input/output); PREPARE ≤ 20 MB;
each COMMIT run ≤ 20 MB (manifest read in parts, writes in slices).
