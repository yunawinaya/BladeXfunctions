# FIX03_05 - Platform facts: workflow authorisation and Item Assembly change history

Researched 2026-10-21, DEV only, read-only (DB SELECTs, the decompiled app mirror, the engine docs, repo JSON). Nothing
was published, written or minted.

Labels: **VERIFIED** = seen in DB rows or run traces; **DOC** = stated in `.su-code/docs`; **INFERRED** = follows from
verified data, but the platform code was not seen; **UNVERIFIED** = open.

Paths used below: `DOCS` = `~/Documents/ASC-dev/sudu-lowcode-apps/dev/1901532458164277249/.su-code/docs`, `MIRROR` =
`~/Documents/ASC-dev/sudu-lowcode-apps/dev/1901532458164277249`.

---

## A1. What the platform checks when a form or page calls `this.runWorkflow(id, params)`

**It checks that the caller is logged in. Nothing else was found: no check on roles, menus, buttons or the workflow itself.**

| Possible check | Finding | Evidence |
|---|---|---|
| Login (token) | The request carries the `Blade-Auth: bearer <JWT>` header to `POST /su-code-workflow/workflow/run/{id}`. The caller's identity comes from the token's claims. | `scratchpad/gdc/tools/runwf.mjs` ("Run a DEV workflow the way a form does"); run `context` JSON holds only `tenant_id` and `user_id` from the token (runs 2112487160207769601 and 2112477518886993922) |
| Token issuer | On DEV, su-code accepted self-minted JWTs carrying any `user_id`, `dept_id` or `role_id`. The platform does not check that the user exists: a made-up `user_id` is written as an orphan `create_user`. `blade-system` refuses these tokens, but su-code accepts them. | `.claude/skills/running-dev-workflows-as-tenant/SKILL.md` (Common mistakes table); CLI audit log `~/.local/share/sudu-lowcode/audit.jsonl`, `minted:*` entries on 2026-10-15 matching su-code runs |
| Run permission per workflow | **None exists.** The docs say: "2.x 只维护表与视图权限，不提供工作流 Run 或接口 Call 权限" (2.x only maintains table and view permissions; there is no workflow-run or API-call permission). | `DOCS/permission/README.md`, resource contract section |
| Settings on the workflow | `su_code_workflow` has 34 columns and none of them is about auth, roles or permissions. `config` is `{}` on 351 rows and NULL on 185, so no workflow has any config. Both new workflows: `type=Workflow`, `run_type=Api`, `config={}`, `status=1`, `tenant_id=000000`. The repo JSON has `config: {}`, and the start node holds only title and name. | DESC of `su_code_workflow`; `GROUP BY config` query; `SO_IA_PROJECTION.json` and `IA_SC_RELINK.json` |
| Tenant or app ownership | The workflow rows belong to tenant `000000`, yet they run with each caller's own tenant (157944, 496474, 627085, 711077, 277737, 239760...). Every tenant user who can reach the app can run every published workflow of the app by its id. | `su_code_workflow_inst.tenant_id` of the runs; whether a tenant *without* the app can run them is UNVERIFIED |
| Button or menu permission | Checked **in the browser only**. A button with `permission: "<menu code>"` is hidden when the user lacks that code, but the workflow endpoint behind it is not protected. The SO row buttons "Create IA" and "Linked IAs" carry `permission: so_item_create_ia` and `so_item_linked_ias` (see A4). | `DOCS/component/components/button.md` (`permission`: "当前用户无该权限时隐藏整个按钮", i.e. the whole button is hidden when the user lacks the permission); `Item Assembly & BOM/SmallCycle/SOform.json` |
| Low-code data permissions (`su_code_permission`, 22 live rows on dev) | These apply per table and per tenant to the table data paths (`db` SDK, list pages): operations, row scope and field scope. The docs do not say whether workflow get, search or update nodes apply them for the caller (UNVERIFIED). An **sql-node is raw SQL**, so no permission layer applies. **No rule targets `sm_item_assembly` (2098256587713404929) or `sales_order` in tenant 000000**, and a table with no rule is fully open ("表没有任何权限记录 = 完全放开", i.e. a table with no permission record is completely open). | `DOCS/permission/README.md` (fail-open section); `su_code_permission` rows (tenants 239760, 627085, 640701 plus two test rows in 000000) |
| BladeX API scope (接口权限) | Not configured: `blade_scope_api` has 0 rows. | `SELECT COUNT(*) FROM blade_scope_api` |
| BladeX data scope (数据权限) | 1 live row, for the Purchase Order menu ("本人可见", self only, on `create_user`), linked through `blade_role_scope` to role 1912697471623299073. It is menu or resource based, and nothing links it to workflows. | `blade_scope_data`, `blade_role_scope` |
| Client contract | `runWorkflow` rejects when the workflow is "未发布、无权限或执行失败" (not published, no permission, or failed). No per-workflow permission setting exists, so "no permission" here most likely means an auth or disabled-workflow failure (INFERRED). | `DOCS/runtime/functions/form.runWorkflow.md` |

