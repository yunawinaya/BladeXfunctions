# Classic SM_LOCATION_TRANSFER: one 2,000-line Draft on dev (NOT RUN)

**Status: not run.** Testing was cancelled for this release on 2026-10-16. Nothing below has been executed.

## Blocker: the stock rules in the brief cannot all be met on dev tenant 000000
The strict pool has no usable stock, so the generator stops with exit code 3. Using either fallback needs the user's OK, and the session that owns those items should be asked.
- `--pool putaway-items` allows the items on TRF-PA-20261016-0010 and -0011, but only in bins A1-B2, WZP1, WZP2 and 123-456-789-ABC-DEF.
- `--pool a1b1-source` allows A1-B1 as a source bin. This fallback cannot produce a Blocked line or a two-bin line.

## 1. Build the request (read-only), from the repo root
```
python3 scratchpad/smv2/live/build_lot_payload.py --lines 2000 --action Draft --pool putaway-items --qty 0.25 \
  --out scratchpad/smv2/live/out/lot_2000_draft.json --report scratchpad/smv2/live/out/lot_2000_draft.report.json
```
Create `scratchpad/smv2/live/out/` first. This command was checked on 2026-10-16. It produced:
- 2,000 lines: 1,949 plain, 40 batch, 10 two-bin and 1 Blocked.
- 2,010 entries, which is 4,020 engine movements.
- A request of about 4.2 MB.
- No more than 50% of any one balance is used, set by `--max-share 0.5`.

## 2. Run the save once, as junaxanto@000000 through https://dev.mes.sudu.ai/api, from the repo root
```
node scratchpad/gdc/tools/runwf.mjs 2013133675374927874 scratchpad/smv2/live/out/lot_2000_draft.json scratchpad/smv2/live/out/lot_2000_draft.out.json
```
- **What it writes:** the LOT header, 2,000 line rows and the closure rows, plus `item.last_transaction_date` on the items used. That last update is harmless and cannot be undone.
- **What it does not do:** a Draft does not move stock and runs no inventory sub-workflow.
- **Load:** expect the run's node data to be roughly 25-40 MB, because the allData of about 4 MB is copied through several nodes. The dev crashes happened at about 60 MB or more in one synchronous chain, so this is within that but not trivial.

## 3. Read the result back (read-only)
```
.dbtools/wf --dev runs 2013133675374927874 -n 3
.dbtools/db --dev "SELECT CAST(h.id AS CHAR) id, h.stock_movement_no, h.stock_movement_status, h.create_time, (SELECT COUNT(*) FROM sm_location_transfer_d2c7o1jd_sub l WHERE l.sm_location_transfer_id=h.id AND l.is_deleted=0) n_lines FROM sm_location_transfer h WHERE h.tenant_id='000000' ORDER BY h.id DESC LIMIT 3"
.dbtools/db --dev "SELECT status, current_node_id, run_time, LENGTH(request_json_data) req, LENGTH(nodes_data) nodes FROM su_code_workflow_inst WHERE id=<instance id>"
```
A good result is a status of Draft, `n_lines` = 2000, and a draft number assigned by the platform.

## 4. Soft-delete it afterwards (a write: show it and get a yes first)
`su_code_tables.physical_delete` is 0 for `sm_location_transfer` and for its line table, so the CLI delete is logical and cascades to the lines. Run it from the mirror root:
```
cd ~/Documents/ASC-dev/sudu-lowcode-apps/dev/1901532458164277249 && sudu-lowcode --profile dev-write data del "Location Transfer" --id <id> --yes
```
If the CLI cannot be used, use the guarded dev writer instead. It shows a preview first, and needs `--execute` after the yes.
```
.dbtools/dbw "UPDATE sm_location_transfer SET is_deleted=1 WHERE id=<id> AND tenant_id='000000'"
.dbtools/dbw "UPDATE sm_location_transfer_d2c7o1jd_sub SET is_deleted=1 WHERE sm_location_transfer_id=<id>"
```
`sm_location_transfer_d2c7o1jd_sub_closure` also has an `is_deleted` column, joined on `ancestor_id`/`descendant_id` = the line id.
