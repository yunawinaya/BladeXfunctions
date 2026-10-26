# 2026-10-27 GOODS_DELIVERY: the GD Created V2 guards read only the session tenant's rows

**Status:**
- **Dev:** LIVE, v252 (02:53:35), IDENTICAL to the repo.
- **Prod:** NOT a separate paste. This change is folded into 68's
  `prod-hotfix/2026-10-27-sales-header-cf-gd/1_GOODS_DELIVERY.prod_paste.json` (JSON-identical to `GOODS_DELIVERY.json`
  here, checked 10-27 03:02), so GOODS_DELIVERY is pasted once, with 68's folder. This folder is the record of the change.
- **After that paste:** verify against 68's item 1, not the file here. 68 rebuilt item 1 at 03:11 (a declared-type fix
  in their CfOut nodes; dev v253), so `GOODS_DELIVERY.json` here is the 03:02 snapshot. The two SQL nodes are byte-equal
  in both files and in dev v253 (checked 03:13).
- **If prod ever needs it rebuilt:** `python3 scratchpad/gdc/gdcreate/patch_gd_guard_tenant.py <prod copy> --write`.

## The problem (found by GD Edit & Picking V2, 10-27; live on prod v182)
Two of the guards at the top of the classic GD save read rows by id alone: `sql_node_GdSoGuard` ("a background save of
this SO is unfinished") and `sql_node_GdUomGuard` ("a stock line in a unit its item lacks").
- **The reads:** goods_delivery, gd_async_job, item and unit_of_measurement are read with no tenant filter.
- **The job scan:** it is scoped only by the organization_id the client sends, and falls back to `1 = 1` when that is
  missing.
- **The exposure:** a hand-crafted save naming another tenant's GD, SO or item id gets that tenant's GD status, job id
  or SO number back in the refusal message.
- **The risk is low.** It needs an exact 19-digit id from another tenant, and normal saves only name their own records.

## The change (`scratchpad/gdc/gdcreate/patch_gd_guard_tenant.py`)
- Each of those reads also requires `tenant_id = '{{system:tenantId}}'`, as the third guard (`sql_node_GdProcGuard`)
  already does.
- The organization scope stays. With the tenant filter, its `1 = 1` fallback now covers only the session tenant.
- Only the two SQL strings change; the patch asserts that nothing else in the file differs.

Checked on prod (read-only):
- **Units are per tenant:** 57 tenants each have their own. A unit's name only labels the refusal message.
- **Jobs carry their tenant:** all 1,170 CREATE_GD_FROM_FORM jobs have a tenant_id equal to their sales order's.
- **Same speed:** the job scan keeps its plan (a range on the Lease Recovery index, 7 rows).

## Tests
- **Offline + dev reads:** `node scratchpad/gdc/gdcreate/test/test_gd_guard_tenant.js [file]` passes 8/8 on this file
  and on dev v252, and dev v251 fails the 3 other-tenant cases. It runs the workflow's own guard code and both SQL reads
  on dev (GD/20261023/615, tenant 000000), once as 000000 and once as 496474.
- **Lint:** no new findings.
- **Live on dev v252:** a test save as admin@000000 with a stock line in a unit its item lacks (BAG).
  - The SO check ran and passed, and the unit check refused it before any write.
  - Result: 400 "line 1 (ITM-20260600005-A) is in BAG" (run 2114792750731309058).