**Paths that bypass any guard inside a workflow** (the designer must consider these):
- The data SDK (`db.collection('sm_item_assembly').doc(id).update({...})`) can write IA rows directly. Because the IA table has no permission rules, the documented behaviour is "open", so a guard in IA_SC_RELINK does not stop a direct update (DOC plus fail-open; not tested live).
- `POST /su-code-workflow/workflow/doTest/{id}` runs **any FlowGram JSON sent in the request**, as the caller (used by `dotest.mjs`, `runas.mjs --test` and `sudu-lowcode workflow test`). Whether it is limited to developers is UNVERIFIED.

## A2. Variables that identify the caller inside a workflow

The docs list these system keys: `uid`, `roleIds`, `deptIds`, `now`, `tenantId`, `nickname` (`DOCS/workflow/syntax/references.md`). `uuid` also works. The permission filters have their own closed set of 10 keys (`DOCS/permission/README.md`). The `{{global:*}}` keys `firstLvDeptId`, `deptParentId`, `deptIdList` and `nickname` are **not** rows in `su_code_global_var`; the only live row there is "Tenant ID". They are platform-provided.

Use in the app's 479 live workflows: `{{system:tenantId}}` 126, `{{system:deptIds}}` 112, `{{system:uid}}` 48, `{{global:firstLvDeptId}}` 31, `{{system:nickname}}` 2, `{{system:roleIds}}` **0**.

What each resolves to. Values come from the `variableMap` in `su_code_workflow_inst.nodes_data`; a placeholder that cannot be resolved is dropped from the map, and in sql-nodes it becomes the literal `null`.

