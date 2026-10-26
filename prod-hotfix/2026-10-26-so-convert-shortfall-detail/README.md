# SO list Convert to GD: refused lines in detail (2026-10-26)

With auto-create on (Picking Setup `convert_gd_created` = 1, LSH 128671 among others), a bulk convert (Multiple GDs) reported a sales order that GD Created V2 refused for stock as one line, for example: "SO/… — auto allocation: Insufficient stock for item X. Available: A, Requested: R". That is the first refused line only, in the item's base unit. LSH has had 32 such refusals since 10-23 (31 with one line, 1 with three).

The result window now shows, under each refused sales order, a table like the GD form's Insufficient Inventory Alert:

- Columns: Item Code, Item Name, UOM, Order Qty, Undelivered, Remaining Demand, Available, Shortfall.
- Quantities are in the sales order line's unit; serial-numbered items use their base unit, as in the GD form.
- Other refused lines (for example a unit with no conversion) are listed as "Line N (item): message", with unit names instead of ids.
- The first 10 lines show, then "… and N more".
- The window widens only when it shows a table.
- Short sales orders stay unconverted, as before. A note says to convert one on its own to deliver the available quantity in the form.

| # | Prod item | File here | Base on prod |
|---|---|---|---|
| 1 | **GD_SO_CONVERT_CHECK** workflow (2112084100104495105) | `GD_SO_CONVERT_CHECK.json` | v8, identical to dev v8 (checked 10-26) |
| 2 | SO list page (1901872125787099137), event script **`func_handleConvertGD`** | `func_handleConvertGD.js` | v261's handler, identical to dev v535's (checked 10-26) |

**Change 1:** the workflow takes a new optional input, `job_lines`. With `"1"` and `job_ids`, the answer's `job_lines_json` gives each FAILED Created job's first 10 line errors, joined to its payload line (item, unit, quantities).

- Without `job_lines`, the new read is an impossible WHERE and touches no table. The GD form's verdict wait and the GD list's cancel and revert follows get today's answer plus `job_lines_json: "[]"`.
- The item and unit joins are by id from the job's own payload, and the job is read tenant-scoped.

**Change 2:** the convert's follow asks with `job_lines: "1"` and shows the lines. If change 1 is not on prod yet, the page shows today's text, so either order is safe. Paste change 1 first anyway.

## Paste, in this order

1. **GD_SO_CONVERT_CHECK:** paste the JSON into the designer and publish.
2. **SO list page:** open the event script **`func_handleConvertGD`**, replace its whole body with `func_handleConvertGD.js`, then save and publish the page.
   - Do not paste it into **`func_bulkConvertGD`**. That is the button's entry script: it opens the plant dialog and then calls `func_handleConvertGD`, as `onConfirm_selectPlant` also does.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"
# -> deployed as 'GD_SO_CONVERT_CHECK' (id=2112084100104495105), IDENTICAL

python3 scratchpad/soautogd/shortfall/deploy/build_page.py --env prod --old "Goods Delivery/GDhandleConvertSOtoGD.js" \
  --new "Goods Delivery/GDhandleConvertSOtoGD.js" --base-out /tmp/so_list_prod.json
# -> "live handler == Goods Delivery/GDhandleConvertSOtoGD.js"; an AssertionError means the paste did not land there

python3 scratchpad/prod_health.py
```

## Undo

The `RESTORE_*` files are what prod runs now (check v8, page v261's handler). Paste them back the same way.

## Source and tests

- **Dev:** GD_SO_CONVERT_CHECK v9 and SO list v536 (10-27 00:23–00:24 MYT). Both live v8 / v535 were backed up first, and both read-backs match the repo.
  - **Publish smoke** (through dev.mes): dev's refused job 2112387426529939457 came back as P-00002 / POST 2 / PCS, 100000 requested vs 15837 available.
  - **Without `job_lines`:** today's `jobs_json` plus `"[]"`.
  - **Speed:** all three check modes took 70–87 ms, against 66–81 ms before.
- **Check workflow:**
  - `scratchpad/soautogd/shortfall/patch_convert_check_lines.py` builds it.
  - `test_convert_check_lines.js` runs 18 cases.
  - `test_convert_check_lines_sql.py` runs 13 cases, read-only on dev. The edge cases go through a CTE that shadows `gd_async_job`, so the SQL under test is unchanged.
  - Lint shows only CONDITIONAL notes, as v8 does.
  - EXPLAIN uses primary keys throughout.
- **Page:**
  - `test_shortfall_client.js` runs 12 cases.
  - The existing tests still pass: `soautogd/test_client.js`, `gdc/gdcreate/test/test_convert_handler.js` and `test_convert_check_run.js`, and the gdcan and gdrev list tests.
  - The rendering was checked in Element Plus 2.4.4 at 1440 and 800 px (`render_preview.js`).
- **Review:** GD Completed & Created V2, which owns the check and SO_AUTO_GD, reviewed it on 10-26.
- **Not yet done:** a real convert in a browser. On dev, tenant 000000 has auto-create on. Convert SO/20261020-049 together with any other open sales order as Multiple GDs. It should come back with P-00002 / POST 2 / PCS, about 15.8k available against 99,999 remaining demand.
