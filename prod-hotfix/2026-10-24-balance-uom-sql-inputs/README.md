# BALANCE_UOM_CONVERSION: request inputs pasted into the SQL (2026-10-24)

## What is wrong

BALANCE_UOM_CONVERSION (2084199011688968193) backs the Item Balance "UOM" grid. Since v8 (10-22 12:21, dev and prod), its SQL
node `sql_node_Qb7hK2Rx` writes its four request inputs straight into the SQL text: `material_id`, `material_uom`, `balance_type`
and `selected_dept_id`, 18 places in all. A SQL node substitutes placeholders as text before parsing. So a caller who sends a
value containing a quote can change the query: SELECT only, but enough to read other tenants' rows. An automated security
review found it during the 10-24 repo sync.

## Fix

A new code node `code_node_BUguard` runs before the SQL:
- **Ids** (material, UOM, plant): digits pass through, blank stays blank, anything else becomes `0`, which matches no rows.
- **Balance type:** `item_batch_balance`, or else `item_balance`.
- **Missing plant:** becomes `0`, which matches nothing, as the old SQL did when the placeholder turned into the text `null`.

The SQL keeps its quoting and logic. Only its placeholders change, to read the guard's output.

**Why the guard's own inputs are safe.** A second automated review asked whether the platform encodes `{{workflowparams:x}}`
when it substitutes it into code-node source. It does: values arrive as encoded JS / JSON literals. The evidence:
- On prod on 10-24, the DO-FG2610-158 job carried the description `"SAMBAL SHRIMP ROLL (5KG/CTN) 虾米卷"`, double quotes included.
  It went through GD_ASYNC_SUBMIT's `[{{workflowparams:...}}][0]` code nodes, was stored escaped (`\"SAMBAL`), and the job COMPLETED.
- GOODS_DELIVERY reads its whole form the same way in 14 code nodes.
- On dev, an injection-style `material_id` (`...' OR '1'='1`) ran through the guard cleanly and came out as `0`.

A SQL node is different: there a placeholder is plain text.

Same behaviour, checked:
- **Real runs:** all 37 prod v8 runs (10-22 to 10-24), replayed through the guard, give byte-identical SQL text.
- **Tests:** `scratchpad/balance_uom_guard/test_guard.js` covers real-shaped inputs (same SQL as before), hostile and missing
  inputs (no caller text reaches the SQL), and the declared outputs. `scratchpad/validate.py` is clean.
- **Rebuild:** `scratchpad/balance_uom_guard/patch.py` makes the change.

## Dev: DONE (v9, 14:10:08, IDENTICAL to the repo)

Live check, two runs as the CLI user in tenant 000000, material JN-WA-01:
- **Normal call** (run 2113875954768334849): the guard passed every id through, and the SQL returned 8 balance rows.
- **`material_id` = `...' OR '1'='1`** (run 2113875957385580546): the guard output `0`, so the SQL ran with `'0'`. No caller
  text reached it, and it returned no rows.

## Prod

Paste `BALANCE_UOM_CONVERSION.prod_v8_guard.json` into **BALANCE_UOM_CONVERSION** (id 2084199011688968193), then enable it.
Check the name: UPDATE_BALANCE_TABLE, PROCESS_HU_BALANCE and the `*_FETCH_UOM` workflows are other workflows.

It is prod v8 exactly plus the guard. It is node for node the same as the repo's `Balance Table/BalanceUOMConversionWorkflow.json`.
`BALANCE_UOM_CONVERSION.prod_v8_live.json` is what prod runs now. It is kept only to reverse the change.

## Check after pasting

```
.dbtools/wf --prod deployed "Balance Table/BalanceUOMConversionWorkflow.json"   # IDENTICAL
```

Then open an Item Balance record, go to the UOM tab and pick a UOM. The grid fills as before.

## Not changed here

Three more repo workflows put raw request inputs into SQL:
- `Customer Statement/CSgenerateFilterWorkflow.json`;
- `Item/ItemBulkImportWorkflow.json` (`organization_id`);
- `Balance Table/WorkflowExample.json`.