| Variable | Value | Direct (form or page) | Nested (workflow-node) | CLI (junaxanto@000000) | Self-minted token |
|---|---|---|---|---|---|
| `{{system:tenantId}}` | token tenant, e.g. `"157944"` | VERIFIED | VERIFIED: GD_BULK_COMMIT 2112425791807655938, nested in the GD_ASYNC_WORKER loop, got `"157944"` | VERIFIED `"000000"` | VERIFIED (the identity's tenant) |
| `{{system:uid}}` | token user id | VERIFIED | VERIFIED: GD_Convert_SI 2110962848833339394 and 2111007836971597825, nested in GOODS_DELIVERY, got the browser user's id | VERIFIED 2109866916722085890 (IA_SC_RELINK run 2112477518886993922) | = the minted `user_id` (not checked against blade_user) |
| `{{system:deptIds}}` | **JSON array of strings** = the token's dept list; its first element = `create_dept` | VERIFIED: admin@000000 browser `["1123598813738675201"]`; admin@277737 `[4 ids spanning 2 organisations]` (ATC_SYNC_* runs 2112731959691182081 and 2112398549262110721) | INFERRED same | INFERRED | = the minted `dept_id` list |
| `{{system:roleIds}}` | token role list | UNVERIFIED (no app workflow uses it) | | | |
| `{{global:firstLvDeptId}}` | **the organisation (top-level dept, `parent_id=0`) of the token's first or current dept.** When that dept is a plant, the parent organisation is returned. **NULL when that dept is deleted.** | VERIFIED | VERIFIED: CHECK_APPROVAL 2112425356308877313, nested in SO_SAVE `workflow_node_yxaOreDk`, resolved `2098239805212581889`; GD_Convert_SI nested in GOODS_DELIVERY resolved `1123598813738675201` | VERIFIED `1123598813738675201` | NULL for `id000000.json` (its first dept, 1996481727282352129 "MES Product", is deleted) |
| `{{global:nickname}}` | null in workflows | VERIFIED earlier (memory note `project_lowcode_global_vars_in_workflow.md`) | | | |
| `{{global:deptIdList}}` | not resolved in workflows | memory note `project_lowcode_sql_node.md` | | | |
| `{{global:deptParentId}}` | UNVERIFIED server-side. It is a page global; the client uses it as the organisation. | | | | |
| `{{system:now}}`, `{{system:uuid}}` | `"2026-10-20 14:07:06.736"`; a random UUID | VERIFIED | VERIFIED (uuid in GD_BULK_COMMIT) | | |

How `firstLvDeptId` is derived (INFERRED from 400 REORDER_SET_REDIS runs and 40 GET_ITEM_UNIT_PRICE_BULK runs):
- Wherever it was null, `create_dept` was 1996481727282352129, the deleted first dept of the minted admin@000000 token. That pattern covered 24 runs plus the memory note's "nested" case 2110660257863217154.
- Runs with `create_dept` 1942795438353035266 (Testing Plant 1) resolved to its parent 1901545950162329602 (15 runs).
- The claim `detail.first_lv_dept_id` that runas puts into the token is **not** what the platform reads: it was present in id000000.json, and the result was still null.
- **Correction:** the memory note's statement that the value is "EMPTY when nested" is wrong as a rule. Nested browser runs resolve it. The failing case was the minted token, not the nesting.

Other identity facts:
- Every nested or chained run gets its own `su_code_workflow_inst` row, and its `create_user`, `create_user_name`, `create_dept` and `tenant_id` are those of the **original caller**. Example: GD_ASYNC_SUBMIT → GD_ASYNC_WORKER → GD_BULK_PREPARE/COMMIT are all admin@157944 with dept 2098239805212581889. VERIFIED.
- The platform data layer stamps system columns from the session: `create_user {$env: uid, update:false}`, `create_dept {$env: did}`, `create_time {$env: now}`, `tenant_id {$env: tid}`, `update_user {$env: uid}`, `update_time {$env: now, update:true}`. `organization_id` is a **plain field** with no session default. Source: IA `schema_json` (su_code_tables 2098256587713404929). VERIFIED.
- Browser tokens of multi-dept users may carry only the dept chosen at login. admin@000000 has 11 depts in `id000000.json`, which the skill says is copied from blade_user, but its browser runs show `deptIds ["1123598813738675201"]`. INFERRED: the login picks a dept.

## A3. Checking that the caller may see an organisation's records

**Data model (VERIFIED on dev):**
- An organisation is a `blade_dept` row with `parent_id = 0` and `ancestors = '0'`. 123 live depts are depth 1 (122 of them `dept_category = 1`). Plants or departments are depth-2 children (`ancestors = '0,<org>'`), 128 of them; there is one depth-3 dept.
- `organization_id` on business tables is that dept id. Grouping SO `organization_id` by dept: every value is a `parent_id=0` dept. Note that 916 ASAI-org SOs sit in other tenants, so **always filter `tenant_id` as well**.
- User to dept: `blade_user.dept_id` holds a comma-separated list (varchar 1000) and `role_id` likewise. The junction `blade_user_dept(user_id, dept_id, is_deleted)` agrees with the CSV count for all 322 live users. `blade_user.dept_ids` (json) is NULL for everyone.
- 190 of 322 users have more than one dept. 264 belong to 1 organisation, **25 to 2 and 1 to 4**. 43 user-dept links point to deleted depts, and 2 links cross tenants.
- The docs: query blade_* tables only with an explicit `tenant_id`, and match multi-value columns with `FIND_IN_SET(?, dept_id) > 0` (`DOCS/workflow/sdk/sql.md`, section on platform base tables). `personnelScope()` cannot run inside an apiFlow (LOCAL_ATOMIC) transaction: it returns 400 "local_atomic 事务内禁止调用 BladeX master 服务" (BladeX master services may not be called inside a local_atomic transaction), so use SQL instead (DOC).

**How workflows in this app scope by organisation today:**
1. **Organisation supplied by the caller, tenant and user from the session (most workflows).** SO_IA_PROJECTION and IA_SC_RELINK take `organization_id` as a param; their guards only check digits and `{{system:tenantId}}`. In IA_SAVE (`code_node_SCin`), IA_V2_SUBMIT ("the form's organization, session tenant + user") and GD_ASYNC_SUBMIT, the organisation comes from the form payload. The client computes it as `getVarGlobal("deptParentId")`, or `getVarSystem("deptIds").split(",")[0]` when that is "0" (e.g. `iaForm_mounted.js:311`). The SO Linked IAs page passes the SO's `organization_id` as a page param (`page_sli_load.js:55`).
2. **Organisation from the session.** CHECK_APPROVAL get-node `organization_id numberEqual {{global:firstLvDeptId}}`. `Balance Table/BalanceUOMConversionWorkflow.json` SQL `ib.organization_id = '{{global:firstLvDeptId}}'`. GET_ITEM_UNIT_PRICE_BULK v5 uses the global, falling back to the param when the global is not a valid id. AC_GLOB_FETCH_ORG (1985968882749558786) and SQL_ACC_FIND_ORG (2000498617847713794) use a get-node on `blade_dept` with `id = {{system:deptIds}}`, then `parent_id == 0 ? {{system:deptIds}}[0] : parent_id`.
3. **A real membership check (the only one found):** INVENTORY_APPLY_OPERATION (2105133980371554305), `sql_node_U1SF0De4` "Permission: organization, plant and requesting user" plus `code_node_zyCoUNH0`:
   - `org_ok` = the organisation is a live `parent_id=0` dept of the session tenant;
   - `plant_ok` = the plant is that organisation or a direct child of it;
   - `user_depts` = `blade_user.dept_id` of `requested_by` in the tenant;
   - it rejects `PERMISSION_DENIED` unless the user is live and the CSV contains the organisation **or** the plant (exact membership).
   - In GD V2, `requested_by` = `job.create_user`, which the platform stamped from the submitting session (GD_BULK_PREPARE: `requestedBy: s(job.create_user)`). So the identity chain never trusts a client param.
   - Caution: it skips the organisation, plant and user-assignment checks when `organization_id = "0"` (test mode). Do not copy that bypass into a public workflow.

**Ways to check an organisation server-side** (facts for the designer; ids must pass a digits guard *before* use, because FlowGram sql-node placeholders are substituted as raw text):
- (a) `organization_id == {{global:firstLvDeptId}}`. This costs no reads. It refuses when the value is null (deleted first dept, minted token). For multi-organisation users it allows only the organisation of the token's current or first dept. That matches the client's `deptParentId` for 2-level trees, but not for the depth-3 dept.
- (b) An SQL membership check, joined into one of the reads the workflow already does:
  `blade_user u` (`u.tenant_id = <session tenant>`, `u.id = {{system:uid}}`, `u.is_deleted = 0`) JOIN `blade_dept d` ON `FIND_IN_SET(CAST(d.id AS CHAR), u.dept_id) > 0 AND d.tenant_id = u.tenant_id AND d.is_deleted = 0`, with `d.id = <org> OR FIND_IN_SET('<org>', d.ancestors) > 0`. Return a 1/0 number: an sql-node `boolean` output is only true for the string `'true'` (`DOCS/workflow/sdk/sql.md`). The semantics are "the user is assigned to the organisation or any of its plants". The engine itself uses the stricter "the organisation or this specific plant".

## A4. Checking a button or menu permission from a workflow

- **The platform has no primitive for it** (nothing in `DOCS/workflow/sdk.md`). No app workflow reads `blade_role_menu`, and none uses `{{system:roleIds}}`.
- An sql-node can read blade_* tables (VERIFIED: "Setup User" 2063879331723259906 reads `blade_dept` and `blade_role`; the engine reads `blade_user` and `blade_dept`), so the check can be rebuilt in SQL:
  - Tables: `blade_menu` (button rows have `category = 2`, matched on `code`) and `blade_role_menu(menu_id, role_id, is_deleted)`. The user's roles come from `blade_user.role_id` (CSV) or from `{{system:roleIds}}`.
  - **Note:** the `blade_role_menu.tenant_id` was `000000` even for roles of tenant 711077, so do not filter on it.
  - **Super-admin bypass:** role_alias `administrator` (role 1123598816738675201, held by 13 users, including admin@000000). That is the only way tenant-000000 users see the SO buttons today.
  - Tenant packages (`blade_tenant.package_id` → `blade_tenant_package.menu_id` text) may further limit the menus. That is standard BladeX behaviour, UNVERIFIED here.
- The relevant codes on dev:
  - `so_item_create_ia` (2112451752037027841) and `so_item_linked_ias` (2112451482636881921), under the Sales Order menu 1901872116714840066. They are granted only to roles 2105190589038759937 and 2107772548265476098 (tenant 711077).
  - The IA menu 2098312072972783618 has `ia_add`, `ia_edit`, `ia_view`, `ia_delete`, `ia_post`, `ia_revert`, `ia_save_draft`, `ia_save_completed`, `ia_save_completed_post` and `ia_save_post`. There is **no code for relink**; the IA form uses only the 4 `ia_save_*` codes.

---

## B5. Change log or audit trail that the platform already keeps

**Yes: the platform has a per-field "记录修改历史" (record change history) setting, and it records writes made by workflows.**

How it is configured (DOC: `DOCS/component/common/field-interaction-extend.md`): `<SuField ... history />` sets `options.history: true` in the form JSON and `historyKey: true` in `schema_json`. The setting is per field and is applied by the backend. A subform gets its own history table, keyed on the line id. Tables are registered in `su_code_tables` with `table_type = 'history'`, for example `sales_order_history` 1904538875368153090 and `sales_order_axszx8cj_sub_history` 2031182266363510785.

Columns (VERIFIED on `sales_order_history`, 166,774 rows from 2025-03-25 to now, no purge seen):
- `id`, `data_id` (the record), `version_number`;
- `update_field` (varchar 5000): a comma list of the *tracked* fields whose value changed;
- `status`: `enabled` = the v1 snapshot taken at creation (`update_field` NULL; 65,714 rows) or `history` = a later change (101,038 rows, v1–v36, `update_field` never NULL);
- `create_user`, `create_dept`, `create_time`, `tenant_id`;
- one column per tracked field, holding the **value written by that operation** (after-value). It is NULL when the field was not in the write payload.
- The before-value is not stored: take it from the previous version that carries the field.
- When a field's history is switched off, its column is kept and renamed `<field>_d_xxxxx`, with the comment "删除时间: …" (time of deletion).

Workflow writes are recorded (VERIFIED):
- SO 2112425357323898881: v1 `enabled` at 14:07:06.835 came from SO_SAVE's add-node (run 2112425354501132290). v2 `history`, `update_field = gd_status`, `gd_status = Created`, `so_status` NULL, at 14:08:54.221, falls inside GD_BULK_COMMIT 2112425791807655938. Its `update_node_Yj1Tp7zh` writes `sales_order {id, gd_status}` only, which explains the NULL `so_status`.
- `create_user` = the run's caller (admin@157944) for all 7 versions, including the nested and async-chain writes.
- Writes made through the form or the `db` SDK use the same data layer and are presumably recorded too (UNVERIFIED).
- **Not recorded:** soft deletes. 12 sampled deleted SO lines have only their v1 row. Writes that leave every tracked field unchanged are not recorded either. Records inserted outside the data layer have no `enabled` baseline (their first change becomes `history` v1).

It can be queried:
- with an sql-node on the physical table;
- with the `su-fm-edit-history` component (`table-id` + `data-id`, which shows modifier, time and old/new values from the server's "修改记录分页服务", the change-record paging service; DOC `DOCS/component/components/su-fm-edit-history.md`). The repo uses this component nowhere.
- through get or search nodes on the registered history table (UNVERIFIED).

**Item Assembly today: nothing is tracked.**
- The live IA form (`su_code_tables` 2098256587713404929) has 0 `"history":true`, 2 `false`, and 0 `historyKey:true`. The same holds for `sm_item_assembly_tlm8ve69_sub`. There is no `sm_item_assembly*_history` table.
- All 72 IA properties, including `source_so_id`, `source_so_line_id`, `source_so_context_json`, `planned_output_qty`, `bom_consumption_mode`, `item_qty` and `item_assembly_status`, have `historyKey=false`.
- Turning it on means republishing the IA form. The memory index says "NEVER republish AsyncV2 IA_SAVE/SUBMIT/IAform", so that is the owner's decision.

Other logs, all unsuitable as a durable audit trail:
- **`su_code_workflow_inst`**: one row per run, with `create_user`, `create_user_name`, `create_dept`, `tenant_id`, `request_json_data`, `context.workflowparams`, `response_json_data`, `error_msg`, and `nodes_data` (per-node input and output). It is incomplete: nodes inside loops are not recorded, and in GD_BULK_COMMIT 2112425791807655938 a top-level update-node (`update_node_FpPGkiqt`, the lease claim) is missing, as are the condition nodes and every write node inside them. There is also a server file log (`log_file_path` `/app/logs/workflow/<date>/<id>.log`). Dev rows start 2026-08-18 (the date the DB was built); prod retention is unknown. It records the inputs, not row before/after values.
- **`blade_log_api`**: the BladeX log of annotated APIs. Since September only `progress/get` and i18n entries appear; the `add/update/...` data entries stopped on 2025-12-18.
- **`blade_log_usual`**: 0 rows. **`blade_log_error`**: exceptions only.
- **`su_code_{workflow,pages,tables,components}_history`**: versions of design assets, not data.
- `act_*` tables: Flowable approval history.
- `po_history`, `so_history`, `si_history`, `sqt_history`, `preq_history` (+ `_line_`) are **VIEWs** (for example sales lines joined to items), not audit tables.
- `update_user` and `update_time` on each row: only the last writer.

## B6. The app's pattern for a history table written by workflows

There is no generic audit table. The pattern in use is **a low-code table, registered in `su_code_tables`, that workflows append to with add-nodes.** The platform stamps `create_user`, `create_dept`, `create_time` and `tenant_id`, and a unique index makes each entry idempotent. Examples:
- **`gd_publish_step`** (2105131615547461634, 4,238 rows). Columns: `job_id`, `organization_id`, `step_name`, `step_status`, `attempt_count`, `started_at`, `finished_at`, `inventory_operation_id`, `result_ref` longtext, `error_code`, `error_message`. Unique index "Job Step" on (`tenant_id`, `job_id`, `step_name`); non-unique "Step Review" on (`step_status`, `started_at`). An add-node writes STARTED before the step and an update-node writes DONE after the read-back. IA V2 reuses this table through IA_V2_SUBMIT.
- **`inventory_operation`** (2105132166007918593) plus **`inventory_operation_effect`**: one row per operation, with `requested_by`, statuses, phase timestamps, `result_code`, `result_message` and `effect_summary`.
- Both tables were created 2026-09-29/30 by admin@000000; that is the route a new IA change-log table would take.
- `fifo_costing_history` is named "history" but is the live FIFO cost-layer ledger (11 writer workflows), not an audit table.
- **What IA keeps today:** `source_so_context_json.history`, a JSON array of the **last 20** `{op: LINK|RELINK|UNLINK, lineId, orderedQty, at, by}` entries. IA_SAVE (`code_node_SCin`) and IA_SC_RELINK (`code_node_RLcheck`) write it through `update_node_RLia`, the IA row update. It is mutable, capped, inside the row it describes, and a later save can overwrite it. `SMALL_CYCLE_IMPLEMENTATION.md` D11 already notes "The IA has no history mechanism".

---

## Recommendation inputs

1. **The workflows need their own authorisation.** Any logged-in user of any tenant that uses the app can POST either workflow id with any params. Platform permissions only hide buttons, and only table permissions exist; the IA and SO tables have none.
2. **Trust only the session.** Trust `{{system:tenantId}}` and `{{system:uid}}`. Trust `{{global:firstLvDeptId}}` when it is non-null. All three survive nesting and async chains. The `organization_id` param is caller-controlled; today both new workflows only digit-check it.
3. **Two checks already exist in the app:**
   - organisation == `{{global:firstLvDeptId}}` (CHECK_APPROVAL, BalanceUOMConversion): free, but it refuses multi-organisation users outside their current organisation and anyone with a null global;
   - INVENTORY_APPLY_OPERATION's SQL membership check (live organisation of the tenant, plus the user's `blade_user.dept_id` contains the organisation or plant). The membership predicate can be joined into an sql-node the workflow already runs, so it costs no extra fetch.
4. **For IA_SC_RELINK** (a write), the stored IA row's `organization_id` and the SO header's `organization_id` are already read. Check the caller against those stored values, not against the param.
5. **Replicating a button check** in SQL needs `blade_menu.code` plus `blade_role_menu` plus the user's roles, with the `administrator` bypass (and tenant packages, unverified). Today only tenant 711077 roles hold the SC buttons.
6. **A guard in the workflow does not cover direct `db` SDK writes to `sm_item_assembly`** (no table permission rules; fail-open) or `doTest`. A `PreUpdate` table-event workflow exists as a mechanism (`DOCS/workflow/syntax/flows.md`), but whether it can veto a write is UNVERIFIED.
7. **History, option 1: the platform `history` flag on IA fields.** It needs no extra nodes and catches every write path (form, SDK, workflow) with who and when and the after-values. It needs an IA form republish (owner decision). It does not record deletes, and before-values must be derived. Large JSON fields (`source_so_context_json`, `bom_snapshot_json`) would be copied into every version.
8. **History, option 2: an append-only change-log table written by the IA workflows** (the `gd_publish_step` pattern): one add-node per save or relink. It records only changes made through those workflows. It can store before and after explicitly, and it outlives the 20-entry cap in `source_so_context_json`.

## Open questions

1. Do workflow get, search and update nodes apply the caller's `su_code_permission` (row and field scope)? The docs say nothing. The `so_remarks2`-hidden employee role in tenant 239760 would be a test case.
2. Is `/workflow/doTest/{id}` limited to developers? Can a plain tenant user write `sm_item_assembly` through the `db` SDK (expected yes)?
3. Can a `PreUpdate` or `PreAdd` table-event workflow reject the write?
4. Is the platform history also written for `db` SDK writes and Excel imports (expected yes)? Can get or search nodes read the history table?
5. Can a tenant that does not have the app installed still run the app's workflows by id?
6. The exact server-side derivation of `firstLvDeptId` (inferred: the top-level ancestor of the token's first dept), and whether `{{global:deptParentId}}` resolves in workflows.
7. Prod parity: retention of `su_code_workflow_inst`; whether minted tokens are accepted (signing key).
8. Who created the table `so_planning_permission_probe_20261019` (4 rows `PROBE_A..D` ALLOW/DENY, tenants 000000 and 999998) and what it found. Nothing in the repo, memory or `~/Developer` refers to it.
9. The edit-history component requires "记录和审计访问权限" (record and audit access permissions). How is the audit access granted?
