# GD Completion V2 — async Save as Completed (dev only)

Built 2026-10-13/14. A Goods Delivery is completed in the background, in steps that each verify what they
wrote. A 1,948-line delivery completes in ~84 s on dev. The classic path took dev down at 2,000 lines.
**Prod has none of this.**

| Workflow (dev id) | Role |
|---|---|
| GD_COMPLETE_SUBMIT `2110182609618337794` | runs GOODS_DELIVERY's gates in its order (same codes, same texts), then queues: lock row + `COMPLETE_GD` job + `gd_status = 'Processing'`. `operation: STATUS` reports the latest job |
| GD_COMPLETE_WORKER `2110182645714518018` | claims due jobs (≤ 5 per tick), calls PREPARE then COMMIT (twice: COMMIT splits) |
| GD_COMPLETE_PREPARE `2110182689117175810` | set-based reads + GOODS_DELIVERY / GD_UNUSED_FN_NEW code (copied verbatim) + INVENTORY_BULK_APPLY in PLAN mode → the prepared payload |
| GD_COMPLETE_COMMIT `2110182729927753730` | C0 revalidate · C1 snapshot (GD_COMPLETION_SNAPSHOT, so Revert Completed works) · C2 inventory (INVENTORY_BULK_APPLY, all-or-nothing) · C3 reservations · C4 sales orders · C5 the delivery (Completed) · C6 item dates, reorder, auto-SI |
| INVENTORY_BULK_APPLY `2109916822821744641` | general set-based SUBTRACT/ADD engine (Balance Table/) |

Built from `scratchpad/gdc/` (`python3 scratchpad/gdc/build_gdc.py --write`, all four at once).
Published with `.dbtools/wf_upload.mjs`. Each Edit save of GOODS_DELIVERY (v241) first checks the stored status,
and refuses the save while a delivery is `Processing`.

## What goes async

Everything the Completed button / list Complete sends, except (these run the classic save, unchanged):
- a Draft or a new delivery; force-completing an In Progress Picking (406);
- unsaved edits on the form (any column the classic save writes; `gd_undelivered_qty` is carried instead);
- serial-numbered items, a delivery from a Picking Plan, internal-trading auto-GR, lines needing auto-allocation;
- **handling-unit allocations** (`temp_qty_data.handling_unit_id`, `temp_hu_data`) and **Picking-record stamps**
  (`picking_record_id`): not built yet (C3H / C3P).

Above 500 lines these are refused with the reason, since the classic save cannot carry them.

## Client (paste into the dev designer)

1. **GD form** — add an event script `gdc_onClick_save_as_completed` = `gdc_onClick_save_as_completed.js`; set
   `button_save_as_completed` → onClick → it. Keep `onClick_save_as_completed`: it is the classic fallback.
2. **GD list page** (built on dev v391) — replace `func_bulkComplete` with `gdc_list_func_bulkComplete.js` and
   `mounted` with `gdc_list_mounted.js`.

Switch: `ASYNC_COMPLETE_ENABLED` at the top of both handlers (`false` = classic everywhere). There is no Quartz
schedule (user decision: cost). The worker runs when the form queues a job, when bulk Complete queues jobs (it keeps
ticking while ticks find work), and when the list opens (at most every 2 minutes per browser).

## Deliberate differences from the classic completion

- `delivery_cost` is kept; the classic re-save blanks it from a `driver_cost` field the form never sends.
- Header columns stored as `""` stay `""`; the classic re-save turns them into NULL.
- Inventory movements carry `operation_effect_key` (`GDC|<job>|<movement>`); the engine replays safely.
- All open FIFO layers are read (SUBTRACT read 100); a stock shortfall fails the job before anything moves.

## Tested on dev (tenant 711077, 2026-10-14)

| Test | Result |
|---|---|
| /004 classic vs /005 V2 (twins) | identical changes in every table, apart from the deliberate differences above |
| /002, 973 lines (2 bundles) | 57.7 s, one worker tick; reservations, balances, FIFO, movements, SO lines reconciled |
| /001, 1,948 lines | 83.6 s; same checks; largest run 20.8 MB node data (cap 64 MB) |
| Revert Completed of /005 | back to the pre-completion state (reservations, SO header, balances) |
| GOODS_DELIVERY guard | save of a Processing delivery refused, nothing written; normal completion unaffected |

Run them again with the `running-dev-workflows-as-tenant` skill, plus `scratchpad/gdc/test/snap.py`,
`diff_twins.py` and `check_one.py`.
