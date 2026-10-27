# PO line import: the UOM error names the right unit (2026-10-27)

**Asked by the user:** when an Excel row's UOM is not one of the item's units, the import's error should also say
which unit to use. The base UOM is enough.

**Change:** PO_LINE_IMPORT only, two nodes. The form and its handler are unchanged; the handler already shows each
error as "Row N: message".
- `sql_node_PIitems` also reads the item's base UOM name (`based_uom_name`).
- `code_node_PIresolve`: "UOM X is not a unit of item Y" now ends with ". Use its base UOM PCS (or BOX, CTN)": the base
  UOM, then the item's other units. Without a base UOM name it ends with ". Its units: ...".

Example from dev (v5), as the alert lists it:
- Row 2: UOM KG is not a unit of item MOLLY. Use its base UOM UNIT (or BOX)
- Row 3: UOM BOX is not a unit of item TES510. Use its base UOM UNIT

Tests: `scratchpad/po_import/test/unit.js` passes 43 (39 old + 4 new: base and others, base only, base name from the
item, no base name). The new read was run on dev and on prod (LSH 3005-017: base `包Paket`). Dev v5 published
2026-10-27 11:31 (backup v4 in workflow-backups/dev/PO_LINE_IMPORT/).

## Paste (user)

- Workflow **PO_LINE_IMPORT**, id **`2110564093187756034`**.
- File: `prod-hotfix/2026-10-27-po-import-uom-hint/PO_LINE_IMPORT.prod_paste.json`. It is prod v4 (=
  `PO_LINE_IMPORT.prod_v4_base.json`) plus the two nodes above.
- After the paste: `.dbtools/wf --prod deployed "Purchase Order/LineImport/PO_LINE_IMPORT.json"` must say IDENTICAL.
- The import writes nothing, so no data step.
