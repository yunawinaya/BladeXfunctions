# PO line import — Excel → Purchase Order lines (dev only)

Built 2026-10-15. An **Import Lines (Excel)** button above the PO line table reads an Excel file and adds its lines
exactly as Batch Add would: same fields, same price lookup, one recalculation. It checks every row first and adds
nothing if any row is wrong. On dev, 2,000 lines are answered in about 10 s (1.4 s of it is the workflow's own run
time). **Prod has none of this.**

| Piece | Role |
|---|---|
| PO_LINE_IMPORT `2110564093187756034` v4 | **writes nothing.** Checks the rows → reads the items, UOM conversions and supplier descriptions (one SQL) → asks GET_ITEM_UNIT_PRICE_BULK for the prices (passing its organization) → answers the lines (`rows`, `alt_uom` once per item, `tax_open`), or `code 400` with every bad row |
| GET_ITEM_UNIT_PRICE_BULK `2110564019682578434` v5 | GET_ITEM_UNIT_PRICE's request / answer, one SQL per price source instead of one call per item (`Purchase Order/GetItemUnitPriceBulk/`); also used by the PO form's Batch Add. v5 adds an optional `organization_id`, used only when the session has no organization: `{{global:firstLvDeptId}}` is empty when another workflow calls it, and v4 then ignored the organization's price sequence |
| `onUpload_poLines.js` | the PO form handler (`onUploadSuccess` of `import_po_lines`) |
| `PO_Line_Import_Template.xlsx` | the template: the header row only |

Built from `scratchpad/po_import/` (`build_po_import.py [--write]` for the workflow, `build_form.py [--write]` for the
form, `make_template.py` for the template).

## Client (published to dev 2026-10-15: PO form v850; v851 hides the button's label)

**PO form** — `Purchase Order/POfullJSON.json` (dev v849 plus the import, label hidden = v851). It adds the upload button above `table_po`
(the platform's `su-fm-excel-parse`, as on the GR form) wired to `onUpload_poLines`, and hides it in View like the
save buttons. Everything else is identical to dev v849.

## The file

Row 1 holds the column names. Their order does not matter, nor do case, spaces or punctuation (`Item Code`,
`item_code` and `ITEM CODE` are the same). Columns the import does not know are ignored, and named in the success
message.

| Column | Required | Notes |
|---|---|---|
| Item Code | yes | matched as the database compares codes (ignoring case and trailing spaces); an exact-case match wins a tie. Also read from `Code`, `Material Code`, `Item` |
| Quantity | yes | above 0; `1,250.5` is read as 1250.5. Also `Qty` |
| UOM | | one of the item's own units, by name. Blank → the item's default purchase UOM, else its base UOM. Also `Unit` |
| Unit Price | | 0 or above. Blank → the price Batch Add would give (purchase history / price tag / default, in the configured order). Also `Price` |
| Discount | | 0 or above; at most 100 when the type is % |
| Discount Type | | `%` (or `percent`) / `Amount` |
| Description | | blank → the supplier's description of the item, else the item's own |
| Remark 1, Remark 2 | | the line remarks. `Remark` / `Remarks` also go to Remark 1 |
| Required Delivery Date | | an Excel date, `2026-10-15`, `15/10/2026` (also with `-` or `.`), `15 Oct 2026` or `Oct 15, 2026` |

Blank rows are skipped. At most 2,500 lines per file. Item bundles are not imported: add them with the line table's
bundle Batch Add, as before.

## What the user sees

- A wrong row stops the whole import. The alert lists each problem with its Excel row number: item not found, matching
  several items, or inactive; a UOM that is not one of the item's units; quantity 0 or not a number; a price,
  discount or date that cannot be read; an item with no purchase UOM and none given. The first 30 are listed, then
  "… and N more". The PO is not changed.
- On a PO with no lines yet (a new PO's empty first row), the lines simply go in.
- On a PO that already has lines, the user chooses **Add after** or **Replace**. Closing the dialog changes nothing.
  If some lines are already received, invoiced or returned, only Add is offered, since those lines cannot be replaced.
- Lines of items that have a purchase tax but no tax code on the line keep Tax Rate editable, as Batch Add leaves them.

## Tested on dev (2026-10-15)

| Test | Result |
|---|---|
| Against the deployed Batch Add (`onConfirm_batchAddItem`) on the same real items and price answer, read-only (`test/dev_parity.py`) | identical rows: 120/120 items; 60/60 with supplier descriptions; 2,000/2,000 (item SQL 0.27 s, prices 0.86 s, answer 724 KB + `alt_uom` 209 KB) |
| The published workflow end to end, 2,000 rows as admin@000000 (`runas.mjs`) | v3: rows built exactly as Batch Add's for the same price answer, but the nested price call ran without the organization (1,692 lines priced from purchase history, not the organization's sequence) → fixed in v4 + price v5. v4: 9.7 s, prices in the organization's sequence, rows identical to Batch Add's |
| Unit (`test/unit.js`) | 39 passed: headers, numbers, dates, discount types, limits, errors, item / UOM matching |
| Form handler in a mocked PO form (`test/client_harness.js`) | 19 passed: new PO, Add after, Replace, closed dialog, lines in use, 400 list (escaped), workflow failure, View |

Not yet tried in the browser.
