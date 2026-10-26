# PURCHASE_RETURN: returns from Blocked / Reserved / QI stock refused as "Unrestricted" (2026-10-26)

**Reported:** LSH (tenant 128671) PR-2610-0014 (`2114539055764082690`). Users chose stock in Blocked, and Completed was
refused with "Insufficient stock for item 3005-017 (Unrestricted). Available: 0, Requested: 4". Six attempts were made,
10:11-10:16.

**Cause:** the workflow, not the form. The form sends the right category: `temp_qty_data[].inventory_category =
"Blocked"`. PURCHASE_RETURN's stock check `workflow_node_oSKZaqxU` ("Check Inventory") calls
GLOBAL_INVENTORY_VALIDATION (`2056291728334573570`) with the category parameter named **`" category"`, with a leading
space**. The child reads `{{workflowparams:category}} || "Unrestricted"`, so every return was checked against
Unrestricted. The typo is in every version back to at least v9 (2026-07-23). The stock step itself (SUBTRACT_INVENTORY,
`inventory_category`) was always right. Prod refusals at that check since 10-14: LSH 27 (10-17 to 10-26), 605249 1.
No other live workflow has a parameter name starting with a space.

**Fix:** one rename, `" category"` → `"category"` (prop and propLabel), built on prod's live v16 (= dev v16 = repo).
Proof on dev, 000000, a batch with 5 Blocked and 0 Unrestricted: the check with `" category"` refuses ("Unrestricted",
0 available), with `"category"` it passes (5). Dev v17 was published 2026-10-26 10:24 (backup v16 in
workflow-backups/dev/PURCHASE_RETURN/).

## Paste (user)

- Workflow **PURCHASE_RETURN**, id **`2066433188188499969`**. Not PRT_CANCEL, not purchase_return_line.
- File: `prod-hotfix/2026-10-26-prt-blocked-category/PURCHASE_RETURN.prod_paste.json`. It is prod v16 with only that
  rename (`PURCHASE_RETURN.prod_v16_base.json` is the base).
- After the paste: `.dbtools/wf --prod deployed "Purchase Return/PRTsaveWorkflow.json"` must say IDENTICAL.

## After the paste

- No data repair. The check runs before any write, so the refused attempts wrote nothing. PR-2610-0014 is untouched in
  Created; the user clicks Completed again.
- Other returns refused the same way since 10-17 can be completed the same way.
